import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { distanceKm } from "@/lib/backend/routing";
import { driverLocationRpcArgs } from "@/lib/backend/driver-location-rpc";
import { driverLocationInputSchema } from "@/lib/location/driver-location-input";


export async function POST(request: Request) {
  try {
    const { supabase, user, profile } = await requireUser(request, ["passenger", "driver"], { allowBlocked: true });
    // Um motorista pode manter a corrida aberta em mais de uma aba/aparelho.
    // O limite anterior (20/min) rejeitava posições válidas durante a navegação.
    await consumeRateLimit(supabase, `location:${user.id}`, profile.role === "driver" ? 90 : 30, 60);
    const parsed = driverLocationInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "body"))];
      console.warn("[LOCATION_INPUT_INVALID]", fields.join(","));
      throw new ApiError(400, "O aparelho enviou uma posição inválida.", "INVALID_LOCATION_INPUT", { fields });
    }
    const input = parsed.data;
    if (profile.blocked && !input.rideId) throw new ApiError(403, "Conta bloqueada.", "ACCOUNT_BLOCKED");
    let rideStatus: string | null = null;
    if (input.rideId) {
      const ownerColumn = profile.role === "driver" ? "driver_id" : "passenger_id";
      const { data: ownedRide } = await supabase.from("rides").select("id,status").eq("id", input.rideId).eq(ownerColumn, user.id).not("status", "in", "(finalizada,cancelada)").maybeSingle();
      if (!ownedRide) throw new ApiError(403, "Esta localização não pertence a uma corrida ativa sua.", "INVALID_RIDE_LOCATION");
      rideStatus = ownedRide.status;
    }
    if (profile.role === "driver") {
      const { data: driver } = await supabase.from("drivers").select("approval_status, online").eq("profile_id", user.id).single();
      if (!profile.blocked && (driver?.approval_status !== "approved" || !driver.online)) throw new ApiError(403, "Fique online para compartilhar sua localização.", "DRIVER_OFFLINE");
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
      const { data, error } = await supabase.rpc("upsert_driver_location_if_newer", driverLocationRpcArgs({
        driverId: user.id, rideId: input.rideId, latitude: input.latitude,
        longitude: input.longitude, accuracyMeters: input.accuracyMeters,
        heading: input.heading, speedMps: input.speedMps, recordedAt: recordedAt.toISOString(),
      }));
      if (error) throw error;
      locationApplied = Boolean(data);
      if (locationApplied && input.rideId && ["aceita", "motorista_a_caminho", "motorista_chegou"].includes(rideStatus || "")
        && input.accuracyMeters !== undefined && input.accuracyMeters <= 40) {
        const { error: approachError } = await supabase.from("ride_approach_points").insert({
          ride_id: input.rideId, driver_id: user.id, latitude: input.latitude,
          longitude: input.longitude, accuracy_meters: input.accuracyMeters,
        });
        // A gravação auxiliar não pode derrubar a posição principal.
        if (approachError && approachError.code !== "42P01")
          console.error("[GPS] approach sample rejected", approachError.code);
      }
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
