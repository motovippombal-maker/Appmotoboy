import { z } from "zod";
import { ApiError } from "@/lib/backend/errors";
import { normalizeBrazilianPhone } from "@/lib/auth/phone-identity";

export const brazilianPhoneSchema = z.string().trim().min(10).max(24).transform((value, context) => {
  try {
    if (!/^\+?[\d\s().-]+$/.test(value)) throw new Error("Invalid phone characters");
    return normalizeBrazilianPhone(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Informe um telefone brasileiro válido com DDD." });
    return z.NEVER;
  }
});

export function profilePhoneError(error: { code?: string; message?: string; details?: string } | null) {
  if (error?.code === "23505" && /profiles_phone_|Telefone (?:reservado|já cadastrado)/i.test(`${error.message ?? ""} ${error.details ?? ""}`))
    return new ApiError(409, "Este telefone já está vinculado a outra conta.", "PHONE_ALREADY_REGISTERED");
  return error;
}
