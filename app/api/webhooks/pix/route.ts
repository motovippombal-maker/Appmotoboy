import { createHash } from "node:crypto";
import { ApiError, jsonError } from "@/lib/backend/api";
import { getPixProvider, toDatabasePaymentStatus } from "@/lib/backend/payment";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const provider = getPixProvider();
    const rawPayload = await request.clone().text();
    const event = await provider.verifyWebhook(request);
    const supabase = createSupabaseAdminClient();
    const payloadHash = createHash("sha256").update(rawPayload).digest("hex");
    const { data: payment } = await supabase.from("payments").select("id,ride_id,passenger_id,amount_cents,status").eq("provider", provider.name).eq("provider_reference", event.providerChargeId).maybeSingle();
    if (!payment) throw new ApiError(404, "Pagamento não encontrado.", "PAYMENT_NOT_FOUND");
    if (payment.amount_cents !== event.amountCents) throw new ApiError(409, "Valor do webhook divergente.", "WEBHOOK_AMOUNT_MISMATCH");
    const { error: eventError } = await supabase.from("payment_webhook_events").insert({ provider: provider.name, event_id: event.eventId, provider_reference: event.providerChargeId, event_type: event.eventType, payload_hash: payloadHash });
    if (eventError?.code === "23505") return Response.json({ received: true, duplicate: true });
    if (eventError) throw eventError;
    const status = toDatabasePaymentStatus(event.status);
    const { error: updateError } = await supabase.from("payments").update({ status, paid_at: status === "pago" ? new Date().toISOString() : null }).eq("id", payment.id).eq("amount_cents", event.amountCents);
    if (updateError) {
      await supabase.from("payment_webhook_events").delete().eq("provider", provider.name).eq("event_id", event.eventId);
      throw updateError;
    }
    return Response.json({ received: true });
  } catch (error) { return jsonError(error); }
}
