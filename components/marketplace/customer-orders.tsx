"use client";

import Link from "next/link";
import { ArrowLeft, Bike, ChevronRight, ReceiptText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RealMap } from "@/components/map/real-map";
import { isLocationFresh } from "@/lib/tracking/realtime";
import { marketFetch, marketMessage, useMarketQuery } from "@/lib/marketplace/customer-client";
import type { MarketOrder, MarketOrderSummary } from "@/lib/marketplace/customer-contract";
import { useMarketCustomer } from "./customer-shell";
import { marketMoney } from "./customer-store";

export function marketOrderTitle(order: MarketOrderSummary) {
  if (order.status === "rejected") return "Pedido recusado pela loja";
  if (order.status === "cancelled") return "Pedido cancelado";
  if (order.logistics_status === "exception") return "Entrega em atendimento pela central";
  if (order.logistics_status === "delivered" || order.status === "delivered") return "Pedido entregue";
  if (order.logistics_status === "in_delivery") return "Pedido a caminho";
  if (order.logistics_status === "assigned") return "Entregador a caminho da loja";
  if (order.status === "ready") return "Pronto · aguardando entregador";
  if (order.status === "preparing") return "Pedido em preparação";
  return "Aguardando confirmação da loja";
}

const eventNames: Record<string, string> = {
  "order.created": "Pedido enviado à loja",
  "order.accepted": "A loja confirmou o pedido",
  "order.preparing": "Pedido em preparação",
  "order.ready": "Pedido pronto para retirada",
  "order.rejected": "Pedido recusado pela loja",
  "order.cancelled": "Pedido cancelado",
  "order.expired": "Prazo de confirmação expirado",
  delivery_assigned: "Entregador aceitou o serviço",
  picked_up: "Pedido retirado",
  delivered: "Entrega concluída",
  dispatch_waiting_support: "Busca de entregador em atendimento pela central",
  "payment.cash_received": "Recebimento registrado",
};
const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

