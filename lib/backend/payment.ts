import { ApiError } from "@/lib/backend/errors";
import { z } from "zod";

export const cashConfirmationSchema = z.object({ rideId: z.string().uuid() }).strict();

export function assertPaymentMethodAvailable(method: "cash" | "pix") {
  if (method === "pix") getPixProvider();
}

export interface PixCharge { providerChargeId: string; qrCode: string; qrCodeImageUrl?: string; expiresAt: string; }
export type ProviderPaymentStatus = "pending" | "paid" | "expired" | "cancelled" | "failed" | "refunded";
export interface VerifiedPixEvent { eventId: string; providerChargeId: string; status: ProviderPaymentStatus; amountCents: number; eventType: string; }
export interface PixProvider {
  readonly name: string;
  createCharge(input: { reference: string; amountCents: number; payerEmail?: string }): Promise<PixCharge>;
  getCharge(providerChargeId: string): Promise<{ status: ProviderPaymentStatus; amountCents: number }>;
  cancelCharge(providerChargeId: string): Promise<void>;
  verifyWebhook(request: Request): Promise<VerifiedPixEvent>;
}

export function getPixProvider(): PixProvider {
  const configured = process.env.PIX_PROVIDER?.trim();
  if (!configured) throw new ApiError(503, "Provedor Pix não configurado.", "PIX_PROVIDER_NOT_CONFIGURED");
  throw new ApiError(503, `O provedor Pix '${configured}' ainda não possui um adaptador homologado no servidor.`, "PIX_PROVIDER_NOT_IMPLEMENTED");
}

export function publicPixStatus() {
  return { available: false, configured: Boolean(process.env.PIX_PROVIDER?.trim()), provider: process.env.PIX_PROVIDER?.trim() || null };
}

export function toDatabasePaymentStatus(status: ProviderPaymentStatus) {
  return ({ pending: "aguardando_pagamento", paid: "pago", expired: "expirado", cancelled: "cancelado", failed: "falhou", refunded: "reembolsado" } as const)[status];
}
