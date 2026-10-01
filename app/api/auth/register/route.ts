import { z } from "zod";
import { normalizeBrazilianPhone, normalizeBrazilianPlate, phoneAuthEmail } from "@/lib/auth/phone-identity";
import { createSupabaseAuthClient, findProfileByPhone, publicSession, rateLimitAuth } from "@/lib/auth/server";
import { ApiError, jsonError } from "@/lib/backend/api";

const vehicle = z.object({
  plate: z.string().transform(normalizeBrazilianPlate).pipe(z.string().regex(/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/, "Informe uma placa válida.")),
  model: z.string().trim().min(2, "Informe o modelo da moto.").max(60),
  color: z.string().trim().min(2, "Informe a cor da moto.").max(30),
}).strict();

const schema = z.object({
  fullName: z.string().trim().min(3, "Informe seu nome completo.").max(100),
  phone: z.string().trim().min(10).max(24),
  password: z.string().min(8, "Use uma senha com pelo menos 8 caracteres.").max(128),
  role: z.enum(["passenger", "driver"]),
  vehicle: vehicle.optional(),
}).strict().superRefine((input, context) => {
  if (!input.fullName.trim().includes(" ")) context.addIssue({ code: "custom", path: ["fullName"], message: "Informe nome e sobrenome." });
  if (input.role === "driver" && !input.vehicle) context.addIssue({ code: "custom", path: ["vehicle"], message: "Preencha os dados da moto." });
  if (input.role === "passenger" && input.vehicle) context.addIssue({ code: "custom", path: ["vehicle"], message: "Dados de moto não são aceitos para passageiro." });
});

export async function POST(request: Request) {
  let createdUserId: string | null = null;
  try {
    const input = schema.parse(await request.json());
    const phone = normalizeBrazilianPhone(input.phone);
    const admin = await rateLimitAuth(request, phone, "register");
    const duplicatePhone = await findProfileByPhone(admin, phone);
    if (duplicatePhone) throw new ApiError(409, "Este celular já está cadastrado. Entre na sua conta.", "PHONE_ALREADY_REGISTERED");

    if (input.vehicle) {
      const { data: plate } = await admin.from("vehicles").select("id").eq("plate", input.vehicle.plate).maybeSingle();
      if (plate) throw new ApiError(409, "Esta placa já está cadastrada.", "PLATE_ALREADY_REGISTERED");
    }

    const email = phoneAuthEmail(phone);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      phone,
      password: input.password,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: input.fullName.trim(), phone, role: input.role },
    });
    if (createError || !created.user) {
      const duplicate = createError?.code === "email_exists" || /already|registered|exists/i.test(createError?.message || "");
      if (duplicate) throw new ApiError(409, "Este celular já está cadastrado. Entre na sua conta.", "PHONE_ALREADY_REGISTERED");
      throw createError || new Error("User creation failed");
    }
    createdUserId = created.user.id;

    if (input.role === "driver" && input.vehicle) {
      const { error: vehicleError } = await admin.from("vehicles").insert({
        driver_id: created.user.id,
        brand: "Não informado",
        model: input.vehicle.model,
        color: input.vehicle.color,
        plate: input.vehicle.plate,
      });
      if (vehicleError) throw vehicleError;
    }

    await admin.from("audit_logs").insert({
      actor_id: created.user.id,
      action: "auth.phone_registered",
      entity_type: "profile",
      entity_id: created.user.id,
      metadata: { role: input.role },
    });

    const auth = createSupabaseAuthClient();
    const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({ email, password: input.password });
    if (signInError || !signedIn.session) throw signInError || new Error("Session creation failed");
    return Response.json({ session: publicSession(signedIn.session), role: input.role }, { status: 201 });
  } catch (error) {
    if (createdUserId) {
      try {
        const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
        await createSupabaseAdminClient().auth.admin.deleteUser(createdUserId);
      } catch {
        // The original error is more useful; orphan cleanup can be audited separately.
      }
    }
    return jsonError(error);
  }
}
