import { configuredSecret, parsePublicSiteUrl, parseSupabaseUrl } from "../lib/config/public-site-url.mjs";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
];

const recommended = ["NEXT_PUBLIC_SITE_URL", "PUSH_DISPATCH_SECRET"];

const missingRequired = required.filter((name) => !configuredSecret(process.env[name]));
const missingRecommended = recommended.filter((name) => !process.env[name]?.trim());

const vapidVariables = [
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
];
const configuredVapid = vapidVariables.filter((name) => process.env[name]?.trim());
const incompleteVapid = configuredVapid.length > 0 && configuredVapid.length < vapidVariables.length;

if (missingRequired.length > 0) {
  console.error("Variaveis obrigatorias ausentes para o deploy:");
  for (const name of missingRequired) console.error(`- ${name}`);
  process.exit(1);
}

try {
  parseSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  parsePublicSiteUrl(process.env.NEXT_PUBLIC_SITE_URL, { required: process.env.VERCEL_ENV === "production" });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Configuração de URL inválida.");
  process.exit(1);
}

if (incompleteVapid) {
  console.error("A configuracao VAPID esta incompleta. Configure todas ou nenhuma:");
  for (const name of vapidVariables) console.error(`- ${name}`);
  process.exit(1);
}

if (configuredVapid.length === vapidVariables.length && !configuredSecret(process.env.PUSH_DISPATCH_SECRET)) {
  console.error("PUSH_DISPATCH_SECRET é obrigatório quando VAPID está configurado.");
  process.exit(1);
}

console.log("Variaveis obrigatorias do Supabase: OK");

if (missingRecommended.length > 0) {
  console.warn("Aviso: recursos de producao ainda aguardam configuracao:");
  for (const name of missingRecommended) console.warn(`- ${name}`);
}

if (!process.env.PIX_PROVIDER?.trim()) {
  console.warn("- PIX_PROVIDER (Pix permanecera indisponivel ate a homologacao)");
}

if (configuredVapid.length === 0) {
  console.warn("- VAPID (notificacoes Push permanecerao indisponiveis)");
}
