import { z } from "zod";
import { consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { reverseAddress } from "@/lib/backend/geocoding";

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `reverse-geocode:${user.id}`, 30, 60);
    const input = schema.parse(await request.json());
    return Response.json(await reverseAddress(input.lat, input.lng));
  } catch (error) {
    return jsonError(error);
  }
}
