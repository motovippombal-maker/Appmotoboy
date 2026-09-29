import { z } from "zod";

import {
  ApiError,
  consumeRateLimit,
  jsonError,
  requireUser,
} from "@/lib/backend/api";
import { getDispatchSettings } from "@/lib/backend/dispatch";
import { calculateRoute } from "@/lib/backend/routing";
import { etaTarget } from "@/lib/tracking/realtime";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user, profile } = await requireUser(request, [
      "passenger",
      "driver",
    ]);
    const { id } = paramsSchema.parse(await context.params);
    await consumeRateLimit(supabase, `tracking-route:${user.id}`, 12, 60);
    const ownerColumn =
      profile.role === "driver" ? "driver_id" : "passenger_id";
    const { data: ride, error } = await supabase
      .from("rides")
      .select(
        "id,status,driver_id,origin_lat,origin_lng,destination_lat,destination_lng",
      )
      .eq("id", id)
      .eq(ownerColumn, user.id)
      .not("status", "in", "(finalizada,cancelada)")
      .maybeSingle();
    if (error) throw error;
    if (!ride || !ride.driver_id) {
      throw new ApiError(
        404,
        "Acompanhamento da corrida indisponível.",
        "TRACKING_NOT_AVAILABLE",
      );
    }
    const target = etaTarget(ride.status, ride);
    if (!target) {
      throw new ApiError(
        409,
        "Esta corrida não possui uma rota de acompanhamento ativa.",
        "TRACKING_FINISHED",
      );
    }
    const [{ data: location, error: locationError }, tracking] =
      await Promise.all([
        supabase
          .from("driver_locations")
          .select(
            "driver_id,ride_id,latitude,longitude,accuracy_meters,updated_at",
          )
          .eq("driver_id", ride.driver_id)
          .eq("ride_id", ride.id)
          .maybeSingle(),
        getDispatchSettings(supabase),
      ]);
    if (locationError) throw locationError;
    if (!location) {
      throw new ApiError(
        409,
        "A localização do motorista ainda não está disponível.",
        "DRIVER_LOCATION_UNAVAILABLE",
      );
    }
    if (
      new Date(location.updated_at).getTime() <
      Date.now() - tracking.freshnessSeconds * 1000
    ) {
      throw new ApiError(
        409,
        "A localização do motorista está desatualizada.",
        "DRIVER_LOCATION_STALE",
      );
    }
    const route = await calculateRoute(
      { lat: location.latitude, lng: location.longitude },
      { lat: target.lat, lng: target.lng },
    );
    return Response.json({
      phase: target.phase,
      ...route,
      from: {
        lat: location.latitude,
        lng: location.longitude,
        updatedAt: location.updated_at,
      },
      to: { lat: target.lat, lng: target.lng },
      calculatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
