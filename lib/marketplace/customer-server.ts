import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/backend/api";
import { fareRuleFingerprint, QUOTE_TTL_SECONDS } from "@/lib/backend/quote-token";
import { resolveTripFare } from "@/lib/backend/region-fare";
import { calculateRoute } from "@/lib/backend/routing";
import type { MarketItem, MarketPoint, MarketQuoteInput, MarketStore } from "./customer-contract";
import { checkoutFingerprint, signMarketQuote } from "./quote-signature";

export const MARKET_STORE_FIELDS = "id,slug,name,description,category,image_url,cover_url,address,hours,prep_minutes,service_area_id";
export const MARKET_ORDER_SUMMARY = "id,store_id,store_name,status,logistics_status,total_cents,created_at,updated_at";
export const MARKET_ORDER_DETAILS = `${MARKET_ORDER_SUMMARY},pickup_address,pickup_lat,pickup_lng,destination_address,destination_lat,destination_lng,subtotal_cents,freight_cents,discount_cents,prep_minutes,estimated_duration_seconds,expires_at,assigned_driver_id`;
const NO_CACHE = { "Cache-Control": "private, no-store" };
export function marketResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_CACHE });
}

const marketErrors: Record<string, [number, string]> = {
  MARKET_STORE_NOT_FOUND: [404, "Loja não encontrada."],
  MARKET_STORE_CLOSED: [409, "A loja não está aceitando pedidos agora."],
  MARKET_NOT_OPEN: [409, "A loja não está aceitando pedidos agora."],
  MARKET_ITEM_UNAVAILABLE: [409, "Um dos produtos não está disponível. Revise o carrinho."],
  MARKET_PRODUCT_UNAVAILABLE: [409, "Um dos produtos não está disponível. Revise o carrinho."],
  MARKET_OUT_OF_STOCK: [409, "A quantidade disponível mudou. Revise o carrinho."],
  MARKET_STOCK: [409, "A quantidade disponível mudou. Revise o carrinho."],
  MARKET_STOCK_UNAVAILABLE: [409, "A quantidade disponível mudou. Revise o carrinho."],
  MARKET_OPTIONS_INVALID: [422, "Os complementos mudaram. Revise o carrinho."],
  MARKET_CART_INVALID: [422, "Revise os itens selecionados."],
  MARKET_LOCATION_CHANGED: [409, "O local de retirada mudou. Reveja a cotação."],
  MARKET_INVALID_OPTIONS: [422, "Os complementos mudaram. Revise o carrinho."],
  MARKET_INVALID_CART: [422, "Revise os itens selecionados."],
  MARKET_PRICE_CHANGED: [409, "O preço ou a disponibilidade mudou. Reveja a cotação."],
  MARKET_CATALOG_CHANGED: [409, "O catálogo foi atualizado. Reveja a cotação."],
  MARKET_FARE_CHANGED: [409, "A área ou tarifa mudou. Reveja a cotação."],
  MARKET_PICKUP_CHANGED: [409, "O local de retirada mudou. Reveja a cotação."],
  MARKET_AREA_MISMATCH: [422, "A loja não atende esse endereço."],
  MARKET_IDEMPOTENCY_CONFLICT: [409, "Já existe uma solicitação com esse identificador. Consulte Meus pedidos."],
  MARKET_INVALID_TRANSITION: [409, "O pedido mudou de estado. Atualize antes de tentar novamente."],
  MARKET_TRANSITION_INVALID: [409, "O pedido mudou de estado. Atualize antes de tentar novamente."],
  MARKET_OUTSIDE_AREA: [422, "A loja não atende esse endereço."],
  MARKET_DELIVERY_INVALID: [422, "Confira o endereço e o contato para a entrega."],
  MARKET_TOTAL_INVALID: [422, "O valor máximo por pedido foi atingido. Revise o carrinho."],
  MARKET_REASON_REQUIRED: [422, "Informe um motivo válido."],
  MARKET_ORDER_NOT_FOUND: [404, "Pedido não encontrado."],
  MARKET_FORBIDDEN: [403, "Esta ação não está disponível para sua conta."],
  MARKET_PAYMENT_AMOUNT_INVALID: [422, "Informe um valor válido em centavos."],
  MARKET_PAYMENT_AMOUNT_REQUIRED: [503, "O registro de caixa está indisponível até concluir a atualização."],
  MARKET_PAYMENT_REFERENCE_REQUIRED: [422, "Informe uma referência externa válida para o registro."],
  MARKET_PAYMENT_LEGACY_UNVERIFIED: [409, "Este registro antigo não tem valor informado. Encaminhe à central para conferência."],
  MARKET_PAYMENT_DIVERGENT: [409, "Há diferença no recebimento. O repasse permanece bloqueado."],
  MARKET_PAYMENT_CONFLICT: [409, "Já existe um registro com outro valor ou referência. Consulte o histórico da operação."],
  MARKET_PAYMENT_NOT_READY: [409, "Só é possível registrar o dinheiro de um pedido após a entrega confirmada."],
  MARKET_PAYMENT_NOT_RECEIVED: [409, "O recebimento em dinheiro ainda não foi confirmado."],
  MARKET_REFUND_POLICY_NOT_CONFIGURED: [409, "Estornos e ajustes de caixa aguardam definição operacional."],
};
export function throwMarketError(error: { code?: string; message?: string }) {
  if (error.message === "MARKETPLACE_OPERATIONS_PAUSED")
    throw new ApiError(503, "Operações de Compras estão temporariamente indisponíveis.", "MARKETPLACE_OPERATIONS_PAUSED");
  const code = error.message?.match(/\bMARKET_[A-Z_]+\b/)?.[0];
  const expected = code && marketErrors[code];
  if (code && expected) throw new ApiError(expected[0], expected[1], code);
  if (error.code === "42P01" || error.code === "42883" || error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42703")
    throw new ApiError(503, "Compras ainda não foi habilitado neste ambiente.", "MARKETPLACE_NOT_CONFIGURED");
  if (error.code === "42501") throw new ApiError(403, "Esta ação não está disponível para sua conta.", "MARKET_FORBIDDEN");
  if (code) throw new ApiError(409, "Não foi possível concluir esta ação. Atualize o pedido ou o carrinho.", code);
  throw new ApiError(503, "Compras está temporariamente indisponível. Tente novamente mais tarde.", "MARKETPLACE_UNAVAILABLE");
}

export async function storeAvailability(supabase: SupabaseClient, store: Omit<MarketStore, "open">): Promise<MarketStore> {
  const { data, error } = await supabase.rpc("market_store_open", { p_store_id: store.id });
  if (error) throwMarketError(error);
  return { ...store, open: data === true };
}

export function marketQuoteSecret() {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) throw new ApiError(503, "A assinatura de cotação de compras não está configurada.", "QUOTE_SIGNING_NOT_CONFIGURED");
  return secret;
}

