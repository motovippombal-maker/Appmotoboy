import { z } from "zod";
import { ApiError, consumeRateLimit, jsonError, requireAdmin } from "@/lib/backend/api";

const schema = z.object({ status: z.enum(["approved", "rejected", "blocked", "pending"]) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireAdmin(request);
    await consumeRateLimit(supabase, `admin-driver-approval:${user.id}`, 30, 60);
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Motorista inválido.", "INVALID_DRIVER");
    const input = schema.parse(await request.json());
    const { data: driver, error } = await supabase.rpc("admin_set_driver_approval", {
      p_driver_id: id, p_actor_id: user.id, p_status: input.status,
    });
    if (error) throw new ApiError(409, "Não foi possível alterar o motorista. Verifique o estado atual.", "DRIVER_APPROVAL_FAILED");
    return Response.json({ driver });
  } catch (error) {
    return jsonError(error);
  }
}
