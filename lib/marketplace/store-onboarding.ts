import { z } from "zod";
import { ApiError } from "@/lib/backend/errors";

export const storeOnboardingInput = z.object({
  idempotencyKey: z.string().uuid(),
  slug: z.string().trim().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).default(""),
  category: z.string().trim().min(2).max(60),
  pickup: z.object({
    address: z.string().trim().min(5).max(240),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }).strict(),
}).strict();

export type StoreOnboardingInput = z.infer<typeof storeOnboardingInput>;

export const storeOnboardingResult = z.object({
  storeId: z.string().uuid(),
  slug: z.string(),
  status: z.enum(["pending", "approved", "suspended"]),
  active: z.boolean(),
  reused: z.boolean(),
});
export type StoreOnboardingResult = z.infer<typeof storeOnboardingResult>;

export function throwStoreOnboardingError(error: { code?: string; message?: string }) {
  if (["PGRST202", "42883"].includes(error.code ?? ""))
    throw new ApiError(503, "O cadastro de lojas ainda não está disponível neste ambiente.", "MARKET_ONBOARDING_NOT_CONFIGURED");
  if (error.code === "42501" || error.message?.includes("MARKET_FORBIDDEN"))
    throw new ApiError(403, "Sua conta não pode acessar este cadastro de loja.", "MARKET_FORBIDDEN");
  if (error.message?.includes("MARKET_REGISTRATION_CONFLICT"))
    throw new ApiError(409, "Esta tentativa já foi usada com outros dados. Atualize o painel e consulte suas lojas antes de tentar novamente.", "MARKET_REGISTRATION_CONFLICT");
  if (error.code === "23505" || error.message?.includes("MARKET_SLUG_UNAVAILABLE"))
    throw new ApiError(409, "Esse endereço da loja já está em uso. Escolha outro identificador.", "MARKET_SLUG_UNAVAILABLE");
  if (error.message?.includes("MARKET_REGISTRATION_INVALID") || ["22023", "22P02", "23514"].includes(error.code ?? ""))
    throw new ApiError(422, "Revise os dados e a localização da sua loja.", "MARKET_REGISTRATION_INVALID");
  throw new ApiError(503, "Não foi possível confirmar o cadastro agora. Consulte suas lojas antes de reenviar.", "MARKET_REGISTRATION_UNAVAILABLE");
}
