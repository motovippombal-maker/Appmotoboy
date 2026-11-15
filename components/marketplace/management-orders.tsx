"use client";

import { useState } from "react";
import type { AdminManagementAction, MerchantManagementAction } from "@/lib/marketplace/management";
import type { ManageOrder } from "@/lib/marketplace/management-view";
import { cashReconciliationIssue, marketCashAmountInCents, marketOrderCashState, summarizeMarketCash } from "@/lib/marketplace/cash-reconciliation";
import { ApplyButton, field } from "./management-catalog";
import { managementDate, managementMoney } from "./management-client";

type OrderAction = Extract<AdminManagementAction | MerchantManagementAction, { orderId: string }>;
type ActionOption = { label: string; value: string; confirmation?: string } &
  ({ cash: "receive" | "settle"; action?: never } | { cash?: never; action: (reason: string) => OrderAction });
const commercial = { pending: "Aguardando loja", preparing: "Em preparação", ready: "Pronto para retirada", delivered: "Entregue", rejected: "Recusado", cancelled: "Cancelado" } as const;
const logistics = { not_requested: "Entrega ainda não solicitada", awaiting_driver: "Aguardando entregador", assigned: "Entregador a caminho da retirada", in_delivery: "Em entrega", delivered: "Entrega concluída", exception: "Ocorrência em análise pela central", cancelled: "Entrega encerrada" } as const;
const eventLabels: Record<string, string> = {
  "order.created": "Pedido realizado", "order.preparing": "Pedido aceito e em preparação", "order.ready": "Pedido pronto para retirada",
  "order.rejected": "Pedido recusado", "order.cancelled": "Pedido cancelado", "order.expired": "Prazo de aceite encerrado",
  "payment.cash_received": "Recebimento em dinheiro registrado", "payment.store_settled": "Repasse à loja registrado",
  dispatch_waiting_support: "Distribuição precisa de apoio da central", delivery_offered: "Entrega oferecida a um entregador",
  delivery_assigned: "Entregador aceitou a entrega", picked_up: "Pedido retirado", delivered: "Entrega concluída",
  delivery_exception: "Ocorrência após a retirada", delivery_driver_withdrew: "Entregador saiu antes da retirada",
  delivery_declined: "Oferta recusada; buscando outro entregador",
  delivery_admin_retry: "Nova tentativa autorizada pela central", delivery_admin_resume: "Entrega retomada pela central",
  delivery_admin_delivered: "Entrega confirmada pela central", delivery_admin_cancel: "Entrega cancelada pela central",
  delivery_admin_returned_restock: "Ocorrência encerrada com devolução ao estoque", delivery_admin_close_without_restock: "Ocorrência encerrada sem reposição",
};
const dispatchReasons: Record<string, string> = { customer_blocked: "Conta de compra bloqueada", attempts_exhausted: "Limite de tentativas atingido" };

