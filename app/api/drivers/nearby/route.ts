import { z } from "zod";
import { consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { listAvailableDriverLocations } from "@/lib/backend/dispatch";
import { calculateRoute } from "@/lib/backend/routing";

const schema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `nearby:${user.id}`, 20, 60);
    const origin = schema.parse(await request.json());
    const { drivers, config } = await listAvailableDriverLocations(supabase, origin);
    const nearest = drivers[0];
    const arrivalSeconds = nearest
      ? await calculateRoute(
          { lat: nearest.latitude, lng: nearest.longitude },
          origin,
        ).then((route) => route.durationSeconds).catch(() => null)
      : null;
    return Response.json({
      freshnessSeconds: config.freshnessSeconds,
      arrivalSeconds,
      drivers: drivers.map((driver, index) => ({
        markerId: `nearby-${index + 1}`,
        latitude: driver.latitude,
        longitude: driver.longitude,
        distanceMeters: Math.round(driver.distanceKm * 1000),
      })),
    });
  } catch (error) { return jsonError(error); }
}
