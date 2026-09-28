import { z } from "zod";
import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { calculateRoute } from "@/lib/backend/routing";
import { requireConfiguredFare } from "@/lib/backend/fare";
import { regionLabels, resolveRegionFare } from "@/lib/backend/region-fare";

const point = z.object({ address: z.string().min(3).max(200), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() });
const schema = z.object({ origin: point, destination: point });

async function resolvePoint(input: z.infer<typeof point>) {
  if (input.lat !== undefined && input.lng !== undefined) return { address: input.address, lat: input.lat, lng: input.lng, regionLabels: [] as string[] };
  const query = encodeURIComponent(`${input.address}, Ribeira do Pombal, Bahia, Brasil`);
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=br&q=${query}`, { headers: { "User-Agent": "MotoVIP/1.0", "Accept-Language": "pt-BR" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new ApiError(503, "Busca de endereço indisponível.", "GEOCODING_UNAVAILABLE");
  const result = await response.json() as Array<{ lat: string; lon: string; display_name: string; address?: Record<string, string> }>;
  if (!result[0]) throw new ApiError(422, `Endereço não encontrado: ${input.address}`, "ADDRESS_NOT_FOUND");
  return { address: result[0].display_name, lat: Number(result[0].lat), lng: Number(result[0].lon), regionLabels: regionLabels(result[0].address) };
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
    const regionalFare = await resolveRegionFare(supabase, resolvedDestination.address, resolvedDestination.regionLabels);
    return Response.json({ origin, destination, ...route, fareCents: regionalFare.fareCents, fareRegion: regionalFare.fareRegion, pricingMode: "region" });
  } catch (error) { return jsonError(error); }
}
