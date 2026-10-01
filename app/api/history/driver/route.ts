import { jsonError, requireUser } from "@/lib/backend/api";

type CompletedRide = {
  id: string;
  passenger_id: string;
  completed_at?: string | null;
  finished_at?: string | null;
  final_fare_cents?: number | null;
  fare_cents: number;
  [key: string]: unknown;
};

function periodStarts() {
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const day = new Date(`${localDate}T00:00:00-03:00`);
  const week = new Date(day); week.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const month = new Date(`${localDate.slice(0, 7)}-01T00:00:00-03:00`);
  return { day, week, month };
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    const allRides: CompletedRide[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from("rides").select("*").eq("driver_id", user.id).eq("status", "finalizada").order("completed_at", { ascending: false }).range(from, from + pageSize - 1);
      if (error) throw error;
      allRides.push(...((data || []) as CompletedRide[]));
      if (!data || data.length < pageSize) break;
    }
    const rides = allRides.slice(0, 100);
    const rideIds = allRides.map((ride) => ride.id);
    const paymentBatches = await Promise.all(Array.from({ length: Math.ceil(rideIds.length / 200) }, (_, index) =>
      supabase.from("payments").select("ride_id,method,status,amount_cents,paid_at").in("ride_id", rideIds.slice(index * 200, index * 200 + 200))));
    const paymentError = paymentBatches.find((batch) => batch.error)?.error;
    if (paymentError) throw paymentError;
    const payments = paymentBatches.flatMap((batch) => batch.data || []);
    const [{ data: passengers }, { data: commissionSetting }] = await Promise.all([
      rides.length ? supabase.from("profiles").select("id,full_name").in("id", [...new Set(rides.map((ride) => ride.passenger_id))]) : Promise.resolve({ data: [] }),
      supabase.from("system_settings").select("value").eq("key", "commission").maybeSingle(),
    ]);
    const starts = periodStarts();
    const totalSince = (start: Date) => allRides
      .filter((ride) => {
        const completedAt = ride.completed_at ?? ride.finished_at;
        return Boolean(completedAt && new Date(completedAt).getTime() >= start.getTime());
      })
      .reduce((sum, ride) => sum + (ride.final_fare_cents ?? ride.fare_cents), 0);
    const receivedCents = payments.filter((payment) => payment.status === "pago")
      .reduce((sum, payment) => sum + payment.amount_cents, 0);
    const pendingCents = payments.filter((payment) => payment.status === "aguardando_pagamento")
      .reduce((sum, payment) => sum + payment.amount_cents, 0);
    return Response.json({
      totals: { dayCents: totalSince(starts.day), weekCents: totalSince(starts.week), monthCents: totalSince(starts.month), receivedCents, pendingCents, commissionConfigured: commissionSetting?.value?.configured === true },
      rides: rides.map((ride) => ({ ...ride, passenger_name: passengers?.find((profile) => profile.id === ride.passenger_id)?.full_name || null, payment: payments?.find((payment) => payment.ride_id === ride.id) || null })),
    });
  } catch (error) { return jsonError(error); }
}
