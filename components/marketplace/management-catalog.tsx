"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { MARKET_IMAGE_LIMIT, MARKET_IMAGE_TYPES, marketImageType } from "@/lib/marketplace/image-upload";
import type { StoreHours, MerchantManagementAction } from "@/lib/marketplace/management";
import type { ManagementData, ManageCategory, ManageGroup, ManageOption, ManageProduct, ManageStore } from "@/lib/marketplace/management-view";
import { managementMoney } from "./management-client";

export type MerchantCommand = (action: MerchantManagementAction) => Promise<boolean>;
export type UploadImage = (storeId: string, file: File) => Promise<string>;
export const dayNames = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"] as const;
const days = ["1", "2", "3", "4", "5", "6", "7"] as const;
export const storeStatusLabel = { pending: "Em análise", approved: "Aprovada", suspended: "Suspensa" } as const;
export const field = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
export const optionalField = (data: FormData, name: string) => field(data, name) || null;
export const numberField = (data: FormData, name: string) => Number(field(data, name));
const slugPattern = "[a-z0-9]+(-[a-z0-9]+)*";

export function ApplyButton({ children = "Salvar", disabled = false, danger = false }: { children?: ReactNode; disabled?: boolean; danger?: boolean }) {
  return <button type="submit" className={`mp-manage-button${danger ? " danger" : ""}`} disabled={disabled}>{children}</button>;
}

function ManageImageField({ name, label, value, storeId, upload }: { name: string; label: string; value: string | null | undefined; storeId?: string; upload?: UploadImage }) {
  const [url, setUrl] = useState(value ?? "");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  return <div className="mp-manage-image-field">
    <label>{label}<input name={name} type="url" maxLength={2000} value={url} onChange={(event) => { setUrl(event.target.value); setMessage(""); }} /></label>
    {upload && storeId && <>
      <input hidden ref={picker} type="file" aria-label={`Selecionar arquivo para ${label}`} accept={MARKET_IMAGE_TYPES.join(",")} onChange={async (event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        if (!marketImageType(file.type) || file.size > MARKET_IMAGE_LIMIT || file.size === 0) {
          setFailed(true); setMessage("Escolha uma imagem JPEG, PNG ou WebP de até 3 MB."); return;
        }
        setMessage(""); setFailed(false); setSending(true);
        try {
          setUrl(await upload(storeId, file));
          setMessage("Imagem enviada. Salve o cadastro para publicar a alteração.");
        } catch (problem) {
          setFailed(true);
          setMessage(problem instanceof Error ? problem.message : "Não foi possível enviar a imagem.");
        } finally { setSending(false); }
      }} />
      <button className="mp-manage-button secondary" type="button" disabled={sending} onClick={() => picker.current?.click()}>{sending ? "Enviando imagem…" : "Escolher e enviar imagem"}</button>
    </>}
    {message && <p className={failed ? "mp-manage-message error" : "mp-manage-caption"} role={failed ? "alert" : "status"}>{message}</p>}
  </div>;
}

export function StoreFields({ store, newStore = false, upload }: { store?: ManageStore; newStore?: boolean; upload?: UploadImage }) {
  return <>
    <div className="mp-manage-fields">
      <label>Nome da loja<input name="name" required minLength={2} maxLength={100} defaultValue={store?.name} /></label>
      <label>Categoria da loja<input name="category" required minLength={2} maxLength={60} placeholder="Ex.: Restaurante" defaultValue={store?.category} /></label>
      {newStore && <label>Identificador no link público<input name="slug" required minLength={3} maxLength={80} pattern={slugPattern} placeholder="exemplo-loja" /></label>}
      <label>Preparo estimado pela loja (minutos)<input name="prep_minutes" type="number" min="1" max="240" step="1" defaultValue={store?.prep_minutes ?? ""} /></label>
      <ManageImageField name="image_url" label="URL HTTPS do logotipo" value={store?.image_url} storeId={store?.id} upload={upload} />
      <ManageImageField name="cover_url" label="URL HTTPS da capa" value={store?.cover_url} storeId={store?.id} upload={upload} />
    </div>
    <label>Descrição<textarea name="description" rows={3} maxLength={1000} defaultValue={store?.description} /></label>
    <p className="mp-manage-caption">Use uma URL pública HTTPS ou {newStore ? "envie arquivos pelo painel após cadastrar a loja" : "envie JPEG, PNG ou WebP de até 3 MB"}. Imagens serão públicas. O preparo é informado pela loja, sem contar o deslocamento.</p>
    <label><input type="checkbox" name="is_open" defaultChecked={store?.is_open ?? false} /> Receber pedidos no horário configurado</label>
  </>;
}

