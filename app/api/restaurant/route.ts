import { z } from "zod";
import {
  ApiError,
  audit,
  consumeRateLimit,
  jsonError,
  requireUser,
} from "@/lib/backend/api";
import { restaurantSchema } from "@/lib/delivery/schemas";
import { restaurantForStaff } from "@/lib/delivery/server";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request);
    const { data: memberships, error } = await supabase
      .from("restaurant_staff")
      .select("restaurant_id,role")
      .eq("user_id", user.id);
    if (error) throw error;
    const ids = (memberships || []).map((member) => member.restaurant_id);
    if (!ids.length) return Response.json({ restaurants: [] });
    const { data, error: restaurantsError } = await supabase
      .from("restaurants")
      .select(
        "id,name,status,accepting_orders,address,cuisine,logo_url,cover_url,preparation_minutes,minimum_order_cents,opens_at,closes_at,created_at",
      )
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (restaurantsError) throw restaurantsError;
    return Response.json({ restaurants: data || [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request);
    await consumeRateLimit(supabase, `restaurant-apply:${user.id}`, 3, 86400);
    const input = restaurantSchema.parse(await request.json());
    const { data, error } = await supabase
      .from("restaurants")
      .insert({
        owner_id: user.id,
        name: input.name,
        responsible_name: input.responsibleName,
        phone: input.phone,
        whatsapp: input.whatsapp || null,
        document: input.document || null,
        description: input.description || null,
        cuisine: input.cuisine,
        address: input.address,
        latitude: input.latitude,
        longitude: input.longitude,
        city: input.city,
        state: input.state,
        preparation_minutes: input.preparationMinutes,
        minimum_order_cents: input.minimumOrderCents,
        opens_at: input.opensAt || null,
        closes_at: input.closesAt || null,
        status: "pending",
        accepting_orders: false,
      })
      .select("id,name,status")
      .single();
    if (error) throw error;
    await audit(supabase, user.id, "restaurant.applied", "restaurant", data.id);
    return Response.json({ restaurant: data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser(request);
    const input = z
      .object({ restaurantId: z.string().uuid(), acceptingOrders: z.boolean() })
      .parse(await request.json());
    const member = await restaurantForStaff(
      supabase,
      input.restaurantId,
      user.id,
    );
    if (member.role === "staff")
      throw new ApiError(
        403,
        "Apenas proprietário ou gerente pode alterar a operação.",
        "FORBIDDEN",
      );
    const { data, error } = await supabase
      .from("restaurants")
      .update({ accepting_orders: input.acceptingOrders })
      .eq("id", input.restaurantId)
      .eq("status", "approved")
      .select("id,accepting_orders")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new ApiError(
        409,
        "Restaurante ainda não aprovado.",
        "RESTAURANT_NOT_APPROVED",
      );
    await audit(
      supabase,
      user.id,
      "restaurant.availability_changed",
      "restaurant",
      input.restaurantId,
      { accepting_orders: input.acceptingOrders },
    );
    return Response.json({ restaurant: data });
  } catch (error) {
    return jsonError(error);
  }
}
