export function invalidatesMarketSnapshot(status: unknown) {
  return status === 401 || status === 403 || status === 404 || status === 410;
}

export function marketSnapshotAfterError<T>(current: { key: string; data: T | null }, key: string, status?: number) {
  if (current.key !== key || invalidatesMarketSnapshot(status)) return null;
  return current.data;
}
