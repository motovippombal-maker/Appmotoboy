import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/backend/errors";
import { marketplaceOperationEnvironment } from "@/lib/config/marketplace-operation-mode.mjs";

export async function marketplaceOperationState(supabase: SupabaseClient): Promise<"enabled" | "disabled" | "unavailable"> {
  const config = marketplaceOperationEnvironment();
  if (!config) return "disabled";
  try {
    const { data, error } = await supabase.rpc("market_confirm_operation_environment", {
      p_environment_id: config.environmentId,
      p_operation_mode: config.operationMode,
    });
    // Prior schema: expected during rollout, with no writes enabled.
    if (error?.code === "PGRST202" || error?.code === "42883") return "disabled";
    return error ? "unavailable" : data === true ? "enabled" : "disabled";
  } catch { return "unavailable"; }
}

export async function marketplaceOperationsEnabled(supabase: SupabaseClient) {
  return await marketplaceOperationState(supabase) === "enabled";
}

export async function requireMarketplaceOperations(supabase: SupabaseClient) {
  if (!await marketplaceOperationsEnabled(supabase))
    throw new ApiError(503, "Operações de Compras estão temporariamente indisponíveis.", "MARKETPLACE_OPERATIONS_PAUSED");
}
