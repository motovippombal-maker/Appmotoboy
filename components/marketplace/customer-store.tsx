"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clock, MapPin, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { addMarketEntry, cartEntryId, optionsInRange, type MarketCartEntry } from "@/lib/marketplace/cart";
import { MarketClientError, marketFetch, marketMessage, useMarketQuery } from "@/lib/marketplace/customer-client";
import { marketQuoteInput, type MarketCatalog, type MarketProduct, type MarketQuote, type MarketQuoteInput } from "@/lib/marketplace/customer-contract";
import { MarketAddress } from "./customer-address";
import { MarketImage } from "./customer-browse";
import { useMarketCustomer } from "./customer-shell";

export const marketMoney = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function ProductSelection({ product, onAdd, onClose }: { product: MarketProduct; onAdd: (entry: MarketCartEntry) => void; onClose: () => void }) {
  const [quantity, setQuantity] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const chosen = product.groups.flatMap(({ options }) => options).filter(({ id }) => selected.includes(id));
  const unit = product.price_cents + chosen.reduce((sum, option) => sum + option.price_cents, 0);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => node?.close();
  }, []);
  return <dialog ref={dialog} className="market-dialog" aria-labelledby={id} onCancel={onClose}>
    <button type="button" className="market-secondary" onClick={onClose}><ArrowLeft size={16} /> Voltar à loja</button>
    <MarketImage src={product.image_url} className="market-product-hero" />
    <h2 id={id}>{product.name}</h2>
    {product.description && <p>{product.description}</p>}
    <strong>{marketMoney(product.price_cents)}</strong>
    {product.groups.map((group) => {
      const selectedInGroup = group.options.filter((option) => selected.includes(option.id));
      return <fieldset className="market-option-group" key={group.id}>
        <legend>{group.name}</legend>
        <small>{group.min_select > 0 ? `Escolha de ${group.min_select} a ${group.max_select}` : `Opcional · até ${group.max_select}`}</small>
        {group.options.map((option) => {
          const checked = selected.includes(option.id);
          return <label className="market-option" key={option.id}><input type="checkbox" checked={checked} disabled={!checked && group.max_select !== 1 && selectedInGroup.length >= group.max_select} onChange={() => {
            setSelected(checked ? selected.filter((id) => id !== option.id) :
              group.max_select === 1 ? [...selected.filter((id) => !group.options.some((item) => item.id === id)), option.id] : [...selected, option.id]);
          }} /><span>{option.name}</span><small>{option.price_cents ? `+${marketMoney(option.price_cents)}` : "Sem adicional"}</small></label>;
        })}
      </fieldset>;
    })}
    <div className="market-row market-quantity">
      <button type="button" className="market-secondary" aria-label="Diminuir quantidade" disabled={quantity <= 1} onClick={() => setQuantity((value) => value - 1)}><Minus size={17} /></button>
      <output aria-label="Quantidade">{quantity}</output>
      <button type="button" className="market-secondary" aria-label="Aumentar quantidade" disabled={quantity >= 99} onClick={() => setQuantity((value) => value + 1)}><Plus size={17} /></button>
    </div>
    <button type="button" className="market-primary market-wide" disabled={!product.available || !optionsInRange(product.groups, selected)} onClick={() => onAdd({
      productId: product.id, quantity, optionIds: selected, title: product.name,
      optionsLabel: chosen.map((option) => option.name).join(", "), estimatedUnitCents: unit,
    })}>Adicionar · {marketMoney(unit * quantity)}</button>
  </dialog>;
}

