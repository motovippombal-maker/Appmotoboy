import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { getPixProvider, publicPixStatus } from "@/lib/backend/payment";
import { isInternalPhoneEmail } from "@/lib/auth/phone-identity";

const schema = z.object({ rideId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `pix-charge:${user.id}`, 6, 60);
    const input = schema.parse(await request.json());
    const { data: ride } = await supabase.from("rides").select("id, passenger_id, final_fare_cents, fare_cents, status, payment_method").eq("id", input.rideId).single();
    if (!ride || ride.passenger_id !== user.id) throw new ApiError(404, "Corrida não encontrada.", "RIDE_NOT_FOUND");
    if (ride.status !== "finalizada") throw new ApiError(409, "A corrida precisa estar finalizada.", "RIDE_NOT_FINISHED");
    if (ride.payment_method !== "pix") throw new ApiError(409, "Esta corrida não foi configurada para pagamento Pix.", "PAYMENT_METHOD_MISMATCH");
    const provider = getPixProvider();
    const amountCents = ride.final_fare_cents ?? ride.fare_cents;
    if (amountCents <= 0) throw new ApiError(409, "Corrida gratuita não gera cobrança.", "FREE_RIDE");
    const { data: existing } = await supabase.from("payments").select("*,pix_transactions(qr_code,qr_code_image_url,expires_at)").eq("ride_id", ride.id).maybeSingle();
    const existingPix = existing?.pix_transactions?.[0];
    if (existing?.provider_reference && existingPix && existing.status === "aguardando_pagamento" && new Date(existingPix.expires_at).getTime() > Date.now()) {
      return Response.json({ paymentId: existing.id, status: "pending", qrCode: existingPix.qr_code, qrCodeImageUrl: existingPix.qr_code_image_url, expiresAt: existingPix.expires_at, duplicate: true });
    }
    if (existing?.status === "pago") return Response.json({ paymentId: existing.id, status: "paid", duplicate: true });
    const { data: payment, error } = await supabase.from("payments").upsert({ ride_id: ride.id, passenger_id: user.id, method: "pix", status: "aguardando_pagamento", amount_cents: amountCents, provider: provider.name }, { onConflict: "ride_id" }).select().single();
    if (error || !payment) throw error || new Error("Payment creation failed");
    if (payment.amount_cents !== amountCents) throw new ApiError(409, "O valor do pagamento não corresponde ao fechamento da corrida.", "PAYMENT_AMOUNT_MISMATCH");
    const charge = await provider.createCharge({
      reference: payment.id,
      amountCents,
      payerEmail: isInternalPhoneEmail(user.email) ? undefined : user.email,
    });
    await supabase.from("payments").update({ provider_reference: charge.providerChargeId }).eq("id", payment.id);
    await supabase.from("pix_transactions").upsert({ payment_id: payment.id, provider_charge_id: charge.providerChargeId, qr_code: charge.qrCode, qr_code_image_url: charge.qrCodeImageUrl, expires_at: charge.expiresAt });
    await audit(supabase, user.id, "payment.pix.created", "payment", payment.id);
    return Response.json({ paymentId: payment.id, status: "aguardando_pagamento", qrCode: charge.qrCode, qrCodeImageUrl: charge.qrCodeImageUrl, expiresAt: charge.expiresAt }, { status: 201 });
  } catch (error) { return jsonError(error); }
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const rideId = new URL(request.url).searchParams.get("rideId");
    if (!rideId) return Response.json({ pix: publicPixStatus(), payment: null });
    const { data: ride } = await supabase.from("rides").select("id,passenger_id").eq("id", rideId).maybeSingle();
    if (!ride || ride.passenger_id !== user.id) throw new ApiError(404, "Corrida não encontrada.", "RIDE_NOT_FOUND");
    const { data: payment } = await supabase.from("payments").select("id,method,status,amount_cents,paid_at,provider,pix_transactions(qr_code,qr_code_image_url,expires_at)").eq("ride_id", rideId).maybeSingle();
    return Response.json({ pix: publicPixStatus(), payment });
  } catch (error) { return jsonError(error); }
}
