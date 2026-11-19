"use client";

import Link from "next/link";
import { Check, ImageIcon, MapPin, Package, ShieldCheck, Store } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ManagementData, ManageStore } from "@/lib/marketplace/management-view";
import type { StoreOnboardingInput, StoreOnboardingResult } from "@/lib/marketplace/store-onboarding";
import { storefrontProducts } from "@/lib/marketplace/storefront-catalog";

export type MerchantRegistration = StoreOnboardingInput;
export type MerchantRegistrationResult = StoreOnboardingResult;

const slugFromName = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

export function MerchantStoreRegistration({
  busy, disabled, create, refresh,
}: {
  busy: boolean;
  disabled: boolean;
  create: (input: MerchantRegistration) => Promise<MerchantRegistrationResult>;
  refresh: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const customSlug = useRef(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const locationRequest = useRef(0);
  useEffect(() => () => { locationRequest.current++; }, []);
  const inFlight = useRef(false);
  const attempt = useRef<MerchantRegistration | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || disabled || locating || inFlight.current) return;
    const fields = new FormData(event.currentTarget);
    const idempotencyKey = attempt.current?.idempotencyKey ?? crypto.randomUUID();
    const input = uncertain && attempt.current ? attempt.current : {
      idempotencyKey, name: text(fields, "name"), slug: text(fields, "slug"),
      category: text(fields, "category"), description: text(fields, "description"),
      pickup: { address: text(fields, "address"), latitude: Number(text(fields, "latitude")), longitude: Number(text(fields, "longitude")) },
    };
    inFlight.current = true;
    attempt.current = input;
    setMessage("");
    try {
      await create(input);
      setUncertain(false);
      attempt.current = null;
    } catch (problem) {
      const status = problem && typeof problem === "object" && "status" in problem ? problem.status : null;
      setUncertain(typeof status !== "number" || status >= 500);
      setMessage(problem instanceof Error ? problem.message : "Não foi possível confirmar o cadastro.");
    } finally { inFlight.current = false; }
  };
  const locate = () => {
    if (busy || disabled || locating || uncertain) return;
    const generation = ++locationRequest.current;
    if (!navigator.geolocation) { setLocationMessage("Este navegador não disponibiliza localização. Informe as coordenadas manualmente."); return; }
    setLocating(true); setLocationMessage("Buscando o ponto do aparelho…");
    navigator.geolocation.getCurrentPosition((position) => {
      if (generation !== locationRequest.current) return;
      setLocating(false);
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
          !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) {
        setLocationMessage("A posição retornou com pouca precisão. Tente novamente na entrada da loja ou informe o ponto correto manualmente.");
        return;
      }
      setLatitude(latitude.toFixed(6)); setLongitude(longitude.toFixed(6));
      setLocationMessage(`Ponto do aparelho preenchido, com precisão estimada de ${Math.ceil(accuracy)} m. Confirme se corresponde à entrada da loja.`);
    }, (problem) => {
      if (generation !== locationRequest.current) return;
      setLocating(false);
      setLocationMessage(problem.code === 1 ? "Permita o acesso à localização para usar este recurso, ou informe as coordenadas manualmente." : "Não foi possível obter uma posição precisa. Tente novamente ou informe as coordenadas manualmente.");
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 });
  };
  const editCoordinate = (update: (value: string) => void, value: string) => {
    locationRequest.current++; setLocating(false); setLocationMessage(""); update(value);
  };
  return <section className="mp-manage-card mp-onboarding-start" aria-labelledby="merchant-register-title">
    <div className="mp-onboarding-intro"><span className="mp-onboarding-icon"><Store aria-hidden="true" /></span>
      <div><h2 id="merchant-register-title">Sua loja no MotoPombal</h2><p>Cadastre o estabelecimento para montar seu catálogo e acompanhar a análise da central.</p></div>
    </div>
    <ol className="mp-onboarding-stages" aria-label="Etapas do cadastro"><li>1. Cadastre a loja</li><li>2. Monte seu catálogo</li><li>3. Aguarde a análise</li></ol>
    <form className="mp-manage-form" onSubmit={submit}>
      <fieldset disabled={disabled || busy || uncertain}>
        <legend>Dados do estabelecimento</legend>
        <div className="mp-manage-fields">
          <label>Nome da loja<input name="name" required minLength={2} maxLength={100} value={name} autoComplete="organization" onChange={(event) => { setName(event.target.value); if (!customSlug.current) setSlug(slugFromName(event.target.value)); }} /></label>
          <label>Categoria<input name="category" required minLength={2} maxLength={60} placeholder="Ex.: Restaurante, mercado ou farmácia" /></label>
        </div>
        <label>Identificador do link da loja<input name="slug" required minLength={3} maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => { customSlug.current = true; setSlug(event.target.value.toLowerCase()); }} aria-describedby="merchant-slug-help" /></label>
        <small id="merchant-slug-help" className="mp-manage-caption">Use letras sem acento, números e hífen. Esse nome fará parte do endereço da sua loja.</small>
        <label>Sobre a loja <span className="mp-onboarding-optional">(opcional)</span><textarea name="description" rows={3} maxLength={1000} placeholder="Conte o que sua loja oferece" /></label>
        <div className="mp-onboarding-location"><MapPin aria-hidden="true" /><div><h3>Onde o entregador retira os pedidos?</h3><p>Informe a entrada real do estabelecimento. A central confere esse ponto antes de liberar a loja.</p></div></div>
        <label>Endereço de retirada<input name="address" required minLength={5} maxLength={240} placeholder="Rua, número, bairro e referência" autoComplete="street-address" /></label>
        <button className="mp-manage-button secondary" type="button" onClick={locate} disabled={locating}>{locating ? "Buscando localização…" : "Usar minha localização para o ponto de retirada"}</button>
        <small className="mp-manage-caption">Use a localização do aparelho somente se estiver na entrada da loja.</small>
        {locationMessage && <p className="mp-manage-caption" role="status">{locationMessage}</p>}
        <div className="mp-manage-fields">
          <label>Latitude da entrada<input name="latitude" type="number" step="any" min="-90" max="90" required value={latitude} onChange={(event) => editCoordinate(setLatitude, event.target.value)} /></label>
          <label>Longitude da entrada<input name="longitude" type="number" step="any" min="-180" max="180" required value={longitude} onChange={(event) => editCoordinate(setLongitude, event.target.value)} /></label>
        </div>
        <p className="mp-manage-caption">As coordenadas devem corresponder ao endereço informado. Não use um ponto aproximado de outro local. Depois do cadastro, a central pode corrigir a retirada.</p>
      </fieldset>
      <p className="mp-manage-caption">A loja é criada fechada e em análise. Capa, logotipo, horários, produtos e complementos ficam disponíveis no painel após cadastrar.</p>
      {uncertain && <div className="mp-manage-message" role="status"><p>A resposta não confirmou o resultado. Atualize o painel para procurar a loja ou repita a mesma tentativa abaixo, sem criar outra solicitação.</p><button type="button" className="mp-manage-button secondary" disabled={busy} onClick={refresh}>Verificar cadastro no painel</button></div>}
      {message && <p className="mp-manage-message error" role="alert">{message}</p>}
      <button type="submit" className="mp-manage-button" disabled={disabled || busy || locating}>{busy ? "Confirmando cadastro…" : uncertain ? "Confirmar a mesma tentativa" : "Criar loja em análise"}</button>
    </form>
    <p className="mp-manage-caption">Já tem uma loja cadastrada por outra conta? Peça à central para vincular sua conta a ela.</p>
  </section>;
}

