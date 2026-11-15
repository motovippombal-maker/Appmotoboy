"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export async function deliveryApi<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const client = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) throw new Error("Entre na sua conta para continuar.");
  const response = await fetch(path, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${session.access_token}`,
      ...(init.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    message?: string;
  };
  if (!response.ok)
    throw new Error(body.message || "Não foi possível concluir a operação.");
  return body;
}
