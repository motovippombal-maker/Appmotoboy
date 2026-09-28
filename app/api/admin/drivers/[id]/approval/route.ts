import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";

const schema = z.object({ status: z.enum(["approved", "rejected", "blocked"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser(request, ["admin"]);
    await consumeRateLimit(supabase, `admin-driver-approval:${user.id}`, 30, 60);
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Motorista inválido.", "INVALID_DRIVER");
    const input = schema.parse(await request.json());
    const databaseStatus = input.status === "blocked" ? "suspended" : input.status;
    const update = input.status === "approved"
      ? { approval_status: databaseStatus, approved_at: new Date().toISOString(), online: false, available: false }
      : { approval_status: databaseStatus, approved_at: null, online: false, available: false };
    const { data: driver, error } = await supabase.from("drivers").update(update).eq("profile_id", id).select("profile_id, approval_status, approved_at").maybeSingle();
    if (error) throw error;
    if (!driver) throw new ApiError(404, "Motorista não encontrado.", "DRIVER_NOT_FOUND");
    const profileUpdate = await supabase.from("profiles").update({ blocked: input.status === "blocked" }).eq("id", id);
    if (profileUpdate.error) throw profileUpdate.error;
    await audit(supabase, user.id, `driver.${input.status}`, "driver", id);
    return Response.json({ driver });
  } catch (error) {
    return jsonError(error);
  }
}
