import "server-only";

import { ApiError, type requireUser } from "@/lib/backend/api";
import { resolvePhoneIdentity } from "@/lib/auth/phone-lookup";
import { InvalidBrazilianPhoneError } from "@/lib/auth/phone-identity";
import { dispatchMarketOrder } from "@/lib/backend/marketplace-dispatch";
import { managementId, type AdminManagementAction, type MerchantManagementAction } from "@/lib/marketplace/management";
import type { ManagementData, ManageOrder, ManageStore } from "@/lib/marketplace/management-view";
import { managementError, requireManageStore, requireManagementOrder, requirePreferredDriverStore } from "@/lib/backend/marketplace-management-access";
import { marketplaceOperationsEnabled, requireMarketplaceOperations } from "@/lib/backend/marketplace-operation-mode";
import { MARKET_CASH_FIELDS } from "@/lib/marketplace/cash-reconciliation";
import { isMarketCashActionUnavailable, LEGACY_MARKET_CASH_FIELDS, legacyMarketCash, readWithMarketCashFallback } from "@/lib/backend/marketplace-cash-schema";
import { isStoreReadinessRpcMissing, parseStoreReadiness, type StoreReadiness } from "@/lib/marketplace/store-onboarding-review";

type Auth = Awaited<ReturnType<typeof requireUser>>;
type ManageAction = Exclude<AdminManagementAction, { action: "findMember" }> | MerchantManagementAction;
type MemberRole = "owner" | "manager";

const STORE_FIELDS = "id,slug,name,description,category,image_url,cover_url,address,latitude,longitude,city,state,service_area_id,status,is_open,active,prep_minutes,hours,preferred_driver_id";
const ORDER_FIELDS = "id,store_id,store_name,assigned_driver_id,status,logistics_status,created_at,expires_at,prep_minutes,subtotal_cents,freight_cents,discount_cents,total_cents,platform_fee_cents,dispatch_exhausted_at";

export async function findManagementMember(auth: Auth, phone: string) {
  try {
    const existing = await resolvePhoneIdentity(auth.supabase, phone);
    if (!existing) throw new ApiError(404, "Não encontramos uma conta com esse telefone.", "MARKET_MEMBER_NOT_FOUND");
    const { data, error } = await auth.supabase.from("profiles").select("id,full_name,blocked").eq("id", existing.id).maybeSingle();
    managementError(error);
    if (!data || data.blocked) throw new ApiError(404, "Não encontramos uma conta ativa com esse telefone.", "MARKET_MEMBER_NOT_FOUND");
    return { profile: { id: data.id as string, name: data.full_name as string } };
  } catch (problem) {
    if (problem instanceof InvalidBrazilianPhoneError) throw new ApiError(400, problem.message, "MARKET_INVALID_PHONE");
    throw problem;
  }
}

export async function loadStoreReadiness(auth: Auth, storeId: string): Promise<StoreReadiness | null> {
  await requireManageStore(auth, storeId);
  const result = await auth.supabase.rpc("market_store_readiness", { p_actor_id: auth.user.id, p_store_id: storeId });
  // Older deployments keep their existing store panel before this incremental migration.
  if (isStoreReadinessRpcMissing(result.error)) return null;
  managementError(result.error);
  return parseStoreReadiness(result.data);
}

