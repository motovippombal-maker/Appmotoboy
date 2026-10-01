import { z } from "zod";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";

const schema = z.object({
  fullName: z.string().trim().min(3, "Informe seu nome completo.").max(100),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{10,20}$/, "Telefone inválido."),
});
const avatarTypes: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
type Client = Awaited<ReturnType<typeof requireUser>>["supabase"];

async function signedAvatar(supabase: Client, path?: string | null) {
  if (!path) return null;
  const { data } = await supabase.storage.from("passenger-avatars").createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    const { data, error } = await supabase.from("profiles").select("full_name, phone, avatar_url").eq("id", user.id).single();
    if (error) throw error;
    return Response.json({ profile: { ...data, avatarUrl: await signedAvatar(supabase, data.avatar_url) } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await consumeRateLimit(supabase, `passenger-profile:${user.id}`, 6, 60);
    if (Number(request.headers.get("content-length") || 0) > 3 * 1024 * 1024) {
      throw new ApiError(413, "O cadastro enviado é muito grande.", "PAYLOAD_TOO_LARGE");
    }
    const body = await request.formData();
    const input = schema.parse({ fullName: body.get("fullName"), phone: body.get("phone") });
    const avatar = body.get("avatar");
    let avatarPath: string | undefined;
    if (avatar instanceof File && avatar.size > 0) {
      const extension = avatarTypes[avatar.type];
      if (!extension) throw new ApiError(400, "Envie uma foto JPG, PNG ou WebP.", "INVALID_AVATAR_TYPE");
      if (avatar.size > 2 * 1024 * 1024) throw new ApiError(400, "A foto deve ter no máximo 2 MB.", "AVATAR_TOO_LARGE");
      const bucket = await supabase.storage.getBucket("passenger-avatars");
      if (bucket.error) {
        const created = await supabase.storage.createBucket("passenger-avatars", {
          public: false, fileSizeLimit: 2 * 1024 * 1024, allowedMimeTypes: Object.keys(avatarTypes),
        });
        if (created.error && !created.error.message.toLowerCase().includes("already")) throw created.error;
      }
      avatarPath = `${user.id}/profile.${extension}`;
      const uploaded = await supabase.storage.from("passenger-avatars").upload(
        avatarPath, new Uint8Array(await avatar.arrayBuffer()), { contentType: avatar.type, upsert: true },
      );
      if (uploaded.error) throw uploaded.error;
    }
    const values: Record<string, string> = { full_name: input.fullName, phone: input.phone };
    if (avatarPath) values.avatar_url = avatarPath;
    const { error } = await supabase.from("profiles").update(values).eq("id", user.id);
    if (error) throw error;
    await audit(supabase, user.id, "passenger.profile_updated", "passenger", user.id, { photoChanged: Boolean(avatarPath) });
    return Response.json({ profile: { ...values, avatarUrl: await signedAvatar(supabase, avatarPath) } });
  } catch (error) { return jsonError(error); }
}
