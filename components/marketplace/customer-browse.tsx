"use client";

import Link from "next/link";
import { Store, StoreIcon, Search } from "lucide-react";
import { useState } from "react";
import { BRASA_SHOWCASE_PATH } from "@/lib/marketplace/brasa-showcase";
import { useMarketQuery } from "@/lib/marketplace/customer-client";
import type { MarketStore } from "@/lib/marketplace/customer-contract";
import { MarketAddress } from "./customer-address";
import { useMarketCustomer } from "./customer-shell";

export function MarketImage({ src, className, eager = false }: {
  src: string | null | undefined;
  className?: string;
  eager?: boolean;
}) {
  let valid: string | undefined;
  if (src && /^\/marketplace-demo\/brasa-da-vila\/[a-z0-9-]+\.(?:png|webp)$/.test(src)) valid = src;
  else if (src) {
    try {
      const url = new URL(src);
      if (url.protocol === "https:" && !url.username && !url.password) valid = url.href;
    } catch { /* An incomplete catalog image uses the placeholder. */ }
  }
  // Catalog assets are external HTTPS URLs; avoid the server-side image proxy.
  // eslint-disable-next-line @next/next/no-img-element
  return valid ? <img className={className} src={valid} loading={eager ? "eager" : "lazy"} referrerPolicy="no-referrer" alt="" /> : <div className={className} aria-hidden="true"><StoreIcon size={30} /></div>;
}

export function MarketStoreList() {
  const { address } = useMarketCustomer();
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const listings = useMarketQuery<{ stores: MarketStore[] }>(`/api/marketplace/stores?q=${encodeURIComponent(query)}`, undefined, 60_000);
  const matching = listings.data?.stores.filter((store) => !address || !store.service_area_id || address.areaIds.includes(store.service_area_id)) ?? [];
  const categories = [...new Set(matching.map((store) => store.category))].filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const stores = category ? matching.filter((store) => store.category === category) : matching;
  return <>
    <section className="market-hero"><span className="market-eyebrow">Ribeira do Pombal</span><h1>Compre de lojas da cidade</h1><p>Escolha uma loja, faça seu pedido e acompanhe pelo MotoPombal.</p></section>
    <MarketAddress />
    <form className="market-panel market-row" role="search" onSubmit={(event) => { event.preventDefault(); setCategory(""); setQuery(typed.trim()); }}>
      <label className="sr-only" htmlFor="market-store-search">Nome da loja</label>
      <input id="market-store-search" maxLength={80} placeholder="Buscar loja pelo nome" value={typed} onChange={(event) => setTyped(event.target.value)} />
      <button type="submit" className="market-primary"><Search size={18} /> Buscar</button>
    </form>
    {!!categories.length && <nav className="market-filters" aria-label="Categorias de loja">
      {["", ...categories].map((name) => <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)}>{name || "Todas"}</button>)}
    </nav>}
    {listings.loading && <p role="status">Carregando lojas…</p>}
    {listings.error && <p className="market-error" role="alert">{listings.error} <button className="market-secondary" type="button" onClick={listings.refresh}>Atualizar</button></p>}
    {listings.data && !stores.length && <section className="market-panel market-empty"><Store aria-hidden="true" /><h2>Nenhuma loja encontrada</h2><p>Tente outra busca, categoria ou endereço.</p></section>}
    <section className="market-card-grid" aria-label="Lojas disponíveis">{stores.map((store) => (
      <Link className="market-store-card" key={store.id} href={`/compras/lojas/${store.slug}`}>
        <MarketImage src={store.image_url || store.cover_url} className="market-store-photo" />
        <div><h2>{store.name}</h2><p>{store.category}</p><small>{store.open ? "Aberta para pedidos" : "Fechada no momento"}</small></div>
      </Link>))}</section>
    <aside className="market-panel market-stack" aria-labelledby="market-demo-card-title">
      <span className="market-eyebrow">Demonstração</span>
      <h2 id="market-demo-card-title">Brasa da Vila · Modelo de loja</h2>
      <p className="market-muted">Explore o cardápio e simule um pedido. Esta demonstração não aceita compras reais.</p>
      <Link className="market-secondary" href={BRASA_SHOWCASE_PATH} prefetch={false}>Ver demonstração</Link>
    </aside>
  </>;
}
