import { createSupabaseAdminClient } from "@/lib/supabase/server";

const headers = { "cache-control": "no-store, max-age=0" };

export async function GET() {
  try {
    const client = createSupabaseAdminClient();
    const { error } = await client.from("system_settings").select("key", { count: "exact", head: true });
    if (error) return Response.json({ connected: false, schemaReady: false, service: "supabase" }, { status: 503, headers });
    return Response.json({ connected: true, schemaReady: true, service: "supabase" }, { headers });
  } catch {
    return Response.json({ connected: false, schemaReady: false, service: "supabase" }, { status: 503, headers });
  }
}
