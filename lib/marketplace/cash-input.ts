import { z } from "zod";
import { MAX_MARKET_CASH_CENTS } from "./cash-reconciliation";

export const marketCashAmount = z.number().int().min(0).max(MAX_MARKET_CASH_CENTS);
export const marketCashReference = z.string().trim().min(3).max(120);
export const marketCashReceiptInput = z.object({
  amountCents: marketCashAmount,
  reference: marketCashReference.optional(),
  note: z.string().trim().max(300).optional(),
}).strict();
