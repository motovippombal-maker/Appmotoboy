import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { expireRideSearches, findNearbyDrivers } from "@/lib/backend/dispatch";
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

const schema = z.object({
  origin: z.object({ address: z.string().min(3).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  destination: z.object({ address: z.string().min(3).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  paymentMethod: z.enum(["pix", "cash"]).default("pix"),
  couponCode: z.string().trim().min(3).max(24).optional(),
  quoteToken: z.string().min(40).max(5000),
});

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `ride-request:${user.id}`, 4, 60);
    const input = schema.parse(await request.json());
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
    const [route, nearbyResult, quoted] = await Promise.all([
      calculateRoute(input.origin, input.destination),
      findNearbyDrivers(supabase, input.origin),
      quoteRidePrice({
        supabase,
        passengerId: user.id,
        origin: input.origin,
        destination: input.destination,
        couponCode: input.couponCode,
      }),
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

    const { drivers: nearby, config } = nearbyResult;
    if (!nearby.length) throw new ApiError(409, "Nenhum motorista online e com GPS recente foi encontrado neste raio.", "NO_NEARBY_DRIVERS");
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
        throw new ApiError(409, "O cupom não está mais disponível. Calcule novamente.", "COUPON_REDEMPTION_FAILED");
      }
    }

    const { error: offersError } = await supabase.from("ride_requests").insert(nearby.map((driver) => ({ ride_id: ride.id, driver_id: driver.driverId, expires_at: new Date(Date.now() + config.offerSeconds * 1000).toISOString() })));
    if (offersError) {
      await supabase.from("rides").update({ status: "cancelada", cancelled_at: new Date().toISOString(), cancelled_by: user.id, cancellation_reason: "Falha ao distribuir a solicitação" }).eq("id", ride.id);
      throw new ApiError(503, "Não foi possível avisar os motoristas agora.", "DISPATCH_FAILED");
    }
    await supabase.from("passenger_locations").upsert({ passenger_id: user.id, ride_id: ride.id, latitude: input.origin.lat, longitude: input.origin.lng });
    await supabase.from("ride_history").insert({ ride_id: ride.id, to_status: "procurando_motorista", actor_id: user.id });
    await audit(supabase, user.id, "ride.requested", "ride", ride.id, { offered_drivers: nearby.length, fare_region_id: resolvedFare.fareRegion.id, fare_region_name: resolvedFare.fareRegion.name, service_area_id: resolvedFare.serviceArea.id, fare_cents: fareCents, quote_fingerprint: quoted.claims.ruleFingerprint, coupon_code: coupon?.code ?? null, discount_cents: coupon?.discountCents ?? 0 });
    return Response.json({ ride, offeredDrivers: nearby.length, radiusKm: config.radiusKm }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
