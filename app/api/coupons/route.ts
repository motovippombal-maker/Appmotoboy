import { jsonError, requireUser } from "@/lib/backend/api";

type Coupon = {
  id: string;
  code: string;
  description: string | null;
  discount_type: "fixed" | "percentage";
  discount_value: number;
  min_fare_cents: number;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
};

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const { data: redemptions, error: redemptionError } = await supabase
      .from("coupon_redemptions")
      .select("coupon_id,discount_cents,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (redemptionError) throw redemptionError;

    const { data: activeCoupons, error: couponError } = await supabase
      .from("coupons")
      .select("id,code,description,discount_type,discount_value,min_fare_cents,starts_at,ends_at,usage_limit")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(50);
    if (couponError) throw couponError;

    const usedIds = new Set((redemptions || []).map((item) => item.coupon_id));
    const couponIds = [...usedIds].filter((id) =>
      !(activeCoupons || []).some((coupon) => coupon.id === id),
    );
    const { data: usedCoupons, error: usedError } = couponIds.length
      ? await supabase.from("coupons")
          .select("id,code,description,discount_type,discount_value,min_fare_cents,starts_at,ends_at,usage_limit")
          .in("id", couponIds)
      : { data: [] as Coupon[], error: null };
    if (usedError) throw usedError;

    const couponById = new Map(
      [...(activeCoupons || []), ...(usedCoupons || [])].map((item) => [item.id, item as Coupon]),
    );
    const now = Date.now();
    const candidates = (activeCoupons || []).filter((coupon) =>
      !usedIds.has(coupon.id) &&
      (!coupon.starts_at || Date.parse(coupon.starts_at) <= now) &&
      (!coupon.ends_at || Date.parse(coupon.ends_at) >= now),
    );
    const eligible = await Promise.all(candidates.map(async (coupon) => {
      if (coupon.usage_limit === null) return coupon;
      const { count, error } = await supabase.from("coupon_redemptions")
        .select("id", { count: "exact", head: true }).eq("coupon_id", coupon.id);
      if (error) throw error;
      return (count || 0) < coupon.usage_limit ? coupon : null;
    }));

    return Response.json({
      available: eligible.filter((item): item is Coupon => item !== null),
      used: (redemptions || []).map((item) => ({
        code: couponById.get(item.coupon_id)?.code || "Cupom utilizado",
        description: couponById.get(item.coupon_id)?.description || null,
        discountCents: item.discount_cents,
        usedAt: item.created_at,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