async function loadManagementOrders(auth: Auth, storeId: string, central: boolean): Promise<{ orders: ManageOrder[]; cashSchemaReady: boolean }> {
  const orders = await auth.supabase.from("market_orders").select(ORDER_FIELDS).eq("store_id", storeId).order("created_at", { ascending: false }).limit(100);
  managementError(orders.error);
  if (!orders.data?.length) return { orders: [], cashSchemaReady: true };
  const ids = orders.data.map(({ id }) => id);
  // Child records are locked to the selected store via the scoped parent IDs.
  const readCash = <Fields extends string>(fields: Fields) => auth.supabase.from("market_cash_payments").select(fields).in("order_id", ids).limit(100);
  const [items, events, cash] = await Promise.all([
    auth.supabase.from("market_order_items").select("id,order_id,product_name,quantity,unit_price_cents,line_total_cents,options").in("order_id", ids).limit(5_000),
    auth.supabase.from("market_order_events").select("id,order_id,event_type,created_at,metadata,actor_id").in("order_id", ids).order("id", { ascending: true }).limit(5_000),
    readWithMarketCashFallback(() => readCash(`order_id,${MARKET_CASH_FIELDS},receipt_reference,settlement_reference`), () => readCash(`order_id,${LEGACY_MARKET_CASH_FIELDS}`)),
  ]);
  for (const response of [items, events, cash.result]) managementError(response.error);
  const cashRows = cash.schemaReady ? cash.result.data ?? [] : (cash.result.data ?? []).map((row) => ({ ...legacyMarketCash(row), receipt_reference: null, settlement_reference: null }));
  return { cashSchemaReady: cash.schemaReady, orders: orders.data.map((order) => ({ ...order, items: (items.data ?? []).filter((item) => item.order_id === order.id),
    events: (events.data ?? []).filter((event) => event.order_id === order.id).map(({ id, event_type, created_at, metadata, actor_id }) => ({
      id, event_type, created_at, reason: typeof metadata?.reason === "string" ? metadata.reason : null,
      financialActor: central && event_type.startsWith("payment.") ? actor_id : null,
    })),
    cash: cashRows.find((entry) => entry.order_id === order.id) ?? null,
  })) as ManageOrder[] };
}

