import { z } from "zod";
import { normalizeBrazilianPhone } from "@/lib/auth/phone-identity";

export const RIDE_SERVICE_OPTIONS = [
  { id: "passenger", label: "Passageiro", description: "Vá de moto até o seu destino." },
  { id: "delivery", label: "Encomendas", description: "Envie documentos e pequenos volumes." },
  { id: "food", label: "Comida", description: "Peça a retirada de uma refeição já preparada." },
  { id: "market", label: "Mercado", description: "Receba suas compras já separadas." },
  { id: "pharmacy", label: "Farmácia", description: "Peça a retirada do seu pedido na farmácia." },
] as const;

export type RideServiceType = (typeof RIDE_SERVICE_OPTIONS)[number]["id"];
export type RideServiceDetails = {
  description?: string;
  recipientName?: string;
  recipientPhone?: string;
  pickupNotes?: string;
  dropoffNotes?: string;
};

export function getRideService(type?: string | null) {
  return RIDE_SERVICE_OPTIONS.find((service) => service.id === type) ?? RIDE_SERVICE_OPTIONS[0];
}

export function rideServiceOfferDetails(details?: RideServiceDetails | null): RideServiceDetails {
  if (!details) return {};
  return { description: details.description, pickupNotes: details.pickupNotes, dropoffNotes: details.dropoffNotes };
}

const optionalText = (limit: number) => z.string().trim().max(limit, `Use até ${limit} caracteres.`).transform((value) => value || undefined).optional();
const recipientPhone = z.string().trim().max(30, "Use até 30 caracteres no telefone.").transform((value, context) => {
  if (!value) return undefined;
  try {
    if (!/^\+?[\d\s().-]+$/.test(value)) throw new Error("Invalid phone characters");
    return normalizeBrazilianPhone(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Informe um telefone brasileiro válido com DDD." });
    return z.NEVER;
  }
}).optional();

const serviceInput = z.object({
  serviceType: z.enum(["passenger", "delivery", "food", "market", "pharmacy"]).default("passenger"),
  serviceDetails: z.object({
    description: optionalText(500),
    recipientName: optionalText(100),
    recipientPhone,
    pickupNotes: optionalText(300),
    dropoffNotes: optionalText(300),
  }).default({}),
}).superRefine((input, context) => {
  if (input.serviceType === "passenger") return;
  if (!input.serviceDetails.description || input.serviceDetails.description.length < 3)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["serviceDetails", "description"], message: "Descreva o que será transportado (mínimo de 3 caracteres)." });
  if (!input.serviceDetails.recipientName || input.serviceDetails.recipientName.length < 2)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["serviceDetails", "recipientName"], message: "Informe o nome de quem receberá a entrega." });
  if (!input.serviceDetails.recipientPhone)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["serviceDetails", "recipientPhone"], message: "Informe o telefone de quem receberá a entrega." });
});

// Dados de uma entrega anterior nunca acompanham uma solicitação de passageiro.
export const rideServiceSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  return input.serviceType === undefined || input.serviceType === "passenger"
    ? { ...input, serviceDetails: {} }
    : input;
}, serviceInput);
