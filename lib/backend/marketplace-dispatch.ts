import "server-only";

import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/backend/api";
import { dispatchPushQueue } from "@/lib/backend/push";
import { requireMarketplaceOperations } from "@/lib/backend/marketplace-operation-mode";

export function marketplaceDispatchAuthorized(authorization: string | null, secret: string) {
  if (!authorization?.startsWith("Bearer ") || secret.length < 32) return false;
  const token = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return token.length === expected.length && timingSafeEqual(token, expected);
}

async function notifyOffers() {
  try { await dispatchPushQueue(50); } catch { /* Offers persist; Push is optional. */ }
}

export async function dispatchMarketOrder(supabase: SupabaseClient, orderId: string) {
  await requireMarketplaceOperations(supabase);
  const { data: offered, error } = await supabase.rpc("dispatch_market_order", { p_order_id: orderId });
  if (error) throw new ApiError(503, "Não foi possível distribuir a entrega agora.", "MARKET_DISPATCH_UNAVAILABLE");
  if (offered) await notifyOffers();
  return Boolean(offered);
}

export async function runMarketDispatch(supabase: SupabaseClient) {
  await requireMarketplaceOperations(supabase);
  const { data: expired, error: expirationError } = await supabase.rpc("market_expire_orders", { p_limit: 50 });
  if (expirationError) throw new ApiError(503, "Não foi possível expirar pedidos pendentes agora.", "MARKET_EXPIRATION_UNAVAILABLE");
  const { data: offered, error: dispatchError } = await supabase.rpc("dispatch_due_market_orders", { p_limit: 25 });
  if (dispatchError) throw new ApiError(503, "Não foi possível distribuir entregas agora.", "MARKET_DISPATCH_UNAVAILABLE");
  if (offered) await notifyOffers();
  return { expiredOrders: expired ?? 0, offeredDeliveries: offered ?? 0 };
}

export async function applyMarketDriverAction(
  supabase: SupabaseClient,
  rideId: string,
  driverId: string,
  action: "pickup" | "complete" | "withdraw" | "exception",
  reason?: string,
  reasonCode?: string,
) {
  const { data: ride, error } = await supabase.rpc("market_driver_delivery_action", {
    p_ride_id: rideId,
    p_driver_id: driverId,
    p_action: action,
    p_reason: reason?.trim() || null,
    p_reason_code: reasonCode ?? null,
  });
  if (error) throw error;
  if (!ride?.id) throw new ApiError(409, "A etapa da entrega mudou. Atualize para conferir.", "MARKET_DELIVERY_STATE_CHANGED");
  if (action === "withdraw" && ride.market_order_id) {
    try { await dispatchMarketOrder(supabase, ride.market_order_id); } catch { /* A próxima execução agendada retoma a entrega. */ }
  }
  return ride;
}
