export const MAX_MARKET_CASH_CENTS = 200_000_000;
export const MARKET_CASH_FIELDS = "amount_cents,store_due_cents,driver_due_cents,platform_due_cents,received_at,received_amount_cents,settled_at,settled_amount_cents";

export type MarketCashSnapshot = {
  amount_cents: number;
  store_due_cents: number;
  driver_due_cents: number;
  platform_due_cents: number;
  received_at: string | null;
  received_amount_cents: number | null;
  settled_at: string | null;
  settled_amount_cents: number | null;
};

/** Accept reais without thousands separators and convert exactly, with no float rounding. */
export function marketCashAmountInCents(value: string): number | null {
  const parts = /^(\d{1,7})(?:[,.](\d{1,2}))?$/.exec(value.trim());
  if (!parts) return null;
  const cents = Number(parts[1]) * 100 + Number((parts[2] ?? "").padEnd(2, "0"));
  return cents <= MAX_MARKET_CASH_CENTS ? cents : null;
}

export function cashReconciliationState(cash: MarketCashSnapshot | null, orderTotal?: number) {
  if (!cash) return "missing";
  const { amount_cents: expected, store_due_cents: store, driver_due_cents: driver, platform_due_cents: platform,
    received_at: receivedAt, received_amount_cents: received, settled_at: settledAt, settled_amount_cents: settled } = cash;
  if ([expected, store, driver, platform, received, settled].some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0)) ||
      (orderTotal !== undefined && expected !== orderTotal) || expected !== store + driver + platform ||
      (!receivedAt && (received !== null || settledAt !== null)) || (!settledAt && settled !== null) ||
      (settled !== null && (settled !== store || received !== expected))) return "inconsistent";
  if ((receivedAt !== null && received === null) || (settledAt !== null && settled === null)) return "legacy_unverified";
  if (!receivedAt) return "pending";
  if (received !== expected) return "divergent";
  return settledAt ? "settled" : "received";
}

export function cashReconciliationIssue(state: ReturnType<typeof cashReconciliationState>) {
  if (state === "missing" || state === "inconsistent") return "Registro financeiro inconsistente ou ausente. Encaminhe à central.";
  if (state === "legacy_unverified") return "Registro antigo sem valor informado. Conferência manual necessária; não será usado como valor confirmado.";
  if (state === "divergent") return "O valor informado difere do total previsto. O repasse fica bloqueado até revisão da central.";
  return null;
}

export type CashReconciliationOrder = { status: string; logistics_status: string; total_cents: number; cash: MarketCashSnapshot | null };

export function marketOrderCashState(order: CashReconciliationOrder) {
  const delivered = order.status === "delivered" && order.logistics_status === "delivered";
  if (!delivered && !order.cash?.received_at && !order.cash?.settled_at) return "not_due";
  return delivered ? cashReconciliationState(order.cash, order.total_cents) : "inconsistent";
}

export function summarizeMarketCash(orders: CashReconciliationOrder[]) {
  const totals = {
    completedOrders: 0, deliveredTotalCents: 0, receivedCents: 0, receivedWithAmount: 0, pendingCashCents: 0,
    expectedStoreCents: 0, expectedDriverCents: 0, expectedPlatformCents: 0, storeSettledCents: 0, settledWithAmount: 0,
    shortCents: 0, overCents: 0, divergentOrders: 0, legacyOrders: 0, inconsistentOrders: 0,
  };
  for (const order of orders) {
    const state = marketOrderCashState(order);
    const cash = order.cash;
    if (order.status === "delivered" && order.logistics_status === "delivered") {
      totals.completedOrders++;
      totals.deliveredTotalCents += order.total_cents;
      if (cash && state !== "inconsistent") {
        totals.expectedStoreCents += cash.store_due_cents;
        totals.expectedDriverCents += cash.driver_due_cents;
        totals.expectedPlatformCents += cash.platform_due_cents;
      }
    }
    if (state === "pending" && cash) totals.pendingCashCents += cash.amount_cents;
    if (state === "legacy_unverified") totals.legacyOrders++;
    if (state === "inconsistent" || state === "missing") totals.inconsistentOrders++;
    if (cash && state !== "inconsistent") {
      if (cash.received_at && cash.received_amount_cents !== null) {
        totals.receivedCents += cash.received_amount_cents;
        totals.receivedWithAmount++;
      }
      if (cash.settled_at && cash.settled_amount_cents !== null) {
        totals.storeSettledCents += cash.settled_amount_cents;
        totals.settledWithAmount++;
      }
    }
    if (state === "divergent" && cash && cash.received_amount_cents !== null) {
      totals.divergentOrders++;
      totals.shortCents += Math.max(0, cash.amount_cents - cash.received_amount_cents);
      totals.overCents += Math.max(0, cash.received_amount_cents - cash.amount_cents);
    }
  }
  return totals;
}
