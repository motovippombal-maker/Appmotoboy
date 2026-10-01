import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { browserAuthStorageKey, legacyAuthStorageKey, replaceAccountSlot } from "../lib/auth/browser-session";

function tabStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

test("janelas com o endereço normal recebem sessões independentes", () => {
  const firstTab = tabStorage();
  const secondTab = tabStorage();
  const url = "https://example.supabase.co";
  const firstSlot = "973a99d7-f14b-44a6-b071-05ea3545cd16";
  const secondSlot = "3c9917d2-3039-4a7d-9b95-b9a32d11983a";
  assert.equal(browserAuthStorageKey(url, "", firstTab, () => firstSlot), `${legacyAuthStorageKey(url)}-conta-${firstSlot}`);
  assert.equal(browserAuthStorageKey(url, "", secondTab, () => secondSlot), `${legacyAuthStorageKey(url)}-conta-${secondSlot}`);
  assert.equal(browserAuthStorageKey(url, "", firstTab, () => secondSlot), `${legacyAuthStorageKey(url)}-conta-${firstSlot}`);
  assert.equal(browserAuthStorageKey(url, "?conta=2", secondTab), `${legacyAuthStorageKey(url)}-conta-2`);
});

test("aba duplicada pode trocar de sessão sem alterar a original", () => {
  const original = tabStorage();
  const duplicate = tabStorage();
  const url = "https://example.supabase.co";
  const slot = "973a99d7-f14b-44a6-b071-05ea3545cd16";
  const newSlot = "3c9917d2-3039-4a7d-9b95-b9a32d11983a";
  browserAuthStorageKey(url, "", original, () => slot);
  browserAuthStorageKey(url, `?conta=${slot}`, duplicate);
  replaceAccountSlot(duplicate, () => newSlot);
  assert.equal(browserAuthStorageKey(url, "", original), `${legacyAuthStorageKey(url)}-conta-${slot}`);
  assert.equal(browserAuthStorageKey(url, "", duplicate), `${legacyAuthStorageKey(url)}-conta-${newSlot}`);
});

test("logout é local e a sessão antiga compartilhada é removida", async () => {
  const hook = await readFile(new URL("../hooks/use-moto-vip.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../lib/supabase/client.ts", import.meta.url), "utf8");
  assert.match(hook, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.match(client, /window\.localStorage\.removeItem\(legacyKey\)/);
});
