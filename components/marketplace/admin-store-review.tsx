"use client";

import { useState } from "react";
import type { ManagementData } from "@/lib/marketplace/management-view";
import { filterStoresForReview, type StoreReviewStatus } from "@/lib/marketplace/store-onboarding-review";
import { storeStatusLabel } from "./management-catalog";

export function AdminStoreReviewQueue({ stores, selectedStoreId, busy, select }: {
  stores: ManagementData["stores"]; selectedStoreId: string | null; busy: boolean; select: (id: string) => void;
}) {
  const [status, setStatus] = useState<StoreReviewStatus | "">("pending");
  const [query, setQuery] = useState("");
  const pending = stores.filter((store) => store.status === "pending").length;
  const visible = filterStoresForReview(stores, status, query);
  return <section className="mp-manage-card" aria-labelledby="market-store-review-title">
    <h2 id="market-store-review-title">Cadastros para revisão ({pending})</h2>
    <p className="mp-manage-caption">Lojas em análise ficam fora do catálogo público. Confira o estabelecimento, o titular, a retirada e os produtos antes de aprovar. Suspender ou aprovar não altera pedidos já aceitos.</p>
    <div className="mp-manage-form mp-manage-fields">
      <label>Localizar loja<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} placeholder="Nome ou identificador do link" /></label>
      <label>Situação<select value={status} onChange={(event) => setStatus(event.target.value as StoreReviewStatus | "")}>
        <option value="pending">Em análise</option><option value="approved">Aprovadas</option><option value="suspended">Suspensas</option><option value="">Todas</option>
      </select></label>
    </div>
    <p className="mp-manage-caption" role="status">{visible.length} {visible.length === 1 ? "loja encontrada" : "lojas encontradas"}.</p>
    <div className="mp-manage-list">
      {!visible.length && <p>{!query.trim() && status === "pending" ? "Nenhum cadastro aguardando revisão." : "Nenhuma loja corresponde aos filtros."}</p>}
      {visible.map((store) => <article key={store.id} className="mp-manage-row">
        <div><h3>{store.name}</h3><p className="mp-manage-caption">{store.slug} · {storeStatusLabel[store.status]}</p></div>
        <button className="mp-manage-button secondary" type="button" aria-label={`Revisar cadastro de ${store.name}`} aria-pressed={store.id === selectedStoreId} disabled={busy} onClick={() => select(store.id)}>
          {store.id === selectedStoreId ? "Loja selecionada" : "Revisar loja"}
        </button>
      </article>)}
    </div>
  </section>;
}
