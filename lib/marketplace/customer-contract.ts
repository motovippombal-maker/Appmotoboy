import { z } from "zod";
import { normalizeBrazilianPhone } from "@/lib/auth/phone-identity";
import type { MarketCashSnapshot } from "./cash-reconciliation";

export const marketSlug = z.string().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const marketId = z.string().uuid();
export const marketPoint = z.object({
  address: z.string().trim().min(5).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
}).strict();
export const marketDelivery = marketPoint.extend({
  recipientName: z.string().trim().min(2).max(100),
  recipientPhone: z.string().trim().max(30).transform((value, ctx) => {
    try {
      if (!/^\+?[\d\s().-]+$/.test(value)) throw new Error("Invalid phone");
      return normalizeBrazilianPhone(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe um telefone brasileiro válido com DDD." });
      return z.NEVER;
    }
  }),
  notes: z.string().trim().max(300).default(""),
}).strict();
export const marketCartLine = z.object({
  productId: marketId,
  quantity: z.number().int().min(1).max(99),
  optionIds: z.array(marketId).max(40).default([]).refine((ids) => new Set(ids).size === ids.length),
}).strict();
export const marketQuoteInput = z.object({
  storeId: marketId,
  delivery: marketDelivery,
  cart: z.array(marketCartLine).min(1).max(30),
}).strict();
export const marketCheckoutInput = marketQuoteInput.extend({
  quoteToken: z.string().min(20).max(2048),
  idempotencyKey: marketId,
  paymentMethod: z.literal("cash"),
}).strict();

export type MarketPoint = z.infer<typeof marketPoint>;
export type MarketQuoteInput = z.infer<typeof marketQuoteInput>;
export type MarketCartLine = z.infer<typeof marketCartLine>;
export type MarketItem = {
  productId: string; productName: string; quantity: number; unitPriceCents: number; lineTotalCents: number;
  options: { id: string; groupId: string; groupName: string; name: string; priceCents: number }[];
};
export type MarketQuote = {
  subtotalCents: number; freightCents: number; discountCents: number; totalCents: number;
  prepMinutes: number | null; travelSeconds: number | null; quoteToken: string; expiresAt: string;
  items: MarketItem[];
};
export type MarketStore = {
  id: string; slug: string; name: string; description: string | null; category: string; image_url: string | null;
  cover_url: string | null; address: string; hours: Record<string, { open: string; close: string }[]>;
  prep_minutes: number | null; service_area_id: string | null; open: boolean;
};
export type MarketCategory = { id: string; name: string };
export type MarketOption = { id: string; name: string; price_cents: number };
export type MarketGroup = { id: string; name: string; min_select: number; max_select: number; options: MarketOption[] };
export type MarketProduct = {
  id: string; category_id: string | null; name: string; description: string | null; image_url: string | null;
  price_cents: number; available: boolean; groups: MarketGroup[];
};
export type MarketCatalog = { store: MarketStore; categories: MarketCategory[]; products: MarketProduct[]; checkoutAvailable: boolean };
export type MarketOrderSummary = {
  id: string; store_id: string; store_name: string; status: string; logistics_status: string;
  total_cents: number; created_at: string; updated_at: string;
};
export type MarketCashStatus = MarketCashSnapshot;
export type MarketOrder = MarketOrderSummary & {
  pickup_address: string; destination_address: string; subtotal_cents: number; freight_cents: number;
  discount_cents: number; prep_minutes: number | null; estimated_duration_seconds: number | null; expires_at: string | null;
  pickup: MarketPoint; destination: MarketPoint;
  driverLocation: { lat: number; lng: number; updatedAt: string; freshnessSeconds: number } | null;
  payment: Pick<MarketCashSnapshot, "received_at" | "received_amount_cents"> | null;
  cashSchemaReady: boolean;
  items: { id: string; product_name: string; quantity: number; line_total_cents: number; options: MarketItem["options"] }[];
  events: { id: number; event_type: string; created_at: string }[];
};
