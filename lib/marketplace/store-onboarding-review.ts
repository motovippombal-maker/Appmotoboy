export type StoreReviewStatus = "pending" | "approved" | "suspended";
export type StoreReviewIssue = "owner" | "pickup" | "catalog";
export type StoreReadiness = { required: boolean; ready: boolean; issues: StoreReviewIssue[] };

export const storeReviewIssueLabels: Record<StoreReviewIssue, string> = {
  owner: "Vincular um titular com conta ativa.",
  pickup: "Conferir o endereço e o ponto de retirada dentro da área atendida.",
  catalog: "Cadastrar ao menos um produto disponível, com categoria e complementos obrigatórios válidos.",
};

export function parseStoreReadiness(value: unknown): StoreReadiness | null {
  if (!value || typeof value !== "object" || !("required" in value) || !("ready" in value) || !("issues" in value)) return null;
  if (typeof value.required !== "boolean" || typeof value.ready !== "boolean" || !Array.isArray(value.issues) ||
    value.issues.some((issue) => issue !== "owner" && issue !== "pickup" && issue !== "catalog")) return null;
  if (value.ready !== (value.issues.length === 0) || (!value.required && !value.ready)) return null;
  return { required: value.required, ready: value.ready, issues: [...new Set(value.issues)] };
}

export function isStoreReadinessRpcMissing(error: { code?: string; message?: string } | null) {
  return Boolean(error && ["42883", "PGRST202"].includes(error.code ?? "") &&
    /\b(?:public\.)?market_store_readiness\b/i.test(error.message ?? ""));
}

export function filterStoresForReview<T extends { name: string; slug: string; status: StoreReviewStatus }>(
  stores: T[], status: StoreReviewStatus | "", query: string,
): T[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return stores.filter((store) => (!status || store.status === status) && terms.every((term) => normalize(`${store.name} ${store.slug}`).includes(term)));
}
