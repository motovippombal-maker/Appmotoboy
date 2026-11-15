import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { boundaryContains } from "@/lib/backend/pricing-rules";
import { marketPoint } from "@/lib/marketplace/customer-contract";
import { marketResponse } from "@/lib/marketplace/customer-server";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `market-address:${user.id}`, 15, 60);
    const point = marketPoint.parse(await request.json());
    const { data, error } = await supabase.from("service_areas")
      .select("id,name,boundary,priority").eq("active", true).eq("allow_destinations", true)
      .order("priority", { ascending: false }).order("id");
    if (error || !data?.length) throw new ApiError(503, "A área atendida ainda não está configurada.", "SERVICE_AREA_NOT_CONFIGURED");
    const serviceAreas = data.filter(({ boundary }) => boundaryContains(boundary, point))
      .sort((a, b) => b.priority - a.priority || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, 1).map(({ id, name }) => ({ id, name }));
    if (!serviceAreas.length) throw new ApiError(422, "Este endereço fica fora da área atendida.", "DESTINATION_OUTSIDE_SERVICE_AREA");
    return marketResponse({ serviceAreas });
  } catch (error) { return jsonError(error); }
}
