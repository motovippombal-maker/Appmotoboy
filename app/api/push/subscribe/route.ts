import { z } from "zod";
import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { pushConfiguration } from "@/lib/config/push";
import { isPublicPushEndpoint } from "@/lib/push/endpoint";

const pushEndpoint = z.string().url().max(2000).refine(isPublicPushEndpoint, "Endpoint Push deve usar HTTPS público.");
const endpointSchema = z.object({ endpoint: pushEndpoint }).strict();
const schema = endpointSchema.extend({ keys: z.object({ p256dh: z.string().min(1).max(1000), auth: z.string().min(1).max(1000) }).strict() }).strict();

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request);
    await consumeRateLimit(supabase, `push-subscribe:${user.id}`, 5, 60);
    const config = pushConfiguration();
    if (!config.configured) throw new ApiError(503, `Push não configurado: ${config.missing.join(", ")}.`, "PUSH_NOT_CONFIGURED");
    const input = schema.parse(await request.json());
    const { error: previousError } = await supabase.from("push_subscriptions")
      .update({ active: false }).eq("endpoint", input.endpoint).neq("user_id", user.id);
    if (previousError) throw previousError;
    const { error } = await supabase.from("push_subscriptions").upsert({ user_id: user.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, user_agent: request.headers.get("user-agent"), active: true }, { onConflict: "user_id,endpoint" });
    if (error) throw error;
    return Response.json({ subscribed: true });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser(request);
    const { endpoint } = endpointSchema.parse(await request.json());
    const { error } = await supabase.from("push_subscriptions")
      .update({ active: false }).eq("user_id", user.id).eq("endpoint", endpoint);
    if (error) throw error;
    return Response.json({ unsubscribed: true });
  } catch (error) { return jsonError(error); }
}
