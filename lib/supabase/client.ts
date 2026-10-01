"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { browserAuthStorageKey, legacyAuthStorageKey, replaceAccountSlot } from "@/lib/auth/browser-session";
import { parseSupabaseUrl } from "@/lib/config/public-site-url.mjs";

let browserClient: SupabaseClient | undefined;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("As variáveis públicas do Supabase não foram configuradas.");
  }

  const parsedUrl = parseSupabaseUrl(url);
  const storageKey = typeof window === "undefined"
    ? undefined
    : browserAuthStorageKey(parsedUrl, window.location.search, window.sessionStorage);
  if (typeof window !== "undefined" && storageKey) {
    // Older versions shared one login across every window. A new window must
    // never inherit that account from the old shared storage key.
    const legacyKey = legacyAuthStorageKey(parsedUrl);
    window.localStorage.removeItem(legacyKey);
    window.localStorage.removeItem(`${legacyKey}-user`);
  }
  browserClient = createClient(parsedUrl, publishableKey, {
    auth: {
      storageKey,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  if (typeof window !== "undefined" && storageKey && "BroadcastChannel" in window) {
    // Duplicating a browser tab can clone sessionStorage. Move the duplicate
    // to a new namespace if its original window is still open.
    const guardedWindow = window as Window & { motoVipAccountTabGuard?: { storageKey: string; channel: BroadcastChannel } };
    if (guardedWindow.motoVipAccountTabGuard?.storageKey !== storageKey) {
      const instanceId = window.crypto.randomUUID();
      const channel = new BroadcastChannel("moto-syxp:account-tabs");
      let rotating = false;
      guardedWindow.motoVipAccountTabGuard = { storageKey, channel };
      channel.onmessage = (event: MessageEvent) => {
        const message = event.data as { type?: string; storageKey?: string; instanceId?: string; target?: string } | null;
        if (!message || message.storageKey !== storageKey || message.instanceId === instanceId) return;
        if (message.type === "probe") {
          channel.postMessage({ type: "occupied", storageKey, instanceId, target: message.instanceId });
        } else if (message.type === "occupied" && message.target === instanceId && !rotating) {
          rotating = true;
          const nextSlot = replaceAccountSlot(window.sessionStorage);
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set("conta", nextSlot);
          window.history.replaceState(null, "", nextUrl);
          window.location.reload();
        }
      };
      channel.postMessage({ type: "probe", storageKey, instanceId });
      window.addEventListener("pagehide", () => channel.close(), { once: true });
    }
  }

  return browserClient;
}