function CashCheckout({ enabled }: { enabled: boolean }) {
  const { account, address, cart, isCurrentSession, pendingCheckoutKey, rememberCheckout, resolveCheckout } = useMarketCustomer();
  const router = useRouter();
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<{ input: string; quote: MarketQuote } | null>(null);
  const [busy, setBusy] = useState<"quote" | "checkout" | "check" | null>(null);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const active = useRef(false);
  const checkedKey = useRef<string | null>(null);
  const userId = account.id ?? undefined;
  useEffect(() => {
    active.current = true;
    const first = window.setTimeout(() => {
      if (!inFlight.current && pendingCheckoutKey() && !checkedKey.current) setUncertain(true);
    }, 0);
    return () => { active.current = false; window.clearTimeout(first); };
  }, [pendingCheckoutKey]);
  const current = cart && address ? marketQuoteInput.safeParse({
    storeId: cart.storeId, delivery: { ...address.point, recipientName, recipientPhone, notes },
    cart: cart.entries.map(({ productId, quantity, optionIds }) => ({ productId, quantity, optionIds })),
  }) : null;
  const input = current?.success ? current.data : null;
  const serializedInput = input ? JSON.stringify(input) : "";
  const quote = state?.input === serializedInput ? state.quote : null;
  function completed(id: string, key: string, submittedCart?: NonNullable<typeof cart>) {
    if (!active.current || !isCurrentSession() || !resolveCheckout(key, submittedCart)) return;
    setUncertain(false);
    router.push(`/compras/pedidos/${id}`);
  }
  async function checkExisting() {
    const key = pendingCheckoutKey();
    if (!userId || !isCurrentSession() || inFlight.current) return;
    if (!key) { setMessage("Nenhuma tentativa de compra nesta aba. Consulte também Meus pedidos."); return; }
    inFlight.current = true; setBusy("check"); setMessage("");
    try {
      const { order } = await marketFetch<{ order: { id: string } | null }>(`/api/marketplace/orders?checkout=${encodeURIComponent(key)}`, { userId });
      if (!active.current || !isCurrentSession() || pendingCheckoutKey() !== key) return;
      if (order) completed(order.id, key);
      else {
        checkedKey.current = key;
        setUncertain(false);
        setMessage("Ainda não encontramos esse pedido. Se precisar confirmar novamente, o mesmo identificador será usado.");
      }
    } catch (error) { setMessage(marketMessage(error)); }
    finally { inFlight.current = false; setBusy(null); }
  }
  async function getQuote(event: React.FormEvent) {
    event.preventDefault();
    if (!enabled) return;
    if (!userId || inFlight.current) return;
    if (!input) { setMessage("Informe um endereço válido, o nome de quem recebe e um telefone brasileiro com DDD."); return; }
    inFlight.current = true; setBusy("quote"); setMessage("");
    const snapshot = serializedInput;
    try {
      const result = await marketFetch<{ quote: MarketQuote }>("/api/marketplace/orders/quote", { method: "POST", body: input, userId });
      setState({ input: snapshot, quote: result.quote });
    } catch (error) { setState(null); setMessage(marketMessage(error)); }
    finally { inFlight.current = false; setBusy(null); }
  }
  async function placeOrder(currentInput: MarketQuoteInput, currentQuote: MarketQuote) {
    if (!enabled) return;
    if (!userId || !cart || !isCurrentSession() || inFlight.current) return;
    const previousKey = pendingCheckoutKey();
    if (previousKey && checkedKey.current !== previousKey) {
      setUncertain(true);
      setMessage("Consulte a tentativa anterior antes de confirmar outra vez.");
      return;
    }
    if (!navigator.onLine) { setMessage("Sem conexão. Nenhuma solicitação nova foi enviada."); return; }
    const key = previousKey || window.crypto.randomUUID();
    if (!rememberCheckout(key, cart)) return;
    inFlight.current = true; setBusy("checkout"); setMessage("");
    try {
      const result = await marketFetch<{ orderId: string }>("/api/marketplace/orders", {
        method: "POST", body: { ...currentInput, quoteToken: currentQuote.quoteToken, idempotencyKey: key, paymentMethod: "cash" }, userId,
        signal: AbortSignal.timeout(24_000),
      });
      if (!result.orderId) throw new Error("Resposta de checkout incompleta.");
      completed(result.orderId, key, cart);
    } catch (error) {
      if (!active.current || !isCurrentSession()) return;
      if (error instanceof MarketClientError && error.status >= 400 && error.status < 500) {
        if (error.code === "MARKET_IDEMPOTENCY_CONFLICT") { checkedKey.current = null; setUncertain(true); }
        else { checkedKey.current = key; setUncertain(false); }
        if (error.quote) setState({ input: serializedInput, quote: error.quote });
        else if (error.status === 409 || error.status === 422) setState(null);
        setMessage(error.message);
      } else {
        checkedKey.current = null;
        setUncertain(true);
        setMessage("Não recebemos a confirmação. Consulte a tentativa antes de confirmar novamente. Nenhum reenvio é automático.");
      }
    } finally { inFlight.current = false; setBusy(null); }
  }
  if (!account.id) return <p><Link href="/">Entre na sua conta</Link> para finalizar a compra.</p>;
  return <section className="market-checkout" aria-label="Finalizar compra">
    <h2>Finalizar compra</h2>
    <div className="market-panel">
      {!enabled ? <p role="status">Pedidos temporariamente indisponíveis. Você ainda pode consultar o catálogo e seus pedidos anteriores.</p> : <>
      <form className="market-stack" onSubmit={getQuote}>
        <label>Quem recebe<input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} required maxLength={100} disabled={Boolean(busy)} /></label>
        <label>Telefone com DDD<input value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} type="tel" autoComplete="tel" required maxLength={30} disabled={Boolean(busy)} /></label>
        <label>Instruções de entrega <small>(opcional)</small><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} disabled={Boolean(busy)} /></label>
        <p className="market-muted">Pagamento em dinheiro na entrega. Pix e cartão ainda indisponíveis para compras.</p>
        {!quote && <button className="market-primary" type="submit" disabled={Boolean(busy) || !address}>{busy === "quote" ? "Calculando…" : "Ver resumo e frete"}</button>}
        {!address && <p>Defina o endereço de entrega acima.</p>}
      </form>
      {quote && input && <div className="market-stack">
        <h3>Confira o pedido</h3>
        <ul className="market-list">{quote.items.map((line, index) => <li key={`${line.productId}:${index}`}><span>{line.quantity} × {line.productName}{!!line.options.length && <small>{line.options.map(({ name }) => name).join(", ")}</small>}</span><b>{marketMoney(line.lineTotalCents)}</b></li>)}</ul>
        <dl className="market-totals">
          <div><dt>Produtos e complementos</dt><dd>{marketMoney(quote.subtotalCents)}</dd></div>
          <div><dt>Frete</dt><dd>{marketMoney(quote.freightCents)}</dd></div>
          {quote.discountCents > 0 && <div><dt>Descontos</dt><dd>−{marketMoney(quote.discountCents)}</dd></div>}
          <div className="market-total"><dt>Total em dinheiro</dt><dd>{marketMoney(quote.totalCents)}</dd></div>
        </dl>
        <p className="market-muted">Preparo informado pela loja: {quote.prepMinutes === null ? "não informado" : `${quote.prepMinutes} min`}. Deslocamento estimado da loja ao destino: {quote.travelSeconds === null ? "indisponível" : `${Math.max(1, Math.ceil(quote.travelSeconds / 60))} min`}. O tempo para encontrar um entregador é separado.</p>
        <button className="market-primary" type="button" disabled={Boolean(busy) || uncertain} onClick={() => void placeOrder(input, quote)}>{busy === "checkout" ? "Confirmando…" : `Confirmar compra · ${marketMoney(quote.totalCents)}`}</button>
      </div>}
      </>}
      <button className="market-secondary" type="button" disabled={Boolean(busy)} onClick={() => void checkExisting()}>{busy === "check" ? "Consultando…" : "Consultar tentativa anterior"}</button>
      {uncertain && <p className="market-muted">Consulte a tentativa anterior antes de confirmar outra vez.</p>}
      {message && <p className="market-status" role="status">{message}</p>}
    </div>
  </section>;
}

