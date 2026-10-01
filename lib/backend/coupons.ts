import { ApiError } from "@/lib/backend/api";
import type { SupabaseClient } from "@supabase/supabase-js";

type CouponRow = {
  id: string;
  code: string;
  description: string | null;
  discount_type: "fixed" | "percentage";
  discount_value: number;
  max_discount_cents: number | null;
  min_fare_cents: number;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  updated_at: string;
};

export type CouponResult = {
  id: string;
  code: string;
  description: string | null;
  originalFareCents: number;
  discountCents: number;
  fareCents: number;
  revision: string;
};

export async function applyCoupon(
  supabase: SupabaseClient,
  userId: string,
  rawCode: string | undefined,
  fareCents: number,
): Promise<CouponResult | null> {
  const code = rawCode?.trim().toUpperCase();
  if (!code) return null;

  const { data, error } = await supabase
    .from("coupons")
    .select(
      "id,code,description,discount_type,discount_value,max_discount_cents,min_fare_cents,starts_at,ends_at,usage_limit,updated_at",
    )
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  const coupon = data as CouponRow | null;
  if (!coupon) throw new ApiError(422, "Cupom inválido ou inativo.", "COUPON_INVALID");

  const now = Date.now();
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now)
    throw new ApiError(422, "Este cupom ainda não está disponível.", "COUPON_NOT_STARTED");
  if (coupon.ends_at && new Date(coupon.ends_at).getTime() < now)
    throw new ApiError(422, "Este cupom expirou.", "COUPON_EXPIRED");
  if (fareCents < coupon.min_fare_cents)
    throw new ApiError(422, "O valor mínimo deste cupom não foi atingido.", "COUPON_MINIMUM");

  const { count: userUses, error: userError } = await supabase
    .from("coupon_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("coupon_id", coupon.id)
    .eq("user_id", userId);
  if (userError) throw userError;
  if ((userUses || 0) > 0)
    throw new ApiError(409, "Você já utilizou este cupom.", "COUPON_ALREADY_USED");

  const { count: totalUses, error: totalError } = await supabase
    .from("coupon_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("coupon_id", coupon.id);
  if (totalError) throw totalError;
  if (coupon.usage_limit !== null && (totalUses || 0) >= coupon.usage_limit)
    throw new ApiError(409, "Este cupom atingiu o limite de uso.", "COUPON_LIMIT_REACHED");

  let discountCents =
    coupon.discount_type === "fixed"
      ? coupon.discount_value
      : Math.round((fareCents * coupon.discount_value) / 100);
  if (coupon.max_discount_cents !== null)
    discountCents = Math.min(discountCents, coupon.max_discount_cents);
  discountCents = Math.min(discountCents, fareCents);
  if (discountCents <= 0)
    throw new ApiError(422, "Este cupom não gera desconto para a corrida.", "COUPON_NO_DISCOUNT");

  return {
    id: coupon.id,
    code: coupon.code,
    description: coupon.description,
    originalFareCents: fareCents,
    discountCents,
    fareCents: fareCents - discountCents,
    revision: `${coupon.id}:${coupon.updated_at}:${totalUses || 0}`,
  };
}
