"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, Clock, MapPin, ReceiptText, Search, ShoppingBag, SlidersHorizontal, Store, X } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import type { MarketCatalog, MarketProduct } from "@/lib/marketplace/customer-contract";
import { filterStorefrontProducts } from "@/lib/marketplace/storefront-catalog";
import { MarketImage } from "./customer-browse";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const marketMoney = (cents: number) => brl.format(cents / 100);
const weekdays = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

export function MarketStorefront({ catalog, demo = false, cartItems = 0, onSelect, delivery }: {
  catalog: MarketCatalog;
  demo?: boolean;
  cartItems?: number;
  onSelect: (product: MarketProduct) => void;
  delivery?: ReactNode;
}) {
  const { store, categories, products } = catalog;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const searchId = useId();
  const catalogId = useId();
  const activeCategory = categories.some((item) => item.id === category) ? category : "";
  const visible = useMemo(() => filterStorefrontProducts(products, activeCategory, query),
    [products, activeCategory, query]);
  const sections = useMemo(() => {
    const labels = new Map(categories.map((item) => [item.id, item.name]));
    const groups = new Map<string, MarketProduct[]>();
    const other: MarketProduct[] = [];
    for (const product of visible) {
      const categoryId = product.category_id;
      if (categoryId && labels.has(categoryId)) {
        const group = groups.get(categoryId);
        if (group) group.push(product);
        else groups.set(categoryId, [product]);
      } else other.push(product);
    }
    const ordered = categories.flatMap((item) => {
      const group = groups.get(item.id);
      return group ? [{ id: item.id, name: item.name, items: group }] : [];
    });
    if (other.length) ordered.push({ id: "outros", name: ordered.length ? "Outros itens" : "Produtos", items: other });
    return ordered;
  }, [categories, visible]);
  const showHours = !demo && Object.values(store.hours).some((slots) => slots.length > 0);
  const steps = [
    { icon: Store, label: demo ? "Conheça a loja modelo" : "Conheça a loja" },
    { icon: SlidersHorizontal, label: "Personalize seus favoritos" },
    { icon: ShoppingBag, label: "Revise sua sacola" },
    { icon: ReceiptText, label: demo ? "Confira a simulação" : "Acompanhe seu pedido" },
  ];

  return <div className={`market-storefront${demo ? " market-storefront-demo" : ""}`}>
    <Link className="market-back" href="/compras" prefetch={demo ? false : undefined}><ArrowLeft size={17} aria-hidden="true" /> Todas as lojas</Link>
    <header className="market-storefront-hero">
      <div className="market-storefront-cover">
        <MarketImage src={store.cover_url} className="market-storefront-cover-media" eager />
        <span className="market-storefront-kicker">{demo ? "Loja modelo · MotoPombal" : "Compras · MotoPombal"}</span>
      </div>
      <div className="market-storefront-profile">
        <MarketImage src={store.image_url} className="market-storefront-logo" eager />
        <div className="market-storefront-title">
          <span className="market-storefront-category">{store.category}</span>
          <h1>{store.name}</h1>
        </div>
        {demo ? <span className="market-storefront-state" data-state="demo">Demonstração</span> :
          <span className="market-storefront-state" data-state={store.open ? "open" : "closed"}>
            {store.open ? "Aberta para pedidos" : "Fechada no momento"}
          </span>}
        {store.description && <p className="market-storefront-description">{store.description}</p>}
        {!demo && (store.address || store.prep_minutes !== null || showHours) && <div className="market-storefront-meta">
          {store.address && <span><MapPin size={16} aria-hidden="true" /> {store.address}</span>}
          {store.prep_minutes !== null && <span><Clock size={16} aria-hidden="true" /> Preparo informado: {store.prep_minutes} min</span>}
          {showHours && <details>
            <summary>Horários da loja</summary>
            <ul>{weekdays.map((day, index) => <li key={day}><span>{day}</span> {store.hours[String(index + 1)]?.map(({ open, close }) => `${open}–${close}`).join(", ") || "Fechada"}</li>)}</ul>
          </details>}
        </div>}
      </div>
    </header>
    {demo && <p className="market-storefront-demo-note"><b>Catálogo ilustrativo.</b> Produtos e preços fictícios. A simulação não envia pedidos nem cobra.</p>}
    {delivery}
    <ol className="market-storefront-steps" aria-label={demo ? "Etapas da demonstração" : "Como comprar"}>
      {steps.map(({ icon: Icon, label }) => <li key={label}>
        <span><Icon size={18} aria-hidden="true" /></span>{label}
      </li>)}
    </ol>

    <section className="market-storefront-menu" aria-labelledby={catalogId}>
      <div className="market-storefront-menu-heading">
        <div><span className="market-storefront-category">Explore a loja</span><h2 id={catalogId}>Cardápio</h2></div>
        <span className="market-muted" role="status">{visible.length} {visible.length === 1 ? "item" : "itens"}</span>
      </div>
      <form className="market-storefront-search" role="search" onSubmit={(event) => event.preventDefault()}>
        <Search size={19} aria-hidden="true" />
        <label className="sr-only" htmlFor={searchId}>Buscar no cardápio</label>
        <input id={searchId} value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar no cardápio" autoComplete="off" maxLength={100} type="search" />
        {query && <button type="button" aria-label="Limpar busca" onClick={() => {
          setQuery("");
          document.getElementById(searchId)?.focus();
        }}><X size={17} aria-hidden="true" /></button>}
      </form>
      {!!categories.length && <nav className="market-storefront-filters" aria-label="Categorias do cardápio">
        {[{ id: "", name: "Todos" }, ...categories].map((item) => <button type="button" key={item.id}
          aria-pressed={activeCategory === item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}
      </nav>}

      {!visible.length && <div className="market-panel market-empty">
        <Search aria-hidden="true" />
        <h3>{products.length ? "Nenhum item encontrado" : "Cardápio sem itens cadastrados"}</h3>
        <p>{products.length ? "Tente outro termo ou escolha outra categoria." : "Os produtos vão aparecer aqui quando a loja disponibilizar o catálogo."}</p>
        {products.length > 0 && (query || activeCategory) && <button type="button" className="market-secondary" onClick={() => {
          setQuery("");
          setCategory("");
          document.getElementById(searchId)?.focus();
        }}>Limpar filtros</button>}
      </div>}
      {sections.map((section) => <section className="market-storefront-section" key={section.id} aria-label={section.name}>
        <div className="market-storefront-section-title"><h3>{section.name}</h3><span>{section.items.length}</span></div>
        <ul className="market-storefront-products">{section.items.map((product) => (
          <li key={product.id}>
            <button type="button" className="market-storefront-product" onClick={() => onSelect(product)}>
              <span className="market-storefront-product-copy">
                <b>{product.name}</b>
                {product.description && <small>{product.description}</small>}
                <span className="market-storefront-product-price">{marketMoney(product.price_cents)}</span>
                {!product.available ? <span className="market-storefront-unavailable">Indisponível</span> :
                  product.groups.length > 0 && <span className="market-storefront-product-options">Tem opções</span>}
              </span>
              <MarketImage src={product.image_url} className="market-storefront-product-photo" />
            </button>
          </li>
        ))}</ul>
      </section>)}
    </section>
    {cartItems > 0 && <a className="market-storefront-cart-jump" href="#carrinho">
      <ShoppingBag size={19} aria-hidden="true" /><span>Ver carrinho</span>
      <b>{cartItems} {cartItems === 1 ? "item" : "itens"}</b><ChevronRight size={18} aria-hidden="true" />
    </a>}
  </div>;
}
