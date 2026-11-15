import { z } from "zod";
import { marketCashAmount, marketCashReference } from "./cash-input";

const id = z.string().uuid();
const shortName = z.string().trim().min(2).max(100);
const description = z.string().trim().max(1_000);
const sequence = z.number().int().min(0).max(100_000);
const cents = z.number().int().min(0).max(10_000_000);
const stock = z.number().int().min(0).max(100_000).nullable();
const reason = z.string().trim().min(3).max(300);
export function isPublicMarketplaceImage(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, "");
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host) && !/^\d+(?:\.\d+){3}$/.test(host) &&
      !/(?:^|\.)(?:localhost|local|internal|lan|home|test|example|invalid|onion)$/i.test(host) &&
      url.pathname.length > 1 && !/[\\\s]|%2f|%5c|%2e|(?:^|\/)\.{1,2}(?:\/|$)/i.test(value);
  } catch { return false; }
}
const imageUrl = z.string().trim().max(2_000).url().refine(isPublicMarketplaceImage, "Informe um endereço público HTTPS para a imagem, sem credenciais ou parâmetros.").nullable();

export type StoreHours = Partial<Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", { open: string; close: string }[]>>;
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const windows = z.array(z.object({ open: clock, close: clock }).strict()).max(12);
const schedule = z.object({ "1": windows.optional(), "2": windows.optional(), "3": windows.optional(), "4": windows.optional(), "5": windows.optional(), "6": windows.optional(), "7": windows.optional() }).strict().superRefine((items, context) => {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const ranges: [number, number][] = [];
  for (const [day, slots] of Object.entries(items)) for (const { open, close } of slots ?? []) {
    const from = minutes(open), until = minutes(close), offset = (Number(day) - 1) * 1440;
    if (from === until) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "A abertura e o fechamento não podem ser no mesmo horário." });
      return;
    }
    const end = offset + until + (until < from ? 1440 : 0);
    ranges.push([offset + from, Math.min(end, 10080)]);
    if (end > 10080) ranges.push([0, end - 10080]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((range, index) => index > 0 && ranges[index - 1][1] > range[0]))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Os horários da loja não podem se sobrepor." });
});

const storeFields = z.object({
  name: shortName, description, category: z.string().trim().min(2).max(60), image_url: imageUrl, cover_url: imageUrl,
  is_open: z.boolean(), prep_minutes: z.number().int().min(1).max(240).nullable(), hours: schedule,
}).strict();
const storePickup = z.object({
  address: z.string().trim().min(5).max(240),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  service_area_id: id.nullable(),
}).strict();
const categoryFields = z.object({ name: shortName, active: z.boolean(), sort_order: sequence }).strict();
const productFields = z.object({
  ...categoryFields.shape, category_id: id.nullable(), description, image_url: imageUrl, price_cents: cents,
  stock_quantity: stock, expected_stock: stock.optional(),
}).strict();
const groupFields = z.object({
  ...categoryFields.shape,
  min_select: z.number().int().min(0).max(50), max_select: z.number().int().min(1).max(50),
}).strict();
const optionFields = z.object({ ...categoryFields.shape, price_cents: cents }).strict();

export const merchantManagementAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("saveStore"), storeId: id, fields: storeFields }).strict(),
  z.object({ action: z.literal("setPreferredDriver"), storeId: id, driverId: id.nullable() }).strict(),
  z.object({ action: z.literal("saveCategory"), storeId: id, id: id.optional(), fields: categoryFields }).strict(),
  z.object({ action: z.literal("saveProduct"), storeId: id, id: id.optional(), fields: productFields }).strict(),
  z.object({ action: z.literal("saveGroup"), storeId: id, productId: id, id: id.optional(), fields: groupFields }).strict(),
  z.object({ action: z.literal("saveOption"), storeId: id, groupId: id, id: id.optional(), fields: optionFields }).strict(),
  z.object({ action: z.literal("orderAction"), storeId: id, orderId: id, command: z.enum(["accept", "reject", "ready", "cancel"]), reason: reason.optional() }).strict(),
  z.object({ action: z.literal("cashAction"), storeId: id, orderId: id, command: z.literal("settle"), amountCents: marketCashAmount, reference: marketCashReference, reason }).strict(),
]).superRefine((input, context) => {
  if (input.action === "saveGroup" && input.fields.min_select > input.fields.max_select)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", "min_select"], message: "O mínimo não pode ultrapassar o máximo de seleções." });
  if (input.action === "saveProduct" && input.id && input.fields.expected_stock === undefined)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", "expected_stock"], message: "Recarregue o estoque antes de editar o produto." });
  if (input.action === "orderAction" && ["reject", "cancel"].includes(input.command) && !input.reason)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Informe o motivo do encerramento do pedido." });
});

export const adminManagementAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("findMember"), phone: z.string().trim().min(8).max(24) }).strict(),
  z.object({ action: z.literal("createStore"), slug: z.string().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), fields: storeFields, pickup: storePickup }).strict(),
  z.object({ action: z.literal("setStorePickup"), storeId: id, pickup: storePickup }).strict(),
  z.object({ action: z.literal("setStoreStatus"), storeId: id, status: z.enum(["pending", "approved", "suspended"]), reason }).strict(),
  z.object({ action: z.literal("setMember"), storeId: id, userId: id, role: z.enum(["owner", "manager"]).nullable(), reason }).strict(),
  z.object({ action: z.literal("setPreferredDriver"), storeId: id, driverId: id.nullable() }).strict(),
  z.object({ action: z.literal("orderAction"), storeId: id, orderId: id, command: z.literal("cancel"), reason }).strict(),
  z.object({ action: z.literal("cashAction"), storeId: id, orderId: id, command: z.enum(["receive", "settle"]), amountCents: marketCashAmount, reference: marketCashReference.optional(), reason }).strict(),
  z.object({ action: z.literal("retryDelivery"), storeId: id, orderId: id, reason }).strict(),
  z.object({ action: z.literal("deliveryException"), storeId: id, orderId: id, resolution: z.enum(["resume", "delivered", "cancel", "returned_restock", "close_without_restock"]), reason }).strict(),
]).superRefine((input, context) => {
  if (input.action === "cashAction" && input.command === "settle" && !input.reference)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reference"], message: "Informe uma referência externa para confirmar o repasse." });
});

export type MerchantManagementAction = z.infer<typeof merchantManagementAction>;
export type AdminManagementAction = z.infer<typeof adminManagementAction>;
export const managementId = id;

export function hasManagementAccess(role: "owner" | "manager" | null | undefined, isAdmin: boolean, ownerOnly = false) {
  return isAdmin || role === "owner" || (!ownerOnly && role === "manager");
}
