"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronRight, Headphones, History, Home, Ticket } from "lucide-react";
import { useMotoVip, type HistoryRide } from "@/hooks/use-moto-vip";

type Section = "corridas" | "cupons" | "notificacoes" | "suporte";
type Backend = ReturnType<typeof useMotoVip>;
type CouponList = Awaited<ReturnType<Backend["listPassengerCoupons"]>>;

const shortcuts = [
  { section: "corridas", label: "Minhas corridas", href: "/passageiro/corridas", icon: History },
  { section: "cupons", label: "Cupons", href: "/passageiro/cupons", icon: Ticket },
  { section: "notificacoes", label: "Notificações", href: "/passageiro/notificacoes", icon: Bell },
  { section: "suporte", label: "Suporte", href: "/passageiro/suporte", icon: Headphones },
] as const;

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function date(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function HistoryContent({ backend }: { backend: Backend }) {
  if (backend.passengerHistoryLoading) return <p role="status">Carregando suas corridas…</p>;
  if (backend.passengerHistoryError) return <div role="alert"><p>{backend.passengerHistoryError}</p><button type="button" onClick={() => void backend.reloadPassengerHistory()}>Tentar novamente</button></div>;
  if (!backend.passengerHistory.length) return <p>Você ainda não possui corridas.</p>;
  return <div className="shortcut-list">{backend.passengerHistory.map((ride: HistoryRide) => (
    <details className="shortcut-card" key={ride.id}>
      <summary>
        <span><small>{date(ride.completed_at || ride.created_at)}</small><b>{ride.destination_address}</b><small>{ride.status.replaceAll("_", " ")}</small></span>
        <strong>{money(ride.final_fare_cents ?? ride.fare_cents)}</strong>
        <ChevronRight aria-hidden="true" />
      </summary>
      <dl>
        <div><dt>Origem</dt><dd>{ride.origin_address}</dd></div>
        <div><dt>Destino</dt><dd>{ride.destination_address}</dd></div>
        <div><dt>Motorista</dt><dd>{ride.driver_name || "Não informado"}</dd></div>
      </dl>
    </details>
  ))}</div>;
}

function CouponsContent({ backend }: { backend: Backend }) {
  const router = useRouter();
  const backendRef = useRef(backend);
  const [code, setCode] = useState("");
  const [list, setList] = useState<CouponList | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { backendRef.current = backend; }, [backend]);
  useEffect(() => {
    if (!backend.session) return;
    let cancelled = false;
    void backendRef.current.listPassengerCoupons().then((result) => {
      if (!cancelled) setList(result);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Não foi possível carregar os cupons.");
    });
    return () => { cancelled = true; };
  }, [backend.session]);
  const apply = (value: string) => {
    const normalized = value.trim().toUpperCase();
    if (normalized.length < 3 || normalized.length > 24) {
      setError("Digite um código entre 3 e 24 caracteres.");
      return;
    }
    router.push(`/?cupom=${encodeURIComponent(normalized)}`);
  };
  return <div className="shortcut-list">
    <form className="shortcut-coupon-form" onSubmit={(event) => { event.preventDefault(); apply(code); }}>
      <label htmlFor="shortcut-coupon-code">Inserir código promocional</label>
      <div><input id="shortcut-coupon-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={24} autoComplete="off" placeholder="Seu código" /><button type="submit">Usar no pedido</button></div>
      <small>O desconto será validado no resumo da próxima corrida.</small>
    </form>
    {error && <p role="alert">{error} <button type="button" onClick={() => { setError(""); setList(null); void backend.listPassengerCoupons().then(setList).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar os cupons.")); }}>Tentar novamente</button></p>}
    {!list && !error && <p role="status">Carregando cupons…</p>}
    {list && <>
      <h2>Disponíveis</h2>
      {list.available.length ? list.available.map((coupon) => <article className="shortcut-card shortcut-coupon" key={coupon.id}>
        <div><b>{coupon.code}</b><p>{coupon.description || (coupon.discount_type === "fixed" ? `${money(coupon.discount_value)} de desconto` : `${coupon.discount_value}% de desconto`)}</p>{coupon.min_fare_cents > 0 && <small>Para corridas a partir de {money(coupon.min_fare_cents)}</small>}</div>
        <button type="button" onClick={() => apply(coupon.code)}>Usar</button>
      </article>) : <p>Nenhum cupom disponível no momento.</p>}
      <h2>Utilizados</h2>
      {list.used.length ? list.used.map((coupon, index) => <article className="shortcut-card" key={`${coupon.code}-${coupon.usedAt}-${index}`}><b>{coupon.code}</b><p>{coupon.description || `${money(coupon.discountCents)} de desconto`}</p><small>Usado em {date(coupon.usedAt)}</small></article>) : <p>Você ainda não utilizou cupons.</p>}
    </>}
  </div>;
}

function NotificationsContent({ backend }: { backend: Backend }) {
  const [error, setError] = useState("");
  if (backend.notificationsLoading) return <p role="status">Carregando notificações…</p>;
  if (backend.notificationsError) return <div role="alert"><p>{backend.notificationsError}</p><button type="button" onClick={() => void backend.reloadNotifications()}>Tentar novamente</button></div>;
  return <div className="shortcut-list">
    {backend.unreadNotifications > 0 && <button type="button" className="shortcut-mark-all" onClick={() => void backend.markNotificationsRead().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível marcar como lidas."))}>Marcar todas como lidas</button>}
    {error && <p role="alert">{error}</p>}
    {backend.notifications.length ? backend.notifications.map((item) => <button type="button" key={item.id} className={`shortcut-card shortcut-notification ${item.read_at ? "read" : "unread"}`} onClick={() => { if (!item.read_at) void backend.markNotificationsRead(item.id).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Não foi possível marcar como lida.")); }}>
      <span><b>{item.title}</b><small>{date(item.created_at)}</small><span>{item.body}</span></span>
      {!item.read_at && <i aria-label="Não lida" />}
    </button>) : <p>Você não possui notificações.</p>}
  </div>;
}

function SupportContent() {
  return <div className="shortcut-list">
    <p>Precisa de ajuda? Escolha um assunto para entrar em contato com a central do MotoPombal.</p>
    {[
      ["Corridas", "Ajuda com corrida"],
      ["Pagamentos", "Ajuda com pagamento"],
      ["Conta e acesso", "Ajuda com conta"],
    ].map(([label, subject]) => <a className="shortcut-card shortcut-support" href={`mailto:suporte@motovip.app?subject=${encodeURIComponent(`MotoPombal - ${subject}`)}`} key={label}><Headphones aria-hidden="true" /><span><b>{label}</b><small>Enviar e-mail ao suporte</small></span><ChevronRight aria-hidden="true" /></a>)}
    <p><a href="mailto:suporte@motovip.app">Central de suporte MotoPombal</a></p>
  </div>;
}

export function PassengerShortcutPage({ section }: { section: Section }) {
  const backend = useMotoVip();
  const current = shortcuts.find((item) => item.section === section)!;
  return <div className="app-role-passenger shortcut-page">
    <header className="shortcut-header"><Link href="/" aria-label="Voltar ao início"><Image src="/brand/motopombal-wordmark.png" alt="MotoPombal" width={180} height={90} /></Link><span>{backend.profile?.full_name || "Passageiro"}</span></header>
    <nav className="shortcut-nav" aria-label="Atalhos do passageiro"><Link href="/"><Home aria-hidden="true" />Início</Link>{shortcuts.map(({ section: item, href, label, icon: Icon }) => <Link href={href} key={item} className={section === item ? "active" : ""} aria-current={section === item ? "page" : undefined}><Icon aria-hidden="true" />{label}{item === "notificacoes" && backend.unreadNotifications > 0 && <b className="shortcut-badge" aria-label={`${backend.unreadNotifications} não lidas`}>{backend.unreadNotifications}</b>}</Link>)}</nav>
    <main className="shortcut-main"><Link href="/" className="shortcut-back">‹ Voltar ao mapa</Link><h1>{current.label}</h1>
      {backend.loading ? <p role="status">Carregando…</p> : !backend.session ? <p>Entre na sua conta para acessar esta seção. <Link href="/">Ir para o início</Link></p> : backend.profile?.role !== "passenger" ? <p>Esta seção é exclusiva do passageiro. <Link href="/">Voltar ao início</Link></p> : <>
        {section === "corridas" && <HistoryContent backend={backend} />}
        {section === "cupons" && <CouponsContent backend={backend} />}
        {section === "notificacoes" && <NotificationsContent backend={backend} />}
        {section === "suporte" && <SupportContent />}
      </>}
    </main>
  </div>;
}
