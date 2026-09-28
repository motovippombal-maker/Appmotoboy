import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
const schema = z.object({ rideId: z.string().uuid(), score: z.number().int().min(1).max(5), comment: z.string().max(500).optional() });
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `rating:${user.id}`, 10, 60);
    const input = schema.parse(await request.json());
    const { data: ride } = await supabase.from("rides").select("passenger_id, driver_id, status").eq("id", input.rideId).single();
    if (!ride || ride.status !== "finalizada") throw new ApiError(409, "A corrida precisa estar finalizada para ser avaliada.", "RIDE_NOT_FINISHED");
    if (ride.passenger_id !== user.id || !ride.driver_id) throw new ApiError(403, "Somente o passageiro desta corrida pode avaliar o motorista.", "FORBIDDEN");
    const { error } = await supabase.from("ratings").insert({ ride_id: input.rideId, rater_id: user.id, rated_id: ride.driver_id, score: input.score, comment: input.comment });
    if (error?.code === "23505") throw new ApiError(409, "Esta corrida já foi avaliada.", "RATING_ALREADY_EXISTS");
    if (error) throw error;
    const { data: scores } = await supabase.from("ratings").select("score").eq("rated_id", ride.driver_id);
    if (scores?.length) await supabase.from("drivers").update({ rating: scores.reduce((sum, item) => sum + item.score, 0) / scores.length }).eq("profile_id", ride.driver_id);
    await audit(supabase, user.id, "ride.rated", "ride", input.rideId, { score: input.score });
    return Response.json({ rated: true });
  } catch (error) { return jsonError(error); }
}
