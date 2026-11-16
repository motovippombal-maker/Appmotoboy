import { jsonError } from "@/lib/backend/api";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("delivery_settings")
      .select("enabled,cash_enabled,card_on_delivery_enabled")
      .eq("singleton", true)
      .single();
    if (error?.code === "PGRST205") {
      return Response.json({
        enabled: false,
        cashEnabled: false,
        cardOnDeliveryEnabled: false,
      });
    }
    if (error) throw error;
    return Response.json({
      enabled: data.enabled,
      cashEnabled: data.cash_enabled,
      cardOnDeliveryEnabled: data.card_on_delivery_enabled,
    });
  } catch (error) {
    return jsonError(error);
  }
}
