import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { expireRideSearches } from "@/lib/backend/dispatch";
import { calculateRoute } from "@/lib/backend/routing";
import { requireConfiguredFare } from "@/lib/backend/fare";
import {
  quoteHasExpired,
  quoteMatches,
  QuoteTokenError,
  verifyQuoteToken,
} from "@/lib/backend/quote-token";
import {
  publicPriceQuote,
  quoteRidePrice,
  quoteSecretForVerification,
} from "@/lib/backend/ride-pricing";
import { assertPaymentMethodAvailable } from "@/lib/backend/payment";
import { dispatchPushQueue } from "@/lib/backend/push";

const schema = z.object({
  origin: z.object({ address: z.string().min(3).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  destination: z.object({ address: z.string().min(3).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  paymentMethod: z.enum(["pix", "cash"]).default("cash"),
  couponCode: z.string().trim().min(3).max(24).optional(),
  quoteToken: z.string().min(40).max(5000),
});

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `ride-request:${user.id}`, 4, 60);
    const input = schema.parse(await request.json());
    assertPaymentMethodAvailable(input.paymentMethod);
    await expireRideSearches(supabase);
    const { data: existingRide } = await supabase.from("rides").select("id,status").eq("passenger_id", user.id).not("status", "in", "(finalizada,cancelada)").limit(1).maybeSingle();
    if (existingRide) throw new ApiError(409, "Você já possui uma corrida ativa. O estado atual foi preservado.", "ACTIVE_RIDE_EXISTS");
    let previousQuote;
    try {
      previousQuote = verifyQuoteToken(
        input.quoteToken,
        quoteSecretForVerification(),
      );
    } catch (error) {
      if (error instanceof QuoteTokenError) {
        throw new ApiError(
          409,
          "A cotação não pôde ser validada. Calcule novamente.",
          "INVALID_QUOTE",
        );
      }
      throw error;
    }
    const { data: fareConfig } = await supabase.from("system_settings").select("value").eq("key", "fare").single();
    requireConfiguredFare(fareConfig?.value);
    const routePromise = calculateRoute(input.origin, input.destination);
    const quotePromise = quoteRidePrice({
      supabase,
      passengerId: user.id,
      origin: input.origin,
      destination: input.destination,
      couponCode: input.couponCode,
    }).catch(async (quoteError: unknown) => {
      if (!(quoteError instanceof ApiError) || !quoteError.code.startsWith("COUPON_")) throw quoteError;
      const [route, withoutCoupon] = await Promise.all([
        routePromise,
        quoteRidePrice({ supabase, passengerId: user.id, origin: input.origin, destination: input.destination }),
      ]);
      throw new ApiError(409, "O cupom mudou. Confirme a nova cotação.", "QUOTE_PRICE_CHANGED", {
        quote: { origin: input.origin, destination: input.destination, ...route, ...publicPriceQuote(withoutCoupon) },
      });
    });
    const [route, quoted] = await Promise.all([
      routePromise,
      quotePromise,
    ]);
    const refreshedQuote = {
      origin: input.origin,
      destination: input.destination,
      ...route,
      ...publicPriceQuote(quoted),
    };
    if (
      previousQuote.passengerId !== user.id ||
      !quoteMatches(previousQuote, quoted.claims)
    ) {
      throw new ApiError(
        409,
        "O valor da corrida foi atualizado. Confirme o novo valor.",
        "QUOTE_PRICE_CHANGED",
        { quote: refreshedQuote },
      );
    }
    if (quoteHasExpired(previousQuote)) {
      throw new ApiError(
        409,
        "A cotação expirou. Confirme novamente o valor atualizado.",
        "QUOTE_EXPIRED",
        { quote: refreshedQuote },
      );
    }

    const { coupon, resolvedFare, fareCents } = quoted;
    const ridePayload: Record<string, unknown> = { passenger_id: user.id, status: "procurando_motorista", origin_address: input.origin.address, origin_lat: input.origin.lat, origin_lng: input.origin.lng, destination_address: input.destination.address, destination_lat: input.destination.lat, destination_lng: input.destination.lng, distance_meters: route.distanceMeters, duration_seconds: route.durationSeconds, route_geometry: route.geometry, fare_cents: fareCents, estimated_distance_meters: route.distanceMeters, estimated_duration_seconds: route.durationSeconds, estimated_fare_cents: fareCents, fare_region_id: resolvedFare.fareRegion.id, fare_region_name: resolvedFare.fareRegion.name, fare_pricing_mode: "region", fare_rule_snapshot: resolvedFare.snapshot, service_area_id: resolvedFare.serviceArea.id, service_area_name: resolvedFare.serviceArea.name, fare_quote_fingerprint: quoted.claims.ruleFingerprint, payment_method: input.paymentMethod };
    if (coupon) {
      ridePayload.fare_rule_snapshot = { ...resolvedFare.snapshot, coupon: { code: coupon.code, discountCents: coupon.discountCents } };
      ridePayload.coupon_id = coupon.id;
      ridePayload.coupon_code = coupon.code;
      ridePayload.discount_cents = coupon.discountCents;
      ridePayload.original_fare_cents = coupon.originalFareCents;
    }
    const { data: ride, error } = await supabase.from("rides").insert(ridePayload).select().single();
    if (error?.code === "23505") throw new ApiError(409, "A corrida já foi solicitada. Sincronize para acompanhar o estado atual.", "RIDE_REQUEST_ALREADY_EXISTS");
    if (error || !ride) throw error || new Error("Ride creation failed");

    if (coupon) {
      const { error: redemptionError } = await supabase.from("coupon_redemptions").insert({ coupon_id: coupon.id, user_id: user.id, ride_id: ride.id, discount_cents: coupon.discountCents });
      if (redemptionError) {
        await supabase.from("rides").update({ status: "cancelada", cancelled_at: new Date().toISOString(), cancelled_by: user.id, cancellation_reason: "Falha ao reservar o cupom" }).eq("id", ride.id);
        const withoutCoupon = await quoteRidePrice({ supabase, passengerId: user.id, origin: input.origin, destination: input.destination });
        throw new ApiError(409, "O cupom não está mais disponível. Confirme a nova cotação.", "QUOTE_PRICE_CHANGED", {
          quote: { origin: input.origin, destination: input.destination, ...route, ...publicPriceQuote(withoutCoupon) },
        });
      }
    }

    const { data: offeredDriver, error: offersError } = await supabase.rpc("dispatch_next_offer", { p_ride_id: ride.id });
    if (offersError || !offeredDriver) {
      await supabase.from("rides").update({ status: "cancelada", cancelled_at: new Date().toISOString(), cancelled_by: user.id, cancellation_reason: "Falha ao distribuir a solicitação" }).eq("id", ride.id);
      if (coupon) await supabase.from("coupon_redemptions").delete().eq("ride_id", ride.id);
      if (offersError) throw new ApiError(503, "Não foi possível distribuir a corrida agora.", "DISPATCH_FAILED");
      throw new ApiError(409, "Nenhum motorista online e disponível está elegível agora.", "NO_AVAILABLE_DRIVERS");
    }
    await supabase.from("passenger_locations").upsert({ passenger_id: user.id, ride_id: ride.id, latitude: input.origin.lat, longitude: input.origin.lng });
    await supabase.from("ride_history").insert({ ride_id: ride.id, to_status: "procurando_motorista", actor_id: user.id });
    const [{ data: dispatchSetting }, { count: offeredDrivers }] = await Promise.all([
      supabase.from("system_settings").select("value").eq("key", "dispatch").single(),
      supabase.from("ride_requests").select("id", { count: "exact", head: true }).eq("ride_id", ride.id),
    ]);
    await audit(supabase, user.id, "ride.requested", "ride", ride.id, { offered_driver: offeredDriver, dispatch_mode: dispatchSetting?.value?.mode === "broadcast" ? "broadcast" : "round_robin", fare_region_id: resolvedFare.fareRegion.id, fare_region_name: resolvedFare.fareRegion.name, service_area_id: resolvedFare.serviceArea.id, fare_cents: fareCents, quote_fingerprint: quoted.claims.ruleFingerprint, coupon_code: coupon?.code ?? null, discount_cents: coupon?.discountCents ?? 0 });
    // O envio direto torna o alerta útil dentro da janela curta da oferta.
    // Falhas de Push nunca desfazem a corrida: Realtime e polling continuam ativos.
    try {
      const { data: offerNotifications } = await supabase.from("notifications")
        .select("id")
        .eq("type", "ride.offer")
        .contains("data", { rideId: ride.id });
      const notificationIds = (offerNotifications || []).map((notification) => notification.id);
      if (notificationIds.length) await dispatchPushQueue(50, notificationIds);
    } catch {
      // Push é complementar; a oferta já está disponível por Realtime e polling.
    }
    return Response.json({ ride, offeredDrivers: offeredDrivers ?? 1 }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
