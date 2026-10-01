"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Bell, BriefcaseBusiness, Camera, Check, ChevronRight, CreditCard,
  Gift, Headphones, Heart, History, House, LogOut, MapPin,
  Pencil, Settings2, ShieldCheck, Ticket, Trash2, UserRound, Wallet,
} from "lucide-react";
import { useMotoVip, type AddressResult } from "@/hooks/use-moto-vip";
import type { SavedPlace } from "@/lib/passenger/saved-places";

type Backend = ReturnType<typeof useMotoVip>;
type Section = "main" | "edit" | "places" | "coupons" | "payments" | "settings" | "privacy";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const placeTitle = (kind: SavedPlace["kind"]) => kind === "home" ? "Casa" : kind === "work" ? "Trabalho" : "Favorito";

export function PassengerCentral({ backend, places, initialSection = "main", onSavePlace, onRemovePlace, onChoosePlace, onRides, onNotifications, onUseCoupon, paymentMethod, onPaymentMethod }: {
  backend: Backend;
  places: SavedPlace[];
  initialSection?: "main" | "places";
  onSavePlace: (place: SavedPlace) => void;
  onRemovePlace: (id: string) => void;
  onChoosePlace: (place: SavedPlace) => void;
  onRides: () => void;
  onNotifications: () => void;
  onUseCoupon: (code: string) => void;
  paymentMethod: "cash" | "pix";
  onPaymentMethod: (method: "cash" | "pix") => void;
}) {
  const [section, setSection] = useState<Section>(initialSection);
  const [name, setName] = useState(backend.profile?.full_name || "");
  const [phone, setPhone] = useState(backend.profile?.phone || "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [placeKind, setPlaceKind] = useState<SavedPlace["kind"]>("home");
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  const [placeLabel, setPlaceLabel] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [chosenAddress, setChosenAddress] = useState<AddressResult | null>(null);
  const [suggestions, setSuggestions] = useState<AddressResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [coupons, setCoupons] = useState<Awaited<ReturnType<Backend["listPassengerCoupons"]>> | null>(null);
  const [couponError, setCouponError] = useState("");
  const backendRef = useRef(backend);
  useEffect(() => { backendRef.current = backend; }, [backend]);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    const timer = window.setTimeout(() => setPreview(url), 0);
    return () => { window.clearTimeout(timer); URL.revokeObjectURL(url); };
  }, [photo]);
  useEffect(() => {
    if (section !== "coupons") return;
    let mounted = true;
    void backendRef.current.listPassengerCoupons().then((result) => {
      if (mounted) { setCoupons(result); setCouponError(""); }
    }).catch((error: unknown) => {
      if (mounted) setCouponError(error instanceof Error ? error.message : "Não foi possível carregar os cupons.");
    });
    return () => { mounted = false; };
  }, [section]);
  useEffect(() => {
    if (section !== "places" || placeQuery.trim().length < 3 || chosenAddress?.address === placeQuery) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void backendRef.current.searchAddresses(placeQuery.trim(), controller.signal)
        .then(({ results }) => setSuggestions(results))
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [section, placeQuery, chosenAddress]);

  const completed = backend.passengerHistory.filter((ride) => ["completed", "finalizada", "finished"].includes(ride.status));
  const spent = completed.reduce((sum, ride) => sum + (ride.final_fare_cents ?? ride.fare_cents), 0);
  const photoSrc = preview || backend.passengerAvatarUrl;
  function open(sectionName: Section) { setMessage(""); setSection(sectionName); }
  function editPlace(kind: SavedPlace["kind"], existing?: SavedPlace) {
    setPlaceKind(kind); setEditingPlaceId(existing?.id || null); setPlaceLabel(existing?.label || (kind === "favorite" ? "" : placeTitle(kind)));
    setPlaceQuery(existing?.address.address || ""); setChosenAddress(existing?.address || null); setSuggestions([]); open("places");
  }
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setMessage("");
    const form = new FormData(); form.set("fullName", name.trim()); form.set("phone", phone.trim()); if (photo) form.set("avatar", photo);
    try { await backend.savePassengerProfile(form); setPhoto(null); setPreview(null); setMessage("Perfil atualizado."); setSection("main"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar o perfil."); }
    finally { setSaving(false); }
  }
  function savePlace(event: React.FormEvent) {
    event.preventDefault();
    if (!chosenAddress) { setMessage("Escolha um endereço da lista de sugestões."); return; }
    const label = placeKind === "favorite" ? placeLabel.trim() : placeTitle(placeKind);
    if (!label) { setMessage("Dê um nome ao favorito."); return; }
    onSavePlace({ id: editingPlaceId || crypto.randomUUID(), kind: placeKind, label, address: chosenAddress });
    setEditingPlaceId(null); setPlaceQuery(""); setChosenAddress(null); setSuggestions([]); setMessage("Lugar salvo neste aparelho.");
  }
  function applyCoupon(code: string) {
    const normalized = code.trim().toUpperCase();
    if (normalized.length < 3) { setMessage("Digite um cupom válido."); return; }
    onUseCoupon(normalized);
  }

  if (section !== "main") return <div className="passenger-central subpage">
    <button type="button" className="central-back" onClick={() => open("main")}>‹ Voltar para minha conta</button>
    <h3>{({ edit: "Editar perfil", places: "Meus lugares", coupons: "Cupons e promoções", payments: "Formas de pagamento", settings: "Configurações", privacy: "Privacidade e segurança" } as Record<Exclude<Section,"main">, string>)[section]}</h3>
    {message && <p className="central-message" role="status">{message}</p>}
    {section === "edit" && <form className="central-form" onSubmit={(event) => void saveProfile(event)}>
      <label className="central-photo"><span>{photoSrc ? <Image src={photoSrc} alt="Sua foto" fill sizes="88px" unoptimized /> : <UserRound />}</span><span><Camera /> Trocar foto</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] || null)} /></label>
      <small>JPG, PNG ou WebP, até 2 MB.</small>
      <label>Nome completo<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required minLength={3} /></label>
      <label>Telefone<input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" autoComplete="tel" required /></label>
      <button type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar perfil"}</button>
    </form>}
    {section === "places" && <>
      <p className="central-intro">Seus endereços favoritos ficam disponíveis na Home e na busca de destino.</p>
      <div className="central-place-list">{places.map((place) => <div key={place.id}><MapPin /><button type="button" onClick={() => onChoosePlace(place)}><b>{place.label}</b><small>{place.address.address}</small></button><button type="button" onClick={() => editPlace(place.kind, place)} aria-label={`Editar ${place.label}`}><Pencil /></button><button type="button" onClick={() => onRemovePlace(place.id)} aria-label={`Remover ${place.label}`}><Trash2 /></button></div>)}</div>
      <div className="central-place-tabs"><button type="button" className={placeKind === "home" ? "active" : ""} onClick={() => editPlace("home", places.find((place) => place.kind === "home"))}><House /> Casa</button><button type="button" className={placeKind === "work" ? "active" : ""} onClick={() => editPlace("work", places.find((place) => place.kind === "work"))}><BriefcaseBusiness /> Trabalho</button><button type="button" className={placeKind === "favorite" ? "active" : ""} onClick={() => editPlace("favorite")}><Heart /> Favorito</button></div>
      <form className="central-form" onSubmit={savePlace}>
        {placeKind === "favorite" && <label>Nome do lugar<input value={placeLabel} onChange={(event) => setPlaceLabel(event.target.value)} placeholder="Ex.: Academia" maxLength={40} /></label>}
        <label>Endereço<input value={placeQuery} onChange={(event) => { setPlaceQuery(event.target.value); setChosenAddress(null); }} placeholder="Busque rua, número ou local" autoComplete="street-address" /></label>
        {searching && <small role="status">Buscando endereços…</small>}
        {suggestions.length > 0 && <div className="central-address-results">{suggestions.slice(0, 5).map((result) => <button type="button" key={result.id} onClick={() => { setChosenAddress(result); setPlaceQuery(result.address); setSuggestions([]); }}><MapPin /> {result.address}</button>)}</div>}
        {chosenAddress && <small className="central-selected"><Check /> Endereço selecionado no mapa</small>}
        <button type="submit">{editingPlaceId ? "Salvar alterações" : "Adicionar lugar"}</button>
      </form>
    </>}
    {section === "coupons" && <>
      <p className="central-intro">Digite um código ou selecione uma promoção. O desconto será confirmado no resumo da corrida.</p>
      <form className="central-coupon-form" onSubmit={(event) => { event.preventDefault(); applyCoupon(couponCode); }}><label><Ticket /><input value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} placeholder="Digite seu cupom" maxLength={24} /></label><button type="submit">Aplicar</button></form>
      {couponError && <p role="alert">{couponError}</p>}
      {!coupons && !couponError && <p role="status">Carregando cupons…</p>}
      <h4>Promoções disponíveis</h4>
      {coupons?.available.length ? coupons.available.map((coupon) => <div className="central-coupon" key={coupon.id}><Gift /><span><b>{coupon.code}</b><small>{coupon.description || (coupon.discount_type === "fixed" ? `${money(coupon.discount_value)} de desconto` : `${coupon.discount_value}% de desconto`)}</small>{coupon.ends_at && <small>Válido até {new Intl.DateTimeFormat("pt-BR").format(new Date(coupon.ends_at))}</small>}</span><button type="button" onClick={() => applyCoupon(coupon.code)}>Usar</button></div>) : coupons && <p>Nenhuma promoção disponível no momento.</p>}
      {!!coupons?.used.length && <><h4>Cupons usados</h4>{coupons.used.slice(0, 5).map((coupon, index) => <p className="central-used-coupon" key={`${coupon.code}-${index}`}>{coupon.code} · {money(coupon.discountCents)} de desconto</p>)}</>}
    </>}
    {section === "payments" && <><p className="central-intro">Escolha o método preferido para as próximas corridas neste aparelho.</p><div className="central-payment-list"><button type="button" className={paymentMethod === "pix" ? "active" : ""} onClick={() => onPaymentMethod("pix")}><CreditCard /><span><b>PIX</b><small>Pagamento digital no app</small></span>{paymentMethod === "pix" && <Check />}</button><button type="button" className={paymentMethod === "cash" ? "active" : ""} onClick={() => onPaymentMethod("cash")}><Wallet /><span><b>Dinheiro</b><small>Pague diretamente ao motorista</small></span>{paymentMethod === "cash" && <Check />}</button></div></>}
    {section === "settings" && <div className="central-list"><button type="button" onClick={onNotifications}><Bell /> <span><b>Notificações</b><small>Ver avisos e atualizações</small></span><ChevronRight /></button><button type="button" onClick={() => open("privacy")}><ShieldCheck /> <span><b>Privacidade e localização</b><small>Dados da conta e permissões</small></span><ChevronRight /></button><a href="mailto:suporte@motovip.app?subject=MotoPombal%20-%20Prefer%C3%AAncias%20do%20aplicativo"><Settings2 /><span><b>Preferências do aplicativo</b><small>Fale com nossa equipe</small></span><ChevronRight /></a><a href="/passageiro/suporte"><Headphones /><span><b>Ajuda e suporte</b><small>Atendimento MotoPombal</small></span><ChevronRight /></a></div>}
    {section === "privacy" && <div className="central-privacy"><ShieldCheck /><p>Usamos sua localização para calcular a origem, mostrar o mapa e acompanhar a corrida. Você pode alterar a permissão nas configurações do navegador ou do celular.</p><p>Para consultar dados da conta, termos e políticas, ou solicitar ajuda sobre privacidade, entre em contato com a central.</p><a href="mailto:suporte@motovip.app?subject=MotoPombal%20-%20Privacidade%20e%20termos">Solicitar termos, políticas ou dados</a></div>}
  </div>;

  return <div className="passenger-central">
    <div className="central-hero"><div className="central-identity"><span className="central-avatar">{photoSrc ? <Image src={photoSrc} alt={`Foto de ${backend.profile?.full_name || "passageiro"}`} fill sizes="72px" unoptimized /> : <UserRound />}</span><span><b>{backend.profile?.full_name || "Passageiro MotoPombal"}</b><small>Passageiro MotoPombal</small><small>{backend.profile?.phone || "Telefone não informado"}</small></span></div><button type="button" onClick={() => open("edit")}><Pencil /> Editar perfil</button></div>
    <div className="central-stats"><span><b>{completed.length}</b><small>Corridas</small></span><span><b>{money(spent)}</b><small>Gastos em corridas</small></span></div>
    <h3>Minha mobilidade</h3><div className="central-list"><button type="button" onClick={onRides}><History /><span><b>Minhas corridas</b><small>Histórico e detalhes das viagens</small></span><ChevronRight /></button><button type="button" onClick={() => open("places")}><MapPin /><span><b>Meus lugares</b><small>Casa, Trabalho e favoritos</small></span><ChevronRight /></button><button type="button" onClick={() => open("coupons")}><Ticket /><span><b>Cupons e promoções</b><small>Descontos para suas corridas</small></span><ChevronRight /></button><button type="button" onClick={() => open("payments")}><CreditCard /><span><b>Formas de pagamento</b><small>PIX e dinheiro</small></span><ChevronRight /></button></div>
    <h3>Conta e ajuda</h3><div className="central-list"><button type="button" onClick={onNotifications}><Bell /><span><b>Notificações</b><small>{backend.unreadNotifications ? `${backend.unreadNotifications} não lida(s)` : "Seus avisos"}</small></span><ChevronRight /></button><button type="button" onClick={() => open("settings")}><Settings2 /><span><b>Configurações</b><small>Privacidade e preferências</small></span><ChevronRight /></button><a href="/passageiro/suporte"><Headphones /><span><b>Ajuda e suporte</b><small>Fale com a central</small></span><ChevronRight /></a></div>
    <button type="button" className="central-signout" onClick={() => backend.signOut()}><LogOut /> Sair da conta</button>
  </div>;
}