type CatalogQuote = {
  cartFingerprint: string; subtotalCents: number; items: MarketItem[];
  store: { id: string; address: string; latitude: number; longitude: number; prep_minutes: number | null; service_area_id: string | null };
};
export async function prepareMarketQuote(supabase: SupabaseClient, userId: string, input: MarketQuoteInput) {
  const { data, error } = await supabase.rpc("market_quote_catalog", { p_store_id: input.storeId, p_cart: input.cart });
  if (error) throwMarketError(error);
  const catalog = data as CatalogQuote;
  if (!catalog?.store || !catalog.cartFingerprint)
    throw new ApiError(503, "Cotação de compras indisponível.", "MARKETPLACE_UNAVAILABLE");
  const pickup: MarketPoint = { address: catalog.store.address, lat: catalog.store.latitude, lng: catalog.store.longitude };
  const destination = { lat: input.delivery.lat, lng: input.delivery.lng };
  const resolvedFare = await resolveTripFare(supabase, pickup, destination);
  if (catalog.store.service_area_id && catalog.store.service_area_id !== resolvedFare.serviceArea.id)
    throw new ApiError(422, "A loja não atende esse endereço.", "MARKET_AREA_MISMATCH");
  const freightCents = resolvedFare.fareCents;
  const route = await calculateRoute(pickup, destination).catch(() => null);
  const fareFingerprint = fareRuleFingerprint({ resolvedFare, fareCents: freightCents, originalFareCents: freightCents, discountCents: 0, couponCode: null });
  const claims = {
    version: 1 as const, customerId: userId, requestFingerprint: checkoutFingerprint(input),
    catalogFingerprint: catalog.cartFingerprint, fareFingerprint, expiresAt: Math.floor(Date.now() / 1000) + QUOTE_TTL_SECONDS,
  };
  const fare = {
    freightCents, discountCents: 0, ruleSnapshot: resolvedFare.snapshot,
    distanceMeters: route?.distanceMeters, durationSeconds: route?.durationSeconds, geometry: route?.geometry,
  };
  const quote = {
    subtotalCents: catalog.subtotalCents, freightCents, discountCents: 0, totalCents: catalog.subtotalCents + freightCents,
    prepMinutes: catalog.store.prep_minutes, travelSeconds: route?.durationSeconds ?? null,
    quoteToken: signMarketQuote(claims, marketQuoteSecret()), expiresAt: new Date(claims.expiresAt * 1000).toISOString(),
    items: catalog.items,
  };
  return { pickup, claims, fare, quote };
}
