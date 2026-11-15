import { z } from "zod";
import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { getDispatchSettings } from "@/lib/backend/dispatch";
import { marketId } from "@/lib/marketplace/customer-contract";
import { MARKET_ORDER_DETAILS, marketResponse, throwMarketError } from "@/lib/marketplace/customer-server";
import { readWithMarketCashFallback } from "@/lib/backend/marketplace-cash-schema";

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const id = marketId.parse((await params).id);
    const { data: order, error } = await supabase.from("market_orders").select(MARKET_ORDER_DETAILS)
      .eq("id", id).eq("customer_id", user.id).maybeSingle();
    if (error) throwMarketError(error);
    if (!order) throw new ApiError(404, "Pedido não encontrado.", "MARKET_ORDER_NOT_FOUND");
    const readPayment = <Fields extends string>(fields: Fields) => supabase.from("market_cash_payments").select(fields).eq("order_id", id).maybeSingle();
    const [items, events, paymentRead] = await Promise.all([
      supabase.from("market_order_items").select("id,product_name,quantity,line_total_cents,options").eq("order_id", id).order("id").limit(30),
      supabase.from("market_order_events").select("id,event_type,created_at").eq("order_id", id).order("created_at", { ascending: false }).order("id").limit(50),
      readWithMarketCashFallback(() => readPayment("received_at,received_amount_cents"), () => readPayment("received_at")),
    ]);
    for (const result of [items, events, paymentRead.result]) if (result.error) throwMarketError(result.error);
    const payment = paymentRead.result.data && (paymentRead.schemaReady ? paymentRead.result.data : { ...paymentRead.result.data, received_amount_cents: null });
    const { assigned_driver_id: driverId, pickup_lat, pickup_lng, destination_lat, destination_lng, ...publicOrder } = order;
    let driverLocation = null;
    if (driverId && ["assigned", "in_delivery"].includes(order.logistics_status)) {
      const { data: ride } = await supabase.from("rides").select("id").eq("market_order_id", order.id).eq("driver_id", driverId)
        .not("status", "in", "(finalizada,cancelada)").maybeSingle();
      if (ride) {
        const [{ data: location }, config] = await Promise.all([
          supabase.from("driver_locations").select("latitude,longitude,updated_at").eq("driver_id", driverId).eq("ride_id", ride.id).maybeSingle(),
          getDispatchSettings(supabase).catch(() => null),
        ]);
        if (location && config) driverLocation = { lat: location.latitude, lng: location.longitude, updatedAt: location.updated_at, freshnessSeconds: config.freshnessSeconds };
      }
    }
    return marketResponse({ order: {
      ...publicOrder, items: items.data ?? [], events: events.data ?? [], payment, cashSchemaReady: paymentRead.schemaReady, driverLocation,
      pickup: { address: order.pickup_address, lat: pickup_lat, lng: pickup_lng },
      destination: { address: order.destination_address, lat: destination_lat, lng: destination_lng },
    } });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `market-cancel:${user.id}`, 5, 60);
    const id = marketId.parse((await params).id);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).strict().parse(await request.json());
    const { data, error } = await supabase.rpc("market_cancel_order", { p_customer_id: user.id, p_order_id: id, p_reason: reason });
    if (error) throwMarketError(error);
    return marketResponse(data);
  } catch (error) { return jsonError(error); }
}