function OrderControls({ order, busy, central, canPrepare, operationsEnabled, cashWritesEnabled, send }: { order: ManageOrder; busy: boolean; central: boolean; canPrepare: boolean; operationsEnabled: boolean; cashWritesEnabled: boolean; send: (input: OrderAction) => Promise<boolean> }) {
  const [selection, setSelection] = useState("");
  const [formIssue, setFormIssue] = useState("");
  const core = { storeId: order.store_id, orderId: order.id };
  const actions: ActionOption[] = [];
  if (!central && order.status === "pending") actions.push({ value: "reject", label: "Recusar pedido", action: (reason) => ({ ...core, action: "orderAction", command: "reject", reason }) });
  if ((central && order.status === "pending") || order.status === "preparing") actions.push({ value: "cancel", label: "Cancelar pedido", action: (reason) => ({ ...core, action: "orderAction", command: "cancel", reason }) });
  if (operationsEnabled && central && order.status === "ready" && order.logistics_status === "awaiting_driver" && order.dispatch_exhausted_at)
    actions.push({ value: "retry", label: "Autorizar nova tentativa de despacho", action: (reason) => ({ ...core, action: "retryDelivery", reason }) });
  if (operationsEnabled && central && order.status === "ready" && ["awaiting_driver", "assigned"].includes(order.logistics_status))
    actions.push({ value: "cancelDelivery", label: "Cancelar entrega antes da retirada", confirmation: "Confirmei que a encomenda ainda não foi retirada.", action: (reason) => ({ ...core, action: "deliveryException", resolution: "cancel", reason }) });
  if (operationsEnabled && central && order.logistics_status === "exception") actions.push(
    { value: "resume", label: "Retomar com o mesmo entregador", action: (reason) => ({ ...core, action: "deliveryException", resolution: "resume", reason }) },
    { value: "delivered", label: "Registrar entrega confirmada", confirmation: "Confirmei que o destinatário recebeu o pedido. Esta ação não confirma pagamento.", action: (reason) => ({ ...core, action: "deliveryException", resolution: "delivered", reason }) },
    { value: "returned", label: "Encerrar com devolução ao estoque", confirmation: "Confirmei que os itens foram devolvidos e podem retornar ao estoque.", action: (reason) => ({ ...core, action: "deliveryException", resolution: "returned_restock", reason }) },
    { value: "noStock", label: "Encerrar sem devolver ao estoque", confirmation: "Confirmei que os itens não podem retornar ao estoque.", action: (reason) => ({ ...core, action: "deliveryException", resolution: "close_without_restock", reason }) },
  );
  const cashState = marketOrderCashState(order);
  if (cashWritesEnabled && central && cashState === "pending") actions.push({ value: "receive", label: "Registrar recebimento em dinheiro", confirmation: "Conferi e confirmo o valor que informei.", cash: "receive" });
  if (cashWritesEnabled && cashState === "received") actions.push({ value: "settle", label: "Registrar repasse à loja", confirmation: "Conferi o valor e a referência do repasse já realizado.", cash: "settle" });
  const choice = actions.find((action) => action.value === selection);
  return <>
    {operationsEnabled && !central && canPrepare && order.status === "pending" && <button className="mp-manage-button" disabled={busy} type="button" onClick={() => void send({ ...core, action: "orderAction", command: "accept" })}>Aceitar e iniciar preparo</button>}
    {operationsEnabled && !central && canPrepare && order.status === "preparing" && <button className="mp-manage-button" disabled={busy} type="button" onClick={() => void send({ ...core, action: "orderAction", command: "ready" })}>Marcar pronto e solicitar entregador</button>}
    {operationsEnabled && !central && !canPrepare && ["pending", "preparing"].includes(order.status) && <p className="mp-manage-caption">A loja precisa estar aprovada para aceitar ou despachar pedidos.</p>}
    {actions.length > 0 && <form className="mp-manage-form" onSubmit={async (event) => {
      event.preventDefault(); if (!choice) return; const form = event.currentTarget;
      setFormIssue(""); const fields = new FormData(form); const reason = field(fields, "reason");
      let input: OrderAction;
      if (choice.cash) {
        const amountCents = marketCashAmountInCents(field(fields, "cashAmount"));
        const reference = field(fields, "cashReference") || undefined;
        if (amountCents === null) { setFormIssue("Informe reais e até duas casas decimais, sem separador de milhares."); return; }
        if (choice.cash === "settle" && amountCents !== order.cash?.store_due_cents) {
          setFormIssue("O repasse informado difere da parcela prevista da loja. Encaminhe à central; não registre um valor diferente como repasse concluído."); return;
        }
        input = { ...core, action: "cashAction", command: choice.cash, amountCents, reference, reason };
      } else input = choice.action(reason);
      if (await send(input)) { form.reset(); setSelection(""); }
    }}><fieldset disabled={busy}>
      <label>Outras ações<select value={choice?.value ?? ""} onChange={(event) => { setSelection(event.target.value); setFormIssue(""); }}><option value="">Selecione</option>{actions.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}</select></label>
      {choice && <>
        {choice.cash && <fieldset key={`cash:${choice.value}`}>
          <p className="mp-manage-caption">Informe o valor e a referência conferidos. O sistema registra a conferência; não transfere dinheiro.</p>
          <label>{choice.cash === "receive" ? "Valor efetivamente recebido (R$)" : "Valor efetivamente repassado (R$)"}<input name="cashAmount" required inputMode="decimal" maxLength={10} placeholder="0,00" /></label>
          <label>Referência externa {choice.cash === "receive" ? "(opcional)" : "(obrigatória)"}, sem CPF, chaves ou dados pessoais<input name="cashReference" minLength={3} maxLength={120} required={choice.cash === "settle"} /></label>
        </fieldset>}
        <label>Justificativa<textarea key={choice.value} name="reason" rows={2} minLength={3} maxLength={300} required placeholder="Registre o motivo ou a conferência realizada" /></label>
        {choice.confirmation && <label><input key={choice.value} type="checkbox" required />{choice.confirmation}</label>}
        {formIssue && <p className="mp-manage-message error" role="alert">{formIssue}</p>}
        <ApplyButton danger={["cancel", "cancelDelivery", "reject", "returned", "noStock"].includes(choice.value)}>{choice.label}</ApplyButton>
      </>}
    </fieldset></form>}
  </>;
}

