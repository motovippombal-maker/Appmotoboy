"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { nextMarketAccountScope, type MarketAccountScope } from "@/lib/marketplace/checkout-attempt";
import { invalidatesMarketSnapshot } from "@/lib/marketplace/query-state";

const signInRequired = () => Object.assign(new Error("Entre na sua conta pelo início do MotoPombal para acessar este painel."), { status: 401 });
const statusOf = (problem: unknown) => problem instanceof Error && "status" in problem ? problem.status : null;

export function useMarketplaceManagement<T>(path: string, pollMs = 20_000) {
  const [snapshot, setSnapshot] = useState<{ data: T; scope: MarketAccountScope } | null>(null);
  const data = snapshot?.data ?? null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const loadGeneration = useRef(0);
  const requestInFlight = useRef(false);
  const mutationInFlight = useRef(false);
  const authScope = useRef<MarketAccountScope>({ id: null, generation: 0 });
  const invalidateRefresh = useCallback(() => {
    loadGeneration.current++;
    requestInFlight.current = false;
  }, []);

  const request = useCallback(async <R>(endpoint: string, action?: object | File, expected?: MarketAccountScope): Promise<{ data: R; scope: MarketAccountScope }> => {
    if (!navigator.onLine) throw new Error("Sem conexão. Reconecte-se e tente novamente.");
    const startingScope = authScope.current;
    const { data: { session } } = await getSupabaseBrowserClient().auth.getSession();
    if (!session) throw signInRequired();
    if (!startingScope.id && authScope.current === startingScope) authScope.current = nextMarketAccountScope(startingScope, session.user.id);
    const scope = authScope.current;
    if (scope.id !== session.user.id || (expected && expected !== scope)) throw signInRequired();
    const file = action instanceof File ? action : null;
    const response = await fetch(endpoint, {
      method: action ? "POST" : "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(24_000),
      headers: { Authorization: `Bearer ${session.access_token}`, ...(action ? { "Content-Type": file?.type ?? "application/json" } : {}) },
      body: file ?? (action ? JSON.stringify(action) : undefined),
    });
    const body: unknown = await response.json().catch(() => null);
    if (scope !== authScope.current) throw signInRequired();
    if (!response.ok) {
      const message = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "Não foi possível concluir a operação.";
      const problem = new Error(message);
      Object.assign(problem, { status: response.status });
      throw problem;
    }
    return { data: body as R, scope };
  }, []);

  const refresh = useCallback(async (quiet = false): Promise<T | null> => {
    if (quiet && requestInFlight.current) return null;
    const generation = ++loadGeneration.current;
    requestInFlight.current = true;
    if (!quiet) { setError(""); setErrorStatus(null); setLoading(true); }
    try {
      const result = await request<T>(path);
      if (generation !== loadGeneration.current) return null;
      setSnapshot(result);
      setError("");
      setErrorStatus(null);
      return result.data;
    } catch (problem) {
      if (generation !== loadGeneration.current) return null;
      if (invalidatesMarketSnapshot(statusOf(problem))) setSnapshot(null);
      setError(problem instanceof Error ? problem.message : "Não foi possível atualizar o painel.");
      setErrorStatus(typeof statusOf(problem) === "number" ? statusOf(problem) as number : null);
      return null;
    } finally {
      if (generation === loadGeneration.current) { requestInFlight.current = false; setLoading(false); }
    }
  }, [path, request]);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    let signedInTimer: number | undefined;
    const recover = () => { if (!document.hidden && navigator.onLine) void refresh(true); };
    const offline = () => setError("Sem conexão. Confira os dados exibidos antes de agir ao voltar à internet.");
    const interval = window.setInterval(recover, pollMs);
    window.addEventListener("online", recover);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", recover);
    // Do not leave information from a signed-out account on the screen.
    let subscription: { unsubscribe: () => void } | undefined;
    try {
      subscription = getSupabaseBrowserClient().auth.onAuthStateChange((event, session) => {
        const nextId = session?.user.id ?? null;
        const previous = authScope.current;
        authScope.current = nextMarketAccountScope(previous, nextId);
        if (event === "SIGNED_OUT" || (previous.id && previous !== authScope.current)) {
          invalidateRefresh();
          setSnapshot(null);
          setLoading(false);
          if (!nextId) {
            setError("Entre na sua conta pelo início do MotoPombal para acessar este painel.");
            setErrorStatus(401);
          }
        }
        if (event === "SIGNED_IN" && nextId) {
          window.clearTimeout(signedInTimer);
          signedInTimer = window.setTimeout(recover, 0);
        }
      }).data.subscription;
    } catch { /* The initial request reports missing environment configuration. */ }
    return () => {
      invalidateRefresh();
      window.clearTimeout(first);
      window.clearTimeout(signedInTimer);
      window.clearInterval(interval);
      window.removeEventListener("online", recover);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", recover);
      subscription?.unsubscribe();
    };
  }, [invalidateRefresh, pollMs, refresh]);

  const forgetDeniedSession = useCallback((problem: unknown, scope: MarketAccountScope) => {
    if (scope === authScope.current && [401, 403].some((status) => status === statusOf(problem))) {
      invalidateRefresh();
      setSnapshot(null);
      setError(problem instanceof Error ? problem.message : "Entre novamente para continuar.");
      setErrorStatus(typeof statusOf(problem) === "number" ? statusOf(problem) as number : null);
    }
  }, [invalidateRefresh]);

  const submit = useCallback(async <R>(action: object, endpoint = path): Promise<R> => {
    if (!snapshot) throw signInRequired();
    if (mutationInFlight.current) throw new Error("Aguarde a operação em andamento.");
    mutationInFlight.current = true;
    setBusy(true);
    try {
      const result = await request<R>(endpoint, action, snapshot.scope);
      await refresh();
      if (result.scope !== authScope.current) throw signInRequired();
      return result.data;
    } catch (problem) {
      forgetDeniedSession(problem, snapshot.scope);
      throw problem;
    } finally {
      setBusy(false);
      mutationInFlight.current = false;
    }
  }, [forgetDeniedSession, path, refresh, request, snapshot]);

  const uploadImage = useCallback(async (storeId: string, file: File): Promise<string> => {
    if (!snapshot) throw signInRequired();
    if (mutationInFlight.current) throw new Error("Aguarde a operação em andamento.");
    mutationInFlight.current = true;
    setBusy(true);
    try {
      const { data: result } = await request<{ url: string }>(`/api/marketplace/merchant/images?storeId=${encodeURIComponent(storeId)}`, file, snapshot.scope);
      if (!result?.url) throw new Error("O armazenamento não devolveu o endereço da imagem.");
      return result.url;
    } catch (problem) {
      forgetDeniedSession(problem, snapshot.scope);
      throw problem;
    } finally {
      setBusy(false);
      mutationInFlight.current = false;
    }
  }, [forgetDeniedSession, request, snapshot]);

  return { data, loading, error, errorStatus, authenticationRequired: errorStatus === 401, busy, refresh, submit, uploadImage };
}

export function managementMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function managementDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}
