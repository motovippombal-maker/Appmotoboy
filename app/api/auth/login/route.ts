import { z } from "zod";
import { normalizeBrazilianPhone } from "@/lib/auth/phone-identity";
import {
  createSupabaseAuthClient,
  findUserEmailByPhone,
  invalidCredentials,
  publicSession,
  rateLimitAuth,
} from "@/lib/auth/server";
import { jsonError } from "@/lib/backend/api";

const schema = z.object({
  phone: z.string().trim().min(10).max(24),
  // Existing accounts may predate the current eight-character signup rule.
  password: z.string().min(1).max(128),
}).strict();

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const phone = normalizeBrazilianPhone(input.phone);
    const admin = await rateLimitAuth(request, phone, "login");
    const email = await findUserEmailByPhone(admin, phone);
    const auth = createSupabaseAuthClient();
    const { data, error } = await auth.auth.signInWithPassword({ email, password: input.password });
    if (error || !data.session || !data.user) throw invalidCredentials();
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("role,blocked").eq("id", data.user.id).single();
    if (profileError || !profile || profile.blocked) throw invalidCredentials();
    return Response.json({ session: publicSession(data.session), role: profile.role });
  } catch (error) {
    return jsonError(error);
  }
}
