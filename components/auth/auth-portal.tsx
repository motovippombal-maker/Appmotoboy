"use client";

import Image from "next/image";
import { useState } from "react";
import {
  ArrowRight,
  Bike,
  ChevronLeft,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onSignIn: (
    email: string,
    password: string,
  ) => Promise<{ error: { message: string } | null; message?: string }>;
  onSignUp: (input: {
    email: string;
    password: string;
    fullName: string;
    phone: string;
    role: "passenger" | "driver";
  }) => Promise<{ error: { message: string } | null; message?: string }>;
  onReset: (
    email: string,
  ) => Promise<{ error: { message: string } | null; message?: string }>;
};

export function AuthPortal({ onSignIn, onSignUp, onReset }: Props) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [role, setRole] = useState<"passenger" | "driver">("passenger");
  const [form, setForm] = useState({
    email: "",
    password: "",
    fullName: "",
    phone: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const field =
    (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((value) => ({ ...value, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!form.email.trim()) return setMessage("Informe seu e-mail.");
    if (mode !== "reset" && !form.password)
      return setMessage("Informe sua senha.");
    if (mode === "register" && form.password.length < 8)
      return setMessage("Use uma senha com pelo menos 8 caracteres.");
    if (mode === "register" && (!form.fullName.trim() || !form.phone.trim()))
      return setMessage("Preencha nome completo e telefone.");
    setBusy(true);
    try {
      const result =
        mode === "login"
          ? await onSignIn(form.email, form.password)
          : mode === "register"
            ? await onSignUp({ ...form, role })
            : await onReset(form.email);
      setMessage(
        result.error
          ? result.error.message
          : result.message ||
              (mode === "reset"
                ? "Se houver uma conta com este e-mail, enviaremos as instruções de recuperação."
                : mode === "register"
                  ? "Cadastro realizado com sucesso."
                  : ""),
      );
    } catch {
      setMessage(
        "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  const scrollToLogin = () =>
    document
      .getElementById("acesso")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <main className="auth-page syxp-auth-page">
      <header className="auth-site-header">
        <a
          className="auth-header-brand"
          href="#inicio"
          aria-label="Moto SyXp, início"
        >
          <Image
            src="/gosyxp-logo.png"
            alt="GoSyXP — Ideias que entregam resultados"
            width={260}
            height={87}
            priority
          />
          <span>
            Moto <b>SyXp</b>
          </span>
        </a>
        <nav aria-label="Navegação institucional">
          <a href="#inicio">Início</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#seguranca">Segurança</a>
          <a href="#passageiros">Passageiros</a>
          <a href="#motociclistas">Motociclistas</a>
          <a href="mailto:suporte@motovip.app">Contato</a>
        </nav>
        <div className="auth-header-actions">
          <button type="button" onClick={scrollToLogin}>
            ENTRAR
          </button>
          <button type="button" className="gold" onClick={scrollToLogin}>
            PEDIR UMA MOTO
          </button>
        </div>
      </header>

      <section className="auth-stage" id="inicio">
        <div className="auth-hero">
          <Image
            className="auth-hero-media auth-hero-desktop"
            src="/brand/moto-syxp-hero.webp"
            alt="Motociclista da Moto SyXp em Ribeira do Pombal"
            fill
            priority
            sizes="66vw"
          />
          <Image
            className="auth-hero-media auth-hero-mobile"
            src="/brand/moto-syxp-mobile.webp"
            alt="Motociclista da Moto SyXp em Ribeira do Pombal"
            fill
            priority
            sizes="(max-width: 760px) 100vw, 1px"
          />
          <div className="auth-hero-shade" />
          <div className="auth-brand-copy">
            <Image
              src="/gosyxp-logo.png"
              alt="GoSyXP — Ideias que entregam resultados"
              width={560}
              height={187}
              priority
            />
            <div className="service-name">
              <span>Moto</span> <b>SyXp</b>
            </div>
            <h1>Mobilidade rápida e segura em Ribeira do Pombal.</h1>
            <p>Peça sua moto pelo celular de forma simples, rápida e segura.</p>
            <div className="auth-hero-actions">
              <button type="button" onClick={scrollToLogin}>
                PEDIR UMA MOTO <ArrowRight />
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("register");
                  setRole("driver");
                  scrollToLogin();
                }}
              >
                QUERO SER MOTORISTA
              </button>
            </div>
          </div>
        </div>

        <section className="auth-card" id="acesso" aria-labelledby="auth-title">
          {mode !== "login" && (
            <button
              className="auth-back"
              type="button"
              onClick={() => setMode("login")}
            >
              <ChevronLeft /> Voltar
            </button>
          )}
          <span className="auth-kicker">
            {mode === "reset" ? "RECUPERAÇÃO SEGURA" : "ACESSO SEGURO"}
          </span>
          <h2 id="auth-title">
            {mode === "login" ? (
              <>
                Entre na sua <em>conta</em>
              </>
            ) : mode === "register" ? (
              <>
                Crie sua <em>conta</em>
              </>
            ) : (
              <>
                Recupere seu <em>acesso</em>
              </>
            )}
          </h2>
          <p>
            {mode === "login"
              ? "Use seus dados para continuar."
              : mode === "register"
                ? "Escolha como você usará a Moto SyXp."
                : "Informe o e-mail cadastrado."}
          </p>
          {mode === "register" && (
            <div className="auth-role">
              <button
                type="button"
                className={role === "passenger" ? "active" : ""}
                onClick={() => setRole("passenger")}
              >
                <UserRound /> Passageiro
              </button>
              <button
                type="button"
                className={role === "driver" ? "active" : ""}
                onClick={() => setRole("driver")}
              >
                <Bike /> Motorista
              </button>
            </div>
          )}
          <form onSubmit={submit}>
            {mode === "register" && (
              <>
                <label>
                  <UserRound />
                  <input
                    required
                    autoComplete="name"
                    placeholder="Nome completo"
                    value={form.fullName}
                    onChange={field("fullName")}
                  />
                </label>
                <label>
                  <Phone />
                  <input
                    required
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="Telefone"
                    value={form.phone}
                    onChange={field("phone")}
                  />
                </label>
              </>
            )}
            <label>
              <Mail />
              <input
                required
                type="email"
                autoComplete="email"
                placeholder="E-mail"
                value={form.email}
                onChange={field("email")}
              />
            </label>
            {mode !== "reset" && (
              <label>
                <LockKeyhole />
                <input
                  required
                  minLength={mode === "register" ? 8 : undefined}
                  type={showPassword ? "text" : "password"}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  placeholder="Senha"
                  value={form.password}
                  onChange={field("password")}
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </label>
            )}
            {message && (
              <div className="auth-message" role="status">
                {message}
              </div>
            )}
            <Button disabled={busy} className="primary-cta">
              {busy ? (
                <>
                  <span className="button-spinner" /> AGUARDE…
                </>
              ) : mode === "login" ? (
                <>
                  ENTRAR <ArrowRight />
                </>
              ) : mode === "register" ? (
                <>
                  CRIAR CONTA <ArrowRight />
                </>
              ) : (
                <>
                  ENVIAR INSTRUÇÕES <ArrowRight />
                </>
              )}
            </Button>
          </form>
          {mode === "login" && (
            <div className="auth-links">
              <button type="button" onClick={() => setMode("reset")}>
                Esqueci minha senha
              </button>
              <button type="button" onClick={() => setMode("register")}>
                Criar uma conta
              </button>
            </div>
          )}
          <small className="auth-byline">
            MOTO SyXp <span>by GoSyXP</span>
          </small>
        </section>
      </section>

      <section
        className="auth-marketing"
        id="como-funciona"
        aria-label="Como funciona"
      >
        <article id="passageiros">
          <MapPin />
          <span>
            <b>Peça pelo celular</b>
            <small>
              Defina origem e destino com GPS e acompanhe sua corrida.
            </small>
          </span>
        </article>
        <article id="seguranca">
          <ShieldCheck />
          <span>
            <b>Mobilidade segura</b>
            <small>
              Motoristas aprovados, rota em tempo real e suporte durante a
              viagem.
            </small>
          </span>
        </article>
        <article id="motociclistas">
          <Zap />
          <span>
            <b>Rápido para todos</b>
            <small>
              Chamadas em tempo real e operação simples para motociclistas.
            </small>
          </span>
        </article>
      </section>
    </main>
  );
}
