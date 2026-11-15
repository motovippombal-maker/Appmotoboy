import "server-only";

import webpush from "web-push";
import { ApiError } from "@/lib/backend/api";
import { marketplaceOperationState } from "@/lib/backend/marketplace-operation-mode";
import { pushConfiguration } from "@/lib/config/push";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { isPushIdentifier, liveOfferPush, marketPushPointer } from "@/lib/push/delivery-policy";
import { isPublicPushEndpoint } from "@/lib/push/endpoint";

type PushPayload = {
  title: string;
  body: string;
  data: { notificationId: string; url: string; type: string; [key: string]: unknown };
};
const MAX_ATTEMPTS = 5;

function configureWebPush() {
  const config = pushConfiguration();
  if (!config.configured) throw new ApiError(503, `Push aguardando configuração: ${config.missing.join(", ")}.`, "PUSH_NOT_CONFIGURED");
  const { publicKey, privateKey, subject } = config.values;
  webpush.setVapidDetails(subject!, publicKey!, privateKey!);
}

export async function dispatchPushQueue(limit = 50, targetNotificationIds?: string[]) {
  configureWebPush();
  const supabase = createSupabaseAdminClient();
  const now = new Date();
  const stopBy = Date.now() + 20_000;
  let marketMode: Awaited<ReturnType<typeof marketplaceOperationState>> | undefined;
  let deliveryQuery = supabase
    .from("notification_push_deliveries")
    .select("id,notification_id,subscription_id,attempts")
    .in("status", ["pending", "processing", "retry"])
    .lte("next_attempt_at", now.toISOString())
    .order("created_at");
  if (targetNotificationIds?.length) deliveryQuery = deliveryQuery.in("notification_id", targetNotificationIds);
  const { data: deliveries, error } = await deliveryQuery.limit(Math.min(100, Math.max(1, limit)));
  if (error) throw error;
  if (!deliveries?.length) return { processed: 0, sent: 0, failed: 0, expired: 0 };

  const notificationIds = [...new Set(deliveries.map((item) => item.notification_id))];
  const { data: notifications, error: notificationError } = await supabase
    .from("notifications").select("id,user_id,type,title,body,data").in("id", notificationIds);
  if (notificationError) throw notificationError;
  const notificationMap = new Map((notifications || []).map((item) => [item.id, item]));
  const result = { processed: 0, sent: 0, failed: 0, expired: 0 };

  for (const delivery of deliveries) {
    if (Date.now() >= stopBy) break;
    const lockExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { data: claimed, error: claimError } = await supabase.from("notification_push_deliveries")
      .update(delivery.attempts >= MAX_ATTEMPTS
        ? { status: "failed", last_error: "Limite de tentativas atingido." }
        : { status: "processing", attempts: delivery.attempts + 1, next_attempt_at: lockExpiresAt })
      .eq("id", delivery.id).eq("attempts", delivery.attempts)
      .in("status", ["pending", "processing", "retry"]).lte("next_attempt_at", now.toISOString())
      .select("id").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;
    result.processed += 1;
    if (delivery.attempts >= MAX_ATTEMPTS) { result.failed += 1; continue; }
    const attempts = delivery.attempts + 1;
    // An expired worker may still return from the network; it cannot settle
    // a delivery now leased by another request.
    const settle = async (patch: Record<string, unknown>) => {
      const { data, error } = await supabase.from("notification_push_deliveries").update(patch)
        .eq("id", delivery.id).eq("status", "processing").eq("attempts", attempts)
        .eq("next_attempt_at", lockExpiresAt).select("id").maybeSingle();
      if (error) throw error;
      return Boolean(data);
    };

    const notification = notificationMap.get(delivery.notification_id);
    const marketplaceNotice = notification && (notification.type.startsWith("market.") ||
      (notification.type === "ride.offer" && ["preferred", "network"].includes(notification.data?.source)));
    if (marketplaceNotice) {
      marketMode ??= await marketplaceOperationState(supabase);
      if (marketMode === "unavailable") {
        if (await settle({
          status: attempts >= MAX_ATTEMPTS ? "failed" : "retry",
          next_attempt_at: new Date(Date.now() + Math.min(3600, 30 * 2 ** attempts) * 1000).toISOString(),
          last_error: "Não foi possível verificar se Compras está liberada.",
        })) result.failed += 1;
        continue;
      }
      if (marketMode === "disabled") {
        if (await settle({ status: "expired", last_error: "Operação de Compras indisponível." })) result.expired += 1;
        continue;
      }
    }
    // Re-read the subscription after claiming, not from a batch snapshot
    // taken before an account switch or logout.
    const { data: subscription, error: subscriptionError } = await supabase.from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth,active,updated_at").eq("id", delivery.subscription_id).maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (!notification || !subscription?.active || subscription.user_id !== notification.user_id || !isPublicPushEndpoint(subscription.endpoint)) {
      if (await settle({ status: "expired", last_error: "Notificação ou inscrição indisponível." })) result.expired += 1;
      continue;
    }
    let offerPush: ReturnType<typeof liveOfferPush> = null;
    if (notification.type === "ride.offer") {
      const offerId = notification.data?.offerId;
      const { data: offer, error: offerError } = isPushIdentifier(offerId)
        ? await supabase.from("ride_requests").select("id,ride_id,driver_id,status,expires_at")
          .eq("id", offerId).eq("driver_id", notification.user_id).maybeSingle()
        : { data: null, error: null };
      if (offerError) throw offerError;
      offerPush = liveOfferPush({ offerId, rideId: notification.data?.rideId, userId: notification.user_id }, offer);
      if (!offerPush) {
        if (await settle({ status: "expired", last_error: "Oferta encerrada." })) result.expired += 1;
        continue;
      }
    }
    const market = marketPushPointer(notification.type, notification.data);
    const payload: PushPayload = {
      title: notification.type === "ride.offer" ? "MotoPombal" : notification.title,
      body: notification.type === "ride.offer"
        ? notification.data?.source === "preferred" || notification.data?.source === "network"
          ? "Nova entrega de compras disponível" : "Nova corrida disponível"
        : notification.type.startsWith("queue.") || market.orderId ? notification.body : "Abra o MotoPombal para consultar o aviso.",
      data: {
        notificationId: notification.id,
        type: notification.type,
        url: offerPush
          ? `/?open=driver-offer&ride=${encodeURIComponent(offerPush.rideId)}`
          : notification.type.startsWith("food.driver.")
            ? "/motorista/entregas"
          : notification.type.startsWith("food.restaurant.")
            ? "/restaurante"
          : notification.type.startsWith("food.customer.")
            ? "/delivery"
          : notification.type.startsWith("queue.")
            ? "/?open=driver-queue"
          : "/?open=notifications",
        ...(offerPush ? { rideId: offerPush.rideId, expiresAt: offerPush.expiresAt } : {}),
        ...market,
      },
    };
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), {
        TTL: offerPush?.ttl ?? 300, urgency: offerPush ? "high" : "normal", timeout: 10_000,
        topic: notification.id.replaceAll("-", ""),
      });
    } catch (caught) {
      const pushError = caught as Error & { statusCode?: number };
      const expired = pushError.statusCode === 404 || pushError.statusCode === 410;
      const terminal = expired || attempts >= MAX_ATTEMPTS;
      const nextAttempt = new Date(Date.now() + Math.min(3600, 30 * 2 ** attempts) * 1000).toISOString();
      if (!await settle({
        status: expired ? "expired" : terminal ? "failed" : "retry", next_attempt_at: nextAttempt,
        last_error: typeof pushError.statusCode === "number" ? `Provedor Push: HTTP ${pushError.statusCode}.` : "Falha de comunicação com o provedor Push.",
      })) continue;
      if (expired) {
        await supabase.from("push_subscriptions").update({ active: false }).eq("id", subscription.id).eq("updated_at", subscription.updated_at);
        result.expired += 1;
      } else {
        result.failed += 1;
      }
      continue;
    }
    if (await settle({ status: "sent", sent_at: new Date().toISOString(), last_error: null })) result.sent += 1;
  }
  return result;
}
