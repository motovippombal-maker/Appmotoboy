import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";

const schema = z.object({ status: z.enum(["motorista_a_caminho", "motorista_chegou", "em_corrida", "finalizada", "cancelada"]), reason: z.string().max(300).optional() });
const driverTransitions: Record<string, string> = { aceita: "motorista_a_caminho", motorista_a_caminho: "motorista_chegou", motorista_chegou: "em_corrida", em_corrida: "finalizada" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const input = schema.parse(await request.json());
    const { supabase, user, profile } = await requireUser(request);
    await consumeRateLimit(supabase, `ride-transition:${user.id}`, 30, 60);
    const { data: ride, error } = await supabase.from("rides").select("*").eq("id", id).single();
    if (error || !ride) throw new ApiError(404, "Corrida não encontrada.", "RIDE_NOT_FOUND");
    const ownsRide = profile.role === "admin" || ride.passenger_id === user.id || ride.driver_id === user.id;
    if (!ownsRide) throw new ApiError(403, "Você não participa desta corrida.", "FORBIDDEN");
    if (input.status === "cancelada") {
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
      return Response.json({ rideId: id, status: input.status, ride: changedRide });
    }
    if (ride.status === input.status) return Response.json({ rideId: id, status: input.status, ride, duplicate: true });
    if (driverTransitions[ride.status] !== input.status) {
      throw new ApiError(409, "Mudança de status não permitida.", "INVALID_RIDE_TRANSITION");
    }
    if (profile.role !== "admin" && (profile.role !== "driver" || ride.driver_id !== user.id)) throw new ApiError(403, "Somente o motorista vinculado pode executar esta ação.", "DRIVER_ONLY");
    const timestamps: Record<string, string> = {}; const now = new Date().toISOString();
    if (input.status === "motorista_chegou") timestamps.arrived_at = now;
    const { data: changedRide, error: updateError } = await supabase.from("rides").update({ status: input.status, ...timestamps }).eq("id", id).eq("status", ride.status).select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!changedRide) {
      const { data: currentRide } = await supabase.from("rides").select("id,status").eq("id", id).maybeSingle();
      if (currentRide?.status === input.status) return Response.json({ rideId: id, status: input.status, duplicate: true });
      throw new ApiError(409, "O status desta corrida já foi alterado.", "RIDE_STATE_CHANGED");
    }
    await supabase.from("ride_history").insert({ ride_id: id, from_status: ride.status, to_status: input.status, actor_id: user.id });
    await audit(supabase, user.id, `ride.${input.status}`, "ride", id);
    return Response.json({ rideId: id, status: input.status });
  } catch (error) { return jsonError(error); }
}
