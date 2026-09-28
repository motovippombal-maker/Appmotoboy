import { z } from "zod";
import { consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { findNearbyDrivers } from "@/lib/backend/dispatch";

const schema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `nearby:${user.id}`, 20, 60);
    const origin = schema.parse(await request.json());
    const { drivers, config } = await findNearbyDrivers(supabase, origin);
    return Response.json({
      radiusKm: config.radiusKm,
      freshnessSeconds: config.freshnessSeconds,
      drivers: drivers.map((driver, index) => ({
        markerId: `nearby-${index + 1}`,
        latitude: driver.latitude,
        longitude: driver.longitude,
        distanceMeters: Math.round(driver.distanceKm * 1000),
      })),
    });
  } catch (error) { return jsonError(error); }
}
