"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bike,
  ChevronLeft,
  Eye,
  EyeOff,
  LockKeyhole,
  MapPin,
  Palette,
  Phone,
  RectangleEllipsis,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  maskBrazilianPhone,
  normalizeBrazilianPhone,
  normalizeBrazilianPlate,
} from "@/lib/auth/phone-identity";

type AuthResult = Promise<{ error: { message: string } | null; message?: string }>;
type Role = "passenger" | "driver";
type Mode = "login" | "role" | "register" | "reset";

type Props = {
  onSignIn: (phone: string, password: string) => AuthResult;
  onSignUp: (input: {
    password: string;
    fullName: string;
    phone: string;
    role: Role;
    vehicle?: { plate: string; model: string; color: string };
  }) => AuthResult;
  onReset: (phone: string) => AuthResult;
};

const REMEMBERED_PHONE_KEY = "motovip:remembered-phone";

function MotorcycleGlyph() {
  return (
    <svg viewBox="0 0 64 40" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="30" r="7" />
      <circle cx="51" cy="30" r="7" />
      <path d="M12 30h11l7-13h8l8 13h5M23 30l-7-16h9m5 3 7 13M30 17l6-7h9m-5 0h8m-9 20h5" />
    </svg>
  );
}

export function AuthPortal({ onSignIn, onSignUp, onReset }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [role, setRole] = useState<Role>("passenger");
  const [form, setForm] = useState({
    phone: "",
    password: "",
    confirmPassword: "",
    fullName: "",
    plate: "",
    model: "",
    color: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const phone = window.localStorage.getItem(REMEMBERED_PHONE_KEY);
        if (phone) setForm((value) => ({ ...value, phone: maskBrazilianPhone(phone) }));
      } catch {
        // Storage is optional and must never block authentication.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const field = (key: "fullName" | "model" | "color") =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((value) => ({ ...value, [key]: event.target.value }));

  function changeMode(next: Mode) {
    if (busy) return;
    setMessage("");
    setMode(next);
  }

  function chooseRole(nextRole: Role) {
    if (busy) return;
    setRole(nextRole);
    setMessage("");
    setMode("register");
  }

  function validatePhone() {
    try {
      return normalizeBrazilianPhone(form.phone);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Informe um celular válido com DDD.");
      return null;
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setMessage("");
    const phone = validatePhone();
    if (!phone) return;

    if (mode === "login" && !form.password) return setMessage("Informe sua senha.");
    if (mode === "register") {
      if (form.fullName.trim().length < 3 || !form.fullName.trim().includes(" "))
        return setMessage("Informe seu nome completo.");
      if (form.password.length < 8)
        return setMessage("Use uma senha com pelo menos 8 caracteres.");
      if (form.password !== form.confirmPassword)
        return setMessage("As senhas não coincidem.");
      if (role === "driver") {
        if (!form.model.trim() || !form.color.trim() || !form.plate.trim())
          return setMessage("Preencha placa, modelo e cor da moto.");
        if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(normalizeBrazilianPlate(form.plate)))
          return setMessage("Informe uma placa válida, como ABC1D23.");
      }
    }

    setBusy(true);
    try {
      const result = mode === "login"
        ? await onSignIn(phone, form.password)
        : mode === "register"
          ? await onSignUp({
              fullName: form.fullName,
              phone,
              password: form.password,
              role,
              vehicle: role === "driver"
                ? { plate: normalizeBrazilianPlate(form.plate), model: form.model, color: form.color }
                : undefined,
            })
          : await onReset(phone);

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      if (mode === "login" || mode === "register") {
        try {
          if (rememberMe) window.localStorage.setItem(REMEMBERED_PHONE_KEY, phone);
          else window.localStorage.removeItem(REMEMBERED_PHONE_KEY);
        } catch {
          // Storage is optional.
        }
      }
      setMessage(result.message || (mode === "register" ? "Conta criada. Entrando…" : "Acesso liberado. Entrando…"));
    } catch {
      setMessage("Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  const scrollToLogin = () => document.getElementById("acesso")?.scrollIntoView({ behavior: "smooth", block: "center" });

  function startDriverRegistration() {
    chooseRole("driver");
    scrollToLogin();
  }

  function goBack() {
    if (mode === "register") changeMode("role");
    else changeMode("login");
  }

  const title = mode === "login"
    ? <>Entre na sua <em>conta</em></>
    : mode === "role"
      ? <>Como você quer usar o <em>MotoPombal?</em></>
      : mode === "register"
        ? <>Crie sua conta de <em>{role === "driver" ? "motorista" : "passageiro"}</em></>
        : <>Recupere seu <em>acesso</em></>;

  return (
    <main className="auth-page syxp-auth-page">
      <header className="auth-site-header">
        <a className="auth-header-brand" href="#inicio" aria-label="MotoPombal, início">
          <Image src="/brand/motopombal-wordmark.png" alt="MotoPombal" width={260} height={130} priority />
        </a>
        <nav aria-label="Navegação institucional">
          <a href="#inicio">Início</a><a href="#como-funciona">Como funciona</a><a href="#seguranca">Segurança</a>
          <a href="#passageiros">Passageiros</a><a href="#motociclistas">Motociclistas</a><a href="mailto:suporte@motovip.app">Contato</a>
        </nav>
        <div className="auth-header-actions">
          <button type="button" onClick={scrollToLogin}>ENTRAR</button>
          <button type="button" className="gold" onClick={scrollToLogin}><MotorcycleGlyph /> PEDIR UMA MOTO</button>
        </div>
      </header>

      <section className="auth-stage" id="inicio">
        <div className="auth-hero">
          <Image className="auth-hero-media auth-hero-desktop" src="/brand/motovip-hero.webp" alt="Motociclista da MotoPombal em Ribeira do Pombal" fill priority sizes="66vw" />
          <Image className="auth-hero-media auth-hero-mobile" src="/brand/motovip-mobile-login-v2.webp" alt="Motociclista da MotoPombal em Ribeira do Pombal" fill priority sizes="(max-width: 760px) 100vw, 1px" />
          <div className="auth-hero-shade" />
          <div className="auth-brand-copy">
            <Image src="/brand/motopombal-wordmark.png" alt="MotoPombal" width={560} height={280} priority />
            <h1><span className="auth-title-white">Mobilidade rápida<br className="auth-mobile-break" /> e segura em</span>{" "}<span className="auth-title-city">Ribeira do Pombal.</span></h1>
            <p>Peça sua moto pelo celular de forma simples, rápida e segura.</p>
            <div className="auth-hero-benefits" aria-label="Rápida, segura e local">
              <span><i><Zap aria-hidden="true" /></i><b>Rápida</b></span>
              <span><i><ShieldCheck aria-hidden="true" /></i><b>Segura</b></span>
              <span><i><MapPin aria-hidden="true" /></i><b>Local</b></span>
            </div>
            <div className="auth-hero-actions">
              <button type="button" onClick={scrollToLogin}>PEDIR UMA MOTO <ArrowRight /></button>
              <button type="button" onClick={startDriverRegistration}>QUERO SER MOTORISTA</button>
            </div>
          </div>
        </div>

        <section className={`auth-card auth-mode-${mode}`} id="acesso" aria-labelledby="auth-title">
          {mode !== "login" && <button className="auth-back" type="button" onClick={goBack} disabled={busy}><ChevronLeft /> Voltar</button>}
          <span className="auth-kicker">{mode === "reset" ? "RECUPERAÇÃO DE ACESSO" : mode === "role" ? "COMECE EM SEGUNDOS" : "ACESSO SEGURO"}</span>
          <h2 id="auth-title">{title}</h2>
          <p>
            {mode === "login" && "Use seu celular ou WhatsApp para continuar."}
            {mode === "role" && "Escolha seu perfil para criar a conta certa para você."}
            {mode === "register" && (role === "driver" ? "Cadastre seus dados e sua moto. A análise acontece dentro do app." : "Só o essencial para você pedir sua primeira corrida.")}
            {mode === "reset" && "Informe o celular cadastrado para ver as orientações de recuperação."}
          </p>

          {mode === "role" ? (
            <div className="auth-role-cards" aria-label="Escolha como usar o MotoPombal">
              <button type="button" onClick={() => chooseRole("passenger")}>
                <i><UserRound /></i><span><b>PASSAGEIRO</b><small>Quero pedir uma moto</small></span><ArrowRight />
              </button>
              <button type="button" onClick={() => chooseRole("driver")}>
                <i><Bike /></i><span><b>MOTORISTA</b><small>Quero fazer corridas</small></span><ArrowRight />
              </button>
            </div>
          ) : (
            <form key={`${mode}-${role}`} onSubmit={submit} aria-busy={busy} autoComplete="off">
              {mode === "register" && (
                <label><UserRound /><input required name="name" autoComplete="name" placeholder="Nome completo" value={form.fullName} onChange={field("fullName")} disabled={busy} /></label>
              )}
              <label><Phone /><input required type="tel" name={mode === "login" ? "phone" : "registration-phone"} autoComplete="off" inputMode="tel" placeholder="Celular ou WhatsApp" value={form.phone} onChange={(event) => setForm((value) => ({ ...value, phone: maskBrazilianPhone(event.target.value) }))} disabled={busy} /></label>
              {mode !== "reset" && (
                <label>
                  <LockKeyhole /><input required name={mode === "login" ? "password" : "new-password"} minLength={mode === "register" ? 8 : undefined} type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "off" : "new-password"} placeholder="Sua senha" value={form.password} onChange={(event) => setForm((value) => ({ ...value, password: event.target.value }))} disabled={busy} />
                  <button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} disabled={busy}>{showPassword ? <EyeOff /> : <Eye />}</button>
                </label>
              )}
              {mode === "register" && (
                <>
                  <label>
                    <LockKeyhole /><input required name="new-password-confirmation" minLength={8} type={showConfirmation ? "text" : "password"} autoComplete="new-password" placeholder="Confirmar senha" value={form.confirmPassword} onChange={(event) => setForm((value) => ({ ...value, confirmPassword: event.target.value }))} disabled={busy} />
                    <button className="password-toggle" type="button" onClick={() => setShowConfirmation((value) => !value)} aria-label={showConfirmation ? "Ocultar confirmação" : "Mostrar confirmação"} disabled={busy}>{showConfirmation ? <EyeOff /> : <Eye />}</button>
                  </label>
                  {role === "driver" && (
                    <div className="driver-register-fields">
                      <label><RectangleEllipsis /><input required name="vehicle-plate" autoCapitalize="characters" placeholder="Placa da moto" value={form.plate} onChange={(event) => setForm((value) => ({ ...value, plate: normalizeBrazilianPlate(event.target.value) }))} disabled={busy} /></label>
                      <label><Bike /><input required name="vehicle-model" placeholder="Modelo da moto" value={form.model} onChange={field("model")} disabled={busy} /></label>
                      <label><Palette /><input required name="vehicle-color" placeholder="Cor da moto" value={form.color} onChange={field("color")} disabled={busy} /></label>
                    </div>
                  )}
                </>
              )}
              {mode === "login" && (
                <div className="auth-login-options">
                  <label className="auth-remember"><input type="checkbox" checked={rememberMe} onChange={(event) => { setRememberMe(event.target.checked); if (!event.target.checked) { try { window.localStorage.removeItem(REMEMBERED_PHONE_KEY); } catch { /* optional */ } } }} /> Lembrar de mim</label>
                  <button type="button" onClick={() => changeMode("reset")}>Esqueceu sua senha?</button>
                </div>
              )}
              {message && <div className="auth-message" role="status" aria-live="polite">{message}</div>}
              <Button disabled={busy} className="primary-cta">
                {busy ? <><span className="button-spinner" /> AGUARDE…</> : mode === "login" ? <>Entrar <ArrowRight /></> : mode === "register" ? <>{role === "driver" ? "Criar conta de motorista" : "Criar conta"} <ArrowRight /></> : <>Ver orientações <ArrowRight /></>}
              </Button>
              {mode === "login" && (
                <button className="auth-create-account" type="button" onClick={() => changeMode("role")} disabled={busy}>
                  <span>Ainda não tem conta?</span><strong>Criar minha conta</strong><ArrowRight />
                </button>
              )}
            </form>
          )}
          <small className="auth-byline">MotoPombal</small>
        </section>
      </section>

      <section className="auth-marketing" id="como-funciona" aria-label="Como funciona">
        <article id="passageiros"><MapPin /><span><b>Peça pelo celular</b><small>Defina origem e destino com GPS e acompanhe sua corrida.</small></span></article>
        <article id="seguranca"><ShieldCheck /><span><b>Mobilidade segura</b><small>Motoristas aprovados, rota em tempo real e suporte durante a viagem.</small></span></article>
        <article id="motociclistas"><Zap /><span><b>Rápido para todos</b><small>Chamadas em tempo real e operação simples para motociclistas.</small></span></article>
      </section>
    </main>
  );
}
