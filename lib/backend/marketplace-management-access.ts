import { ApiError } from "@/lib/backend/errors";
import type { requireUser } from "@/lib/backend/api";
import { hasManagementAccess } from "@/lib/marketplace/management";

type Auth = Awaited<ReturnType<typeof requireUser>>;
type DatabaseError = { code?: string; message?: string } | null | undefined;
type MemberRole = "owner" | "manager";

export function managementError(error: DatabaseError) {
  if (!error) return;
  const message = error.message ?? "";
  if (["PGRST202", "PGRST204", "PGRST205", "42P01", "42883", "42703"].includes(error.code ?? ""))
    throw new ApiError(503, "Os painéis de Compras aguardam a configuração do banco.", "MARKET_NOT_CONFIGURED");
  if (error.code === "42501") throw new ApiError(403, "Você não tem permissão para gerenciar esta loja.", "MARKET_FORBIDDEN");
  if (error.code === "P0002") throw new ApiError(404, "Não encontramos este registro na loja.", "MARKET_TARGET_NOT_FOUND");
  if (error.code === "23505") throw new ApiError(409, "Esse identificador da loja já está em uso.", "MARKET_DUPLICATE");
  const problems: Record<string, [number, string]> = {
    MARKET_FORBIDDEN: [403, "Você não tem permissão para esta ação."],
    MARKET_ORDER_NOT_FOUND: [404, "Pedido não encontrado nesta loja."],
    MARKET_STOCK_CHANGED: [409, "O estoque mudou. Atualize o painel e confira a quantidade antes de salvar."],
    MARKET_STOCK_MODE_RESERVED: [409, "Existem unidades reservadas. Aguarde os pedidos em andamento antes de mudar o controle de estoque."],
    MARKET_TRANSITION_INVALID: [409, "A etapa do pedido mudou. Atualize o painel antes de continuar."],
    MARKET_ORDER_EXPIRED: [409, "Este pedido expirou e não pode mais ser aceito."],
    MARKET_PAYMENT_NOT_READY: [409, "A entrega ainda não está pronta para a confirmação financeira."],
    MARKET_PAYMENT_NOT_RECEIVED: [409, "O recebimento em dinheiro ainda não foi confirmado."],
    MARKET_PAYMENT_AMOUNT_INVALID: [422, "Informe um valor válido. O repasse informado deve ser igual ao valor destinado à loja."],
    MARKET_PAYMENT_AMOUNT_REQUIRED: [503, "O registro de caixa está indisponível até concluir a atualização."],
    MARKET_PAYMENT_REFERENCE_REQUIRED: [422, "Informe uma referência externa válida para o registro."],
    MARKET_PAYMENT_LEGACY_UNVERIFIED: [409, "Este registro antigo não tem valor informado. Encaminhe à central para conferência."],
    MARKET_PAYMENT_DIVERGENT: [409, "Há diferença no recebimento. O repasse permanece bloqueado."],
    MARKET_PAYMENT_CONFLICT: [409, "Já existe um registro com outro valor ou referência. Consulte o histórico da operação."],
    MARKET_REFUND_POLICY_NOT_CONFIGURED: [409, "Estornos e ajustes de caixa aguardam definição operacional."],
    MARKET_DRIVER_UNAVAILABLE: [409, "Selecione um entregador aprovado e com conta ativa."],
    MARKET_STORE_NOT_APPROVED: [403, "O vínculo de entregador só fica disponível depois da aprovação da loja."],
    MARKET_STORE_NOT_READY: [409, "Confira as pendências de titular, retirada e catálogo antes de aprovar a loja."],
    MARKET_MEMBER_UNAVAILABLE: [409, "Selecione uma conta existente e ativa."],
    MARKET_REASON_REQUIRED: [400, "Informe o motivo para registrar a ação."],
    MARKET_AREA_UNAVAILABLE: [409, "Selecione uma área de atendimento ativa que permita entregas."],
  };
  const code = Object.keys(problems).find((name) => message.includes(name));
  if (code) throw new ApiError(...problems[code], code);
  if (["22023", "23503", "23514"].includes(error.code ?? ""))
    throw new ApiError(400, "Os dados não atendem aos limites do cadastro. Revise a loja e tente novamente.", "MARKET_INVALID_INPUT");
  if (message.startsWith("MARKET_")) throw new ApiError(409, "A operação não está disponível para o estado atual. Atualize o painel.", message.split(/\W/)[0]);
  throw new ApiError(500, "Não foi possível atualizar o painel de Compras.", "MARKET_MANAGEMENT_UNAVAILABLE");
}

export async function requireManageStore(auth: Auth, storeId: string, ownerOnly = false) {
  if (auth.profile.blocked) throw new ApiError(403, "Conta bloqueada. Procure a central.", "ACCOUNT_BLOCKED");
  if (auth.profile.role === "admin") return "admin" as const;
  const { data, error } = await auth.supabase.from("market_store_members").select("role")
    .eq("store_id", storeId).eq("user_id", auth.user.id).maybeSingle();
  managementError(error);
  const role = data?.role as MemberRole | null | undefined;
  if (!hasManagementAccess(role, false, ownerOnly))
    throw new ApiError(403, "Você não tem permissão para gerenciar esta loja.", "MARKET_FORBIDDEN");
  return role!;
}

export async function requireManagementOrder(supabase: Auth["supabase"], storeId: string, orderId: string) {
  const order = await supabase.from("market_orders").select("id").eq("id", orderId).eq("store_id", storeId).maybeSingle();
  managementError(order.error);
  if (!order.data) throw new ApiError(404, "Pedido não encontrado nesta loja.", "MARKET_ORDER_NOT_FOUND");
}

export async function requireManagementImageStore(auth: Auth, storeId: string) {
  await requireManageStore(auth, storeId);
  const { data, error } = await auth.supabase.from("market_stores").select("id").eq("id", storeId).maybeSingle();
  managementError(error);
  if (!data) throw new ApiError(404, "Loja não encontrada.", "MARKET_STORE_NOT_FOUND");
}

export async function requirePreferredDriverStore(auth: Auth, storeId: string) {
  await requireManageStore(auth, storeId, true);
  if (auth.profile.role === "admin") return;
  const { data, error } = await auth.supabase.from("market_stores").select("id,status,active").eq("id", storeId).maybeSingle();
  managementError(error);
  if (!data || data.status !== "approved" || data.active !== true)
    throw new ApiError(403, "O vínculo de entregador só fica disponível depois da aprovação da loja.", "MARKET_STORE_NOT_APPROVED");
}
