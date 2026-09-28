import { z } from "zod";
import { consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";

const readSchema = z.object({ id: z.string().uuid().optional(), all: z.boolean().optional() }).refine((value) => value.id || value.all === true, "Informe a notificação ou marque todas.");

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request);
    const { data, error } = await supabase.from("notifications").select("id,type,title,body,data,read_at,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    return Response.json({ notifications: data || [], unread: (data || []).filter((item) => !item.read_at).length });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request);
    await consumeRateLimit(supabase, `notification-read:${user.id}`, 60, 60);
    const payload = readSchema.parse(await request.json().catch(() => ({})));
    let query = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
    if (!payload.all && payload.id) query = query.eq("id", payload.id);
    const { error } = await query;
    if (error) throw error;
    return Response.json({ updated: true });
  } catch (error) { return jsonError(error); }
}
