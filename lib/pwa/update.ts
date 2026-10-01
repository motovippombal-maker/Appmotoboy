export const SW_RELOAD_COOLDOWN_MS = 15_000;

export function shouldReloadForWorkerChange(previous: string | null, now: number) {
  const last = Number(previous);
  return !Number.isFinite(last) || now < last || now - last >= SW_RELOAD_COOLDOWN_MS;
}
