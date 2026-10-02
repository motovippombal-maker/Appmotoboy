import { z } from "zod";
import { ApiError, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";

const schema = z.object({ reason: z.string().trim().min(3).max(300) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const { supabase, user, profile } = await requireUser(request, ["driver"], { allowBlocked: true });
    if (profile.blocked) throw new ApiError(403, "Conta bloqueada.", "ACCOUNT_BLOCKED");
    await consumeRateLimit(supabase, `ride-early-end:${user.id}`, 10, 60);
    const { data: ride, error } = await supabase.rpc("end_ride_early", {
      p_ride_id: id, p_driver_id: user.id, p_reason: input.reason,
    });
    if (error) throw error;
    if (!ride) throw new ApiError(409, "A viagem não está em andamento ou mudou de motorista.", "RIDE_STATE_CHANGED");
    return Response.json({ ride });
  } catch (error) { return jsonError(error); }
}
