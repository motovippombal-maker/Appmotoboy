import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/backend/api";
import { applyCoupon } from "@/lib/backend/coupons";
import type { Coordinates } from "@/lib/backend/pricing-rules";
import {
  buildQuoteClaims,
  createQuoteToken,
} from "@/lib/backend/quote-token";
import { resolveTripFare } from "@/lib/backend/region-fare";

function signingSecret() {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) {
    throw new ApiError(
      503,
      "A assinatura segura das cotações não está configurada.",
      "QUOTE_SIGNING_NOT_CONFIGURED",
    );
  }
  return createHash("sha256")
    .update("moto-syxp:ride-quote:v1:")
    .update(secret)
    .digest("base64url");
}

export async function quoteRidePrice(input: {
  supabase: SupabaseClient;
  passengerId: string;
  origin: Coordinates;
  destination: Coordinates;
  couponCode?: string;
}) {
  const resolvedFare = await resolveTripFare(
    input.supabase,
    input.origin,
    input.destination,
  );
  const coupon = await applyCoupon(
    input.supabase,
    input.passengerId,
    input.couponCode,
    resolvedFare.fareCents,
  );
  const fareCents = coupon?.fareCents ?? resolvedFare.fareCents;
  const originalFareCents =
    coupon?.originalFareCents ?? resolvedFare.fareCents;
  const discountCents = coupon?.discountCents ?? 0;
  const couponCode = coupon?.code ?? null;
  const claims = buildQuoteClaims({
    passengerId: input.passengerId,
    origin: input.origin,
    destination: input.destination,
    resolvedFare,
    fareCents,
    originalFareCents,
    discountCents,
    couponCode,
    couponRevision: coupon?.revision ?? null,
  });

  return {
    resolvedFare,
    coupon,
    claims,
    quoteToken: createQuoteToken(claims, signingSecret()),
    fareCents,
    originalFareCents,
    discountCents,
  };
}

export function publicPriceQuote(
  quoted: Awaited<ReturnType<typeof quoteRidePrice>>,
) {
  return {
    fareCents: quoted.fareCents,
    originalFareCents: quoted.originalFareCents,
    discountCents: quoted.discountCents,
    coupon: quoted.coupon
      ? {
          code: quoted.coupon.code,
          description: quoted.coupon.description,
        }
      : null,
    fareRegion: quoted.resolvedFare.fareRegion,
    serviceArea: quoted.resolvedFare.serviceArea,
    pricingMode: "region" as const,
    quoteToken: quoted.quoteToken,
    quoteExpiresAt: new Date(quoted.claims.expiresAt * 1000).toISOString(),
  };
}

export function quoteSecretForVerification() {
  return signingSecret();
}
