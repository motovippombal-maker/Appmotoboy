import { ApiError, audit, jsonError, requireAdmin } from "@/lib/backend/api";
import { cancellationPolicySchema, parseCancellationPolicy } from "@/lib/backend/cancellation-policy";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const { data, error } = await supabase.from("system_settings").select("value")
      .eq("key", "cancellation_policy").maybeSingle();
    if (error) throw error;
    return Response.json({ policy: parseCancellationPolicy(data?.value), ready: Boolean(data) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    const policy = cancellationPolicySchema.parse(await request.json());
    const { data, error } = await supabase.from("system_settings")
      .update({ value: policy, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("key", "cancellation_policy").select("key").maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(503, "Atualize o banco antes de configurar cancelamentos.", "CANCELLATION_POLICY_NOT_READY");
    await audit(supabase, user.id, "cancellation_policy.updated", "system_setting", "cancellation_policy", policy);
    return Response.json({ policy });
  } catch (error) { return jsonError(error); }
}
