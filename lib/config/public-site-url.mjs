export function parseSupabaseUrl(value) {
  if (!value?.trim()) throw new Error("NEXT_PUBLIC_SUPABASE_URL não configurada.");
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("NEXT_PUBLIC_SUPABASE_URL inválida."); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash || /seu-projeto|example/i.test(url.hostname))
    throw new Error("NEXT_PUBLIC_SUPABASE_URL deve ser uma origem HTTPS válida.");
  return url.origin;
}

export function parsePublicSiteUrl(value, { required = false } = {}) {
  if (!value?.trim()) {
    if (required) throw new Error("NEXT_PUBLIC_SITE_URL obrigatória em produção.");
    return null;
  }
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("NEXT_PUBLIC_SITE_URL inválida."); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash || /seu-dominio|example/i.test(url.hostname))
    throw new Error("NEXT_PUBLIC_SITE_URL deve ser uma origem HTTPS, sem caminho ou credenciais.");
  return url.origin;
}

export function configuredSecret(value) {
  return Boolean(value?.trim() && !/SUBSTITUA_AQUI|YOUR_SECRET|SEU_SEGREDO/i.test(value));
}
