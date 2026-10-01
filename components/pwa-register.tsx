"use client";

import { useEffect, useRef, useState } from "react";
import { shouldReloadForWorkerChange } from "@/lib/pwa/update";

const SW_RELOAD_STORAGE_KEY = "moto-syxp:last-sw-reload";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type NetworkState = "online" | "offline" | "reconnecting" | "restored";

export function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(
    null,
  );
  const [networkState, setNetworkState] = useState<NetworkState>("online");
  const reloading = useRef(false);
  const updateRequested = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((item) => item.unregister())),
        );
      return;
    }
    let registration: ServiceWorkerRegistration | undefined;
    let restoredTimer: number | undefined;
    const initialNetworkTimer = window.setTimeout(
      () => setNetworkState(navigator.onLine ? "online" : "offline"),
      0,
    );

    const watchWorker = (worker?: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller)
          setWaitingWorker(worker);
      });
    };
    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        if (registration.waiting) setWaitingWorker(registration.waiting);
        registration.addEventListener("updatefound", () =>
          watchWorker(registration?.installing),
        );
      } catch {
        // O aplicativo continua utilizavel no navegador sem suporte a instalacao.
      }
    };
    void register();

    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const installed = () => setInstallPrompt(null);
    const offline = () => setNetworkState("offline");
    const online = async () => {
      setNetworkState("reconnecting");
      try {
        const response = await fetch("/api/health/supabase", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("health check failed");
        setNetworkState("restored");
        window.dispatchEvent(new Event("moto-vip:network-restored"));
        restoredTimer = window.setTimeout(
          () => setNetworkState("online"),
          4000,
        );
      } catch {
        setNetworkState("reconnecting");
      }
    };
    const visibility = () => {
      if (!document.hidden) void registration?.update();
    };
    const controllerChange = () => {
      // A primeira instalação também dispara controllerchange. Não interrompa a
      // página do usuário com uma recarga que pode falhar durante uma oscilação.
      if (!updateRequested.current || reloading.current || !navigator.onLine) return;
      reloading.current = true;
      try {
        const now = Date.now();
        if (!shouldReloadForWorkerChange(window.sessionStorage.getItem(SW_RELOAD_STORAGE_KEY), now)) {
          reloading.current = false;
          return;
        }
        window.sessionStorage.setItem(SW_RELOAD_STORAGE_KEY, String(now));
      } catch {
        // O ref ainda impede recargas repetidas quando sessionStorage está indisponível.
      }
      window.location.reload();
    };

    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visibility);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      controllerChange,
    );
    const updateTimer = window.setInterval(
      () => void registration?.update(),
      60 * 60 * 1000,
    );
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visibility);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        controllerChange,
      );
      window.clearTimeout(initialNetworkTimer);
      window.clearInterval(updateTimer);
      if (restoredTimer) window.clearTimeout(restoredTimer);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function update() {
    updateRequested.current = true;
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    setWaitingWorker(null);
  }

  const connectionMessage =
    networkState === "offline"
      ? "Sem conexao"
      : networkState === "reconnecting"
        ? "Reconectando..."
        : networkState === "restored"
          ? "Conexao restabelecida"
          : null;
  if (!installPrompt && !waitingWorker && !connectionMessage) return null;

  return (
    <aside className="pwa-notices" aria-live="polite">
      {connectionMessage && (
        <div className={`pwa-notice ${networkState}`}>
          <span>{connectionMessage}</span>
          {networkState === "reconnecting" && (
            <button onClick={() => window.location.reload()}>
              TENTAR AGORA
            </button>
          )}
        </div>
      )}
      {waitingWorker && (
        <div className="pwa-notice update">
          <span>Nova versao disponivel</span>
          <button onClick={update}>ATUALIZAR</button>
        </div>
      )}
      {installPrompt && (
        <div className="pwa-notice install">
          <span>Instale o MotoPombal neste aparelho</span>
          <button onClick={install}>INSTALAR</button>
        </div>
      )}
    </aside>
  );
}
