import { z } from "zod";
import { ApiError, audit, jsonError, requireAdmin } from "@/lib/backend/api";

const schema = z.object({ mode: z.enum(["round_robin", "broadcast"]) });

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const { data, error } = await supabase.from("system_settings")
      .select("value,updated_at").eq("key", "dispatch").single();
    if (error) throw error;
    return Response.json({
      mode: data.value?.mode_switch_ready === true && data.value?.mode === "broadcast" ? "broadcast" : "round_robin",
      ready: data.value?.mode_switch_ready === true,
      updatedAt: data.updated_at,
    });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    const { mode } = schema.parse(await request.json());
    const { data: current, error: currentError } = await supabase.from("system_settings")
      .select("value").eq("key", "dispatch").single();
    if (currentError) throw currentError;
    if (current.value?.mode_switch_ready !== true)
      throw new ApiError(503, "A atualização do banco para alternar o despacho ainda não foi aplicada.", "DISPATCH_MODE_NOT_READY");
    const { error } = await supabase.from("system_settings").update({
      value: { ...(current.value || {}), mode },
      updated_by: user.id,
    }).eq("key", "dispatch");
    if (error) throw error;
    await audit(supabase, user.id, "dispatch.mode_updated", "system_setting", "dispatch", { mode });
    return Response.json({ mode });
  } catch (error) { return jsonError(error); }
}
