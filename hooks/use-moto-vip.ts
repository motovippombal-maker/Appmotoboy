"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/supabase/auth-errors";

export type Profile = { id: string; role: "passenger" | "driver" | "admin"; full_name: string; phone?: string; avatar_url?: string; blocked: boolean };
export type Ride = { id: string; passenger_id: string; driver_id?: string; status: string; origin_address: string; origin_lat: number; origin_lng: number; destination_address: string; destination_lat: number; destination_lng: number; distance_meters: number; duration_seconds: number; route_geometry?: string; fare_cents: number; estimated_distance_meters?: number; estimated_duration_seconds?: number; estimated_fare_cents?: number; tracked_distance_meters?: number; actual_distance_meters?: number; actual_duration_seconds?: number; final_fare_cents?: number; fare_region_id?: string; fare_region_name?: string; fare_pricing_mode?: "distance" | "region"; started_at?: string; completed_at?: string; created_at: string; payment_method: string; payment_status: string; driver?: { profile_id: string; rating: number; profiles?: { full_name: string; phone?: string; avatar_url?: string }; vehicles?: Array<{ brand: string; model: string; color: string; plate: string }> }; passenger?: { full_name: string; phone?: string } };
export type RideOffer = { id: string; ride_id: string; expires_at: string; passenger_name: string; distance_to_pickup_meters: number | null; ride: Ride };
export type NearbyDriver = { markerId: string; latitude: number; longitude: number; distanceMeters: number };
export type DriverLocation = { lat: number; lng: number; accuracyMeters?: number; updatedAt: string; distanceToOriginMeters?: number };
export type Vehicle = { id?: string; brand: string; model: string; color: string; plate: string; active?: boolean };
export type DriverState = { approval_status: string; online: boolean; available: boolean; rating: number; trips_count: number; vehicles?: Vehicle[] };
export type AdminDriver = { profile_id: string; approval_status: string; online: boolean; available: boolean; rating: number; trips_count: number; created_at: string; profiles?: { full_name: string; phone?: string; avatar_url?: string; avatarUrl?: string; blocked?: boolean } | null; vehicles?: Vehicle[] };
export type AdminStats = { ridesToday: number; driversOnline: number; driversAvailable: number; averageWaitMinutes: number; revenueCents: number; recentRides: Ride[]; drivers: AdminDriver[] };
export type FareConfig = { baseCents: number; perKmCents: number; perMinuteCents: number; minimumCents: number; configured: boolean };
export type FareRegion = { id: string; name: string; amount_cents: number; active: boolean; is_default: boolean; updated_at: string };
export type QuickPlace = { id: string; name: string; address: string; latitude: number; longitude: number; category: "hospital" | "education" | "bus_station" | "government" | "market" | "pharmacy" | "square" | "fuel" | "bank" | "atm" | "restaurant" | "hotel" | "church" | "sports" | "gym" | "store" | "moto_vip" | "generic"; icon: "hospital" | "education" | "bus" | "government" | "market" | "pharmacy" | "square" | "fuel" | "bank" | "atm" | "restaurant" | "hotel" | "church" | "sports" | "gym" | "store" | "bike" | "pin"; color: string; active: boolean; featured: boolean; sort_order: number; created_at?: string; updated_at: string };
export type PaymentSummary = { ride_id?: string; id?: string; method: string; status: string; amount_cents: number; paid_at?: string | null; provider?: string | null; pix_transactions?: Array<{ qr_code?: string; qr_code_image_url?: string; expires_at?: string }> };
export type HistoryRide = Ride & { driver_name?: string | null; passenger_name?: string | null; rating?: { score: number; comment?: string; created_at: string } | null; payment?: PaymentSummary | null };
export type DriverHistory = { rides: HistoryRide[]; totals: { dayCents: number; weekCents: number; monthCents: number; commissionConfigured: boolean } };
export type NotificationItem = { id: string; type: string; title: string; body: string; data: Record<string, unknown>; read_at?: string | null; created_at: string };
export type AdminFinance = { period: { from: string; to: string }; summary: { completedRides: number; cancellations: number; grossCents: number; pixPaidCents: number; pendingCents: number }; commission: { configured?: boolean; percentage_bps?: number; fixed_cents?: number }; byDriver: Array<{ driverId: string; driverName: string; rides: number; grossCents: number; paidCents: number; pendingCents: number }> };

