import { ApiError } from "@/lib/backend/api";

export interface PixCharge { providerChargeId: string; qrCode: string; qrCodeImageUrl?: string; expiresAt: string; }
export type ProviderPaymentStatus = "pending" | "paid" | "expired" | "failed" | "refunded";
export interface VerifiedPixEvent { eventId: string; providerChargeId: string; status: ProviderPaymentStatus; amountCents: number; eventType: string; }
export interface PixProvider {
  readonly name: string;
  createCharge(input: { reference: string; amountCents: number; payerEmail?: string }): Promise<PixCharge>;
  verifyWebhook(request: Request): Promise<VerifiedPixEvent>;
}

export function getPixProvider(): PixProvider {
  const configured = process.env.PIX_PROVIDER?.trim();
  if (!configured) throw new ApiError(503, "Provedor Pix não configurado.", "PIX_PROVIDER_NOT_CONFIGURED");
  throw new ApiError(503, `O provedor Pix '${configured}' ainda não possui um adaptador homologado no servidor.`, "PIX_PROVIDER_NOT_IMPLEMENTED");
}

export function publicPixStatus() {
  return { configured: Boolean(process.env.PIX_PROVIDER?.trim()), provider: process.env.PIX_PROVIDER?.trim() || null };
}

export function toDatabasePaymentStatus(status: ProviderPaymentStatus) {
  return ({ pending: "aguardando_pagamento", paid: "pago", expired: "expirado", failed: "falhou", refunded: "reembolsado" } as const)[status];
}
