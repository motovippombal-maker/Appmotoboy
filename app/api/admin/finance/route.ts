import { ApiError, jsonError, requireAdmin } from "@/lib/backend/api";

function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export async function GET(request: Request) {
  try {
    const { supabase } = await requireAdmin(request);
    const params = new URL(request.url).searchParams;
    const to = params.get("to") ? new Date(params.get("to")!) : new Date();
    const from = params.get("from") ? new Date(params.get("from")!) : new Date(to.getTime() - 30 * 86400000);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to || to.getTime() - from.getTime() > 366 * 86400000) throw new ApiError(400, "Período financeiro inválido.", "INVALID_PERIOD");
    const { data: commissionSetting } = await supabase.from("system_settings").select("value").eq("key", "commission").maybeSingle();
    const rides = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from("rides").select("id,driver_id,status,final_fare_cents,fare_cents,completed_at,created_at,payment_method,payment_status").gte("created_at", from.toISOString()).lte("created_at", to.toISOString()).in("status", ["finalizada", "cancelada"]).order("created_at", { ascending: false }).range(offset, offset + pageSize - 1);
      if (error) throw error;
      rides.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    const rideIds = rides.map((ride) => ride.id);
    const paymentResults = await Promise.all(chunks(rideIds, 200).map((ids) => supabase.from("payments").select("ride_id,method,status,amount_cents,paid_at").in("ride_id", ids)));
    const paymentError = paymentResults.find((result) => result.error)?.error;
    if (paymentError) throw paymentError;
    const payments = paymentResults.flatMap((result) => result.data || []);
    const completed = rides.filter((ride) => ride.status === "finalizada");
    const completedIds = new Set(completed.map((ride) => ride.id));
    const completedPayments = payments.filter((payment) => completedIds.has(payment.ride_id));
    const driverIds = [...new Set(completed.map((ride) => ride.driver_id).filter(Boolean))];
    const profileResults = await Promise.all(chunks(driverIds, 200).map((ids) => supabase.from("profiles").select("id,full_name").in("id", ids)));
    const profileError = profileResults.find((result) => result.error)?.error;
    if (profileError) throw profileError;
    const profiles = profileResults.flatMap((result) => result.data || []);
    const byDriver = new Map<string, { driverId: string; driverName: string; rides: number; grossCents: number; paidCents: number; pendingCents: number }>();
    for (const ride of completed) {
      if (!ride.driver_id) continue;
      const current = byDriver.get(ride.driver_id) || { driverId: ride.driver_id, driverName: profiles?.find((item) => item.id === ride.driver_id)?.full_name || "Motorista", rides: 0, grossCents: 0, paidCents: 0, pendingCents: 0 };
      const amount = ride.final_fare_cents ?? ride.fare_cents;
      const payment = payments.find((item) => item.ride_id === ride.id);
      current.rides += 1; current.grossCents += amount;
      if (payment?.status === "pago") current.paidCents += payment.amount_cents;
      if (payment?.status === "aguardando_pagamento") current.pendingCents += payment.amount_cents;
      byDriver.set(ride.driver_id, current);
    }
    return Response.json({
      period: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        completedRides: completed.length,
        cancellations: rides.filter((ride) => ride.status === "cancelada").length,
        grossCents: completed.reduce((sum, ride) => sum + (ride.final_fare_cents ?? ride.fare_cents), 0),
        pixPaidCents: completedPayments.filter((payment) => payment.method === "pix" && payment.status === "pago").reduce((sum, payment) => sum + payment.amount_cents, 0),
        cashPaidCents: completedPayments.filter((payment) => payment.method === "cash" && payment.status === "pago").reduce((sum, payment) => sum + payment.amount_cents, 0),
        receivedCents: completedPayments.filter((payment) => payment.status === "pago").reduce((sum, payment) => sum + payment.amount_cents, 0),
        pendingCents: completedPayments.filter((payment) => payment.status === "aguardando_pagamento").reduce((sum, payment) => sum + payment.amount_cents, 0),
      },
      commission: commissionSetting?.value || { configured: false, percentage_bps: 0, fixed_cents: 0 },
      byDriver: [...byDriver.values()].sort((a, b) => b.grossCents - a.grossCents),
    });
  } catch (error) { return jsonError(error); }
}
