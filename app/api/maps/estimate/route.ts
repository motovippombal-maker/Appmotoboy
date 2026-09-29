import { z } from "zod";
import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { calculateRoute } from "@/lib/backend/routing";
import { requireConfiguredFare } from "@/lib/backend/fare";
import { searchAddresses } from "@/lib/backend/geocoding";
import { publicPriceQuote, quoteRidePrice } from "@/lib/backend/ride-pricing";

const point = z.object({ address: z.string().min(3).max(200), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() });
const schema = z.object({
  origin: point,
  destination: point,
  couponCode: z.string().trim().min(3).max(24).optional(),
});

async function resolvePoint(input: z.infer<typeof point>) {
  if (input.lat !== undefined && input.lng !== undefined) return { address: input.address, lat: input.lat, lng: input.lng };
  const [result] = await searchAddresses(input.address);
  if (!result) throw new ApiError(422, `Endereço não encontrado: ${input.address}`, "ADDRESS_NOT_FOUND");
  return { address: result.address, lat: result.lat, lng: result.lng };
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `route-estimate:${user.id}`, 20, 60);
    const input = schema.parse(await request.json());
    const [resolvedOrigin, resolvedDestination] = await Promise.all([resolvePoint(input.origin), resolvePoint(input.destination)]);
    const origin = { address: resolvedOrigin.address, lat: resolvedOrigin.lat, lng: resolvedOrigin.lng };
    const destination = { address: resolvedDestination.address, lat: resolvedDestination.lat, lng: resolvedDestination.lng };
    const route = await calculateRoute(origin, destination);
    const { data: setting } = await supabase.from("system_settings").select("value").eq("key", "fare").single();
    requireConfiguredFare(setting?.value);
    const quoted = await quoteRidePrice({
      supabase,
      passengerId: user.id,
      origin,
      destination,
      couponCode: input.couponCode,
    });
    return Response.json({
      origin,
      destination,
      ...route,
      ...publicPriceQuote(quoted),
    });
  } catch (error) { return jsonError(error); }
}
