type MarketplaceColumn = "market_order_id" | "market_dispatch_source";
type QueryError = { code?: string; message?: string };
type QueryResult = { error: QueryError | null; data?: unknown };

const qualifiedMissingColumn: Record<MarketplaceColumn, RegExp> = {
  market_order_id: /^column (?:"?rides(?:_\d+)?"?\.)"?market_order_id"? does not exist$/i,
  market_dispatch_source: /^column (?:"?ride_requests(?:_\d+)?"?\.)"?market_dispatch_source"? does not exist$/i,
};

export function isPreMarketplaceColumnMissing(column: MarketplaceColumn, error: QueryError | null) {
  // PostgreSQL undefined_column is an actual database error. A stale
  // PostgREST schema-cache miss is not proof that market rows do not exist.
  return error?.code === "42703" && qualifiedMissingColumn[column].test(error.message?.trim() || "");
}

export async function readWithPreMarketplaceFallback<Current extends QueryResult, Legacy extends QueryResult>(
  column: MarketplaceColumn,
  readCurrent: () => PromiseLike<Current>,
  readLegacy: () => PromiseLike<Legacy>,
): Promise<Current | Legacy> {
  const result = await readCurrent();
  if (!isPreMarketplaceColumnMissing(column, result.error)) return result;
  const legacy = await readLegacy();
  // Legacy readers must include the row's full column set. In case the
  // migration landed between the two requests, we now see the new column
  // and repeat the scoped query instead of returning unfiltered data.
  const rows = Array.isArray(legacy.data) ? legacy.data : [legacy.data];
  if (rows.some((row) => row && typeof row === "object" && column in row)) return await readCurrent();
  return legacy;
}
