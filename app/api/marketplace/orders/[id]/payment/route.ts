import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { marketplaceOperationsEnabled, requireMarketplaceOperations } from "@/lib/backend/marketplace-operation-mode";
import { marketCashReceiptInput } from "@/lib/marketplace/cash-input";
import { MARKET_CASH_FIELDS } from "@/lib/marketplace/cash-reconciliation";
import { isMarketCashActionUnavailable, LEGACY_MARKET_CASH_FIELDS, legacyMarketCash, readWithMarketCashFallback } from "@/lib/backend/marketplace-cash-schema";
import { marketId } from "@/lib/marketplace/customer-contract";
import { marketResponse, throwMarketError } from "@/lib/marketplace/customer-server";

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    const id = marketId.parse((await params).id);
    const { data: order, error } = await supabase.from("market_orders").select("id")
      .eq("id", id).eq("assigned_driver_id", user.id).in("logistics_status", ["in_delivery", "delivered"]).maybeSingle();
    if (error) throwMarketError(error);
    if (!order) throw new ApiError(404, "Pedido não disponível para esta entrega.", "MARKET_ORDER_NOT_FOUND");
    const readPayment = <Fields extends string>(fields: Fields) => supabase.from("market_cash_payments").select(fields).eq("order_id", id).single();
    const [paymentRead, operationsEnabled] = await Promise.all([
      readWithMarketCashFallback(() => readPayment(MARKET_CASH_FIELDS), () => readPayment(LEGACY_MARKET_CASH_FIELDS)),
      marketplaceOperationsEnabled(supabase),
    ]);
    if (paymentRead.result.error) throwMarketError(paymentRead.result.error);
    const payment = paymentRead.result.data && (paymentRead.schemaReady ? paymentRead.result.data : legacyMarketCash(paymentRead.result.data));
    return marketResponse({ payment, cashSchemaReady: paymentRead.schemaReady, cashWritesEnabled: operationsEnabled && paymentRead.schemaReady });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    await requireMarketplaceOperations(supabase);
    await consumeRateLimit(supabase, `market-cash:${user.id}`, 8, 60);
    const id = marketId.parse((await params).id);
    const { amountCents, reference, note } = marketCashReceiptInput.parse(await request.json());
    const { data, error } = await supabase.rpc("market_record_cash_action", {
      p_actor_id: user.id, p_order_id: id, p_action: "receive", p_amount_cents: amountCents, p_reference: reference ?? null, p_note: note ?? null,
    });
    if (isMarketCashActionUnavailable(error)) throw new ApiError(503, "O registro de caixa está indisponível até concluir a atualização.", "MARKET_CASH_UPDATE_PENDING");
    if (error) throwMarketError(error);
    return marketResponse(data);
  } catch (error) { return jsonError(error); }
}
