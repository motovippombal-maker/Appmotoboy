import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";

const schema = z.object({ online: z.boolean(), location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracyMeters: z.number().nonnegative().max(10000).optional() }).optional() });
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]); await consumeRateLimit(supabase, `driver-status:${user.id}`, 10, 60);
    const input = schema.parse(await request.json());
    const { data: driver } = await supabase.from("drivers").select("approval_status").eq("profile_id", user.id).single();
    const { data: activeRide } = await supabase.from("rides").select("id").eq("driver_id", user.id).not("status", "in", "(finalizada,cancelada)").limit(1).maybeSingle();
    if (!input.online && activeRide) throw new ApiError(409, "Cancele ou conclua a corrida antes de ficar offline.", "ACTIVE_RIDE_IN_PROGRESS");
    if (input.online && driver?.approval_status !== "approved") throw new ApiError(403, "Seu cadastro precisa ser aprovado pela central antes de ficar online.", "DRIVER_NOT_APPROVED");
    if (input.online) {
      const { data: vehicle } = await supabase.from("vehicles").select("id").eq("driver_id", user.id).eq("active", true).limit(1).maybeSingle();
      if (!vehicle) throw new ApiError(403, "Cadastre sua moto antes de ficar online.", "VEHICLE_REQUIRED");
      if (!input.location) throw new ApiError(400, "A localização é obrigatória para ficar online.", "LOCATION_REQUIRED");
    }
    const available = input.online && !activeRide;
    const { error } = await supabase.from("drivers").update({ online: input.online, available }).eq("profile_id", user.id); if (error) throw error;
    const lastSeenAt = new Date().toISOString();
    if (input.online && input.location) {
      const location = await supabase.from("driver_locations").upsert({ driver_id: user.id, latitude: input.location.latitude, longitude: input.location.longitude, accuracy_meters: input.location.accuracyMeters, updated_at: lastSeenAt });
      if (location.error) throw location.error;
    } else {
      await supabase.from("driver_locations").update({ ride_id: null }).eq("driver_id", user.id);
    }
    await audit(supabase, user.id, input.online ? "driver.online" : "driver.offline", "driver", user.id);
    return Response.json({ online: input.online, available, lastSeenAt: input.online ? lastSeenAt : null });
  } catch (error) { return jsonError(error); }
}