export function storeValues(data: FormData, hours: StoreHours) {
  return { name: field(data,"name"), category: field(data, "category"), description: field(data,"description"), image_url: optionalField(data,"image_url"), cover_url: optionalField(data,"cover_url"),
    is_open: data.has("is_open"), prep_minutes: optionalField(data,"prep_minutes") === null ? null : numberField(data,"prep_minutes"), hours };
}

function StoreSchedule({ value, onChange }: { value: StoreHours; onChange: (hours: StoreHours) => void }) {
  const configured = Object.keys(value).length > 0;
  return <div className="mp-manage-list">
    <label><input type="checkbox" checked={configured} onChange={(event) => onChange(event.target.checked ? { "1": [] } : {})} /> Usar horários semanais</label>
    <p className="mp-manage-caption">Sem horários semanais, a loja segue apenas a abertura manual acima. Use uma faixa por turno; caso o horário de fechar seja anterior ao de abrir, ele vale no dia seguinte. Dias sem faixa ficam fechados.</p>
    {configured && days.map((day, i) => <article key={day}>
      <h3>{dayNames[i]}</h3>
      {(value[day] ?? []).map((range, index) => <div className="mp-manage-row" key={index}>
        <label>Abre<input type="time" value={range.open} required onChange={(event) => onChange({ ...value, [day]: value[day]!.map((slot, j) => j === index ? { ...slot, open: event.target.value } : slot) })} /></label>
        <label>Fecha<input type="time" value={range.close} required onChange={(event) => onChange({ ...value, [day]: value[day]!.map((slot, j) => j === index ? { ...slot, close: event.target.value } : slot) })} /></label>
        <button type="button" className="mp-manage-button secondary" aria-label={`Remover faixa ${index + 1} de ${dayNames[i]}`} onClick={() => onChange({ ...value, [day]: value[day]!.filter((_, j) => j !== index) })}>Remover</button>
      </div>)}
      <button className="mp-manage-button secondary" type="button" disabled={(value[day]?.length ?? 0) >= 12} onClick={() => onChange({ ...value, [day]: [...(value[day] ?? []), { open: "08:00", close: "18:00" }] })}>Adicionar horário</button>
    </article>)}
  </div>;
}

export function StoreSettings({ store, busy, send, openNow, upload }: { store: ManageStore; busy: boolean; send: MerchantCommand; openNow: boolean; upload: UploadImage }) {
  const [hours, setHours] = useState(store.hours);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send({ action: "saveStore", storeId: store.id, fields: storeValues(new FormData(event.currentTarget), hours) });
  };
  return <section className="mp-manage-card">
    <h2>Dados e horários</h2>
    <p>{store.address} · {store.city}/{store.state}</p>
    <p><span className="mp-manage-pill">{storeStatusLabel[store.status]}</span> · {openNow ? "Aberta para compras agora" : "Fechada para novas compras"}</p>
    <p className="mp-manage-caption">A central gerencia o endereço físico e a aprovação. É possível fechar a loja temporariamente sem interromper pedidos aceitos.</p>
    <form className="mp-manage-form" onSubmit={submit}><fieldset disabled={busy}>
      <StoreFields store={store} upload={upload} />
      <StoreSchedule value={hours} onChange={setHours} />
      <ApplyButton>Salvar loja</ApplyButton>
    </fieldset></form>
  </section>;
}

export function PreferredDriver({ store, drivers, busy, onChange }: { store: ManageStore; drivers: ManagementData["drivers"]; busy: boolean; onChange: (driverId: string | null) => void }) {
  const knownDriver = drivers.some((driver) => driver.id === store.preferred_driver_id);
  return <section className="mp-manage-card">
    <h2>Entregador preferencial</h2>
    <p className="mp-manage-caption">A preferência só se aplica a novas ofertas. A disponibilidade é verificada no despacho e trocar o vínculo não transfere entregas aceitas.</p>
    <form className="mp-manage-form" onSubmit={(event) => { event.preventDefault(); onChange(optionalField(new FormData(event.currentTarget), "driverId")); }}>
      <label>Selecione um entregador aprovado<select name="driverId" key={store.preferred_driver_id} defaultValue={store.preferred_driver_id ?? ""} disabled={busy}>
        <option value="">Nenhum preferencial</option>
        {store.preferred_driver_id && !knownDriver && <option value={store.preferred_driver_id} disabled>Vínculo atual indisponível</option>}
        {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name} · {driver.id.slice(0, 8)}</option>)}
      </select></label>
      <ApplyButton disabled={busy}>Salvar vínculo</ApplyButton>
    </form>
  </section>;
}

