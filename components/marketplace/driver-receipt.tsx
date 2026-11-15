"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { marketFetch, marketMessage, useMarketQuery } from "@/lib/marketplace/customer-client";
import type { MarketCashStatus } from "@/lib/marketplace/customer-contract";
import { cashReconciliationIssue, cashReconciliationState, marketCashAmountInCents, marketOrderCashState, summarizeMarketCash, type CashReconciliationOrder } from "@/lib/marketplace/cash-reconciliation";
import { useMarketCustomer } from "./customer-shell";

const brl = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
export function DriverMarketReceipt({ orderId, userId, collectible = true }: { orderId: string; userId: string; collectible?: boolean }) {
  const path = `/api/marketplace/orders/${orderId}/payment`;
  const read = useMarketQuery<{ payment: MarketCashStatus; cashSchemaReady: boolean; cashWritesEnabled: boolean }>(path, userId);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const flight = useRef(false);
  const payment = read.data?.payment;
  const state = cashReconciliationState(payment ?? null);
  const issue = payment && cashReconciliationIssue(state);
  const amount = marketCashAmountInCents(amountText);
  async function receive() {
    if (!collectible || flight.current || !payment || !confirm || state !== "pending" || !read.data?.cashWritesEnabled || amount === null) return;
    flight.current = true; setBusy(true); setMessage("");
    try {
      await marketFetch(path, { userId, method: "POST", body: { amountCents: amount, reference: reference.trim() || undefined, note: note.trim() || undefined } });
      setMessage(amount !== payment.amount_cents ? "Valor declarado registrado com divergência. O repasse fica bloqueado." : "Declaração de recebimento registrada. O repasse é uma confirmação separada da loja.");
      setConfirm(false);
    } catch (error) { setMessage(marketMessage(error)); }
    finally { setBusy(false); flight.current = false; read.refresh(); }
  }
  return <section className="market-receipt market-stack">
    {read.loading && <p role="status">Consultando valores do pedido…</p>}
    {read.error && <p role="alert">{read.error} <button type="button" className="market-secondary" onClick={read.refresh}>Atualizar</button></p>}
    {payment && <>
      <dl className="market-totals">
        <div><dt>Total previsto a cobrar</dt><dd>{brl(payment.amount_cents)}</dd></div>
        <div><dt>Dinheiro declarado como recebido</dt><dd>{payment.received_amount_cents === null ? "Não informado" : brl(payment.received_amount_cents)}</dd></div>
        <div><dt>Parcela prevista da loja</dt><dd>{brl(payment.store_due_cents)}</dd></div>
        <div><dt>Frete previsto para o entregador</dt><dd>{brl(payment.driver_due_cents)}</dd></div>
        {payment.settled_amount_cents !== null && <div><dt>Repasse declarado à loja</dt><dd>{brl(payment.settled_amount_cents)}</dd></div>}
      </dl>
      {issue && <p role="status">{issue}</p>}
      {state === "received" && <p>Valor recebido registrado. Repasse pendente.</p>}
      {state === "settled" && <p>Recebimento e repasse registrados separadamente.</p>}
      {read.data?.cashSchemaReady === false && <small role="status">O caixa está em atualização. Consulte os registros disponíveis.</small>}
      {state === "pending" && (!collectible ? <small>O dinheiro pode ser registrado depois de confirmar a entrega.</small> : !read.data?.cashWritesEnabled ? <small>O registro de caixa está indisponível no momento.</small> :
        <form className="market-stack" onSubmit={(event) => { event.preventDefault(); void receive(); }}>
          <small>Informe o valor que você conferiu. Se foi diferente do total previsto, registre a diferença.</small>
          <label>Valor efetivamente recebido (R$)<input required inputMode="decimal" maxLength={10} placeholder="0,00" value={amountText} disabled={busy} onChange={(event) => { setAmountText(event.target.value); setConfirm(false); }} /></label>
          <label>Referência externa do registro (opcional, sem CPF, chaves ou dados pessoais)<input minLength={3} maxLength={120} value={reference} disabled={busy} onChange={(event) => { setReference(event.target.value); setConfirm(false); }} /></label>
          <label>Observação (opcional)<input maxLength={300} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} /></label>
          {amountText && amount === null && <small role="status">Informe reais e até duas casas decimais, sem separador de milhares.</small>}
          {amount !== null && amount !== payment.amount_cents && <small role="status">Valor diferente do previsto: o registro sinalizará a divergência e bloqueará o repasse.</small>}
          <label className="market-option"><input type="checkbox" checked={confirm} disabled={busy} onChange={(event) => setConfirm(event.target.checked)} /> Conferi e confirmo o valor que informei.</label>
          <button type="submit" className="market-primary" disabled={!confirm || amount === null || busy || Boolean(read.error)}>{busy ? "Registrando…" : "Registrar valor em dinheiro"}</button>
        </form>)}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}

export function DriverMarketHistory() {
  const { account } = useMarketCustomer();
  const read = useMarketQuery<{ orders: (CashReconciliationOrder & { id: string; store_name: string; updated_at: string })[]; cashSchemaReady: boolean }>(account.id ? "/api/marketplace/driver/receipts" : null, account.id ?? undefined);
  const [selected, setSelected] = useState("");
  const totals = read.data?.orders.length ? summarizeMarketCash(read.data.orders) : null;
  return <>
    <Link className="market-back" href="/">Voltar à área do motorista</Link>
    <h1>Entregas de Compras</h1>
    {account.loading || read.loading ? <p role="status">Carregando entregas…</p> : null}
    {!account.loading && !account.id && <p>Entre na sua conta de motorista para consultar as entregas.</p>}
    {read.error && <p className="market-error" role="alert">{read.error} <button type="button" className="market-secondary" onClick={read.refresh}>Atualizar</button></p>}
    {read.data?.orders.length === 0 && <p className="market-panel">Nenhuma entrega de Compras concluída.</p>}
    {read.data?.cashSchemaReady === false && <p className="market-panel" role="status">O caixa está em atualização. Este histórico não atribui valores aos recebimentos antigos.</p>}
    {totals && <section className="market-panel market-stack">
      <h2>Valores das últimas {totals.completedOrders} entregas consultadas</h2>
      <p>Frete previsto para o entregador: <strong>{brl(totals.expectedDriverCents)}</strong>.</p>
      <p>Dinheiro declarado como recebido dos clientes, incluindo parcelas de outras partes: <strong>{totals.receivedWithAmount ? brl(totals.receivedCents) : "nenhum valor informado"}</strong>. Esse total não é ganho do entregador.</p>
      {(totals.divergentOrders + totals.legacyOrders + totals.inconsistentOrders) > 0 && <small>Há registros que requerem conferência. Consulte o recebimento de cada pedido.</small>}
    </section>}
    {account.id && read.data?.orders.map((order) => <article key={order.id} className="market-panel market-stack">
      <h2>{order.store_name}</h2><small>Pedido {order.id.slice(0, 8)}</small>
      {cashReconciliationIssue(cashReconciliationState(order.cash, order.total_cents)) && <small>Conferência necessária no caixa do pedido.</small>}
      {marketOrderCashState(order) === "pending" && <small>Sem valor recebido registrado.</small>}
      <button type="button" className="market-secondary" aria-expanded={selected === order.id} onClick={() => setSelected(selected === order.id ? "" : order.id)}>Ver recebimento</button>
      {selected === order.id && <DriverMarketReceipt orderId={order.id} userId={account.id} />}
    </article>)}
  </>;
}
