"use client";

import { CheckCircle2, Minus, Plus, RotateCcw, ShoppingBag, Trash2 } from "lucide-react";
import { useState } from "react";
import { BRASA_SHOWCASE_CATALOG, BRASA_SHOWCASE_PATH } from "@/lib/marketplace/brasa-showcase";
import { addMarketEntry, cartEntryId, type MarketCart, type MarketCartEntry } from "@/lib/marketplace/cart";
import type { MarketProduct } from "@/lib/marketplace/customer-contract";
import { marketMoney, ProductSelection } from "./customer-store";
import { MarketStorefront } from "./storefront";

type DemoState = {
  cart: MarketCart | null;
  step: "cart" | "review" | "done";
  notice: string;
};

const initialState: DemoState = { cart: null, step: "cart", notice: "" };

export function BrasaDemoStore() {
  const [selected, setSelected] = useState<MarketProduct | null>(null);
  const [{ cart, step, notice }, setState] = useState<DemoState>(initialState);
  const entries = cart?.entries ?? [];
  const quantity = entries.reduce((total, item) => total + item.quantity, 0);
  const subtotal = entries.reduce((total, item) => total + item.estimatedUnitCents * item.quantity, 0);

  function add(entry: MarketCartEntry) {
    setState((current) => {
      const result = addMarketEntry(current.step === "done" ? null : current.cart, BRASA_SHOWCASE_CATALOG.store, entry);
      return result.state === "added"
        ? { cart: result.cart, step: "cart", notice: "Item adicionado ao carrinho de teste." }
        : { ...current, notice: "O carrinho de teste atingiu o limite de itens ou quantidade." };
    });
    setSelected(null);
  }

  function edit(id: string, delta?: number) {
    setState((current) => {
      if (!current.cart || current.step !== "cart") return current;
      const next = typeof delta === "number" ? current.cart.entries.map((item) => cartEntryId(item) === id
        ? { ...item, quantity: Math.max(1, Math.min(99, item.quantity + delta)) }
        : item) : current.cart.entries.filter((item) => cartEntryId(item) !== id);
      return { cart: next.length ? { ...current.cart, entries: next } : null, step: "cart", notice: typeof delta === "number" ? "Quantidade atualizada." : "Item removido do carrinho de teste." };
    });
  }

  function changeStep(next: "cart" | "review" | "done") {
    setState((current) => !current.cart?.entries.length || (next === "done" && current.step !== "review")
      ? current : { ...current, step: next, notice: "" });
  }

  return <>
    <MarketStorefront catalog={BRASA_SHOWCASE_CATALOG} demo cartItems={quantity} onSelect={setSelected} />
    <section id="carrinho" className="market-panel market-stack" aria-labelledby="brasa-demo-cart-title">
      <div className="market-row"><ShoppingBag size={20} aria-hidden="true" /><h2 id="brasa-demo-cart-title">Carrinho de demonstração</h2></div>
      {step === "done" ? <>
        <p className="market-status market-row" role="status"><CheckCircle2 size={19} aria-hidden="true" /><span>Simulação concluída. Nenhum pedido foi enviado.</span></p>
        <p className="market-muted">Não foi feita cobrança nem solicitado entregador.</p>
        <button className="market-secondary" type="button" onClick={() => setState(initialState)}><RotateCcw size={17} aria-hidden="true" /> Nova simulação</button>
      </> : <>
        {!entries.length ? <p className="market-muted">Escolha itens do cardápio para testar a montagem de um pedido.</p> : <>
          {step === "review" && <h3>Confira a simulação</h3>}
          <ul className="market-list">{entries.map((item) => {
            const id = cartEntryId(item);
            return <li key={id}>
              <span><b>{item.quantity} × {item.title}</b>{item.optionsLabel && <small>{item.optionsLabel}</small>}<small>{marketMoney(item.estimatedUnitCents * item.quantity)}</small></span>
              {step === "cart" && <div className="market-row">
                <button className="market-secondary" type="button" onClick={() => edit(id, -1)} disabled={item.quantity <= 1} aria-label={`Diminuir quantidade de ${item.title}`}><Minus size={17} aria-hidden="true" /></button>
                <button className="market-secondary" type="button" onClick={() => edit(id, 1)} disabled={item.quantity >= 99} aria-label={`Aumentar quantidade de ${item.title}`}><Plus size={17} aria-hidden="true" /></button>
                <button className="market-secondary" type="button" onClick={() => edit(id)} aria-label={`Remover ${item.title}`}><Trash2 size={17} aria-hidden="true" /></button>
              </div>}
            </li>;
          })}</ul>
          <dl className="market-totals">
            <div className="market-total"><dt>Subtotal dos itens</dt><dd>{marketMoney(subtotal)}</dd></div>
            {step === "review" && <div><dt>Frete</dt><dd>Não calculado</dd></div>}
          </dl>
          {step === "review" ? <>
            <p className="market-muted">A simulação não pede endereço nem pagamento. Os itens não entram no seu carrinho real.</p>
            <button className="market-primary" type="button" onClick={() => changeStep("done")}>Confirmar simulação</button>
            <button className="market-secondary" type="button" onClick={() => changeStep("cart")}>Editar itens</button>
          </> : <button className="market-primary" type="button" onClick={() => changeStep("review")}>Simular pedido, sem envio</button>}
        </>}
        {notice && <p className="market-status" role="status">{notice}</p>}
      </>}
    </section>
    {selected && <ProductSelection key={`${BRASA_SHOWCASE_PATH}:${selected.id}`} product={selected} onAdd={add} onClose={() => setSelected(null)} />}
  </>;
}
