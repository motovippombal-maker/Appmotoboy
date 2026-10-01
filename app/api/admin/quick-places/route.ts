import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireAdmin } from "@/lib/backend/api";

const categories = [
  "hospital", "education", "bus_station", "government", "market", "pharmacy",
  "square", "fuel", "bank", "atm", "restaurant", "hotel", "church", "sports",
  "gym", "store", "moto_vip", "generic",
] as const;
const icons = [
  "hospital", "education", "bus", "government", "market", "pharmacy", "square",
  "fuel", "bank", "atm", "restaurant", "hotel", "church", "sports", "gym",
  "store", "bike", "pin",
] as const;

const placeSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().min(5).max(240),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  category: z.enum(categories),
  icon: z.enum(icons),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  active: z.boolean(),
  featured: z.boolean(),
  locationVerified: z.boolean(),
  sortOrder: z.number().int().min(0).max(100000),
}).superRefine((input, context) => {
  if (input.active && !input.locationVerified) {
    context.addIssue({
      code: "custom",
      path: ["locationVerified"],
      message: "Defina e confirme a localização exata no mapa antes de ativar o ponto.",
    });
  }
});

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const { data, error } = await supabase
      .from("quick_places")
      .select("id,name,address,latitude,longitude,category,icon,color,active,featured,sort_order,created_at,updated_at")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw error;
    return Response.json({ places: data || [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    await consumeRateLimit(supabase, `admin-quick-places:${user.id}`, 60, 60);
    const input = placeSchema.parse(await request.json());
    const values = {
      name: input.name,
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
      category: input.category,
      icon: input.icon,
      color: input.color,
      active: input.active,
      featured: input.featured,
      sort_order: input.sortOrder,
    };
    const result = input.id
      ? await supabase.from("quick_places").update(values).eq("id", input.id).select("*").single()
      : await supabase.from("quick_places").insert(values).select("*").single();
    if (result.error?.code === "23505") throw new ApiError(409, "Já existe um ponto rápido com esse nome e endereço.", "QUICK_PLACE_DUPLICATE");
    if (result.error) throw result.error;
    await audit(supabase, user.id, input.id ? "quick_place.updated" : "quick_place.created", "quick_place", result.data.id, { name: result.data.name });
    return Response.json({ place: result.data }, { status: input.id ? 200 : 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    await consumeRateLimit(supabase, `admin-quick-places-order:${user.id}`, 30, 60);
    const { orderedIds } = z.object({ orderedIds: z.array(z.string().uuid()).min(1).max(500) }).parse(await request.json());
    const uniqueIds = [...new Set(orderedIds)];
    if (uniqueIds.length !== orderedIds.length) throw new ApiError(400, "A ordem contém pontos repetidos.", "INVALID_ORDER");
    const updates = await Promise.all(uniqueIds.map((id, index) =>
      supabase.from("quick_places").update({ sort_order: (index + 1) * 10 }).eq("id", id).select("id").single(),
    ));
    const failed = updates.find((item) => item.error);
    if (failed?.error) throw failed.error;
    await audit(supabase, user.id, "quick_place.reordered", "quick_place", undefined, { ordered_ids: uniqueIds });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    await consumeRateLimit(supabase, `admin-quick-places-delete:${user.id}`, 20, 60);
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    const { data: existing, error: findError } = await supabase.from("quick_places").select("id,name").eq("id", id).single();
    if (findError || !existing) throw new ApiError(404, "Ponto rápido não encontrado.", "QUICK_PLACE_NOT_FOUND");
    const { error } = await supabase.from("quick_places").delete().eq("id", id);
    if (error) throw error;
    await audit(supabase, user.id, "quick_place.deleted", "quick_place", id, { name: existing.name });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
