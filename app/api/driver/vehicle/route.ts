import { z } from "zod";
import { audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";

const schema = z.object({
  brand: z.string().trim().min(2).max(40),
  model: z.string().trim().min(2).max(60),
  color: z.string().trim().min(2).max(30),
  plate: z.string().trim().toUpperCase().regex(/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/, "Placa inválida."),
});

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    await consumeRateLimit(supabase, `driver-vehicle:${user.id}`, 6, 60);
    const input = schema.parse(await request.json());
    const { data: current } = await supabase.from("vehicles").select("id").eq("driver_id", user.id).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const mutation = current
      ? supabase.from("vehicles").update(input).eq("id", current.id).eq("driver_id", user.id).select("id, brand, model, color, plate, active").single()
      : supabase.from("vehicles").insert({ ...input, driver_id: user.id }).select("id, brand, model, color, plate, active").single();
    const { data: vehicle, error } = await mutation;
    if (error) throw error;
    await audit(supabase, user.id, current ? "vehicle.updated" : "vehicle.created", "vehicle", vehicle.id, { plate: input.plate });
    return Response.json({ vehicle });
  } catch (error) {
    return jsonError(error);
  }
}
