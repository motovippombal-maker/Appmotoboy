import { consumeRateLimit, jsonError, requireAdmin } from "@/lib/backend/api";
import { applyManagementAction, findManagementMember, managementData } from "@/lib/backend/marketplace-management";
import { requireMarketplaceOperations } from "@/lib/backend/marketplace-operation-mode";
import { adminManagementAction } from "@/lib/marketplace/management";

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    const params = new URL(request.url).searchParams;
    const result = await managementData(auth, params.get("storeId"), true);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    await consumeRateLimit(auth.supabase, `market-admin:${auth.user.id}`, 45, 60);
    const input = adminManagementAction.parse(await request.json());
    if (input.action !== "findMember" && input.action !== "cashAction" &&
        !(input.action === "orderAction" && ["cancel", "reject"].includes(input.command)))
      await requireMarketplaceOperations(auth.supabase);
    const result = input.action === "findMember" ? await findManagementMember(auth, input.phone) : await applyManagementAction(auth, input);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}
