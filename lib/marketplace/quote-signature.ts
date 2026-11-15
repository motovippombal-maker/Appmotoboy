import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { MarketQuoteInput } from "./customer-contract";

const claimsSchema = z.object({
  version: z.literal(1), customerId: z.string().uuid(), requestFingerprint: z.string(),
  catalogFingerprint: z.string(), fareFingerprint: z.string(), expiresAt: z.number().int(),
}).strict();
type MarketQuoteClaims = z.infer<typeof claimsSchema>;

export function checkoutFingerprint(input: MarketQuoteInput) {
  const cart = input.cart.map(({ productId, quantity, optionIds }) => ({
    productId, quantity, optionIds: [...optionIds].sort(),
  }));
  const delivery = input.delivery;
  return createHash("sha256").update(JSON.stringify({
    storeId: input.storeId, cart,
    delivery: [delivery.address, delivery.lat, delivery.lng, delivery.recipientName, delivery.recipientPhone, delivery.notes],
  })).digest("hex");
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update("motopombal:marketplace:quote:v1:").update(payload).digest();
}

export function signMarketQuote(claims: MarketQuoteClaims, secret: string) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function readMarketQuote(token: string, secret: string) {
  const [payload, encoded, extra] = token.split(".");
  if (!payload || !encoded || extra !== undefined || !/^[\w-]+$/.test(encoded)) return null;
  const actual = Buffer.from(encoded, "base64url");
  const expected = signature(payload, secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = claimsSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
