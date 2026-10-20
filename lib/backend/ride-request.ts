import { z } from "zod";
import { rideServiceSchema } from "@/lib/ride-service";

const address = z.object({
  address: z.string().min(3).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const rideRequestSchema = z.object({
  origin: address,
  destination: address,
  paymentMethod: z.enum(["pix", "cash"]).default("cash"),
  couponCode: z.string().trim().min(3).max(24).optional(),
  quoteToken: z.string().min(40).max(5000),
}).and(rideServiceSchema);

export type RideRequestInput = {
  origin: z.input<typeof address>;
  destination: z.input<typeof address>;
  paymentMethod?: "pix" | "cash";
  couponCode?: string;
  quoteToken: string;
  serviceType?: import("@/lib/ride-service").RideServiceType;
  serviceDetails?: import("@/lib/ride-service").RideServiceDetails;
};

export function isRideServiceMigrationMissing(error: { code?: string; message?: string } | null) {
  return Boolean(error && ["42703", "PGRST204"].includes(error.code ?? "") && /service_(type|details)/i.test(error.message ?? ""));
}
