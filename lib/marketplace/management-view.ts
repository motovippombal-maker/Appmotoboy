import type { StoreHours } from "./management";
import type { MarketCashSnapshot } from "./cash-reconciliation";

export type ManageStore = {
  id: string; slug: string; name: string; description: string; category: string;
  image_url: string | null; cover_url: string | null; address: string; latitude: number; longitude: number;
  city: string; state: string; service_area_id: string | null; status: "pending" | "approved" | "suspended";
  is_open: boolean; active: boolean; prep_minutes: number | null; hours: StoreHours;
  preferred_driver_id: string | null;
};
export type ManageCategory = { id: string; name: string; active: boolean; sort_order: number };
export type ManageProduct = ManageCategory & {
  category_id: string | null; description: string; image_url: string | null; price_cents: number; stock_quantity: number | null;
};
export type ManageGroup = ManageCategory & { product_id: string; min_select: number; max_select: number };
export type ManageOption = ManageCategory & { group_id: string; price_cents: number };
export type ManageOrder = {
  id: string; store_id: string; store_name: string; assigned_driver_id: string | null; created_at: string;
  status: "pending" | "preparing" | "ready" | "delivered" | "rejected" | "cancelled";
  logistics_status: "not_requested" | "awaiting_driver" | "assigned" | "in_delivery" | "delivered" | "exception" | "cancelled";
  expires_at: string; prep_minutes: number | null; subtotal_cents: number; freight_cents: number; discount_cents: number;
  total_cents: number; platform_fee_cents: number; dispatch_exhausted_at: string | null;
  items: { id: string; product_name: string; quantity: number; unit_price_cents: number; line_total_cents: number;
    options: { id: string; groupName: string; name: string; priceCents: number }[] }[];
  events: { id: number; event_type: string; created_at: string; reason: string | null; financialActor: string | null }[];
  cash: (MarketCashSnapshot & { receipt_reference: string | null; settlement_reference: string | null }) | null;
};
export type ManagementData = {
  stores: Pick<ManageStore, "id" | "slug" | "name" | "status">[];
  store: ManageStore | null;
  openNow: boolean;
  role: "owner" | "manager" | "admin" | null;
  categories: ManageCategory[];
  products: ManageProduct[];
  groups: ManageGroup[];
  options: ManageOption[];
  orders: ManageOrder[];
  operationsEnabled: boolean;
  cashSchemaReady: boolean;
  cashWritesEnabled: boolean;
  drivers: { id: string; name: string }[];
  members: { user_id: string; role: "owner" | "manager"; name: string; blocked: boolean }[];
  areas: { id: string; name: string; active: boolean }[];
};
