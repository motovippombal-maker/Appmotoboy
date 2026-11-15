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
    const { error } = await supabase.rpc("register_push_subscription", {
      p_user_id: user.id, p_endpoint: input.endpoint, p_p256dh: input.keys.p256dh,
      p_auth: input.keys.auth, p_user_agent: request.headers.get("user-agent"),
    });
    if (error?.code === "PGRST202" || error?.code === "42883")
      throw new ApiError(503, "A inscrição de notificações precisa da atualização do banco.", "PUSH_REGISTRATION_NOT_READY");
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
