import type { MarketCashSnapshot } from "@/lib/marketplace/cash-reconciliation";

type QueryError = { code?: string; message?: string };
type QueryResult = { error: QueryError | null };

export const LEGACY_MARKET_CASH_FIELDS = "amount_cents,store_due_cents,driver_due_cents,platform_due_cents,received_at,settled_at";
const introduced = "received_amount_cents|settled_amount_cents|receipt_reference|settlement_reference";
const undefinedColumn = new RegExp(`^column (?:(?:"?public"?\\.)?"?market_cash_payments(?:_\\d+)?"?\\.)?"?(${introduced})"? does not exist$`, "i");
const cacheMissing = new RegExp(`^Could not find the '(${introduced})' column of '(?:public\\.)?market_cash_payments' in the schema cache\\.?$`, "i");

export function isMarketCashColumnMissing(error: QueryError | null) {
  const message = error?.message?.trim() ?? "";
  return (error?.code === "42703" && undefinedColumn.test(message)) || (error?.code === "PGRST204" && cacheMissing.test(message));
}

export function isMarketCashActionUnavailable(error: QueryError | null) {
  const message = error?.message?.trim() ?? "";
  return (error?.code === "42501" && /^permission denied for function (?:public\.)?market_record_cash_action$/i.test(message)) ||
    (["42883", "PGRST202"].includes(error?.code ?? "") && /\b(?:public\.)?market_record_cash_action\b/i.test(message));
}

/** Only the projection changes. Each caller retains its original ownership and row filters. */
export async function readWithMarketCashFallback<Current extends QueryResult, Legacy extends QueryResult>(
  readCurrent: () => PromiseLike<Current>, readLegacy: () => PromiseLike<Legacy>,
): Promise<{ schemaReady: true; result: Current } | { schemaReady: false; result: Legacy }> {
  const result = await readCurrent();
  if (!isMarketCashColumnMissing(result.error)) return { schemaReady: true, result };
  return { schemaReady: false, result: await readLegacy() };
}

export function legacyMarketCash<T extends Omit<MarketCashSnapshot, "received_amount_cents" | "settled_amount_cents">>(row: T) {
  return { ...row, received_amount_cents: null, settled_amount_cents: null };
}
