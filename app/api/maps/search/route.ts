import { z } from "zod";
import { consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { searchAddresses } from "@/lib/backend/geocoding";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `address-search:${user.id}`, 12, 60);
    const query = z.string().trim().min(3).max(160).parse(new URL(request.url).searchParams.get("q"));
    return Response.json({ results: await searchAddresses(query) });
  } catch (error) {
    return jsonError(error);
  }
}
