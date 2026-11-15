import { z } from "zod";

export const addressSchema = z.object({
  street: z.string().trim().min(3).max(160),
  number: z.string().trim().min(1).max(20),
  district: z.string().trim().min(2).max(100),
  complement: z.string().trim().max(160).optional(),
  reference: z.string().trim().max(160).optional(),
  postalCode: z.string().trim().max(12).optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().length(2),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const cartItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  optionIds: z.array(z.string().uuid()).max(30).default([]),
  notes: z.string().trim().max(300).default(""),
});

export const checkoutSchema = z.object({
  restaurantId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  items: z.array(cartItemSchema).min(1).max(50),
  address: addressSchema,
  paymentMethod: z.enum(["cash", "card_on_delivery"]),
  changeForCents: z.number().int().min(0).nullable().optional(),
  expectedSubtotalCents: z.number().int().min(0).optional(),
  expectedDeliveryFeeCents: z.number().int().min(0).optional(),
});

export const restaurantSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    responsibleName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(8).max(24),
    whatsapp: z.string().trim().max(24).optional(),
    document: z.string().trim().max(20).optional(),
    description: z.string().trim().max(500).optional(),
    cuisine: z.string().trim().min(2).max(80),
    address: z.string().trim().min(5).max(240),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().length(2),
    preparationMinutes: z.number().int().min(1).max(240).default(30),
    minimumOrderCents: z.number().int().min(0).max(10000000).default(0),
    opensAt: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .optional(),
    closesAt: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .optional(),
  })
  .refine(
    (value) =>
      (!value.opensAt && !value.closesAt) ||
      (!!value.opensAt && !!value.closesAt && value.opensAt !== value.closesAt),
    {
      message: "Informe os dois horários ou deixe ambos vazios.",
      path: ["closesAt"],
    },
  );

export const productSchema = z.object({
  id: z.string().uuid().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  priceCents: z.number().int().min(0).max(10000000),
  available: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});
