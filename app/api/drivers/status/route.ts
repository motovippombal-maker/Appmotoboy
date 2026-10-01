import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";

const schema = z.object({ online: z.boolean(), location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracyMeters: z.number().nonnegative().max(10000).optional() }).optional() });
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]); await consumeRateLimit(supabase, `driver-status:${user.id}`, 10, 60);
    const input = schema.parse(await request.json());
    const { data: driver } = await supabase.from("drivers").select("approval_status").eq("profile_id", user.id).single();
    if (input.online && driver?.approval_status !== "approved") throw new ApiError(403, "Seu cadastro precisa ser aprovado pela central antes de ficar online.", "DRIVER_NOT_APPROVED");
    if (input.online) {
      const { data: vehicle } = await supabase.from("vehicles").select("id").eq("driver_id", user.id).eq("active", true).limit(1).maybeSingle();
      if (!vehicle) throw new ApiError(403, "Cadastre sua moto antes de ficar online.", "VEHICLE_REQUIRED");
    }
    const lastSeenAt = new Date().toISOString();
    const { data: status, error } = await supabase.rpc("set_driver_online_status", {
      p_driver_id: user.id,
      p_online: input.online,
      p_latitude: input.online ? input.location?.latitude ?? null : null,
      p_longitude: input.online ? input.location?.longitude ?? null : null,
      p_accuracy_meters: input.online ? input.location?.accuracyMeters ?? null : null,
      p_recorded_at: lastSeenAt,
    });
    if (error?.message?.includes("Conclua ou cancele a corrida"))
      throw new ApiError(409, "Conclua ou cancele a corrida antes de ficar offline.", "ACTIVE_RIDE_IN_PROGRESS");
    if (error) throw error;
    const available = status?.available === true;
    await audit(supabase, user.id, input.online ? "driver.online" : "driver.offline", "driver", user.id);
    return Response.json({ online: input.online, available, lastSeenAt: input.online ? lastSeenAt : null });
  } catch (error) { return jsonError(error); }
}
