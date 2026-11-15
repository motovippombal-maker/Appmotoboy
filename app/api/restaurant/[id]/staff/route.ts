import { z } from "zod";
import {
  ApiError,
  audit,
  consumeRateLimit,
  jsonError,
  requireUser,
} from "@/lib/backend/api";
import { normalizeBrazilianPhone } from "@/lib/auth/phone-identity";
import { resolvePhoneIdentity } from "@/lib/auth/phone-lookup";
import { restaurantForStaff } from "@/lib/delivery/server";

async function access(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser(request);
  const restaurantId = z
    .string()
    .uuid()
    .parse((await context.params).id);
  const member = await restaurantForStaff(
    auth.supabase,
    restaurantId,
    auth.user.id,
  );
  return { ...auth, restaurantId, member };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, restaurantId, member } = await access(request, context);
    const { data, error } = await supabase
      .from("restaurant_staff")
      .select("user_id,role,created_at,profiles(full_name,phone)")
      .eq("restaurant_id", restaurantId)
      .order("created_at");
    if (error) throw error;
    return Response.json({ staff: data || [], myRole: member.role });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user, restaurantId, member } = await access(
      request,
      context,
    );
    if (member.role !== "owner")
      throw new ApiError(
        403,
        "Somente o proprietário pode convidar funcionários.",
        "OWNER_ONLY",
      );
    await consumeRateLimit(supabase, `restaurant-staff:${user.id}`, 10, 3600);
    const input = z
      .object({
        phone: z.string().trim().min(10).max(24),
        role: z.enum(["manager", "staff"]),
      })
      .parse(await request.json());
    let phone: string;
    try {
      phone = normalizeBrazilianPhone(input.phone);
    } catch {
      throw new ApiError(
        400,
        "Informe um telefone brasileiro válido com DDD.",
        "INVALID_PHONE",
      );
    }
    const identity = await resolvePhoneIdentity(supabase, phone);
    if (!identity)
      throw new ApiError(
        404,
        "Esta pessoa precisa criar uma conta MotoPombal antes de entrar na equipe.",
        "USER_NOT_FOUND",
      );
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id,blocked")
      .eq("id", identity.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.blocked)
      throw new ApiError(
        403,
        "Conta indisponível para a equipe.",
        "USER_UNAVAILABLE",
      );
    const { error } = await supabase
      .from("restaurant_staff")
      .insert({
        restaurant_id: restaurantId,
        user_id: identity.id,
        role: input.role,
      });
    if (error?.code === "23505")
      throw new ApiError(
        409,
        "Esta pessoa já integra a equipe.",
        "STAFF_EXISTS",
      );
    if (error) throw error;
    await audit(
      supabase,
      user.id,
      "restaurant.staff_added",
      "restaurant",
      restaurantId,
      { staff_id: identity.id, role: input.role },
    );
    return Response.json({ added: true }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user, restaurantId, member } = await access(
      request,
      context,
    );
    if (member.role !== "owner")
      throw new ApiError(
        403,
        "Somente o proprietário pode remover funcionários.",
        "OWNER_ONLY",
      );
    const { userId } = z
      .object({ userId: z.string().uuid() })
      .parse(await request.json());
    const { data, error } = await supabase
      .from("restaurant_staff")
      .delete()
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .neq("role", "owner")
      .select("user_id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new ApiError(404, "Funcionário não encontrado.", "STAFF_NOT_FOUND");
    await audit(
      supabase,
      user.id,
      "restaurant.staff_removed",
      "restaurant",
      restaurantId,
      { staff_id: userId },
    );
    return Response.json({ removed: true });
  } catch (error) {
    return jsonError(error);
  }
}
