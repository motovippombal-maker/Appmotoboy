import { jsonError, requireUser } from "@/lib/backend/api";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser(request, ["admin"]);
    const { data, error } = await supabase
      .from("drivers")
      .select("profile_id, approval_status, online, available, rating, trips_count, created_at, profiles(full_name, phone, avatar_url, blocked), vehicles(id, brand, model, color, plate, active)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const drivers = await Promise.all((data || []).map(async (driver) => {
      const profile = Array.isArray(driver.profiles) ? driver.profiles[0] : driver.profiles;
      let avatarUrl: string | null = null;
      if (profile?.avatar_url) {
        const signed = await supabase.storage.from("driver-avatars").createSignedUrl(profile.avatar_url, 1800);
        avatarUrl = signed.data?.signedUrl || null;
      }
      return { ...driver, profiles: profile ? { ...profile, avatarUrl } : null };
    }));
    return Response.json({ drivers });
  } catch (error) {
    return jsonError(error);
  }
}
