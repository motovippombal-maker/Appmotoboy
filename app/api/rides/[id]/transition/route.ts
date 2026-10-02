import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { distanceKm } from "@/lib/backend/routing";
import { parseCancellationPolicy } from "@/lib/backend/cancellation-policy";
import { dispatchPushQueue } from "@/lib/backend/push";

const schema = z.object({ status: z.enum(["motorista_a_caminho", "motorista_chegou", "em_corrida", "finalizada", "cancelada"]), reason: z.string().max(300).optional(),
  reasonCode: z.enum(["mechanical", "personal", "cannot_reach", "unsafe", "passenger_requested", "address", "other"]).optional(),
  offlineEvent: z.object({ eventId: z.string().uuid(), timestamp: z.string().datetime(), coordinates: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable() }).optional() });
const driverTransitions: Record<string, string> = { aceita: "motorista_a_caminho", motorista_a_caminho: "motorista_chegou", motorista_chegou: "em_corrida", em_corrida: "finalizada" };

function offlineMetadata(event: NonNullable<z.infer<typeof schema>["offlineEvent"]>) {
  return { offlineEventId: event.eventId, occurredAt: event.timestamp,
    coordinates: event.coordinates, synchronizedAt: new Date().toISOString() };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const input = schema.parse(await request.json());
    const { supabase, user, profile } = await requireUser(request, undefined, { allowBlocked: true });
    await consumeRateLimit(supabase, `ride-transition:${user.id}`, 30, 60);
    const { data: ride, error } = await supabase.from("rides").select("*").eq("id", id).single();
    if (error || !ride) throw new ApiError(404, "Corrida não encontrada.", "RIDE_NOT_FOUND");
    if (input.offlineEvent) {
      if (profile.role !== "driver" || ride.driver_id !== user.id || !["motorista_chegou", "em_corrida", "finalizada"].includes(input.status))
        throw new ApiError(403, "Evento offline inválido para esta corrida.", "INVALID_OFFLINE_EVENT");
      const happened = Date.parse(input.offlineEvent.timestamp);
      const previous = input.status === "finalizada" ? ride.started_at : input.status === "em_corrida" ? ride.arrived_at : ride.accepted_at;
      if (!Number.isFinite(happened) || happened > Date.now() + 30_000 || happened < Date.now() - 24 * 60 * 60_000 ||
          (previous && happened < Date.parse(previous)))
        throw new ApiError(422, "Horário do evento offline inválido.", "INVALID_OFFLINE_TIMESTAMP");
      if (input.status === "finalizada" && ride.fare_pricing_mode !== "region")
        throw new ApiError(409, "Tarifa variável exige conferência da central após viagem offline.", "OFFLINE_FARE_REVIEW_REQUIRED");
    }
    if (profile.blocked && (profile.role === "admin" || ride.status === "finalizada" || ride.status === "cancelada" || !["cancelada", "em_corrida", "finalizada", "motorista_a_caminho", "motorista_chegou"].includes(input.status)))
      throw new ApiError(403, "Conta bloqueada.", "ACCOUNT_BLOCKED");
    if (input.status === "cancelada" && profile.role === "driver" && input.reason !== "NO_SHOW") {
        if (!input.reasonCode || !input.reason?.trim())
          throw new ApiError(422, "Informe o motivo do cancelamento.", "CANCELLATION_REASON_REQUIRED");
        const { data: reassignedRide, error: reassignmentError } = await supabase.rpc("driver_cancel_and_redispatch", {
          p_ride_id: id, p_driver_id: user.id, p_reason_code: input.reasonCode, p_reason_text: input.reason.trim(),
        });
        if (reassignmentError) throw reassignmentError;
        if (!reassignedRide) throw new ApiError(409, "Esta corrida já mudou de etapa. Atualize para conferir.", "RIDE_STATE_CHANGED");
        try { await dispatchPushQueue(50); } catch { /* A oferta permanece disponível por Realtime e polling. */ }
        return Response.json({ rideId: id, status: reassignedRide.status, ride: reassignedRide,
          redispatched: reassignedRide.status === "procurando_motorista" });
    }
    const ownsRide = profile.role === "admin" || ride.passenger_id === user.id || ride.driver_id === user.id;
    if (!ownsRide) throw new ApiError(403, "Você não participa desta corrida.", "FORBIDDEN");
    if (input.status === "cancelada") {
      if (profile.role === "driver" && input.reason === "NO_SHOW" && !ride.arrival_verified)
        throw new ApiError(409, "Confirme a chegada ao embarque com GPS antes de registrar ausência.", "ARRIVAL_NOT_VERIFIED");
      const { data: changedRide, error: rpcError } = await supabase.rpc("cancel_ride", {
        p_ride_id: id,
        p_actor_id: user.id,
        p_reason: input.reason || null,
      });
      if (rpcError) throw rpcError;
      if (!changedRide) throw new ApiError(409, "Esta corrida não pode mais ser cancelada.", "CANCELLATION_NOT_ALLOWED");
      return Response.json({ rideId: id, status: input.status, ride: changedRide, duplicate: ride.status === "cancelada" });
    }
    if (["em_corrida", "finalizada"].includes(input.status)) {
      if (profile.role !== "driver" || ride.driver_id !== user.id) throw new ApiError(403, "Somente o motorista vinculado pode executar esta ação.", "DRIVER_ONLY");
      if (ride.status === input.status) return Response.json({ rideId: id, status: input.status, ride, duplicate: true });
      if (driverTransitions[ride.status] !== input.status) throw new ApiError(409, "Mudança de status não permitida.", "INVALID_RIDE_TRANSITION");
      const functionName = input.status === "em_corrida" ? "start_ride" : "finish_ride";
      const { data: changedRide, error: rpcError } = await supabase.rpc(functionName, { p_ride_id: id, p_driver_id: user.id });
      if (rpcError?.message?.includes("Tarifa nao configurada")) throw new ApiError(409, "A central precisa confirmar a tarifa antes de finalizar.", "FARE_NOT_CONFIGURED");
      if (rpcError) throw rpcError;
      if (!changedRide) throw new ApiError(409, "O status desta corrida já foi alterado.", "RIDE_STATE_CHANGED");
      if (input.offlineEvent) {
        const occurredAt = input.offlineEvent.timestamp;
        const patch = input.status === "em_corrida"
          ? { started_at: occurredAt }
          : { completed_at: occurredAt, finished_at: occurredAt,
              actual_duration_seconds: Math.max(1, Math.floor((Date.parse(occurredAt) - Date.parse(ride.started_at)) / 1000)),
              actual_distance_meters: null };
        const { error: timestampError } = await supabase.from("rides").update(patch).eq("id", id).eq("status", input.status);
        if (timestampError) throw timestampError;
        const { data: history } = await supabase.from("ride_history").select("id,metadata").eq("ride_id", id).eq("to_status", input.status).order("id", { ascending: false }).limit(1).maybeSingle();
        if (history) {
          const { error: historyError } = await supabase.from("ride_history").update({ metadata: {
            ...(history.metadata && typeof history.metadata === "object" ? history.metadata : {}),
            ...offlineMetadata(input.offlineEvent), distanceUnverified: input.status === "finalizada",
          } }).eq("id", history.id);
          if (historyError) throw historyError;
        }
      }
      return Response.json({ rideId: id, status: input.status, ride: changedRide });
    }
    if (ride.status === input.status) return Response.json({ rideId: id, status: input.status, ride, duplicate: true });
    if (driverTransitions[ride.status] !== input.status) {
      throw new ApiError(409, "Mudança de status não permitida.", "INVALID_RIDE_TRANSITION");
    }
    if (profile.role !== "admin" && (profile.role !== "driver" || ride.driver_id !== user.id)) throw new ApiError(403, "Somente o motorista vinculado pode executar esta ação.", "DRIVER_ONLY");
    let arrivalVerified = false;
    if (input.status === "motorista_chegou") {
      const { data: setting } = await supabase.from("system_settings").select("value")
        .eq("key", "cancellation_policy").maybeSingle();
      const policy = parseCancellationPolicy(setting?.value);
      const pickup = { lat: ride.origin_lat, lng: ride.origin_lng };
      if (input.offlineEvent) {
        const point = input.offlineEvent.coordinates;
        if (!point || distanceKm(point, pickup) * 1000 > policy.arrival_radius_meters)
          throw new ApiError(409, "Chegue perto do embarque para confirmar a chegada.", "OUTSIDE_PICKUP_GEOFENCE");
      } else {
        const { data: location, error: locationError } = await supabase.from("driver_locations")
          .select("ride_id,latitude,longitude,accuracy_meters,updated_at")
          .eq("driver_id", ride.driver_id).maybeSingle();
        if (locationError) throw locationError;
        if (!location || location.ride_id !== id || Number(location.accuracy_meters) > 40 ||
          Date.parse(location.updated_at) < Date.now() - 30_000 ||
          distanceKm({ lat: location.latitude, lng: location.longitude }, pickup) * 1000 > policy.arrival_radius_meters)
          throw new ApiError(409, "Aguardando GPS preciso perto do embarque para confirmar chegada.", "OUTSIDE_PICKUP_GEOFENCE");
        arrivalVerified = true;
      }
    }
    const timestamps: Record<string, string> = {}; const now = new Date().toISOString();
    if (input.status === "motorista_chegou") timestamps.arrived_at = input.offlineEvent?.timestamp || now;
    const { data: changedRide, error: updateError } = await supabase.from("rides").update({ status: input.status, ...timestamps,
      ...(input.status === "motorista_chegou" ? { arrival_verified: arrivalVerified, arrival_server_at: now } : {}) })
      .eq("id", id).eq("status", ride.status).select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!changedRide) {
      const { data: currentRide } = await supabase.from("rides").select("id,status").eq("id", id).maybeSingle();
      if (currentRide?.status === input.status) return Response.json({ rideId: id, status: input.status, duplicate: true });
      throw new ApiError(409, "O status desta corrida já foi alterado.", "RIDE_STATE_CHANGED");
    }
    await supabase.from("ride_history").insert({ ride_id: id, from_status: ride.status, to_status: input.status, actor_id: user.id,
      metadata: input.offlineEvent ? offlineMetadata(input.offlineEvent) : {} });
    await audit(supabase, user.id, `ride.${input.status}`, "ride", id);
    return Response.json({ rideId: id, status: input.status });
  } catch (error) { return jsonError(error); }
}
