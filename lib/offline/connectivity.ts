export type ConnectivityState = "ONLINE" | "DEGRADED" | "OFFLINE" | "RECOVERING";
export const NETWORK_CONFIG = {
  requestTimeoutMs: 4500,
  degradedLatencyMs: 2600,
  degradedFailures: 2,
  offlineFailures: 4,
  recoverySuccesses: 2,
  healthCheckIntervalMs: 15000,
} as const;

export class ConnectivityManager {
  private state: ConnectivityState = "ONLINE";
  private failures = 0;
  private successes = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private listeners = new Set<(state: ConnectivityState) => void>();
  get current() { return this.state; }
  subscribe(listener: (state: ConnectivityState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }
  private setState(next: ConnectivityState) {
    if (this.state === next) return;
    this.state = next;
    if (process.env.NODE_ENV !== "production") console.info(`[NETWORK] ${next}`);
    for (const listener of this.listeners) listener(next);
    if (next === "ONLINE") window.dispatchEvent(new Event("moto-vip:network-restored"));
  }
  async check() {
    if (this.running) return this.state;
    this.running = true;
    const started = Date.now();
    try {
      const response = await fetch("/api/health/supabase", { cache: "no-store", signal: AbortSignal.timeout(NETWORK_CONFIG.requestTimeoutMs) });
      if (!response.ok) throw new Error("backend unavailable");
      this.failures = 0;
      this.successes += 1;
      const slow = Date.now() - started > NETWORK_CONFIG.degradedLatencyMs;
      if (this.state === "OFFLINE" || this.state === "RECOVERING") {
        this.setState(this.successes >= NETWORK_CONFIG.recoverySuccesses ? "ONLINE" : "RECOVERING");
      } else this.setState(slow ? "DEGRADED" : "ONLINE");
    } catch {
      this.successes = 0;
      this.failures += 1;
      if (this.failures >= NETWORK_CONFIG.offlineFailures) this.setState("OFFLINE");
      else if (this.failures >= NETWORK_CONFIG.degradedFailures) this.setState("DEGRADED");
    } finally { this.running = false; }
    return this.state;
  }
  start() {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), NETWORK_CONFIG.healthCheckIntervalMs);
    window.addEventListener("online", this.onNetworkHint);
    window.addEventListener("offline", this.onNetworkHint);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("online", this.onNetworkHint);
    window.removeEventListener("offline", this.onNetworkHint);
  }
  private onNetworkHint = () => { void this.check(); };
}

export const connectivityManager = new ConnectivityManager();