function CashOverview({ orders }: { orders: ManageOrder[] }) {
  const totals = summarizeMarketCash(orders);
  return <section className="mp-manage-card" aria-label="Conciliação dos pedidos consultados">
    <h3>Conciliação do recorte exibido</h3>
    <p className="mp-manage-caption">{orders.length} pedidos recentes nesta loja. Os totais abaixo cobrem apenas esta consulta; não são saldo disponível ou relatório de todo o período.</p>
    <dl className="mp-manage-order-values">
      <div><dt>Vendas entregues · total previsto</dt><dd>{managementMoney(totals.deliveredTotalCents)}</dd></div>
      <div><dt>Recebimentos com valor declarado</dt><dd>{totals.receivedWithAmount ? managementMoney(totals.receivedCents) : "Nenhum valor registrado"}</dd></div>
      <div><dt>Previsto em entregas sem registro de recebimento</dt><dd>{managementMoney(totals.pendingCashCents)}</dd></div>
      <div><dt>Parcela prevista das lojas</dt><dd>{managementMoney(totals.expectedStoreCents)}</dd></div>
      <div><dt>Parcela prevista dos entregadores</dt><dd>{managementMoney(totals.expectedDriverCents)}</dd></div>
      <div><dt>Parcela prevista da plataforma</dt><dd>{managementMoney(totals.expectedPlatformCents)}</dd></div>
      <div><dt>Repasses à loja com valor declarado</dt><dd>{totals.settledWithAmount ? managementMoney(totals.storeSettledCents) : "Nenhum valor registrado"}</dd></div>
    </dl>
    <p className="mp-manage-caption">{totals.completedOrders} entregues; {totals.divergentOrders} com diferença; {totals.legacyOrders} registros antigos com valor não informado; {totals.inconsistentOrders} inconsistentes ou sem registro correlato.</p>
    {totals.divergentOrders > 0 && <p className="mp-manage-caption">Diferenças apuradas separadamente: faltam {managementMoney(totals.shortCents)}; a mais {managementMoney(totals.overCents)}. Consulte os pedidos em “Conferência de caixa”.</p>}
  </section>;
}

