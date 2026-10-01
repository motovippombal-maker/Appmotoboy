import { z } from "zod";

export const cancellationPolicySchema = z.object({
  fee_active: z.boolean(),
  free_seconds: z.number().int().min(0).max(3600),
  minimum_travel_meters: z.number().int().min(50).max(5000),
  fee_cents: z.number().int().min(0).max(100000),
  after_arrival_fee_cents: z.number().int().min(0).max(100000),
  arrival_radius_meters: z.number().int().min(50).max(250),
  no_show_seconds: z.number().int().min(60).max(3600),
  preserve_queue_on_passenger_cancel: z.boolean(),
});

export type CancellationPolicy = z.infer<typeof cancellationPolicySchema>;

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  fee_active: false,
  free_seconds: 120,
  minimum_travel_meters: 250,
  fee_cents: 500,
  after_arrival_fee_cents: 500,
  arrival_radius_meters: 130,
  no_show_seconds: 300,
  preserve_queue_on_passenger_cancel: true,
};

export function parseCancellationPolicy(value: unknown): CancellationPolicy {
  return cancellationPolicySchema.parse(value || DEFAULT_CANCELLATION_POLICY);
}
