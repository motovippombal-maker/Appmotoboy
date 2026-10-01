import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { Coordinates, ResolvedFareRule } from "@/lib/backend/pricing-rules";

export const QUOTE_TTL_SECONDS = 5 * 60;

export type RideQuoteClaims = {
  version: 1;
  passengerId: string;
  origin: Coordinates;
  destination: Coordinates;
  fareCents: number;
  originalFareCents: number;
  discountCents: number;
  couponCode: string | null;
  couponRevision?: string | null;
  ruleFingerprint: string;
  issuedAt: number;
  expiresAt: number;
};

export class QuoteTokenError extends Error {}

function coordinate(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function normalizeQuotePoint(point: Coordinates): Coordinates {
  return { lat: coordinate(point.lat), lng: coordinate(point.lng) };
}

export function fareRuleFingerprint(input: {
  resolvedFare: ResolvedFareRule;
  fareCents: number;
  originalFareCents: number;
  discountCents: number;
  couponCode: string | null;
  couponRevision?: string | null;
}) {
  const snapshot = input.resolvedFare.snapshot;
  return createHash("sha256")
    .update(
      JSON.stringify({
        regionId: snapshot.regionId,
        amountCents: snapshot.amountCents,
        regionPriority: snapshot.regionPriority,
        regionUpdatedAt: snapshot.regionUpdatedAt,
        originServiceAreaId: snapshot.originServiceAreaId,
        originServiceAreaUpdatedAt: snapshot.originServiceAreaUpdatedAt,
        serviceAreaId: snapshot.serviceAreaId,
        serviceAreaUpdatedAt: snapshot.serviceAreaUpdatedAt,
        resolution: snapshot.resolution,
        fareCents: input.fareCents,
        originalFareCents: input.originalFareCents,
        discountCents: input.discountCents,
        couponCode: input.couponCode,
        couponRevision: input.couponRevision ?? null,
      }),
    )
    .digest("base64url");
}

export function buildQuoteClaims(input: {
  passengerId: string;
  origin: Coordinates;
  destination: Coordinates;
  resolvedFare: ResolvedFareRule;
  fareCents: number;
  originalFareCents: number;
  discountCents: number;
  couponCode: string | null;
  couponRevision?: string | null;
  now?: number;
}): RideQuoteClaims {
  const issuedAt = input.now ?? Math.floor(Date.now() / 1000);
  return {
    version: 1,
    passengerId: input.passengerId,
    origin: normalizeQuotePoint(input.origin),
    destination: normalizeQuotePoint(input.destination),
    fareCents: input.fareCents,
    originalFareCents: input.originalFareCents,
    discountCents: input.discountCents,
    couponCode: input.couponCode,
    couponRevision: input.couponRevision ?? null,
    ruleFingerprint: fareRuleFingerprint(input),
    issuedAt,
    expiresAt: issuedAt + QUOTE_TTL_SECONDS,
  };
}

function sign(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest();
}

export function createQuoteToken(claims: RideQuoteClaims, secret: string) {
  if (!secret.trim()) throw new QuoteTokenError("Chave de assinatura ausente.");
  const encodedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, secret).toString("base64url")}`;
}

function isCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<Coordinates>;
  return typeof point.lat === "number" && typeof point.lng === "number";
}

function isClaims(value: unknown): value is RideQuoteClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Partial<RideQuoteClaims>;
  return (
    claims.version === 1 &&
    typeof claims.passengerId === "string" &&
    isCoordinates(claims.origin) &&
    isCoordinates(claims.destination) &&
    typeof claims.fareCents === "number" &&
    typeof claims.originalFareCents === "number" &&
    typeof claims.discountCents === "number" &&
    (claims.couponCode === null || typeof claims.couponCode === "string") &&
    (claims.couponRevision === undefined || claims.couponRevision === null || typeof claims.couponRevision === "string") &&
    typeof claims.ruleFingerprint === "string" &&
    typeof claims.issuedAt === "number" &&
    typeof claims.expiresAt === "number"
  );
}

export function verifyQuoteToken(token: string, secret: string) {
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) {
    throw new QuoteTokenError("Cotação inválida.");
  }
  const received = Buffer.from(encodedSignature, "base64url");
  const expected = sign(encodedPayload, secret);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new QuoteTokenError("Cotação inválida.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new QuoteTokenError("Cotação inválida.");
  }
  if (!isClaims(parsed)) throw new QuoteTokenError("Cotação inválida.");
  return parsed;
}

function samePoint(first: Coordinates, second: Coordinates) {
  const normalized = normalizeQuotePoint(second);
  return first.lat === normalized.lat && first.lng === normalized.lng;
}

export function quoteMatches(
  quoted: RideQuoteClaims,
  current: RideQuoteClaims,
) {
  return (
    quoted.passengerId === current.passengerId &&
    samePoint(quoted.origin, current.origin) &&
    samePoint(quoted.destination, current.destination) &&
    quoted.fareCents === current.fareCents &&
    quoted.originalFareCents === current.originalFareCents &&
    quoted.discountCents === current.discountCents &&
    quoted.couponCode === current.couponCode &&
    (quoted.couponRevision ?? null) === (current.couponRevision ?? null) &&
    quoted.ruleFingerprint === current.ruleFingerprint
  );
}

export function quoteHasExpired(claims: RideQuoteClaims, now = Math.floor(Date.now() / 1000)) {
  return claims.expiresAt <= now;
}
