import { consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { applyManagementAction, managementData } from "@/lib/backend/marketplace-management";
import { requireMarketplaceOperations } from "@/lib/backend/marketplace-operation-mode";
import { merchantManagementAction } from "@/lib/marketplace/management";

export async function GET(request: Request) {
  try {
    const auth = await requireUser(request);
    const storeId = new URL(request.url).searchParams.get("storeId");
    return Response.json(await managementData(auth, storeId, false), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser(request);
    await consumeRateLimit(auth.supabase, `market-merchant:${auth.user.id}`, 40, 60);
    const input = merchantManagementAction.parse(await request.json());
    if (input.action !== "cashAction" && !(input.action === "orderAction" && ["cancel", "reject"].includes(input.command)))
      await requireMarketplaceOperations(auth.supabase);
    return Response.json(await applyManagementAction(auth, input), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}
