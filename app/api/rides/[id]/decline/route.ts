import { ApiError, audit, jsonError, requireUser } from "@/lib/backend/api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireUser(request, ["driver"]);
    const { data, error } = await supabase.from("ride_requests")
      .update({ status: "declined", responded_at: new Date().toISOString() })
      .eq("ride_id", id).eq("driver_id", user.id).eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(409, "Esta oferta não está mais disponível.", "OFFER_UNAVAILABLE");
    await audit(supabase, user.id, "ride.declined", "ride", id);
    return Response.json({ declined: true, rideId: id });
  } catch (error) { return jsonError(error); }
}
