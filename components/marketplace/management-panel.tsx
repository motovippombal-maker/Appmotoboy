"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { adminManagementAction, merchantManagementAction, type AdminManagementAction, type MerchantManagementAction } from "@/lib/marketplace/management";
import type { ManageStore, ManagementData } from "@/lib/marketplace/management-view";
import { ApplyButton, field, numberField, optionalField, StoreFields, storeStatusLabel, storeValues, StoreSettings, MerchantCatalog, PreferredDriver, type MerchantCommand } from "./management-catalog";
import { useMarketplaceManagement } from "./management-client";
import { ManagementOrders } from "./management-orders";

const merchantEndpoint = "/api/marketplace/merchant";
const adminEndpoint = "/api/admin/marketplace";
type CentralCommand = <R = unknown>(action: AdminManagementAction, success?: string) => Promise<R | null>;

function StoreSelection({ data, storeId, select, busy }: { data: ManagementData; storeId: string; select: (id: string) => void; busy: boolean }) {
  if (!data.stores.length) return null;
  return <label>Loja em atendimento<select className="mp-manage-select" value={storeId || data.store?.id || ""} disabled={busy} onChange={(event) => select(event.target.value)}>
    {data.stores.map((store) => <option value={store.id} key={store.id}>{store.name} · {storeStatusLabel[store.status]}</option>)}
  </select></label>;
}

function PanelHeader({ central, refresh, busy }: { central: boolean; refresh: () => void; busy: boolean }) {
  return <header className="mp-manage-heading">
    <div className="mp-manage-toolbar"><Link href="/">‹ Voltar ao MotoPombal</Link><button type="button" className="mp-manage-button secondary" disabled={busy} onClick={refresh}>Atualizar</button></div>
    <h1>{central ? "Central de Compras" : "Painel da loja"}</h1>
    <p>{central ? "Cadastre e aprove lojas, gerencie responsáveis e acompanhe pedidos e ocorrências." : "Gerencie produtos, horários, pedidos e repasses da sua loja."}</p>
  </header>;
}

export function MerchantManagementPanel() {
  const [storeId, setStoreId] = useState("");
  const [view, setView] = useState<"orders" | "catalog" | "store">("orders");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const backend = useMarketplaceManagement<ManagementData>(`${merchantEndpoint}${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`);
  const { data, error, loading, busy } = backend;
  const store = data?.store && (!storeId || data.store.id === storeId) ? data.store : null;
  const send: MerchantCommand = async (action) => {
    setNotice(""); setActionError("");
    const checked = merchantManagementAction.safeParse(action);
    if (!checked.success) { setActionError(checked.error.issues[0]?.message || "Revise o formulário."); return false; }
    try {
      await backend.submit(checked.data);
      setNotice(action.action === "orderAction" && action.command === "ready" ? "Pedido pronto. A entrega agora segue a busca de entregador." : "Alteração registrada.");
      return true;
    } catch (problem) { setActionError(problem instanceof Error ? problem.message : "Não foi possível concluir a operação."); return false; }
  };
  return <main className="marketplace-management">
    <PanelHeader central={false} busy={loading || busy} refresh={() => void backend.refresh()} />
    <div>
      {data && <section className="mp-manage-card"><StoreSelection data={data} storeId={storeId} select={(id) => { setStoreId(id); setNotice(""); setActionError(""); }} busy={busy} />
        {!data.stores.length && <p>Nenhuma loja vinculada a esta conta. Solicite à central o vínculo com uma loja existente.</p>}
        {store && <nav className="mp-manage-tabs" aria-label="Áreas do painel da loja">
          {([ ["orders", "Pedidos"], ["catalog", "Catálogo"], ["store", "Loja e horários"] ] as const).map(([key, title]) => <button className="mp-manage-button secondary" type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}>{title}</button>)}
        </nav>}
      </section>}
      {loading && <p className="mp-manage-message" role="status">Atualizando painel…</p>}
      {data && !data.operationsEnabled && <p className="mp-manage-message" role="status">Novas operações em Compras estão indisponíveis no momento. As consultas e as ações de encerramento permitidas continuam disponíveis.</p>}
      {data?.cashSchemaReady === false && <p className="mp-manage-message" role="status">O caixa está em atualização. Registros antigos continuam disponíveis para consulta.</p>}
      {error && <p className="mp-manage-message error" role="alert">{error} {storeId && <button type="button" className="mp-manage-button secondary" onClick={() => setStoreId("")}>Voltar às lojas vinculadas</button>}</p>}
      {notice && <p className="mp-manage-message" role="status">{notice}</p>}
      {actionError && <p className="mp-manage-message error" role="alert">{actionError}</p>}
      {data && store && <div key={`${store.id}:${view}`}>
        {view === "orders" && <ManagementOrders orders={data.orders} busy={busy} operationsEnabled={data.operationsEnabled} cashWritesEnabled={data.cashWritesEnabled} canPrepare={store.active && store.status === "approved"} send={(action) => send(action as MerchantManagementAction)} />}
        {view === "catalog" && <MerchantCatalog data={data} store={store} busy={busy || !data.operationsEnabled} send={send} upload={backend.uploadImage} />}
        {view === "store" && <>
          <StoreSettings store={store} openNow={data.openNow} busy={busy || !data.operationsEnabled} send={send} upload={backend.uploadImage} />
          {data.role !== "manager" && <PreferredDriver store={store} drivers={data.drivers} busy={busy || !data.operationsEnabled} onChange={(driverId) => void send({ action: "setPreferredDriver", storeId: store.id, driverId })} />}
        </>}
      </div>}
    </div>
  </main>;
}