type MerchantView = "orders" | "catalog" | "store" | "preview";
export function MerchantStoreProgress({ data, store, selectView }: { data: ManagementData; store: ManageStore; selectView: (view: MerchantView) => void }) {
  const approval = store.status === "approved" && store.active;
  const products = storefrontProducts(data.categories.filter((category) => category.active),
    data.products.filter((product) => product.active), data.groups.filter((group) => group.active),
    data.options.filter((option) => option.active)).filter((product) => product.available);
  const status = store.status === "suspended" ? "Loja suspensa" : store.status === "pending" ? "Cadastro em análise" : !store.active ? "Loja inativa" : !data.operationsEnabled ? "Loja aprovada · Compras pausado" : data.openNow ? "Loja aberta" : "Loja aprovada · fechada";
  const steps = [
    { label: "Cadastro da loja", detail: "Sua conta já tem acesso a este estabelecimento.", done: true, Icon: Store },
    { label: "Apresentação (opcional)", detail: "Descrição, logotipo e capa ajudam a apresentar a loja; não substituem os requisitos da análise.", done: Boolean(store.description && store.image_url && store.cover_url), Icon: ImageIcon, view: "store" as const },
    { label: "Catálogo", detail: "Tenha ao menos um produto disponível, com estoque e complementos válidos. Categorias são opcionais.", done: products.length > 0, Icon: Package, view: "catalog" as const },
    { label: "Revisão da central", detail: approval ? "Estabelecimento aprovado para a operação." : "A central confere o cadastro, o responsável e a retirada.", done: approval, Icon: ShieldCheck },
  ];
  return <section className="mp-manage-card mp-onboarding-progress" aria-labelledby="merchant-progress-title">
    <div className="mp-onboarding-status"><div><p className="mp-manage-caption">Próximos passos da sua loja</p><h2 id="merchant-progress-title">{status}</h2></div><span className="mp-manage-pill">{store.name}</span></div>
    {store.status === "pending" && <p>{data.operationsEnabled
      ? "Seu cadastro está salvo. Você pode preparar perfil, horários e catálogo enquanto aguarda a análise; a loja ainda não aparece para compras."
      : "Seu cadastro está salvo e a loja ainda não aparece para compras. A edição poderá continuar quando Compras for liberado pela plataforma."}</p>}
    {store.status === "suspended" && <p>A loja está fora da listagem pública. Fale com a central para conferir o motivo e os ajustes necessários.</p>}
    {!store.active && store.status === "approved" && <p>A aprovação está registrada, mas a central precisa conferir a ativação do estabelecimento.</p>}
    <ol className="mp-onboarding-checklist">{steps.map(({ label, detail, done, Icon, view }) => <li key={label} className={done ? "is-complete" : ""}>
      <span className="mp-onboarding-check-icon">{done ? <Check aria-hidden="true" /> : <Icon aria-hidden="true" />}</span>
      <div><b>{label}</b><small>{detail}</small></div>
      {view && <button type="button" className="mp-manage-button secondary" onClick={() => selectView(view)}>{done ? "Editar" : "Completar"}</button>}
    </li>)}</ol>
    <p className="mp-manage-caption">Este roteiro ajuda a organizar o cadastro; não substitui a análise da central nem abre a loja automaticamente.</p>
    {approval && <p>{!data.operationsEnabled ? "Compras está pausado na plataforma; preparar a loja não libera pedidos." : data.openNow ? "Sua loja está apta a receber pedidos agora. Acompanhe a aba Pedidos." : "Confira a abertura manual e os horários na aba Loja e horários quando estiver pronto para receber pedidos."}</p>}
    {approval && <Link href={`/compras/lojas/${encodeURIComponent(store.slug)}`} className="mp-onboarding-store-link">Ver página da loja</Link>}
  </section>;
}
