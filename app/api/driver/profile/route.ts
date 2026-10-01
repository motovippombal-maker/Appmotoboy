import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { saveDriverVehicle, vehicleSchema } from "@/lib/backend/driver-vehicle";

const fieldsSchema = z.object({
  fullName: z.string().trim().min(3, "Informe o nome completo.").max(100),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{10,20}$/, "Telefone inválido."),
}).merge(vehicleSchema);

const avatarTypes: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function ensureAvatarBucket(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"]) {
  const existing = await supabase.storage.getBucket("driver-avatars");
  if (!existing.error) return;
  const created = await supabase.storage.createBucket("driver-avatars", { public: false, fileSizeLimit: 2 * 1024 * 1024, allowedMimeTypes: Object.keys(avatarTypes) });
  if (created.error && !created.error.message.toLowerCase().includes("already")) throw created.error;
}

async function signedAvatar(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], path?: string | null) {
  if (!path) return null;
  const { data } = await supabase.storage.from("driver-avatars").createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    const [{ data: profile, error: profileError }, { data: driver, error: driverError }, { data: vehicle, error: vehicleError }] = await Promise.all([
      supabase.from("profiles").select("full_name, phone, avatar_url").eq("id", user.id).single(),
      supabase.from("drivers").select("approval_status, online, available, rating, trips_count").eq("profile_id", user.id).single(),
      supabase.from("vehicles").select("id, brand, model, color, plate, active").eq("driver_id", user.id).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (profileError || driverError || vehicleError) throw profileError || driverError || vehicleError;
    return Response.json({ profile: { ...profile, avatarUrl: await signedAvatar(supabase, profile.avatar_url) }, driver, vehicle });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["driver"]);
    await consumeRateLimit(supabase, `driver-profile:${user.id}`, 6, 60);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 3 * 1024 * 1024) throw new ApiError(413, "O cadastro enviado é muito grande.", "PAYLOAD_TOO_LARGE");
    const body = await request.formData();
    const input = fieldsSchema.parse({ fullName: body.get("fullName"), phone: body.get("phone"), brand: body.get("brand"), model: body.get("model"), color: body.get("color"), plate: body.get("plate") });
    const vehicleResult = await saveDriverVehicle(supabase, user.id, {
      brand: input.brand, model: input.model, color: input.color, plate: input.plate,
    }, { resubmitRejected: true });
    const avatar = body.get("avatar");
    let avatarPath: string | undefined;
    if (avatar instanceof File && avatar.size > 0) {
      const extension = avatarTypes[avatar.type];
      if (!extension) throw new ApiError(400, "Envie uma foto JPG, PNG ou WebP.", "INVALID_AVATAR_TYPE");
      if (avatar.size > 2 * 1024 * 1024) throw new ApiError(400, "A foto deve ter no máximo 2 MB.", "AVATAR_TOO_LARGE");
      await ensureAvatarBucket(supabase);
      avatarPath = `${user.id}/profile.${extension}`;
      const upload = await supabase.storage.from("driver-avatars").upload(avatarPath, new Uint8Array(await avatar.arrayBuffer()), { contentType: avatar.type, upsert: true });
      if (upload.error) throw upload.error;
    }
    const profileValues: Record<string, string> = { full_name: input.fullName, phone: input.phone };
    if (avatarPath) profileValues.avatar_url = avatarPath;
    const profileUpdate = await supabase.from("profiles").update(profileValues).eq("id", user.id);
    if (profileUpdate.error) throw profileUpdate.error;
    await audit(supabase, user.id, "driver.profile_submitted", "driver", user.id, { vehicleId: vehicleResult.vehicle.id });
    return Response.json({ vehicle: vehicleResult.vehicle, approvalStatus: vehicleResult.approvalStatus, avatarUrl: await signedAvatar(supabase, avatarPath) });
  } catch (error) { return jsonError(error); }
}
