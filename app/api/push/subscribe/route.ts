import { z } from "zod";
import { consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";

const schema = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(1).max(1000), auth: z.string().min(1).max(1000) }) });

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request);
    await consumeRateLimit(supabase, `push-subscribe:${user.id}`, 5, 60);
    const input = schema.parse(await request.json());
    const { error } = await supabase.from("push_subscriptions").upsert({ user_id: user.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, user_agent: request.headers.get("user-agent"), active: true }, { onConflict: "user_id,endpoint" });
    if (error) throw error;
    return Response.json({ subscribed: true });
  } catch (error) { return jsonError(error); }
}
