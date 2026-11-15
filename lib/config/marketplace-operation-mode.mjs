import { parseSupabaseUrl } from "./public-site-url.mjs";

/** Validate the deployment-side opt-in. The database must also authorize it. */
export function marketplaceOperationEnvironment(env = process.env) {
  const operationMode = env.MARKETPLACE_OPERATION_MODE;
  if (operationMode !== "isolated_test" && operationMode !== "production") return null;
  const production = operationMode === "production";
  if (production) {
    if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production" || env.VERCEL_TARGET_ENV !== "production") return null;
  } else if ((env.VERCEL_ENV && !["preview", "development"].includes(env.VERCEL_ENV)) ||
    env.VERCEL_TARGET_ENV === "production") return null;

  const environmentId = (production ? env.MARKETPLACE_PRODUCTION_ENVIRONMENT_ID : env.MARKETPLACE_TEST_ENVIRONMENT_ID)?.trim().toLowerCase();
  if (!environmentId || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(environmentId)) return null;
  try {
    const target = parseSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
    const expected = parseSupabaseUrl(production ? env.MARKETPLACE_PRODUCTION_SUPABASE_URL : env.MARKETPLACE_TEST_SUPABASE_URL);
    if (target !== expected) return null;
    const otherUrl = production ? env.MARKETPLACE_TEST_SUPABASE_URL : env.MARKETPLACE_PRODUCTION_SUPABASE_URL;
    const otherId = production ? env.MARKETPLACE_TEST_ENVIRONMENT_ID : env.MARKETPLACE_PRODUCTION_ENVIRONMENT_ID;
    if (otherId?.trim().toLowerCase() === environmentId || (otherUrl?.trim() && parseSupabaseUrl(otherUrl) === target)) return null;
    return { environmentId, operationMode };
  } catch { return null; }
}
