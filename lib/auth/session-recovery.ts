type RecoveryEnvironment = {
  window: EventTarget;
  document: EventTarget & { hidden: boolean };
  navigator: { onLine: boolean };
  every: (callback: () => void, milliseconds: number) => () => void;
};

export function startSessionRecovery({
  synchronize,
  role,
  realtimeConnected,
  environment = {
    window,
    document,
    navigator,
    every: (callback, milliseconds) => {
      const interval = window.setInterval(callback, milliseconds);
      return () => window.clearInterval(interval);
    },
  },
}: {
  synchronize: () => Promise<unknown>;
  role?: string;
  realtimeConnected: boolean;
  environment?: RecoveryEnvironment;
}) {
  let stopped = false;
  let inFlight = false;
  const recover = () => {
    if (stopped || inFlight || environment.document.hidden || !environment.navigator.onLine) return;
    inFlight = true;
    void synchronize().catch(() => undefined).finally(() => { inFlight = false; });
  };
  // An authenticated session whose initial profile query failed still needs polling.
  const stopInterval = environment.every(recover, role === "admin" || realtimeConnected ? 30_000 : 10_000);
  for (const event of ["online", "focus", "moto-vip:network-restored"])
    environment.window.addEventListener(event, recover);
  environment.document.addEventListener("visibilitychange", recover);
  return () => {
    stopped = true;
    stopInterval();
    for (const event of ["online", "focus", "moto-vip:network-restored"])
      environment.window.removeEventListener(event, recover);
    environment.document.removeEventListener("visibilitychange", recover);
  };
}