export function useMotoVip() {
  const supabase = getSupabaseBrowserClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [completedRide, setCompletedRide] = useState<Ride | null>(null);
  const [offers, setOffers] = useState<RideOffer[]>([]);
  const [driverState, setDriverState] = useState<DriverState | null>(null);
  const [driverAvatarUrl, setDriverAvatarUrl] = useState<string | null>(null);
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [fareConfig, setFareConfig] = useState<FareConfig | null>(null);
  const [fareRegions, setFareRegions] = useState<FareRegion[]>([]);
  const [quickPlaces, setQuickPlaces] = useState<QuickPlace[]>([]);
  const [quickPlacesLoading, setQuickPlacesLoading] = useState(true);
  const [quickPlacesError, setQuickPlacesError] = useState<string | null>(null);
  const [passengerHistory, setPassengerHistory] = useState<HistoryRide[]>([]);
  const [driverHistory, setDriverHistory] = useState<DriverHistory | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [adminFinance, setAdminFinance] = useState<AdminFinance | null>(null);
  const dismissedCompletedRide = useRef<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Sem conexão. Reconecte-se antes de continuar.");
    const current = (await supabase.auth.getSession()).data.session;
    if (!current) throw new Error("Entre na sua conta para continuar.");
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${current.access_token}`);
    if (init?.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
    let response: Response;
    try {
      response = await fetch(path, { ...init, headers, cache: "no-store" });
    } catch {
      throw new Error("Conexão interrompida. O estado real será sincronizado ao reconectar.");
    }
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload === "object" && payload !== null && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : "Não foi possível concluir a operação.";
      throw new Error(message);
    }
    return payload as T;
  }, [supabase]);

  const refresh = useCallback(async (currentSession: Session | null) => {
    setSession(currentSession); setError(null);
    if (!currentSession) { setProfile(null); setActiveRide(null); setCompletedRide(null); setOffers([]); setDriverState(null); setDriverAvatarUrl(null); setDriverLocation(null); setAdminStats(null); setFareConfig(null); setFareRegions([]); setQuickPlaces([]); setQuickPlacesLoading(false); setQuickPlacesError(null); setPassengerHistory([]); setDriverHistory(null); setNotifications([]); setUnreadNotifications(0); setAdminFinance(null); setRealtimeStatus("closed"); setLoading(false); return; }
    const { data: foundProfile, error: profileError } = await supabase.from("profiles").select("id, role, full_name, phone, avatar_url, blocked").eq("id", currentSession.user.id).single();
    if (profileError || !foundProfile) { setProfile(null); setError("O banco do Moto VIP ainda precisa receber a migração inicial."); setLoading(false); return; }
    const typedProfile = foundProfile as Profile; setProfile(typedProfile);
    if (typedProfile.role !== "admin") {
      const active = await api<{ ride: Ride | null; completedRide: Ride | null; driverLocation: DriverLocation | null }>("/api/rides/active");
      setActiveRide(active.ride); setCompletedRide(active.completedRide?.id === dismissedCompletedRide.current ? null : active.completedRide); setDriverLocation(active.driverLocation);
    }
    if (typedProfile.role === "driver") {
      const details = await api<{ profile: { full_name: string; phone?: string; avatarUrl?: string | null }; driver: Omit<DriverState, "vehicles">; vehicle?: Vehicle | null }>("/api/driver/profile").catch(() => null);
      if (details) {
        setProfile({ ...typedProfile, full_name: details.profile.full_name, phone: details.profile.phone });
        setDriverState({ ...details.driver, vehicles: details.vehicle ? [details.vehicle] : [] });
      } else {
        const { data: state } = await supabase.from("drivers").select("approval_status, online, available, rating, trips_count, vehicles(brand, model, color, plate)").eq("profile_id", currentSession.user.id).single();
        setDriverState((state as DriverState | null) || null);
      }
      setDriverAvatarUrl(details?.profile.avatarUrl || null);
      const offerResult = await api<{ offers: RideOffer[] }>("/api/rides/offers");
      setOffers(offerResult.offers);
      const history = await api<DriverHistory>("/api/history/driver");
      setDriverHistory(history);
    }
    if (typedProfile.role === "passenger") {
      setQuickPlacesLoading(true);
      const [history, quickPlaceResult] = await Promise.all([
        api<{ rides: HistoryRide[] }>("/api/history/passenger"),
        api<{ places: QuickPlace[] }>("/api/quick-places").catch((quickPlaceError: unknown) => {
          setQuickPlacesError(quickPlaceError instanceof Error ? quickPlaceError.message : "Não foi possível carregar os pontos rápidos.");
          return { places: [] as QuickPlace[] };
        }),
      ]);
      setPassengerHistory(history.rides);
      setQuickPlaces(quickPlaceResult.places);
      if (quickPlaceResult.places.length) setQuickPlacesError(null);
      setQuickPlacesLoading(false);
    }
    if (typedProfile.role !== "admin") {
      const inbox = await api<{ notifications: NotificationItem[]; unread: number }>("/api/notifications");
      setNotifications(inbox.notifications); setUnreadNotifications(inbox.unread);
    }
    if (typedProfile.role === "admin") {
      setQuickPlacesLoading(true);
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const [{ count: ridesToday }, { data: drivers }, { data: completed }, { data: recent }, driverDirectory, fareResult, fareRegionsResult, financeResult] = await Promise.all([
        supabase.from("rides").select("id", { count: "exact", head: true }).gte("created_at", start.toISOString()),
        supabase.from("drivers").select("online, available").eq("approval_status", "approved"),
        supabase.from("rides").select("fare_cents, requested_at, accepted_at").eq("status", "finalizada").gte("finished_at", start.toISOString()),
        supabase.from("rides").select("*").order("created_at", { ascending: false }).limit(8),
        api<{ drivers: AdminDriver[] }>("/api/admin/drivers"),
        api<{ fare: FareConfig }>("/api/admin/fare"),
        api<{ regions: FareRegion[] }>("/api/admin/fare-regions"),
        api<AdminFinance>("/api/admin/finance"),
      ]);
      const waits = (completed || []).filter((ride) => ride.accepted_at).map((ride) => (new Date(ride.accepted_at).getTime() - new Date(ride.requested_at).getTime()) / 60000);
      setAdminStats({ ridesToday: ridesToday || 0, driversOnline: (drivers || []).filter((driver) => driver.online).length, driversAvailable: (drivers || []).filter((driver) => driver.available).length, averageWaitMinutes: waits.length ? waits.reduce((sum, value) => sum + value, 0) / waits.length : 0, revenueCents: (completed || []).reduce((sum, ride) => sum + ride.fare_cents, 0), recentRides: (recent as Ride[]) || [], drivers: driverDirectory.drivers });
      setFareConfig(fareResult.fare);
      setFareRegions(fareRegionsResult.regions);
      setAdminFinance(financeResult);
      const quickPlaceResult = await api<{ places: QuickPlace[] }>("/api/admin/quick-places").catch((quickPlaceError: unknown) => {
        setQuickPlacesError(quickPlaceError instanceof Error ? quickPlaceError.message : "Não foi possível carregar os pontos rápidos.");
        return { places: [] as QuickPlace[] };
      });
      setQuickPlaces(quickPlaceResult.places);
      if (quickPlaceResult.places.length) setQuickPlacesError(null);
      setQuickPlacesLoading(false);
    }
    setLoading(false);
  }, [api, supabase]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => refresh(data.session)).catch(() => { setError("Não foi possível conectar. Verifique sua internet."); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      void refresh(next).catch(() => setError("Não foi possível sincronizar sua sessão."));
    });
    return () => listener.subscription.unsubscribe();
  }, [refresh, supabase]);

  useEffect(() => {
    if (!session || !profile) return;
    let channel = supabase.channel(`moto-vip:${session.user.id}:${activeRide?.id || "idle"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rides" }, () => void refresh(session).catch(() => undefined));
    if (profile.role === "driver") channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "ride_requests" }, () => void refresh(session).catch(() => undefined));
    if (profile.role !== "admin") channel = channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, () => void refresh(session).catch(() => undefined));
    if (profile.role === "passenger") channel = channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "payments" }, () => void refresh(session).catch(() => undefined));
    if (profile.role === "passenger" && activeRide?.id) channel = channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "driver_locations" }, (payload) => {
      const point = payload.new as { latitude: number; longitude: number; accuracy_meters?: number; updated_at: string };
      setDriverLocation((current) => ({ lat: point.latitude, lng: point.longitude, accuracyMeters: point.accuracy_meters, updatedAt: point.updated_at, distanceToOriginMeters: current?.distanceToOriginMeters }));
    });
    if (["passenger", "admin"].includes(profile.role)) channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "quick_places" }, () => void refresh(session).catch(() => undefined));
    channel.subscribe((status) => setRealtimeStatus(status.toLowerCase()));
    return () => { void supabase.removeChannel(channel); };
  }, [activeRide?.id, profile, refresh, session, supabase]);

  useEffect(() => {
    if (!session || !profile || profile.role === "admin") return;
    const interval = window.setInterval(() => {
      if (!document.hidden && navigator.onLine) void refresh(session).catch(() => undefined);
    }, realtimeStatus === "subscribed" ? 30000 : 5000);
    return () => window.clearInterval(interval);
  }, [profile, realtimeStatus, refresh, session]);

  useEffect(() => {
    if (!session) return;
    const synchronize = () => void refresh(session).catch(() => setError("Reconectando ao Moto VIP..."));
    window.addEventListener("moto-vip:network-restored", synchronize);
    window.addEventListener("focus", synchronize);
    return () => {
      window.removeEventListener("moto-vip:network-restored", synchronize);
      window.removeEventListener("focus", synchronize);
    };
  }, [refresh, session]);

  const updateLocation = useCallback((position: GeolocationPosition, rideId?: string) => api("/api/location", { method: "POST", body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy, heading: position.coords.heading || undefined, speedMps: position.coords.speed || undefined, rideId }) }), [api]);

  return {
    session, profile, activeRide, completedRide, offers, driverState, driverAvatarUrl, driverLocation, adminStats, fareConfig, fareRegions, quickPlaces, quickPlacesLoading, quickPlacesError, passengerHistory, driverHistory, notifications, unreadNotifications, adminFinance, realtimeStatus, passwordRecovery, loading, error,
    signIn: async (email: string, password: string) => {
      const result = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      return { ...result, error: result.error ? { message: friendlyAuthError(result.error) } : null };
    },
    signUp: async (input: { email: string; password: string; fullName: string; phone: string; role: "passenger" | "driver" }) => {
      const result = await supabase.auth.signUp({ email: input.email.trim().toLowerCase(), password: input.password, options: { data: { full_name: input.fullName.trim(), phone: input.phone.trim(), role: input.role }, emailRedirectTo: `${window.location.origin}/` } });
      const duplicate = Boolean(result.data.user && result.data.user.identities?.length === 0);
      return { ...result, error: result.error ? { message: friendlyAuthError(result.error) } : duplicate ? { message: "Este e-mail já está cadastrado. Entre na sua conta ou recupere a senha." } : null };
    },
    resetPassword: async (email: string) => {
      const result = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/` });
      return { ...result, error: result.error ? { message: friendlyAuthError(result.error) } : null };
    },
    updatePassword: async (password: string) => {
      const result = await supabase.auth.updateUser({ password });
      if (!result.error) setPasswordRecovery(false);
      return { ...result, error: result.error ? { message: friendlyAuthError(result.error) } : null };
    },
    signOut: () => supabase.auth.signOut(),
    requestRide: async (payload: unknown) => { const result = await api<{ ride: Ride }>("/api/rides/request", { method: "POST", body: JSON.stringify(payload) }); setCompletedRide(null); setActiveRide(result.ride); return result.ride; },
    estimateRide: (payload: unknown) => api<{ origin: { address: string; lat: number; lng: number }; destination: { address: string; lat: number; lng: number }; distanceMeters: number; durationSeconds: number; geometry: string; fareCents: number; fareRegion: { id: string; name: string; isDefault: boolean }; pricingMode: "region" }>("/api/maps/estimate", { method: "POST", body: JSON.stringify(payload) }),
    findNearbyDrivers: (origin: { lat: number; lng: number }) => api<{ radiusKm: number; freshnessSeconds: number; drivers: NearbyDriver[] }>("/api/drivers/nearby", { method: "POST", body: JSON.stringify(origin) }),
    acceptRide: (rideId: string) => api(`/api/rides/${rideId}/accept`, { method: "POST" }),
    declineRide: (rideId: string) => api(`/api/rides/${rideId}/decline`, { method: "POST" }),
    transitionRide: (rideId: string, status: string, reason?: string) => api(`/api/rides/${rideId}/transition`, { method: "POST", body: JSON.stringify({ status, reason }) }),
    setDriverStatus: (online: boolean, location?: GeolocationCoordinates) => api("/api/drivers/status", { method: "POST", body: JSON.stringify({ online, location: location ? { latitude: location.latitude, longitude: location.longitude, accuracyMeters: location.accuracy } : undefined }) }),
    saveDriverProfile: (formData: FormData) => api<{ approvalStatus: string; avatarUrl?: string | null }>("/api/driver/profile", { method: "POST", body: formData }),
    approveDriver: (driverId: string, status: "approved" | "rejected" | "blocked") => api(`/api/admin/drivers/${driverId}/approval`, { method: "POST", body: JSON.stringify({ status }) }),
    saveFareConfig: (fare: FareConfig) => api<{ fare: FareConfig }>("/api/admin/fare", { method: "POST", body: JSON.stringify(fare) }),
    saveFareRegion: (region: { id?: string; name: string; amountCents: number; active: boolean }) => api<{ region: FareRegion }>("/api/admin/fare-regions", { method: "POST", body: JSON.stringify(region) }),
    saveQuickPlace: (place: { id?: string; name: string; address: string; latitude: number; longitude: number; category: QuickPlace["category"]; icon: QuickPlace["icon"]; color: string; active: boolean; featured: boolean; sortOrder: number }) => api<{ place: QuickPlace }>("/api/admin/quick-places", { method: "POST", body: JSON.stringify(place) }),
    deleteQuickPlace: (id: string) => api<{ ok: true }>(`/api/admin/quick-places?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    reorderQuickPlaces: (orderedIds: string[]) => api<{ ok: true }>("/api/admin/quick-places", { method: "PATCH", body: JSON.stringify({ orderedIds }) }),
    geocodeQuickPlace: (address: string) => api<{ address: string; latitude: number; longitude: number }>("/api/admin/quick-places/geocode", { method: "POST", body: JSON.stringify({ address }) }),
    dismissCompletedRide: () => { dismissedCompletedRide.current = completedRide?.id || null; setCompletedRide(null); },
    updateLocation,
    rateRide: (rideId: string, score: number, comment?: string) => api("/api/ratings", { method: "POST", body: JSON.stringify({ rideId, score, comment }) }),
    createPixCharge: (rideId: string) => api<{ paymentId: string; status: string; qrCode?: string; qrCodeImageUrl?: string; expiresAt?: string }>("/api/payments/pix", { method: "POST", body: JSON.stringify({ rideId }) }),
    markNotificationsRead: async (id?: string) => { await api("/api/notifications", { method: "POST", body: JSON.stringify(id ? { id } : { all: true }) }); setNotifications((items) => items.map((item) => !id || item.id === id ? { ...item, read_at: new Date().toISOString() } : item)); setUnreadNotifications((count) => id ? Math.max(0, count - 1) : 0); },
    enablePushNotifications: async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este navegador não oferece suporte a notificações Push.");
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("Notificações Push preparadas, aguardando configuração VAPID no servidor.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Permissão de notificação não concedida.");
      const registration = await navigator.serviceWorker.ready;
      const padding = "=".repeat((4 - publicKey.length % 4) % 4); const raw = atob((publicKey + padding).replace(/-/g, "+").replace(/_/g, "/"));
      const key = Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api("/api/push/subscribe", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
      return true;
    },
    refresh: () => refresh(session),
  };
}