export function ManagementOrders({ orders, busy, central = false, canPrepare = true, operationsEnabled, cashWritesEnabled, send }: { orders: ManageOrder[]; busy: boolean; central?: boolean; canPrepare?: boolean; operationsEnabled: boolean; cashWritesEnabled: boolean; send: (input: OrderAction) => Promise<boolean> }) {
  const [view, setView] = useState<"active" | "history" | "cash">("active");
  const closed = (order: ManageOrder) => ["delivered", "rejected", "cancelled"].includes(order.status);
  const needsCashReview = (order: ManageOrder) => ["divergent", "legacy_unverified", "inconsistent", "missing"].includes(marketOrderCashState(order));
  const visibleOrders = orders.filter((order) => view === "cash" ? needsCashReview(order) : view === "history" ? closed(order) : !closed(order));
  return <section className="mp-manage-card"><h2>Pedidos e valores</h2>
    <CashOverview orders={orders} />
    <nav className="mp-manage-tabs" aria-label="Filtros dos pedidos">
      <button className="mp-manage-button secondary" type="button" aria-pressed={view === "active"} onClick={() => setView("active")}>Em andamento ({orders.filter((order) => !closed(order)).length})</button>
      <button className="mp-manage-button secondary" type="button" aria-pressed={view === "history"} onClick={() => setView("history")}>Histórico ({orders.filter(closed).length})</button>
      <button className="mp-manage-button secondary" type="button" aria-pressed={view === "cash"} onClick={() => setView("cash")}>Conferência de caixa ({orders.filter(needsCashReview).length})</button>
    </nav>
    <p className="mp-manage-caption">Mostrando até 100 pedidos recentes da loja. Entrega, recebimento e repasse têm registros separados.</p>
    <div className="mp-manage-list">
      {!visibleOrders.length && <p>{view === "cash" ? "Nenhuma divergência ou registro sem conferência neste recorte." : view === "history" ? "Nenhum pedido encerrado neste período." : "Nenhum pedido em andamento."}</p>}
      {visibleOrders.map((order) => { const cashState = marketOrderCashState(order); return <details key={order.id}>
        <summary>Pedido {order.id.slice(0, 8).toUpperCase()} · {commercial[order.status]} · {managementMoney(order.total_cents)}</summary>
        <p className="mp-manage-caption">Criado em {managementDate(order.created_at)}{order.status === "pending" ? ` · confirmar até ${managementDate(order.expires_at)}` : ""}</p>
        <p><strong>Entrega:</strong> {logistics[order.logistics_status]}{order.dispatch_exhausted_at && order.logistics_status === "awaiting_driver" ? " · tentativas encerradas; a central pode autorizar nova busca" : ""}</p>
        {order.prep_minutes !== null && <p>Preparo informado na compra: {order.prep_minutes} min.</p>}
        <ul className="mp-manage-list">{order.items.map((line) => <li key={line.id}>
          <strong>{line.quantity} × {line.product_name}</strong> · {managementMoney(line.line_total_cents)}
          {line.options.length > 0 && <p className="mp-manage-caption">{line.options.map((option) => `${option.groupName}: ${option.name}${option.priceCents ? ` (+${managementMoney(option.priceCents)})` : ""}`).join(" · ")}</p>}
        </li>)}</ul>
        <dl className="mp-manage-order-values">
          <div><dt>Produtos + adicionais</dt><dd>{managementMoney(order.subtotal_cents)}</dd></div>
          <div><dt>Frete</dt><dd>{managementMoney(order.freight_cents)}</dd></div>
          {order.discount_cents > 0 && <div><dt>Desconto</dt><dd>{managementMoney(order.discount_cents)}</dd></div>}
          <div><dt>Total previsto do pedido</dt><dd>{managementMoney(order.total_cents)}</dd></div>
          {order.cash && <>
            <div><dt>Parcela prevista da loja</dt><dd>{managementMoney(order.cash.store_due_cents)}</dd></div>
            <div><dt>Parcela prevista do entregador</dt><dd>{managementMoney(order.cash.driver_due_cents)}</dd></div>
            <div><dt>Parcela prevista da plataforma</dt><dd>{managementMoney(order.cash.platform_due_cents)}</dd></div>
            {order.cash.received_amount_cents !== null && <div><dt>Dinheiro declarado como recebido</dt><dd>{managementMoney(order.cash.received_amount_cents)}</dd></div>}
            {order.cash.settled_amount_cents !== null && <div><dt>Repasse declarado à loja</dt><dd>{managementMoney(order.cash.settled_amount_cents)}</dd></div>}
          </>}
        </dl>
        {cashState !== "not_due" && cashReconciliationIssue(cashState) && <p className="mp-manage-message error" role="status">{cashReconciliationIssue(cashState)}</p>}
        {cashState === "divergent" && order.cash?.received_amount_cents != null && <p>Diferença neste pedido: {managementMoney(Math.abs(order.cash.amount_cents - order.cash.received_amount_cents))} {order.cash.received_amount_cents < order.cash.amount_cents ? "a menos" : "a mais"}.</p>}
        {order.cash && <p className="mp-manage-caption">Dinheiro: {order.cash.received_at ? `registro em ${managementDate(order.cash.received_at)}${order.cash.receipt_reference ? ` · referência ${order.cash.receipt_reference}` : ""}` : "sem registro"}. Repasse: {order.cash.settled_at ? `registro em ${managementDate(order.cash.settled_at)}${order.cash.settlement_reference ? ` · referência ${order.cash.settlement_reference}` : ""}` : "sem registro"}.</p>}
        {order.events.length > 0 && <details><summary>Histórico deste pedido</summary><ol className="mp-manage-list">
          {order.events.map((event) => <li key={event.id}>{managementDate(event.created_at)} · {eventLabels[event.event_type] ?? "Movimentação do pedido"}{event.reason ? ` · ${event.event_type === "dispatch_waiting_support" ? (dispatchReasons[event.reason] ?? "Aguardando suporte") : event.reason}` : ""}{event.financialActor && ` · evento ${event.id} / ator ${event.financialActor.slice(0, 8)}`}</li>)}
        </ol></details>}
        <OrderControls order={order} central={central} canPrepare={canPrepare} busy={busy} operationsEnabled={operationsEnabled} cashWritesEnabled={cashWritesEnabled} send={send} />
      </details>; })}
    </div>
  </section>;
}