function PickupFields({ store, areas }: { store?: ManageStore; areas: ManagementData["areas"] }) {
  return <>
    <label>Endereço físico para retirada<input name="address" required minLength={5} maxLength={240} defaultValue={store?.address} placeholder="Rua, número e bairro" /></label>
    <div className="mp-manage-fields">
      <label>Latitude da entrada<input name="latitude" type="number" step="any" min="-90" max="90" required defaultValue={store?.latitude} /></label>
      <label>Longitude da entrada<input name="longitude" type="number" step="any" min="-180" max="180" required defaultValue={store?.longitude} /></label>
      <label>Restringir destinos à área<select name="service_area_id" defaultValue={store?.service_area_id ?? ""}>
        <option value="">Áreas atendidas pela plataforma</option>
        {store?.service_area_id && !areas.some((area) => area.id === store.service_area_id) && <option disabled value={store.service_area_id}>Vínculo atual indisponível</option>}
        {areas.map((area) => <option key={area.id} value={area.id} disabled={!area.active}>{area.name}{area.active ? "" : " (inativa)"}</option>)}
      </select></label>
    </div>
    <p className="mp-manage-caption">Use o ponto real de retirada, em Ribeira do Pombal/BA, dentro da área de origem configurada. A restrição de destino é opcional; o frete continua sendo calculado pelas regras da plataforma.</p>
  </>;
}

const pickupValues = (data: FormData) => ({ address: field(data,"address"), latitude: numberField(data,"latitude"), longitude: numberField(data,"longitude"), service_area_id: optionalField(data,"service_area_id") });

function NewStore({ areas, busy, send, select }: { areas: ManagementData["areas"]; busy: boolean; send: CentralCommand; select: (id: string) => void }) {
  const [formVersion, setFormVersion] = useState(0);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const created = await send<{ storeId: string }>({ action: "createStore", slug: field(data,"slug"), fields: storeValues(data, {}), pickup: pickupValues(data) }, "Loja cadastrada em análise. Agora vincule um responsável.");
    if (created?.storeId) { form.reset(); setFormVersion((old) => old + 1); select(created.storeId); }
  };
  return <details className="mp-manage-card"><summary>Cadastrar estabelecimento</summary>
    <p className="mp-manage-caption">A loja começa em análise. A central libera o catálogo público depois de conferir o estabelecimento e o local de retirada.</p>
    <form className="mp-manage-form" onSubmit={submit}><fieldset disabled={busy}>
      <StoreFields key={formVersion} newStore />
      <PickupFields areas={areas} />
      <ApplyButton>Cadastrar loja</ApplyButton>
    </fieldset></form>
  </details>;
}

