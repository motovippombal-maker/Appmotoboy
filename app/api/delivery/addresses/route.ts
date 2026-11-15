import { z } from "zod";
import {
  ApiError,
  consumeRateLimit,
  jsonError,
  requireUser,
} from "@/lib/backend/api";
import { addressSchema } from "@/lib/delivery/schemas";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const { data, error } = await supabase
      .from("food_saved_addresses")
      .select("id,label,address,created_at")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    return Response.json({ addresses: data || [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `food-address:${user.id}`, 20, 3600);
    const { label, address } = z
      .object({
        label: z.string().trim().min(2).max(50),
        address: addressSchema,
      })
      .parse(await request.json());
    const { count, error: countError } = await supabase
      .from("food_saved_addresses")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", user.id);
    if (countError) throw countError;
    if ((count || 0) >= 10)
      throw new ApiError(
        409,
        "Limite de 10 endereços salvos atingido.",
        "ADDRESS_LIMIT",
      );
    const { data, error } = await supabase
      .from("food_saved_addresses")
      .insert({ customer_id: user.id, label, address })
      .select("id,label,address,created_at")
      .single();
    if (error) throw error;
    return Response.json({ address: data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const { id } = z
      .object({ id: z.string().uuid() })
      .parse(await request.json());
    const { data, error } = await supabase
      .from("food_saved_addresses")
      .delete()
      .eq("id", id)
      .eq("customer_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new ApiError(404, "Endereço não encontrado.", "ADDRESS_NOT_FOUND");
    return Response.json({ removed: true });
  } catch (error) {
    return jsonError(error);
  }
}