function CatalogFields({ item, label }: { item?: ManageCategory; label: string }) {
  return <div className="mp-manage-fields">
    <label>{label}<input name="name" minLength={2} maxLength={100} required defaultValue={item?.name} /></label>
    <label>Ordem de exibição<input name="sort_order" type="number" required min="0" max="100000" step="1" defaultValue={item?.sort_order ?? 0} /></label>
    <label><input name="active" type="checkbox" defaultChecked={item?.active ?? true} /> Disponível no catálogo</label>
  </div>;
}

const catalogValues = (data: FormData) => ({ name: field(data,"name"), sort_order: numberField(data,"sort_order"), active: data.has("active") });
const amount = (value: number | undefined) => value === undefined ? "" : (value / 100).toFixed(2);
const formCents = (data: FormData, key: string) => Math.round(numberField(data, key) * 100);

function CategoryEditor({ storeId, item, busy, send }: { storeId: string; item?: ManageCategory; busy: boolean; send: MerchantCommand }) {
  return <form className="mp-manage-form" onSubmit={async (event) => {
    event.preventDefault(); const form = event.currentTarget;
    if (await send({ action: "saveCategory", storeId, id: item?.id, fields: catalogValues(new FormData(form)) }) && !item) form.reset();
  }}><fieldset disabled={busy}><CatalogFields item={item} label="Nome da categoria" /><ApplyButton>{item ? "Salvar categoria" : "Criar categoria"}</ApplyButton></fieldset></form>;
}

function ProductEditor({ storeId, item, categories, busy, send, upload }: { storeId: string; item?: ManageProduct; categories: ManageCategory[]; busy: boolean; send: MerchantCommand; upload: UploadImage }) {
  const [expectedStock, setExpectedStock] = useState(item?.stock_quantity ?? null);
  const [stockInput, setStockInput] = useState(item?.stock_quantity?.toString() ?? "");
  const [imageVersion, setImageVersion] = useState(0);
  const changed = item && item.stock_quantity !== expectedStock;
  return <form className="mp-manage-form" onSubmit={async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const stock = stockInput === "" ? null : Number(stockInput);
    const done = await send({ action: "saveProduct", storeId, id: item?.id, fields: { ...catalogValues(data),
      category_id: optionalField(data,"category_id"), description: field(data,"description"), image_url: optionalField(data,"image_url"),
      price_cents: formCents(data,"price"), stock_quantity: stock, expected_stock: expectedStock,
    } });
    if (done) {
      if (item) setExpectedStock(stock);
      else { form.reset(); setStockInput(""); setImageVersion((old) => old + 1); }
    }
  }}><fieldset disabled={busy}>
    <CatalogFields item={item} label="Nome do produto" />
    <div className="mp-manage-fields">
      <label>Categoria<select name="category_id" defaultValue={item?.category_id ?? ""}><option value="">Sem categoria</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.active ? "" : " (inativa)"}</option>)}</select></label>
      <label>Preço por unidade (R$)<input name="price" type="number" min="0" max="100000" step="0.01" required defaultValue={amount(item?.price_cents)} /></label>
      <label>Unidades disponíveis (opcional)<input name="stock_quantity" type="number" min="0" max="100000" step="1" value={stockInput} onChange={(event) => setStockInput(event.target.value)} /></label>
      <ManageImageField key={imageVersion} name="image_url" label="URL HTTPS da foto" value={item?.image_url} storeId={storeId} upload={upload} />
    </div>
    <label>Descrição<textarea name="description" rows={2} maxLength={1000} defaultValue={item?.description} /></label>
    <p className="mp-manage-caption">Em branco: sem controle numérico de estoque. Zero: esgotado. Para retirar um produto do catálogo, desmarque a disponibilidade.</p>
    {changed && <div className="mp-manage-message" role="status"><p>O estoque disponível mudou: {item.stock_quantity ?? "sem controle numérico"}. Confira antes de editar.</p><button className="mp-manage-button secondary" type="button" onClick={() => { setExpectedStock(item.stock_quantity); setStockInput(item.stock_quantity?.toString() ?? ""); }}>Carregar estoque atual</button></div>}
    <ApplyButton disabled={Boolean(changed)}>{item ? "Salvar produto" : "Criar produto"}</ApplyButton>
  </fieldset></form>;
}

