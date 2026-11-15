import "server-only";

import { ApiError } from "@/lib/backend/api";
import { calculateRoute } from "@/lib/backend/routing";
import type { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { z } from "zod";
import { addressSchema } from "./schemas";
import { isWithinRestaurantHours } from "./opening-hours";

type Db = ReturnType<typeof createSupabaseAdminClient>;

export async function restaurantForStaff(
  supabase: Db,
  restaurantId: string,
  userId: string,
) {
  const { data: member, error: memberError } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id,role")
    .eq("restaurant_id", restaurantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member)
    throw new ApiError(
      403,
      "Acesso ao restaurante negado.",
      "RESTAURANT_FORBIDDEN",
    );
  return member;
}

export async function deliveryDistance(
  supabase: Db,
  restaurantId: string,
  address: z.infer<typeof addressSchema>,
) {
  const { data: restaurant, error } = await supabase
    .from("restaurants")
    .select(
      "id,name,address,latitude,longitude,status,accepting_orders,preparation_minutes,minimum_order_cents,opens_at,closes_at",
    )
    .eq("id", restaurantId)
    .maybeSingle();
  if (error) throw error;
  if (
    !restaurant ||
    restaurant.status !== "approved" ||
    !restaurant.accepting_orders ||
    !isWithinRestaurantHours(restaurant.opens_at, restaurant.closes_at)
  )
    throw new ApiError(
      409,
      "Restaurante indisponível.",
      "RESTAURANT_UNAVAILABLE",
    );
  const route = await calculateRoute(
    { lat: restaurant.latitude, lng: restaurant.longitude },
    { lat: address.lat, lng: address.lng },
  );
  return { restaurant, route };
}

export async function deliverySettings(supabase: Db) {
  const { data, error } = await supabase
    .from("delivery_settings")
    .select(
      "enabled,cash_enabled,card_on_delivery_enabled,minimum_fee_cents,per_km_cents,max_distance_meters",
    )
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw error;
  if (
    !data?.enabled ||
    data.minimum_fee_cents === null ||
    data.per_km_cents === null ||
    data.max_distance_meters === null
  )
    throw new ApiError(
      503,
      "Entrega de restaurantes ainda não configurada.",
      "DELIVERY_NOT_CONFIGURED",
    );
  return data;
}

export function deliveryFeeCents(
  distanceMeters: number,
  settings: {
    minimum_fee_cents: number;
    per_km_cents: number;
    max_distance_meters: number;
  },
) {
  if (distanceMeters <= 0 || distanceMeters > settings.max_distance_meters)
    throw new ApiError(
      422,
      "Endereço fora da área de atendimento.",
      "OUTSIDE_DELIVERY_AREA",
    );
  return Math.max(
    settings.minimum_fee_cents,
    Math.ceil((distanceMeters * settings.per_km_cents) / 1000),
  );
}
