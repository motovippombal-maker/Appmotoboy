"use client";

import { useState } from "react";
import { Bike, ChevronLeft, LockKeyhole, Mail, Phone, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onSignIn: (email: string, password: string) => Promise<{ error: { message: string } | null; message?: string }>;
  onSignUp: (input: { email: string; password: string; fullName: string; phone: string; role: "passenger" | "driver" }) => Promise<{ error: { message: string } | null; message?: string }>;
  onReset: (email: string) => Promise<{ error: { message: string } | null; message?: string }>;
};

export function AuthPortal({ onSignIn, onSignUp, onReset }: Props) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [role, setRole] = useState<"passenger" | "driver">("passenger");
  const [form, setForm] = useState({ email: "", password: "", fullName: "", phone: "" });
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const field = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((value) => ({ ...value, [key]: event.target.value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    if (!form.email.trim()) { setMessage("Informe seu e-mail."); return; }
    if (mode !== "reset" && !form.password) { setMessage("Informe sua senha."); return; }
    if (mode === "register" && form.password.length < 8) { setMessage("Use uma senha com pelo menos 8 caracteres."); return; }
    if (mode === "register" && (!form.fullName.trim() || !form.phone.trim())) { setMessage("Preencha nome completo e telefone."); return; }
    setBusy(true);
    try {
      const result = mode === "login" ? await onSignIn(form.email, form.password) : mode === "register" ? await onSignUp({ ...form, role }) : await onReset(form.email);
      setMessage(result.error ? result.error.message : result.message || (mode === "reset" ? "Se houver uma conta com este e-mail, enviaremos as instruções de recuperação." : mode === "register" ? "Cadastro realizado com sucesso." : ""));
    } catch {
      setMessage("Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.");
    } finally { setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-brand"><div className="auth-logo"><Bike /></div><span>MOTO <b>VIP</b></span><p>Mobilidade rápida e segura em Ribeira do Pombal.</p></section><section className="auth-card">{mode !== "login" && <button className="auth-back" onClick={() => setMode("login")}><ChevronLeft /> Voltar</button>}<span className="auth-kicker">ACESSO SEGURO</span><h1>{mode === "login" ? "Entre na sua conta" : mode === "register" ? "Crie sua conta" : "Recupere seu acesso"}</h1><p>{mode === "login" ? "Use seus dados para continuar." : mode === "register" ? "Escolha como você usará a Moto VIP." : "Informe o e-mail cadastrado."}</p>{mode === "register" && <div className="auth-role"><button type="button" className={role === "passenger" ? "active" : ""} onClick={() => setRole("passenger")}><UserRound /> Passageiro</button><button type="button" className={role === "driver" ? "active" : ""} onClick={() => setRole("driver")}><Bike /> Motoboy</button></div>}<form onSubmit={submit}>{mode === "register" && <><label><UserRound /><input required placeholder="Nome completo" value={form.fullName} onChange={field("fullName")} /></label><label><Phone /><input required placeholder="Telefone" value={form.phone} onChange={field("phone")} /></label></>}<label><Mail /><input required type="email" placeholder="E-mail" value={form.email} onChange={field("email")} /></label>{mode !== "reset" && <label><LockKeyhole /><input required minLength={mode === "register" ? 8 : undefined} type="password" placeholder="Senha" value={form.password} onChange={field("password")} /></label>}{message && <div className="auth-message" role="status">{message}</div>}<Button disabled={busy} className="primary-cta">{busy ? "AGUARDE…" : mode === "login" ? "ENTRAR" : mode === "register" ? "CRIAR CONTA" : "ENVIAR INSTRUÇÕES"}</Button></form>{mode === "login" && <div className="auth-links"><button onClick={() => setMode("reset")}>Esqueci minha senha</button><button onClick={() => setMode("register")}>Criar uma conta</button></div>}</section></main>;
}
