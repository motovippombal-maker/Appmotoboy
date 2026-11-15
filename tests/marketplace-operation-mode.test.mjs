import assert from "node:assert/strict";
import test from "node:test";
import { marketplaceOperationEnvironment } from "../lib/config/marketplace-operation-mode.mjs";

const id = "794382dd-bec6-4420-9745-56c27410e718";
const isolated = {
  VERCEL_ENV: "preview",
  MARKETPLACE_OPERATION_MODE: "isolated_test",
  MARKETPLACE_TEST_SUPABASE_URL: "https://audit-lab.supabase.co/",
  NEXT_PUBLIC_SUPABASE_URL: "https://audit-lab.supabase.co",
  MARKETPLACE_TEST_ENVIRONMENT_ID: id,
};
const prodId = "b89e3c1c-0f95-424a-90b4-07ee3317ffaa";
const production = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_TARGET_ENV: "production",
  MARKETPLACE_OPERATION_MODE: "production",
  MARKETPLACE_PRODUCTION_SUPABASE_URL: "https://confirmed-project.supabase.co/",
  NEXT_PUBLIC_SUPABASE_URL: "https://confirmed-project.supabase.co",
  MARKETPLACE_PRODUCTION_ENVIRONMENT_ID: prodId,
};

test("preview só reconhece URL HTTPS dedicada correspondente e declaração explícita", () => {
  assert.deepEqual(marketplaceOperationEnvironment(isolated), { environmentId: id, operationMode: "isolated_test" });
  for (const changes of [
    { NEXT_PUBLIC_SUPABASE_URL: "https://unverified-project.supabase.co" },
    { MARKETPLACE_TEST_SUPABASE_URL: "http://audit-lab.supabase.co" },
    { MARKETPLACE_TEST_SUPABASE_URL: "https://audit-lab.supabase.co/rest/v1" },
    { MARKETPLACE_TEST_ENVIRONMENT_ID: "" },
    { MARKETPLACE_OPERATION_MODE: "live" },
    { MARKETPLACE_OPERATION_MODE: undefined },
    { MARKETPLACE_PRODUCTION_SUPABASE_URL: isolated.NEXT_PUBLIC_SUPABASE_URL },
    { MARKETPLACE_PRODUCTION_ENVIRONMENT_ID: id },
  ]) assert.equal(marketplaceOperationEnvironment({ ...isolated, ...changes }), null);
  assert.equal(marketplaceOperationEnvironment({}), null);
});

test("produção e Preview nunca se habilitam com as configurações do outro ambiente", () => {
  assert.equal(marketplaceOperationEnvironment({ ...isolated, VERCEL_ENV: "production" }), null);
  assert.equal(marketplaceOperationEnvironment({ ...isolated, VERCEL_TARGET_ENV: "production" }), null);
  assert.equal(marketplaceOperationEnvironment({ ...isolated, VERCEL_ENV: "unknown" }), null);
  assert.equal(marketplaceOperationEnvironment({ ...production, VERCEL_ENV: "preview" }), null);
  assert.equal(marketplaceOperationEnvironment({ ...production, VERCEL_TARGET_ENV: "pilot" }), null);
});

test("produção precisa de Vercel Production, modo explícito e destino e identificador correspondentes", () => {
  assert.deepEqual(marketplaceOperationEnvironment(production), { environmentId: prodId, operationMode: "production" });
  for (const changes of [
    { VERCEL: undefined },
    { VERCEL_TARGET_ENV: undefined },
    { MARKETPLACE_OPERATION_MODE: undefined },
    { MARKETPLACE_PRODUCTION_ENVIRONMENT_ID: undefined },
    { MARKETPLACE_PRODUCTION_SUPABASE_URL: "https://another-project.supabase.co" },
    { MARKETPLACE_TEST_SUPABASE_URL: production.NEXT_PUBLIC_SUPABASE_URL },
    { MARKETPLACE_TEST_ENVIRONMENT_ID: prodId },
  ]) assert.equal(marketplaceOperationEnvironment({ ...production, ...changes }), null);
});