function GroupEditor({ storeId, productId, item, busy, send }: { storeId: string; productId: string; item?: ManageGroup; busy: boolean; send: MerchantCommand }) {
  return <form className="mp-manage-form" onSubmit={async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    if (await send({ action: "saveGroup", storeId, productId, id: item?.id, fields: { ...catalogValues(data), min_select: numberField(data,"min_select"), max_select: numberField(data,"max_select") } }) && !item) form.reset();
  }}><fieldset disabled={busy}><CatalogFields item={item} label="Nome do grupo" />
    <div className="mp-manage-fields">
      <label>Mínimo de escolhas<input name="min_select" type="number" min="0" max="50" step="1" required defaultValue={item?.min_select ?? 0} /></label>
      <label>Máximo de escolhas<input name="max_select" type="number" min="1" max="50" step="1" required defaultValue={item?.max_select ?? 1} /></label>
    </div>
    <p className="mp-manage-caption">Mínimo zero indica complementos opcionais. Se o grupo for obrigatório, mantenha opções disponíveis em quantidade suficiente.</p>
    <ApplyButton>{item ? "Salvar grupo" : "Criar grupo"}</ApplyButton>
  </fieldset></form>;
}

function OptionEditor({ storeId, groupId, item, busy, send }: { storeId: string; groupId: string; item?: ManageOption; busy: boolean; send: MerchantCommand }) {
  return <form className="mp-manage-form" onSubmit={async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    if (await send({ action: "saveOption", storeId, groupId, id: item?.id, fields: { ...catalogValues(data), price_cents: formCents(data,"price") } }) && !item) form.reset();
  }}><fieldset disabled={busy}><CatalogFields item={item} label="Nome da opção" />
    <label>Acréscimo (R$)<input name="price" type="number" min="0" max="100000" step="0.01" required defaultValue={amount(item?.price_cents ?? 0)} /></label>
    <ApplyButton>{item ? "Salvar opção" : "Criar opção"}</ApplyButton>
  </fieldset></form>;
}

export function MerchantCatalog({ data, store, busy, send, upload }: { data: ManagementData; store: ManageStore; busy: boolean; send: MerchantCommand; upload: UploadImage }) {
  return <>
    <section className="mp-manage-card"><h2>Categorias</h2>
      <div className="mp-manage-list">
        {!data.categories.length && <p>Nenhuma categoria cadastrada.</p>}
        {data.categories.map((item) => <details key={item.id}><summary>{item.name}{item.active ? "" : " (inativa)"}</summary><CategoryEditor storeId={store.id} item={item} busy={busy} send={send} /></details>)}
        <details><summary>Adicionar categoria</summary><CategoryEditor storeId={store.id} busy={busy} send={send} /></details>
      </div>
    </section>
    <section className="mp-manage-card"><h2>Produtos e complementos</h2>
      <div className="mp-manage-list">
        {!data.products.length && <p>Nenhum produto cadastrado.</p>}
        {data.products.map((item) => <details key={item.id}><summary>{item.name} · {managementMoney(item.price_cents)}{item.active ? "" : " (inativo)"}</summary>
          <ProductEditor storeId={store.id} item={item} categories={data.categories} busy={busy} send={send} upload={upload} />
          <hr /><h3>Grupos de opções</h3>
          <div className="mp-manage-list">
            {data.groups.filter((group) => group.product_id === item.id).map((group) => <details key={group.id}><summary>{group.name}{group.active ? "" : " (inativo)"}</summary>
              <GroupEditor storeId={store.id} productId={item.id} item={group} busy={busy} send={send} />
              <div className="mp-manage-list">
                {data.options.filter((option) => option.group_id === group.id).map((option) => <details key={option.id}><summary>{option.name} · {managementMoney(option.price_cents)}{option.active ? "" : " (inativa)"}</summary><OptionEditor storeId={store.id} groupId={group.id} item={option} busy={busy} send={send} /></details>)}
                <details><summary>Adicionar opção</summary><OptionEditor storeId={store.id} groupId={group.id} busy={busy} send={send} /></details>
              </div>
            </details>)}
            <details><summary>Adicionar grupo</summary><GroupEditor storeId={store.id} productId={item.id} busy={busy} send={send} /></details>
          </div>
        </details>)}
        <details><summary>Adicionar produto</summary><ProductEditor storeId={store.id} categories={data.categories} busy={busy} send={send} upload={upload} /></details>
      </div>
    </section>
  </>;
}
