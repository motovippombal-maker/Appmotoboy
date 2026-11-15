const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPushIdentifier(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

type OfferPointer = { offerId: unknown; rideId: unknown; userId: string };
type OfferState = { id: string; ride_id: string; driver_id: string; status: string; expires_at: string } | null;

export function liveOfferPush(pointer: OfferPointer, offer: OfferState, now = Date.now()) {
  if (!offer || !isPushIdentifier(pointer.offerId) || !isPushIdentifier(pointer.rideId) ||
    offer.id !== pointer.offerId || offer.ride_id !== pointer.rideId || offer.driver_id !== pointer.userId ||
    offer.status !== "pending") return null;
  const ttl = Math.floor((Date.parse(offer.expires_at) - now) / 1000);
  if (!Number.isFinite(ttl) || ttl < 1) return null;
  return { ttl: Math.min(90, ttl), rideId: offer.ride_id, expiresAt: offer.expires_at };
}

export function marketPushPointer(type: string, data: { orderId?: unknown; audience?: unknown } | null) {
  if (type !== "market.order_update" && type !== "market.delivery_exception") return {};
  const audience = type === "market.delivery_exception" ? "customer" : data?.audience;
  if (!isPushIdentifier(data?.orderId) || (audience !== "customer" && audience !== "merchant" && audience !== "admin")) return {};
  return { orderId: data.orderId, audience };
}
