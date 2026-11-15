import { consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { requireMarketplaceOperations } from "@/lib/backend/marketplace-operation-mode";
import { marketQuoteInput } from "@/lib/marketplace/customer-contract";
import { marketResponse, prepareMarketQuote } from "@/lib/marketplace/customer-server";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser(request, ["passenger"]);
    await requireMarketplaceOperations(supabase);
    await consumeRateLimit(supabase, `market-quote:${user.id}`, 12, 60);
    const input = marketQuoteInput.parse(await request.json());
    const { quote } = await prepareMarketQuote(supabase, user.id, input);
    return marketResponse({ quote });
  } catch (error) { return jsonError(error); }
}