function StoreGovernance({ store, data, busy, send }: { store: ManageStore; data: ManagementData; busy: boolean; send: CentralCommand }) {
  const [profile, setProfile] = useState<{ id: string; name: string } | null>(null);
  return <>
    <section className="mp-manage-card"><h2>Aprovação e retirada</h2>
      <p>{store.name} · <span className="mp-manage-pill">{storeStatusLabel[store.status]}</span></p>
      <p>{data.openNow ? "Aberta para compras agora" : "Fechada para novas compras"} · {store.address}</p>
      <form className="mp-manage-form" onSubmit={async (event) => {
        event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
        if (await send({ action: "setStoreStatus", storeId: store.id, status: field(values,"status") as ManageStore["status"], reason: field(values,"reason") })) form.reset();
      }}><fieldset disabled={busy}>
        <label>Situação pública<select name="status" key={store.status} defaultValue={store.status}><option value="pending">Em análise</option><option value="approved">Aprovada</option><option value="suspended">Suspensa</option></select></label>
        <label>Motivo da decisão<textarea required minLength={3} maxLength={300} name="reason" rows={2} /></label>
        <ApplyButton>Registrar situação</ApplyButton>
      </fieldset></form>
      <hr />
      <form className="mp-manage-form" onSubmit={(event) => { event.preventDefault(); void send({ action: "setStorePickup", storeId: store.id, pickup: pickupValues(new FormData(event.currentTarget)) }); }}><fieldset disabled={busy}>
        <PickupFields store={store} areas={data.areas} />
        <ApplyButton>Salvar retirada</ApplyButton>
      </fieldset></form>
    </section>
    <section className="mp-manage-card"><h2>Responsáveis da loja</h2>
      <p className="mp-manage-caption">Use uma conta que já existe no MotoPombal. O vínculo libera apenas o painel desta loja; o papel da conta no aplicativo não muda.</p>
      <div className="mp-manage-list">
        {!data.members.length && <p>Nenhum responsável vinculado.</p>}
        {data.members.map((member) => <details key={member.user_id}><summary>{member.name} · {member.role === "owner" ? "Titular" : "Gerente"}{member.blocked ? " · conta bloqueada" : ""}</summary>
          <form className="mp-manage-form" onSubmit={async (event) => {
            event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const role = optionalField(values,"role") as "owner" | "manager" | null;
            if (await send({ action: "setMember", storeId: store.id, userId: member.user_id, role, reason: field(values,"reason") })) form.reset();
          }}><fieldset disabled={busy}>
            <label>Vínculo<select key={member.role} name="role" defaultValue={member.role}><option value="owner">Titular</option><option value="manager">Gerente</option><option value="">Remover acesso a esta loja</option></select></label>
            <label>Motivo<textarea name="reason" rows={2} minLength={3} maxLength={300} required /></label>
            <ApplyButton>Registrar vínculo</ApplyButton>
          </fieldset></form>
        </details>)}
      </div>
      <form className="mp-manage-form" onSubmit={async (event) => {
        event.preventDefault(); const phone = field(new FormData(event.currentTarget),"phone");
        setProfile(null); const match = await send<{ profile: { id: string; name: string } }>({ action: "findMember", phone });
        if (match?.profile) setProfile(match.profile);
      }}><fieldset disabled={busy}>
        <label>Buscar conta pelo telefone<input type="tel" name="phone" minLength={8} maxLength={24} required pattern="[+0-9(). \x2d]+" placeholder="(75) 99999-9999" /></label>
        <ApplyButton>Buscar conta existente</ApplyButton>
      </fieldset></form>
      {profile && <form className="mp-manage-form" key={profile.id} onSubmit={async (event) => {
        event.preventDefault(); const values = new FormData(event.currentTarget);
        if (await send({ action: "setMember", storeId: store.id, userId: profile.id, role: field(values,"role") as "owner" | "manager", reason: field(values,"reason") })) setProfile(null);
      }}><fieldset disabled={busy}>
        <p>Conta encontrada: <strong>{profile.name}</strong></p>
        <label>Tipo de vínculo<select name="role" defaultValue="manager"><option value="manager">Gerente</option><option value="owner">Titular</option></select></label>
        <label>Motivo<textarea name="reason" rows={2} minLength={3} maxLength={300} required /></label>
        <ApplyButton>Vincular conta à loja</ApplyButton>
      </fieldset></form>}
    </section>
    <PreferredDriver store={store} drivers={data.drivers} busy={busy} onChange={(driverId) => void send({ action: "setPreferredDriver", storeId: store.id, driverId })} />
  </>;
}

