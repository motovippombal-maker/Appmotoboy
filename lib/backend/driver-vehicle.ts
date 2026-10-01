import { z } from "zod";
import { ApiError, audit } from "@/lib/backend/api";
import type { createSupabaseAdminClient } from "@/lib/supabase/server";

export const vehicleSchema = z.object({
  brand: z.string().trim().min(2).max(40),
  model: z.string().trim().min(2).max(60),
  color: z.string().trim().min(2).max(30),
  plate: z.string().trim().toUpperCase().regex(/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/, "Placa inválida."),
}).strict();

export async function saveDriverVehicle(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  driverId: string,
  input: z.infer<typeof vehicleSchema>,
  options: { resubmitRejected?: boolean } = {},
) {
  const { data: current, error: currentError } = await supabase.from("vehicles")
    .select("id,brand,model,color,plate,active")
    .eq("driver_id", driverId).eq("active", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (currentError) throw currentError;
  const changed = !current || ["brand", "model", "color", "plate"].some((key) =>
    current[key as keyof typeof input] !== input[key as keyof typeof input]);
  if (changed) {
    const { data: activeRide, error: rideError } = await supabase.from("rides")
      .select("id").eq("driver_id", driverId)
      .not("status", "in", "(finalizada,cancelada)").limit(1).maybeSingle();
    if (rideError) throw rideError;
    if (activeRide) throw new ApiError(409, "Conclua ou cancele a corrida antes de trocar a moto.", "ACTIVE_RIDE_IN_PROGRESS");
  }
  const mutation = changed
    ? current
      ? supabase.from("vehicles").update(input).eq("id", current.id).eq("driver_id", driverId).select("id,brand,model,color,plate,active").single()
      : supabase.from("vehicles").insert({ ...input, driver_id: driverId }).select("id,brand,model,color,plate,active").single()
    : Promise.resolve({ data: current, error: null });
  const { data: vehicle, error } = await mutation;
  if (error || !vehicle) throw error || new Error("Vehicle update failed");
  if (changed) await audit(supabase, driverId, current ? "vehicle.updated" : "vehicle.created", "vehicle", vehicle.id);
  const { data: driver, error: driverError } = await supabase.from("drivers")
    .select("approval_status").eq("profile_id", driverId).single();
  if (driverError) throw driverError;
  if (options.resubmitRejected && driver.approval_status === "rejected") {
    const { error: reviewError } = await supabase.from("drivers")
      .update({ approval_status: "pending", approved_at: null, online: false, available: false })
      .eq("profile_id", driverId);
    if (reviewError) throw reviewError;
    await audit(supabase, driverId, "driver.review_requested", "driver", driverId);
    return { vehicle, approvalStatus: "pending", changed };
  }
  return { vehicle, approvalStatus: driver.approval_status as string, changed };
}
