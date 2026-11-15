"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MarketQuote } from "./customer-contract";
import { marketSnapshotAfterError } from "./query-state";

export class MarketClientError extends Error {
  constructor(message: string, public status: number, public code?: string, public quote?: MarketQuote) { super(message); }
}

export async function marketFetch<T>(
  path: string, options: { method?: string; body?: unknown; signal?: AbortSignal; userId?: string } = {},
): Promise<T> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.userId) {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    if (data.session?.user.id !== options.userId)
      throw new MarketClientError("Entre novamente para continuar.", 401, "INVALID_SESSION");
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  if (options.method && options.method !== "GET" && !navigator.onLine)
    throw new MarketClientError("Sem conexão. Aguarde a internet e tente novamente.", 0, "OFFLINE");
  const deadline = AbortSignal.timeout(24_000);
  const response = await fetch(path, {
    method: options.method, signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline, headers, cache: "no-store",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    const detail = payload && typeof payload === "object" ? payload as { message?: string; error?: string; quote?: MarketQuote } : null;
    throw new MarketClientError(detail?.message ?? "O serviço está indisponível. Tente novamente.", response.status, detail?.error, detail?.quote);
  }
  return payload as T;
}

export function marketMessage(error: unknown) {
  return error instanceof MarketClientError ? error.message : "Não foi possível conectar. Verifique sua internet e tente novamente.";
}

export function useMarketQuery<T>(path: string | null, userId?: string, refreshMs?: number) {
  const [state, setState] = useState<{ key: string; data: T | null; error: string; loading: boolean }>({ key: "", data: null, error: "", loading: true });
  const [attempt, setAttempt] = useState(0);
  const key = path ? `${userId ?? "-"}:${path}` : "";
  useEffect(() => {
    if (!path) return;
    let inFlight = false;
    let mounted = true;
    const controller = new AbortController();
    const read = () => {
      if (inFlight || !mounted || document.hidden) return;
      if (!navigator.onLine) {
        setState((old) => ({ key, data: old.key === key ? old.data : null, error: "Sem conexão. Mostrando os últimos dados disponíveis.", loading: false }));
        return;
      }
      inFlight = true;
      void marketFetch<T>(path, { userId, signal: controller.signal }).then((data) => {
        if (mounted) setState({ key, data, loading: false, error: "" });
      }).catch((error: unknown) => {
        if (mounted) setState((old) => ({ key, data: marketSnapshotAfterError(old, key, error instanceof MarketClientError ? error.status : undefined), loading: false, error: marketMessage(error) }));
      }).finally(() => { inFlight = false; });
    };
    read();
    const timer = refreshMs ? window.setInterval(read, refreshMs) : undefined;
    window.addEventListener("online", read);
    window.addEventListener("offline", read);
    window.addEventListener("focus", read);
    window.addEventListener("moto-vip:network-restored", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      mounted = false;
      controller.abort();
      if (timer) window.clearInterval(timer);
      window.removeEventListener("online", read);
      window.removeEventListener("offline", read);
      window.removeEventListener("focus", read);
      window.removeEventListener("moto-vip:network-restored", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [key, path, userId, refreshMs, attempt]);
  const current = state.key === key ? state : { data: null, error: "", loading: true };
  return { ...current, loading: Boolean(path && current.loading), refresh: () => setAttempt((n) => n + 1) };
}