export function AdminMarketplacePanel() {
  const [storeId, setStoreId] = useState("");
  const [view, setView] = useState<"stores" | "orders">("stores");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const backend = useMarketplaceManagement<ManagementData>(`${adminEndpoint}${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`);
  const { data, error, loading, busy } = backend;
  const store = data?.store && (!storeId || data.store.id === storeId) ? data.store : null;
  const send: CentralCommand = async <R,>(action: AdminManagementAction, success = "Operação registrada no histórico.") => {
    setNotice(""); setActionError("");
    const checked = adminManagementAction.safeParse(action);
    if (!checked.success) { setActionError(checked.error.issues[0]?.message || "Revise o formulário."); return null; }
    try {
      const result = await backend.submit<R>(checked.data);
      if (action.action !== "findMember") setNotice(success);
      return result;
    } catch (problem) { setActionError(problem instanceof Error ? problem.message : "Não foi possível concluir a operação."); return null; }
  };
  return <main className="marketplace-management">
    <PanelHeader central busy={loading || busy} refresh={() => void backend.refresh()} />
    <div>
      {loading && <p className="mp-manage-message" role="status">Atualizando central…</p>}
      {data && !data.operationsEnabled && <p className="mp-manage-message" role="status">Novas operações em Compras estão indisponíveis no momento. As consultas e as ações de encerramento permitidas continuam disponíveis.</p>}
      {data?.cashSchemaReady === false && <p className="mp-manage-message" role="status">O caixa está em atualização. Registros antigos continuam disponíveis para consulta.</p>}
      {error && <p className="mp-manage-message error" role="alert">{error} {storeId && <button type="button" className="mp-manage-button secondary" onClick={() => setStoreId("")}>Voltar à lista</button>}</p>}
      {notice && <p className="mp-manage-message" role="status">{notice}</p>}
      {actionError && <p className="mp-manage-message error" role="alert">{actionError}</p>}
      {data && <>
        <NewStore areas={data.areas} busy={busy || !data.operationsEnabled} send={send} select={setStoreId} />
        <section className="mp-manage-card"><StoreSelection data={data} storeId={storeId} select={(id) => { setStoreId(id); setNotice(""); setActionError(""); }} busy={busy} />
          {!data.stores.length && <p>Nenhuma loja cadastrada no marketplace.</p>}
          {store && <nav className="mp-manage-tabs" aria-label="Áreas da central de compras">
            <button className="mp-manage-button secondary" type="button" aria-pressed={view === "stores"} onClick={() => setView("stores")}>Loja e vínculos</button>
            <button className="mp-manage-button secondary" type="button" aria-pressed={view === "orders"} onClick={() => setView("orders")}>Pedidos e ocorrências</button>
            <Link href="/comerciante">Editar catálogo pelo painel da loja</Link>
          </nav>}
        </section>
        {store && <div key={`${store.id}:${view}`}>
          {view === "stores" ? <StoreGovernance store={store} data={data} busy={busy || !data.operationsEnabled} send={send} /> : <ManagementOrders orders={data.orders} busy={busy} operationsEnabled={data.operationsEnabled} cashWritesEnabled={data.cashWritesEnabled} central send={async (action) => Boolean(await send(action as AdminManagementAction))} />}
        </div>}
      </>}
    </div>
  </main>;
}