function PendingOrderLookup({ userId }: { userId: string }) {
  const { isCurrentSession, pendingCheckoutKey, resolveCheckout } = useMarketCustomer();
  const [found, setFound] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function lookup() {
    if (pending.current) return;
    const key = pendingCheckoutKey();
    if (!key) { setMessage("Nenhuma tentativa pendente nesta aba."); return; }
    pending.current = true; setBusy(true); setMessage("");
    try {
      const { order } = await marketFetch<{ order: MarketOrderSummary | null }>(`/api/marketplace/orders?checkout=${encodeURIComponent(key)}`, { userId });
      if (!isCurrentSession() || pendingCheckoutKey() !== key) return;
      if (!order) { setMessage("Ainda não encontramos esse pedido. Nenhuma compra foi enviada novamente."); return; }
      if (resolveCheckout(key)) setFound(order.id);
    } catch (error) { setMessage(marketMessage(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="market-panel market-stack">
    <button type="button" className="market-secondary" onClick={() => void lookup()} disabled={busy}>{busy ? "Consultando…" : "Consultar tentativa de compra"}</button>
    {message && <small role="status">{message}</small>}
    {found && <Link href={`/compras/pedidos/${found}`}>Pedido encontrado. Acompanhar agora.</Link>}
  </div>;
}

export function MarketOrderList() {
  const { account } = useMarketCustomer();
  const query = useMarketQuery<{ orders: MarketOrderSummary[] }>(account.id ? "/api/marketplace/orders" : null, account.id ?? undefined, 20_000);
  return <>
    <Link className="market-back" href="/compras"><ArrowLeft size={17} /> Voltar às lojas</Link>
    <h1>Meus pedidos</h1>
    {account.loading || query.loading ? <p role="status">Carregando pedidos…</p> : null}
    {!account.loading && !account.id ? <p className="market-panel"><Link href="/">Entre na sua conta</Link> para consultar pedidos.</p> : null}
    {account.id && <PendingOrderLookup userId={account.id} />}
    {query.error && <p className="market-error" role="alert">{query.error} <button type="button" className="market-secondary" onClick={query.refresh}>Atualizar</button></p>}
    {query.data?.orders.length === 0 && <section className="market-panel market-empty"><ReceiptText /><h2>Nenhum pedido ainda</h2><p>Suas compras aparecerão aqui.</p></section>}
    <ul className="market-orders">{query.data?.orders.map((order) => <li key={order.id}><Link className="market-panel market-row" href={`/compras/pedidos/${order.id}`}><ReceiptText size={20} /><span><b>{order.store_name}</b><small>{marketOrderTitle(order)} · {date(order.created_at)}</small></span><strong>{marketMoney(order.total_cents)}</strong><ChevronRight size={17} /></Link></li>)}</ul>
  </>;
}

function MarketOrderMap({ order }: { order: MarketOrder }) {
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const first = window.setTimeout(tick, 0);
    const interval = window.setInterval(tick, 5_000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, []);
  const location = order.driverLocation;
  const fresh = location && clock !== null && isLocationFresh(location, location.freshnessSeconds, clock);
  const { lat: pickupLat, lng: pickupLng } = order.pickup;
  const { lat: destinationLat, lng: destinationLng } = order.destination;
  const origin = useMemo(() => ({ lat: pickupLat, lng: pickupLng, label: "Retirada" }), [pickupLat, pickupLng]);
  const destination = useMemo(() => ({ lat: destinationLat, lng: destinationLng, label: "Entrega" }), [destinationLat, destinationLng]);
  const driverLat = fresh ? location.lat : null;
  const driverLng = fresh ? location.lng : null;
  const driver = useMemo(() => driverLat === null || driverLng === null ? undefined : { lat: driverLat, lng: driverLng, label: "Entregador" }, [driverLat, driverLng]);
  return <section className="market-panel market-stack">
    <h2 className="market-row"><Bike size={20} /> Acompanhe a entrega</h2>
    <div className="market-map"><RealMap origin={origin} destination={destination} driver={driver} /></div>
    <small role="status">{fresh ? `Posição recebida às ${new Date(location.updatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : location ? "A posição do entregador está desatualizada. Aguardando novo sinal." : "A posição do entregador ainda não está disponível."}</small>
  </section>;
}

export function MarketOrderPage({ orderId }: { orderId: string }) {
  const { account } = useMarketCustomer();
  const query = useMarketQuery<{ order: MarketOrder }>(account.id ? `/api/marketplace/orders/${encodeURIComponent(orderId)}` : null, account.id ?? undefined, 12_000);
  const [reason, setReason] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef(false);
  const order = query.data?.order;
  async function cancel(event: React.FormEvent) {
    event.preventDefault();
    if (!account.id || request.current || reason.trim().length < 3) return;
    request.current = true; setBusy(true); setMessage("");
    try {
      await marketFetch(`/api/marketplace/orders/${orderId}`, { userId: account.id, method: "PATCH", body: { reason } });
      setCancelled(true); setMessage("Pedido cancelado."); query.refresh();
    } catch (error) { setMessage(marketMessage(error)); query.refresh(); }
    finally { request.current = false; setBusy(false); }
  }
  return <>
    <Link className="market-back" href="/compras/pedidos"><ArrowLeft size={17} /> Meus pedidos</Link>
    {(account.loading || query.loading) && <p role="status">Carregando pedido…</p>}
    {!account.loading && !account.id && <p className="market-panel"><Link href="/">Entre na sua conta</Link> para acompanhar o pedido.</p>}
    {query.error && <p className="market-error" role="alert">{query.error} <button type="button" className="market-secondary" onClick={query.refresh}>Atualizar</button></p>}
    {order && <>
      <section className="market-hero"><span className="market-eyebrow">Pedido {order.id.slice(0, 8)}</span><h1>{order.store_name}</h1><p role="status">{marketOrderTitle(order)}</p></section>
      <section className="market-panel market-stack"><h2>Resumo do pedido</h2><p><b>Entrega:</b> {order.destination_address}</p>
        <ul className="market-list">{order.items.map((item) => <li key={item.id}><span>{item.quantity} × {item.product_name}{!!item.options.length && <small>{item.options.map(({ name }) => name).join(", ")}</small>}</span><b>{marketMoney(item.line_total_cents)}</b></li>)}</ul>
        <dl className="market-totals"><div><dt>Produtos</dt><dd>{marketMoney(order.subtotal_cents)}</dd></div><div><dt>Frete</dt><dd>{marketMoney(order.freight_cents)}</dd></div>{order.discount_cents > 0 && <div><dt>Desconto</dt><dd>{marketMoney(order.discount_cents)}</dd></div>}<div className="market-total"><dt>Total em dinheiro</dt><dd>{marketMoney(order.total_cents)}</dd></div></dl>
        <p>{!order.payment?.received_at ? "Recebimento não registrado." : order.payment.received_amount_cents === null ?
          `Conferência registrada em ${date(order.payment.received_at)}, sem valor informado.` :
          `Dinheiro declarado em ${date(order.payment.received_at)}: ${marketMoney(order.payment.received_amount_cents)}.${order.payment.received_amount_cents !== order.total_cents ? " Há diferença em relação ao total do pedido; procure a central." : ""}`}</p>
        {order.cashSchemaReady === false && <small>Os registros de caixa estão em atualização.</small>}
        <small>Preparo: {order.prep_minutes !== null ? `${order.prep_minutes} min informados pela loja` : "não informado"}. Deslocamento: {order.estimated_duration_seconds ? `estimativa de ${Math.ceil(order.estimated_duration_seconds / 60)} min` : "estimativa indisponível"}.</small>
      </section>
      {["assigned", "in_delivery"].includes(order.logistics_status) && <MarketOrderMap order={order} />}
      {order.logistics_status === "exception" && <p className="market-panel">A entrega está em atendimento pela central. <Link href="/passageiro/suporte">Falar com suporte</Link></p>}
      {order.logistics_status === "awaiting_driver" && order.events[0]?.event_type === "dispatch_waiting_support" && <p className="market-panel">Nenhum entregador disponível no momento. O pedido continua aguardando. <Link href="/passageiro/suporte">Falar com suporte</Link></p>}
      {order.status === "pending" && !cancelled && <form className="market-panel market-stack" onSubmit={cancel}><h2>Cancelar solicitação</h2><label>Motivo <input required minLength={3} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="submit" className="market-secondary" disabled={busy}>{busy ? "Cancelando…" : "Cancelar pedido"}</button></form>}
      {message && <p role="status" className="market-status">{message}</p>}
      <section className="market-panel"><h2>Histórico</h2><ol className="market-orders">{order.events.filter((event) => eventNames[event.event_type]).map((event) => <li key={event.id} className="market-row"><span>{eventNames[event.event_type]}</span><small>{date(event.created_at)}</small></li>)}</ol></section>
    </>}
  </>;
}