export async function managementData(auth: Auth, requestedStoreId: string | null, central: boolean): Promise<ManagementData> {
  const { supabase, user, profile } = auth;
  const isAdmin = profile.role === "admin";
  const selected = requestedStoreId ? managementId.parse(requestedStoreId) : null;
  if (selected) await requireManageStore(auth, selected);
  const operationsEnabled = await marketplaceOperationsEnabled(supabase);
  const empty: ManagementData = { stores: [], store: null, openNow: false, role: null, categories: [], products: [], groups: [], options: [], orders: [], operationsEnabled, cashSchemaReady: true, cashWritesEnabled: false, drivers: [], members: [], areas: [] };
  const areas = central ? await supabase.from("service_areas").select("id,name,active").eq("allow_destinations", true).order("name") : null;
  if (areas) { managementError(areas.error); empty.areas = areas.data ?? []; }
  let storeQuery = supabase.from("market_stores").select("id,slug,name,status").order("name");
  if (!isAdmin) {
    const members = await supabase.from("market_store_members").select("store_id").eq("user_id", user.id);
    managementError(members.error);
    const ids = members.data?.map(({ store_id }) => store_id) ?? [];
    if (!ids.length) return empty;
    storeQuery = storeQuery.in("id", ids);
  }
  const stores = await storeQuery;
  managementError(stores.error);
  empty.stores = (stores.data ?? []) as ManagementData["stores"];
  const storeId = selected ?? empty.stores[0]?.id;
  if (!storeId) return empty;
  const role = await requireManageStore(auth, storeId);
  const storeResult = await supabase.from("market_stores").select(STORE_FIELDS).eq("id", storeId).maybeSingle();
  managementError(storeResult.error);
  if (!storeResult.data) throw new ApiError(404, "Loja não encontrada.", "MARKET_STORE_NOT_FOUND");
  const editablePreference = role === "admin" || (role === "owner" && storeResult.data.status === "approved" && storeResult.data.active === true);
  const [openResult, categories, products, groups, options, orderRead, drivers, members, storeReadiness] = await Promise.all([
    supabase.rpc("market_store_open", { p_store_id: storeId }),
    central ? null : supabase.from("market_categories").select("id,name,active,sort_order").eq("store_id", storeId).order("sort_order").order("name"),
    central ? null : supabase.from("market_products").select("id,name,active,sort_order,category_id,description,image_url,price_cents,stock_quantity").eq("store_id", storeId).order("sort_order").order("name"),
    central ? null : supabase.from("market_option_groups").select("id,name,active,sort_order,product_id,min_select,max_select").eq("store_id", storeId).order("sort_order").order("name"),
    central ? null : supabase.from("market_options").select("id,name,active,sort_order,group_id,price_cents").eq("store_id", storeId).order("sort_order").order("name"),
    loadManagementOrders(auth, storeId, central),
    editablePreference ? supabase.from("drivers").select("profile_id,profiles!inner(full_name,blocked)").eq("approval_status", "approved").eq("profiles.blocked", false) : null,
    central ? supabase.from("market_store_members").select("user_id,role,profiles!inner(full_name,blocked)").eq("store_id", storeId) : null,
    central ? loadStoreReadiness(auth, storeId) : null,
  ]);
  for (const response of [openResult, categories, products, groups, options, drivers, members]) if (response) managementError(response.error);
  const readProfile = (value: unknown) => (Array.isArray(value) ? value[0] : value) as { full_name?: string; blocked?: boolean } | null;
  return {
    ...empty, store: storeResult.data as ManageStore, openNow: openResult.data === true, role, storeReadiness,
    categories: categories?.data ?? [], products: products?.data ?? [], groups: groups?.data ?? [], options: options?.data ?? [],
    orders: orderRead.orders, cashSchemaReady: orderRead.cashSchemaReady, cashWritesEnabled: operationsEnabled && orderRead.cashSchemaReady,
    drivers: (drivers?.data ?? []).map((driver) => ({ id: driver.profile_id, name: readProfile(driver.profiles)?.full_name || "Entregador" })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    members: (members?.data ?? []).map((member) => ({ user_id: member.user_id, role: member.role as MemberRole,
      name: readProfile(member.profiles)?.full_name || "Responsável", blocked: Boolean(readProfile(member.profiles)?.blocked) })),
  };
}

export async function applyManagementAction(auth: Auth, input: ManageAction) {
  const { supabase, user } = auth;
  if (input.action === "cashAction") await requireMarketplaceOperations(supabase);
  if (input.action === "setPreferredDriver") await requirePreferredDriverStore(auth, input.storeId);
  else if ("storeId" in input) await requireManageStore(auth, input.storeId);
  if ("orderId" in input) {
    await requireManagementOrder(supabase, input.storeId, input.orderId);
    const common = { p_actor_id: user.id, p_order_id: input.orderId };
    const result = input.action === "orderAction" ? await supabase.rpc("market_transition_order", { ...common, p_action: input.command, p_reason: input.reason ?? null })
      : input.action === "cashAction" ? await supabase.rpc("market_record_cash_action", {
        ...common, p_action: input.command, p_amount_cents: input.amountCents, p_reference: input.reference ?? null, p_note: input.reason,
      })
      : await supabase.rpc("market_admin_delivery_action", { ...common, p_action: input.action === "retryDelivery" ? "retry" : input.resolution, p_reason: input.reason });
    if (input.action === "cashAction" && isMarketCashActionUnavailable(result.error))
      throw new ApiError(503, "O registro de caixa está indisponível até concluir a atualização.", "MARKET_CASH_UPDATE_PENDING");
    managementError(result.error);
    if ((input.action === "retryDelivery" || input.action === "deliveryException") && result.data !== true)
      throw new ApiError(409, "A etapa da entrega mudou. Atualize o painel antes de continuar.", "MARKET_DELIVERY_STATE_CHANGED");
    if ((input.action === "orderAction" && input.command === "ready") || input.action === "retryDelivery") {
      // A failed first offer must not undo a kitchen transition or falsely cancel a purchase.
      try { await dispatchMarketOrder(supabase, input.orderId); } catch { /* Retry is persisted by the delivery engine. */ }
    }
    return result.data;
  }
  if ("pickup" in input && input.pickup.service_area_id) {
    const area = await supabase.from("service_areas").select("id").eq("id", input.pickup.service_area_id).eq("allow_destinations", true).eq("active", true).maybeSingle();
    managementError(area.error);
    if (!area.data) throw new ApiError(409, "Selecione uma área de atendimento ativa que permita entregas.", "MARKET_AREA_UNAVAILABLE");
  }
  const fields = input.action === "createStore" ? { ...input.fields, ...input.pickup, slug: input.slug }
    : input.action === "setStorePickup" ? input.pickup
    : input.action === "setStoreStatus" ? { status: input.status }
    : input.action === "setMember" ? { role: input.role }
    : "fields" in input ? input.fields : {};
  const target = input.action === "setMember" ? input.userId : input.action === "setPreferredDriver" ? input.driverId : "id" in input ? input.id : null;
  const parent = "productId" in input ? input.productId : "groupId" in input ? input.groupId : null;
  const result = await supabase.rpc("market_manage_store", {
    p_actor_id: user.id, p_action: input.action, p_store_id: "storeId" in input ? input.storeId : null,
    p_target_id: target ?? null, p_parent_id: parent, p_data: fields, p_reason: "reason" in input ? input.reason : null,
  });
  managementError(result.error);
  return result.data;
}
