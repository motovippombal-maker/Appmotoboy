import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { requireMarketplaceOperations } from "@/lib/backend/marketplace-operation-mode";
import { marketCheckoutInput, marketId } from "@/lib/marketplace/customer-contract";
import { MARKET_ORDER_SUMMARY, marketQuoteSecret, marketResponse, prepareMarketQuote, throwMarketError } from "@/lib/marketplace/customer-server";
import { checkoutFingerprint, readMarketQuote } from "@/lib/marketplace/quote-signature";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const key = new URL(request.url).searchParams.get("checkout");
    const query = supabase.from("market_orders").select(MARKET_ORDER_SUMMARY).eq("customer_id", user.id);
    if (key !== null) {
      const { data, error } = await query.eq("idempotency_key", marketId.parse(key)).maybeSingle();
      if (error) throwMarketError(error);
      return marketResponse({ order: data });
    }
    const { data, error } = await query.order("created_at", { ascending: false }).order("id").limit(50);
    if (error) throwMarketError(error);
    return marketResponse({ orders: data ?? [] });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const { idempotencyKey, quoteToken, ...input } = marketCheckoutInput.parse(await request.json());
    const requestFingerprint = checkoutFingerprint(input);

    // Resolve a lost response even if the store closed or the quote expired after checkout.
    const { data: existing, error: lookupError } = await supabase.from("market_orders").select("id,request_fingerprint")
      .eq("customer_id", user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (lookupError) throwMarketError(lookupError);
    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) throwMarketError({ message: "MARKET_IDEMPOTENCY_CONFLICT" });
      return marketResponse({ orderId: existing.id, reused: true });
    }
    await requireMarketplaceOperations(supabase);
    await consumeRateLimit(supabase, `market-checkout:${user.id}`, 8, 60);
    const previous = readMarketQuote(quoteToken, marketQuoteSecret());
    if (!previous || previous.customerId !== user.id || previous.requestFingerprint !== requestFingerprint)
      throw new ApiError(409, "Os dados mudaram. Confira o resumo e gere uma nova cotação.", "MARKET_INVALID_QUOTE");
    const current = await prepareMarketQuote(supabase, user.id, input);
    if (previous.expiresAt <= Math.floor(Date.now() / 1000) ||
        previous.catalogFingerprint !== current.claims.catalogFingerprint ||
        previous.fareFingerprint !== current.claims.fareFingerprint)
      throw new ApiError(409, "Valores ou condições mudaram. Confirme o novo resumo antes de comprar.", "MARKET_QUOTE_CHANGED", { quote: current.quote });
    const { data, error } = await supabase.rpc("market_checkout", {
      p_customer_id: user.id, p_store_id: input.storeId, p_idempotency_key: idempotencyKey,
      p_request_fingerprint: requestFingerprint, p_cart: input.cart, p_catalog_fingerprint: current.claims.catalogFingerprint,
      p_pickup: current.pickup, p_delivery: input.delivery, p_fare: current.fare,
    });
    if (error) throwMarketError(error);
    return marketResponse(data, data.reused ? 200 : 201);
  } catch (error) { return jsonError(error); }
}
