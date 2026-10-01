import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireAdmin } from "@/lib/backend/api";

const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  amountCents: z.number().int().min(1).max(1_000_000),
  active: z.boolean(),
});

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const { data, error } = await supabase.from("fare_regions").select("id,name,amount_cents,active,is_default,updated_at").order("is_default", { ascending: false }).order("name");
    if (error) throw error;
    return Response.json({ regions: data || [] });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    await consumeRateLimit(supabase, `admin-fare-regions:${user.id}`, 30, 60);
    const input = schema.parse(await request.json());
    let region;
    if (input.id) {
      const existing = await supabase.from("fare_regions").select("id,is_default").eq("id", input.id).single();
      if (existing.error || !existing.data) throw new ApiError(404, "Região não encontrada.", "FARE_REGION_NOT_FOUND");
      if (existing.data.is_default && !input.active) throw new ApiError(409, "A tarifa padrão da cidade precisa permanecer ativa.", "DEFAULT_FARE_REQUIRED");
      const updated = await supabase.from("fare_regions").update({ name: input.name, amount_cents: input.amountCents, active: input.active }).eq("id", input.id).select("id,name,amount_cents,active,is_default,updated_at").single();
      if (updated.error?.code === "23505") throw new ApiError(409, "Já existe uma tarifa com esse nome.", "FARE_REGION_DUPLICATE");
      if (updated.error) throw updated.error;
      region = updated.data;
    } else {
      const created = await supabase.from("fare_regions").insert({ name: input.name, amount_cents: input.amountCents, active: input.active, is_default: false }).select("id,name,amount_cents,active,is_default,updated_at").single();
      if (created.error?.code === "23505") throw new ApiError(409, "Já existe uma tarifa com esse nome.", "FARE_REGION_DUPLICATE");
      if (created.error) throw created.error;
      region = created.data;
    }
    await audit(supabase, user.id, input.id ? "fare_region.updated" : "fare_region.created", "fare_region", region.id, { name: region.name, amount_cents: region.amount_cents, active: region.active });
    return Response.json({ region }, { status: input.id ? 200 : 201 });
  } catch (error) { return jsonError(error); }
}
