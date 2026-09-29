import { z } from "zod";
import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { distanceKm } from "@/lib/backend/routing";

const schema = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), accuracyMeters: z.number().finite().nonnegative().max(10000).optional(), heading: z.number().finite().min(0).max(360).optional(), speedMps: z.number().finite().nonnegative().max(100).optional(), rideId: z.string().uuid().optional(), recordedAt: z.string().datetime().optional() });

export async function POST(request: Request) {
  try {
    const { supabase, user, profile } = await requireUser(request, ["passenger", "driver"]);
    await consumeRateLimit(supabase, `location:${user.id}`, 20, 60);
    const input = schema.parse(await request.json());
    let rideStatus: string | null = null;
    if (input.rideId) {
      const ownerColumn = profile.role === "driver" ? "driver_id" : "passenger_id";
      const { data: ownedRide } = await supabase.from("rides").select("id,status").eq("id", input.rideId).eq(ownerColumn, user.id).not("status", "in", "(finalizada,cancelada)").maybeSingle();
      if (!ownedRide) throw new ApiError(403, "Esta localização não pertence a uma corrida ativa sua.", "INVALID_RIDE_LOCATION");
      rideStatus = ownedRide.status;
    }
    if (profile.role === "driver") {
      const { data: driver } = await supabase.from("drivers").select("approval_status, online").eq("profile_id", user.id).single();
      if (driver?.approval_status !== "approved" || !driver.online) throw new ApiError(403, "Fique online para compartilhar sua localização.", "DRIVER_OFFLINE");
    }
    const receivedAt = new Date();
    const recordedAt = input.recordedAt ? new Date(input.recordedAt) : receivedAt;
    if (
      !Number.isFinite(recordedAt.getTime()) ||
      recordedAt.getTime() > receivedAt.getTime() + 30_000 ||
      recordedAt.getTime() < receivedAt.getTime() - 5 * 60_000
    ) {
      throw new ApiError(422, "A posição recebida está desatualizada ou possui horário inválido.", "INVALID_LOCATION_TIMESTAMP");
    }
    let locationApplied = true;
    if (profile.role === "driver") {
      const { data, error } = await supabase.rpc("upsert_driver_location_if_newer", {
        p_driver_id: user.id,
        p_ride_id: input.rideId || null,
        p_latitude: input.latitude,
        p_longitude: input.longitude,
        p_accuracy_meters: input.accuracyMeters,
        p_heading: input.heading,
        p_speed_mps: input.speedMps,
        p_recorded_at: recordedAt.toISOString(),
      });
      if (error) throw error;
      locationApplied = Boolean(data);
    } else {
      const result = await supabase.from("passenger_locations").upsert({ passenger_id: user.id, latitude: input.latitude, longitude: input.longitude, accuracy_meters: input.accuracyMeters, ride_id: input.rideId || null, updated_at: receivedAt.toISOString() });
      if (result.error) throw result.error;
    }
    let sampleAccepted = false;
    if (profile.role === "driver" && locationApplied && input.rideId && rideStatus === "em_corrida" && (input.accuracyMeters || 9999) <= 100) {
      const { data: previous } = await supabase.from("ride_location_points").select("latitude,longitude,recorded_at").eq("ride_id", input.rideId).eq("driver_id", user.id).eq("accepted", true).order("recorded_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
      const traveledMeters = previous ? distanceKm(
        { lat: previous.latitude, lng: previous.longitude },
        { lat: input.latitude, lng: input.longitude },
      ) * 1000 : 0;
      const elapsedSeconds = previous ? Math.max(1, (Date.now() - new Date(previous.recorded_at).getTime()) / 1000) : 0;
      const plausible = !previous || (traveledMeters >= 3 && traveledMeters <= Math.max(100, elapsedSeconds * 60));
      if (plausible) {
        const { error: sampleError } = await supabase.from("ride_location_points").insert({
          ride_id: input.rideId,
          driver_id: user.id,
          latitude: input.latitude,
          longitude: input.longitude,
          accuracy_meters: input.accuracyMeters || 100,
          heading: input.heading,
          speed_mps: input.speedMps,
        });
        if (sampleError) throw sampleError;
        sampleAccepted = true;
      }
    }
    return Response.json({ updated: locationApplied, sampleAccepted });
  } catch (error) { return jsonError(error); }
}
