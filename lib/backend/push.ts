import "server-only";

import webpush from "web-push";
import { ApiError } from "@/lib/backend/api";
import { pushConfiguration } from "@/lib/config/push";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type PushPayload = {
  title: string;
  body: string;
  data: { notificationId: string; url: string; type: string; [key: string]: unknown };
};

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
  const subscriptionIds = [...new Set(deliveries.map((item) => item.subscription_id))];
  const [{ data: notifications, error: notificationError }, { data: subscriptions, error: subscriptionError }] = await Promise.all([
    supabase.from("notifications").select("id,type,title,body,data").in("id", notificationIds),
    supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth,active").in("id", subscriptionIds),
  ]);
  if (notificationError) throw notificationError;
  if (subscriptionError) throw subscriptionError;
  const notificationMap = new Map((notifications || []).map((item) => [item.id, item]));
  const subscriptionMap = new Map((subscriptions || []).map((item) => [item.id, item]));
  const result = { processed: 0, sent: 0, failed: 0, expired: 0 };

  for (const delivery of deliveries) {
    const lockExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from("notification_push_deliveries")
      .update({ status: "processing", next_attempt_at: lockExpiresAt })
      .eq("id", delivery.id)
      .in("status", ["pending", "processing", "retry"])
      .lte("next_attempt_at", now.toISOString())
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;
    result.processed += 1;

    const notification = notificationMap.get(delivery.notification_id);
    const subscription = subscriptionMap.get(delivery.subscription_id);
    if (!notification || !subscription?.active) {
      await supabase.from("notification_push_deliveries").update({ status: "expired", last_error: "Notificação ou inscrição indisponível." }).eq("id", delivery.id).eq("status", "processing");
      result.expired += 1;
      continue;
    }
    const payload: PushPayload = {
      title: notification.type === "ride.offer" ? "MotoPombal" : notification.title,
      body: notification.type === "ride.offer" ? "Nova corrida disponível" : notification.body,
      data: {
        notificationId: notification.id,
        type: notification.type,
        url: notification.type === "ride.offer"
          ? `/?open=driver-offer&ride=${encodeURIComponent(String(notification.data?.rideId || ""))}`
          : notification.type.startsWith("queue.")
            ? "/?open=driver-queue"
          : "/?open=notifications",
        ...(notification.data || {}),
      },
    };
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), { TTL: notification.type === "ride.offer" ? 90 : 300, urgency: "high" });
      await supabase.from("notification_push_deliveries").update({ status: "sent", attempts: delivery.attempts + 1, sent_at: new Date().toISOString(), last_error: null }).eq("id", delivery.id).eq("status", "processing");
      result.sent += 1;
    } catch (caught) {
      const pushError = caught as Error & { statusCode?: number };
      const attempts = delivery.attempts + 1;
      const expired = pushError.statusCode === 404 || pushError.statusCode === 410;
      const terminal = expired || attempts >= 5;
      const nextAttempt = new Date(Date.now() + Math.min(3600, 30 * 2 ** attempts) * 1000).toISOString();
      await supabase.from("notification_push_deliveries").update({ status: expired ? "expired" : terminal ? "failed" : "retry", attempts, next_attempt_at: nextAttempt, last_error: pushError.message.slice(0, 500) }).eq("id", delivery.id).eq("status", "processing");
      if (expired) {
        await supabase.from("push_subscriptions").update({ active: false }).eq("id", subscription.id);
        result.expired += 1;
      } else {
        result.failed += 1;
      }
    }
  }
  return result;
}
