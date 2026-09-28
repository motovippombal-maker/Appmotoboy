import { z } from "zod";
import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["admin"]);
    await consumeRateLimit(supabase, `admin-geocode:${user.id}`, 20, 60);
    const { address } = z.object({ address: z.string().trim().min(5).max(240) }).parse(await request.json());
    const query = encodeURIComponent(`${address}, Ribeira do Pombal, Bahia, Brasil`);
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=br&q=${query}`, {
      headers: { "User-Agent": "MotoVIP/1.0", "Accept-Language": "pt-BR" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new ApiError(503, "Busca de endereço indisponível.", "GEOCODING_UNAVAILABLE");
    const result = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
    if (!result[0]) throw new ApiError(422, "Endereço não encontrado.", "ADDRESS_NOT_FOUND");
    return Response.json({ address: result[0].display_name, latitude: Number(result[0].lat), longitude: Number(result[0].lon) });
  } catch (error) {
    return jsonError(error);
  }
}
