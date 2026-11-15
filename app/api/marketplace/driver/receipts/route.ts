import { jsonError, requireUser } from "@/lib/backend/api";
import { marketResponse, throwMarketError } from "@/lib/marketplace/customer-server";
import { MARKET_CASH_FIELDS } from "@/lib/marketplace/cash-reconciliation";
import { LEGACY_MARKET_CASH_FIELDS, legacyMarketCash, readWithMarketCashFallback } from "@/lib/backend/marketplace-cash-schema";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    const { data, error } = await supabase.from("market_orders").select("id,store_name,updated_at,status,logistics_status,total_cents")
      .eq("assigned_driver_id", user.id).eq("status", "delivered").eq("logistics_status", "delivered")
      .order("updated_at", { ascending: false }).order("id").limit(50);
    if (error) throwMarketError(error);
    const orders = data ?? [];
    if (!orders.length) return marketResponse({ orders, cashSchemaReady: true });
    const ids = orders.map(({ id }) => id);
    const readPayments = <Fields extends string>(fields: Fields) => supabase.from("market_cash_payments").select(fields).in("order_id", ids);
    const payments = await readWithMarketCashFallback(() => readPayments(`order_id,${MARKET_CASH_FIELDS}`), () => readPayments(`order_id,${LEGACY_MARKET_CASH_FIELDS}`));
    if (payments.result.error) throwMarketError(payments.result.error);
    const rows = payments.schemaReady ? payments.result.data ?? [] : (payments.result.data ?? []).map(legacyMarketCash);
    const byOrder = new Map(rows.map((payment) => [payment.order_id, payment]));
    return marketResponse({ orders: orders.map((order) => ({ ...order, cash: byOrder.get(order.id) ?? null })), cashSchemaReady: payments.schemaReady });
  } catch (error) { return jsonError(error); }
}
