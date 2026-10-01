import { consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { saveDriverVehicle, vehicleSchema } from "@/lib/backend/driver-vehicle";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    await consumeRateLimit(supabase, `driver-vehicle:${user.id}`, 6, 60);
    const input = vehicleSchema.parse(await request.json());
    const result = await saveDriverVehicle(supabase, user.id, input);
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
