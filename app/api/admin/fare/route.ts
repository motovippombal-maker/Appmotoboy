import { z } from "zod";
import { audit, jsonError, requireUser } from "@/lib/backend/api";
import { parseFareConfig, serializeFareConfig } from "@/lib/backend/fare";

const schema = z.object({
  baseCents: z.number().int().min(0).max(1_000_000),
  perKmCents: z.number().int().min(0).max(1_000_000),
  perMinuteCents: z.number().int().min(0).max(1_000_000),
  minimumCents: z.number().int().min(0).max(1_000_000),
  configured: z.literal(true),
}).refine((fare) => fare.baseCents > 0 || fare.perKmCents > 0 || fare.perMinuteCents > 0 || fare.minimumCents > 0, {
  message: "Informe ao menos um componente de tarifa maior que zero.",
});

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser(request, ["admin"]);
    const { data, error } = await supabase.from("system_settings").select("value,updated_at").eq("key", "fare").single();
    if (error) throw error;
    return Response.json({ fare: parseFareConfig(data.value), updatedAt: data.updated_at });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["admin"]);
    const fare = schema.parse(await request.json());
    const { data: current, error: currentError } = await supabase.from("system_settings").select("value").eq("key", "fare").single();
    if (currentError) throw currentError;
    const { error } = await supabase.from("system_settings").update({
      value: { ...(current.value || {}), ...serializeFareConfig(fare) },
      updated_by: user.id,
    }).eq("key", "fare");
    if (error) throw error;
    await audit(supabase, user.id, "fare.updated", "system_setting", "fare", fare);
    return Response.json({ fare });
  } catch (error) { return jsonError(error); }
}