export function MarketStorePage({ slug }: { slug: string }) {
  const { cart, setCart, address } = useMarketCustomer();
  const { data, error, loading, refresh } = useMarketQuery<MarketCatalog>(`/api/marketplace/stores/${encodeURIComponent(slug)}`, undefined, 60_000);
  const [product, setProduct] = useState<MarketProduct | null>(null);
  const [category, setCategory] = useState("");
  const [replacement, setReplacement] = useState<MarketCartEntry | null>(null);
  const [message, setMessage] = useState("");
  if (loading) return <p role="status">Carregando loja…</p>;
  if (!data) return <section className="market-panel"><Link href="/compras">Voltar às lojas</Link><h1>Loja indisponível</h1><p className="market-error" role="alert">{error}</p><button type="button" className="market-secondary" onClick={refresh}>Tentar novamente</button></section>;
  const { store, categories, products, checkoutAvailable } = data;
  const servesAddress = !address || !store.service_area_id || address.areaIds.includes(store.service_area_id);
  const items = cart?.storeId === store.id ? cart.entries : [];
  const visible = category ? products.filter((item) => item.category_id === category) : products;
  function add(entry: MarketCartEntry, replace = false) {
    const result = addMarketEntry(cart, store, entry, replace);
    setProduct(null);
    if (result.state === "replace") { setReplacement(entry); return; }
    setReplacement(null);
    if (result.state === "limit") { setMessage("O carrinho atingiu o limite de itens ou quantidade."); return; }
    setCart(result.cart); setMessage("Produto adicionado ao carrinho.");
  }
  return <>
    <Link className="market-back" href="/compras"><ArrowLeft size={17} /> Todas as lojas</Link>
    <section className="market-panel market-store-head">
      <MarketImage src={store.cover_url || store.image_url} className="market-cover" />
      <span className="market-eyebrow">{store.category}</span><h1>{store.name}</h1>
      <b>{store.open ? "Aberta para pedidos" : "Fechada no momento"}</b>
      {store.description && <p>{store.description}</p>}
      <p className="market-row"><MapPin size={16} /> {store.address}</p>
      {store.prep_minutes !== null && <p className="market-row"><Clock size={16} /> Preparo informado: {store.prep_minutes} min</p>}
      {!!Object.keys(store.hours).length && <details><summary>Horários de atendimento</summary><ul>{weekdays.map((day, index) => <li key={day}>{day}: {store.hours[String(index + 1)]?.map(({ open, close }) => `${open}–${close}`).join(", ") || "Fechada"}</li>)}</ul></details>}
    </section>
    <MarketAddress />
    {!checkoutAvailable && <p className="market-status" role="status">Catálogo para consulta. Novos pedidos estão indisponíveis.</p>}
    {error && <p className="market-error" role="alert">{error} <button type="button" className="market-secondary" onClick={refresh}>Atualizar</button></p>}
    {!servesAddress && <p className="market-error" role="alert">A loja não atende o endereço escolhido.</p>}
    <section aria-label="Catálogo">
      <h2>Catálogo</h2>
      {!!categories.length && <nav className="market-filters" aria-label="Categorias de produto">{[{ id: "", name: "Todos" }, ...categories].map((item) => <button type="button" key={item.id} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}</nav>}
      {!visible.length && <p className="market-panel">Nenhum produto disponível nesta categoria.</p>}
      <div className="market-card-grid">{visible.map((item) => <button key={item.id} type="button" className="market-product-card" onClick={() => setProduct(item)} disabled={!checkoutAvailable || !item.available || !store.open || !servesAddress}><MarketImage src={item.image_url} className="market-product-photo" /><span><b>{item.name}</b>{item.description && <small>{item.description}</small>}<strong>{marketMoney(item.price_cents)}</strong>{!item.available && <small>Indisponível</small>}</span></button>)}</div>
    </section>
    {product && <ProductSelection key={product.id} product={product} onAdd={add} onClose={() => setProduct(null)} />}
    {replacement && <section className="market-panel market-confirm" role="alert"><h2>Trocar de loja?</h2><p>Ao confirmar, os itens da outra loja serão removidos do seu carrinho.</p><div className="market-row"><button className="market-secondary" type="button" onClick={() => setReplacement(null)}>Manter carrinho</button><button className="market-primary" type="button" onClick={() => add(replacement, true)}>Trocar e adicionar</button></div></section>}
    {message && <p className="market-status" role="status">{message}</p>}
    <section id="carrinho" className="market-panel" aria-label="Carrinho">
      <h2 className="market-row"><ShoppingBag size={21} /> Carrinho</h2>
      {!items.length ? <p>Adicione os produtos que deseja comprar.</p> : <>
        <ul className="market-list">{items.map((item) => <li key={cartEntryId(item)}><span><b>{item.quantity} × {item.title}</b>{item.optionsLabel && <small>{item.optionsLabel}</small>}</span><span>{marketMoney(item.estimatedUnitCents * item.quantity)}</span><button type="button" className="market-secondary" aria-label={`Remover ${item.title}`} onClick={() => {
          if (!cart) return;
          const entries = cart.entries.filter((entry) => cartEntryId(entry) !== cartEntryId(item));
          setCart(entries.length ? { ...cart, entries } : null);
        }}><Trash2 size={16} /></button></li>)}</ul>
        <p className="market-muted">Valores do catálogo. O servidor confirma produtos, complementos e frete no checkout.</p>
      </>}
    </section>
    {!!items.length && <CashCheckout enabled={checkoutAvailable} />}
  </>;
}
