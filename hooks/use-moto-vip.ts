"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { PUSH_OWNER_KEY, discardSubscriptionFromAnotherUser, retirePushSubscription } from "@/lib/push/subscription-client";
import { assertOnlineConnection } from "@/lib/pwa/network";
import { friendlyAuthError } from "@/lib/supabase/auth-errors";
import {
  newerLocation,
  normalizeRealtimeStatus,
  shouldResynchronizeRealtime,
  type RealtimeConnectionState,
} from "@/lib/tracking/realtime";
import { DEFAULT_CANCELLATION_POLICY, type CancellationPolicy } from "@/lib/backend/cancellation-policy";

export class BackendApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public payload: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type Profile = {
  id: string;
  role: "passenger" | "driver" | "admin";
  full_name: string;
  phone?: string;
  avatar_url?: string;
  blocked: boolean;
};
export type Ride = {
  id: string;
  passenger_id: string;
  driver_id?: string;
  status: string;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  destination_address: string;
  destination_lat: number;
  destination_lng: number;
  distance_meters: number;
  duration_seconds: number;
  route_geometry?: string;
  fare_cents: number;
  estimated_distance_meters?: number;
  estimated_duration_seconds?: number;
  estimated_fare_cents?: number;
  tracked_distance_meters?: number;
  actual_distance_meters?: number;
  actual_duration_seconds?: number;
  final_fare_cents?: number;
  fare_region_id?: string;
  fare_region_name?: string;
  fare_pricing_mode?: "distance" | "region";
  started_at?: string;
  requested_at?: string;
  accepted_at?: string;
  arrived_at?: string;
  arrival_server_at?: string;
  arrival_verified?: boolean;
  completed_at?: string;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  redispatch_started_at?: string | null;
  cancellation_fee_cents?: number;
  cancellation_fee_reason?: string | null;
  created_at: string;
  payment_method: string;
  payment_status: string;
  driver?: {
    profile_id: string;
    rating: number;
    trips_count?: number;
    profiles?: { full_name: string; phone?: string; avatar_url?: string };
    vehicles?: Array<{
      brand: string;
      model: string;
      color: string;
      plate: string;
    }>;
  };
  passenger?: { full_name: string; phone?: string };
};
export type CancelledRide = { id: string; driver_id: string; passenger_id: string; status: "cancelada"; cancelled_at: string | null;
  cancelled_by: string | null; cancellation_fee_cents?: number; cancellation_fee_reason?: string | null };
export type AddressResult = {
  id: string;
  address: string;
  shortAddress: string;
  lat: number;
  lng: number;
  district?: string;
  city: string;
  state: string;
  approximate: boolean;
  provider?: "nominatim" | "photon" | "coordinates";
};
export type RideOffer = {
  id: string;
  ride_id: string;
  expires_at: string;
  passenger_name: string;
  distance_to_pickup_meters: number | null;
  estimated_time_to_pickup_seconds: number | null;
  ride: Ride;
};
export type NearbyDriver = {
  markerId: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  name?: string;
  available?: boolean;
  onlineSince?: string;
  updatedAt?: string;
  currentRide?: { id: string; origin_address: string; destination_address: string; status: string } | null;
};
export type DriverLocation = {
  lat: number;
  lng: number;
  accuracyMeters?: number;
  updatedAt: string;
  distanceToOriginMeters?: number;
  stale?: boolean;
  freshnessSeconds?: number;
  rideId?: string | null;
};
export type TrackingRoute = {
  phase: "pickup" | "trip";
  distanceMeters: number;
  durationSeconds: number;
  geometry: string;
  steps?: import("@/lib/backend/routing").RouteStep[];
  from: { lat: number; lng: number; updatedAt: string };
  to: { lat: number; lng: number };
  calculatedAt: string;
};
export type Vehicle = {
  id?: string;
  brand: string;
  model: string;
  color: string;
  plate: string;
  active?: boolean;
};
export type DriverState = {
  approval_status: string;
  online: boolean;
  available: boolean;
  rating: number;
  trips_count: number;
  vehicles?: Vehicle[];
};
export type DriverQueue = {
  mode: "round_robin" | "broadcast";
  status: "queued" | "offer" | "on_ride" | "paused" | "offline" | "suspended" | "unavailable";
  position: number | null;
  ahead: number | null;
  total: number;
  enteredAt: string | null;
  updatedAt: string;
  returnPolicy: string;
  notificationId?: string | null;
};
export type AdminDriver = {
  profile_id: string;
  approval_status: string;
  online: boolean;
  available: boolean;
  rating: number;
  trips_count: number;
  created_at: string;
  profiles?: {
    full_name: string;
    phone?: string;
    avatar_url?: string;
    avatarUrl?: string;
    blocked?: boolean;
  } | null;
  vehicles?: Vehicle[];
};
export type AdminStats = {
  ridesToday: number;
  driversOnline: number;
  driversAvailable: number;
  averageWaitMinutes: number;
  revenueCents: number;
  recentRides: Pick<Ride, "id" | "passenger_id" | "origin_address" | "destination_address" | "status" | "fare_cents" | "final_fare_cents" | "payment_method" | "payment_status">[];
  drivers: AdminDriver[];
};
export type FareConfig = {
  baseCents: number;
  perKmCents: number;
  perMinuteCents: number;
  minimumCents: number;
  configured: boolean;
};
export type FareRegion = {
  id: string;
  name: string;
  amount_cents: number;
  active: boolean;
  is_default: boolean;
  updated_at: string;
};
export type QuickPlace = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  category:
    | "hospital"
    | "education"
    | "bus_station"
    | "government"
    | "market"
    | "pharmacy"
    | "square"
    | "fuel"
    | "bank"
    | "atm"
    | "restaurant"
    | "hotel"
    | "church"
    | "sports"
    | "gym"
    | "store"
    | "moto_vip"
    | "generic";
  icon:
    | "hospital"
    | "education"
    | "bus"
    | "government"
    | "market"
    | "pharmacy"
    | "square"
    | "fuel"
    | "bank"
    | "atm"
    | "restaurant"
    | "hotel"
    | "church"
    | "sports"
    | "gym"
    | "store"
    | "bike"
    | "pin";
  color: string;
  active: boolean;
  featured: boolean;
  sort_order: number;
  created_at?: string;
  updated_at: string;
};
export type PaymentSummary = {
  ride_id?: string;
  id?: string;
  method: string;
  status: string;
  amount_cents: number;
  paid_at?: string | null;
  provider?: string | null;
  pix_transactions?: Array<{
    qr_code?: string;
    qr_code_image_url?: string;
    expires_at?: string;
  }>;
};
export type HistoryRide = Ride & {
  driver_name?: string | null;
  passenger_name?: string | null;
  rating?: { score: number; comment?: string; created_at: string } | null;
  payment?: PaymentSummary | null;
};
export type DriverHistory = {
  rides: HistoryRide[];
  totals: {
    dayCents: number;
    weekCents: number;
    monthCents: number;
    receivedCents: number;
    pendingCents: number;
    commissionConfigured: boolean;
  };
};
export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at?: string | null;
  created_at: string;
};
export type AdminFinance = {
  period: { from: string; to: string };
  summary: {
    completedRides: number;
    cancellations: number;
    grossCents: number;
    pixPaidCents: number;
    cashPaidCents: number;
    receivedCents: number;
    pendingCents: number;
  };
  commission: {
    configured?: boolean;
    percentage_bps?: number;
    fixed_cents?: number;
  };
  byDriver: Array<{
    driverId: string;
    driverName: string;
    rides: number;
    grossCents: number;
    paidCents: number;
    pendingCents: number;
  }>;
};

export function useMotoVip() {
  const supabase = getSupabaseBrowserClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [cancelledRide, setCancelledRide] = useState<CancelledRide | null>(null);
  const [rideSnapshotVerified, setRideSnapshotVerified] = useState(false);
  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicy>(DEFAULT_CANCELLATION_POLICY);
  const [completedRide, setCompletedRide] = useState<Ride | null>(null);
  const [offers, setOffers] = useState<RideOffer[]>([]);
  const [driverState, setDriverState] = useState<DriverState | null>(null);
  const [driverQueue, setDriverQueue] = useState<DriverQueue | null>(null);
  const [driverQueueError, setDriverQueueError] = useState<string | null>(null);
  const [queuePriorityAlertId, setQueuePriorityAlertId] = useState<string | null>(null);
  const dismissQueuePriorityAlert = useCallback(() => setQueuePriorityAlertId(null), []);
  const driverQueueRequest = useRef(0);
  const [driverAvatarUrl, setDriverAvatarUrl] = useState<string | null>(null);
  const [passengerAvatarUrl, setPassengerAvatarUrl] = useState<string | null>(null);
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(
    null,
  );
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [adminMapDrivers, setAdminMapDrivers] = useState<NearbyDriver[]>([]);
  const [fareConfig, setFareConfig] = useState<FareConfig | null>(null);
  const [dispatchMode, setDispatchMode] = useState<"round_robin" | "broadcast" | null>(null);
  const [dispatchReady, setDispatchReady] = useState(false);
  const [fareRegions, setFareRegions] = useState<FareRegion[]>([]);
  const [quickPlaces, setQuickPlaces] = useState<QuickPlace[]>([]);
  const [quickPlacesLoading, setQuickPlacesLoading] = useState(true);
  const [quickPlacesError, setQuickPlacesError] = useState<string | null>(null);
  const [passengerHistory, setPassengerHistory] = useState<HistoryRide[]>([]);
  const [passengerHistoryLoading, setPassengerHistoryLoading] = useState(true);
  const [passengerHistoryError, setPassengerHistoryError] = useState<string | null>(null);
  const [driverHistory, setDriverHistory] = useState<DriverHistory | null>(
    null,
  );
  const [driverHistoryLoading, setDriverHistoryLoading] = useState(true);
  const [driverHistoryError, setDriverHistoryError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [adminFinance, setAdminFinance] = useState<AdminFinance | null>(null);
  const dismissedCompletedRide = useRef<string | null>(null);
  const refreshGeneration = useRef(0);
  const authenticatedUserId = useRef<string | null | undefined>(undefined);
  const [realtimeStatus, setRealtimeStatus] =
    useState<RealtimeConnectionState>("connecting");
  const realtimeStatusRef = useRef<RealtimeConnectionState>("connecting");
  const [nearbyRevision, setNearbyRevision] = useState(0);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionUserId = session?.user.id;

  useEffect(() => {
    if (!sessionUserId || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    void navigator.serviceWorker.getRegistration().then(async (registration) => {
      const subscription = await registration?.pushManager?.getSubscription();
      if (cancelled || !subscription) return;
      const ownerId = window.localStorage.getItem(PUSH_OWNER_KEY);
      if (ownerId === sessionUserId) return;
      // Another account can be open in a second tab. Its Push subscription belongs
      // to that account and must not be removed just because this tab signed in.
      if (ownerId && ownerId !== sessionUserId) return;
      const removed = await discardSubscriptionFromAnotherUser(ownerId, sessionUserId, subscription);
      if (!cancelled && removed) window.localStorage.removeItem(PUSH_OWNER_KEY);
      if (!cancelled && !removed) setError("Não foi possível desvincular o Push da conta anterior neste aparelho.");
    }).catch(() => {
      if (!cancelled) setError("Não foi possível verificar a inscrição Push deste aparelho.");
    });
    return () => { cancelled = true; };
  }, [sessionUserId]);

  const api = useCallback(
    async <T>(path: string, init?: RequestInit): Promise<T> => {
      if (typeof navigator !== "undefined") assertOnlineConnection(navigator.onLine);
      const current = (await supabase.auth.getSession()).data.session;
      if (!current) throw new Error("Entre na sua conta para continuar.");
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${current.access_token}`);
      if (init?.body && !(init.body instanceof FormData))
        headers.set("content-type", "application/json");
      let response: Response;
      try {
        response = await fetch(path, { ...init, headers, cache: "no-store" });
      } catch {
        throw new Error(
          "Conexão interrompida. O estado real será sincronizado ao reconectar.",
        );
      }
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "message" in payload &&
          typeof payload.message === "string"
            ? payload.message
            : "Não foi possível concluir a operação.";
        const errorCode =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "REQUEST_FAILED";
        throw new BackendApiError(
          message,
          errorCode,
          typeof payload === "object" && payload !== null
            ? (payload as Record<string, unknown>)
            : {},
        );
      }
      return payload as T;
    },
    [supabase],
  );

  const publicApi = useCallback(async <T>(path: string, body: unknown): Promise<T> => {
    if (typeof navigator !== "undefined") assertOnlineConnection(navigator.onLine);
    let response: Response;
    try {
      response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      throw new Error("Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.");
    }
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload === "object" && payload !== null && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : "Não foi possível concluir o acesso.";
      throw new Error(message);
    }
    return payload as T;
  }, []);

  const refreshDriverQueue = useCallback(async () => {
    const requestNumber = ++driverQueueRequest.current;
    try {
      const result = await api<{ queue: DriverQueue }>("/api/driver/queue");
      if (requestNumber === driverQueueRequest.current) {
        setDriverQueue(result.queue);
        setDriverQueueError(null);
        if (result.queue.notificationId && result.queue.position === 1)
          setQueuePriorityAlertId(result.queue.notificationId);
      }
      return result.queue;
    } catch (queueError) {
      if (requestNumber === driverQueueRequest.current) {
        setDriverQueue(null);
        setDriverQueueError(queueError instanceof Error ? queueError.message : "Não foi possível atualizar a fila.");
      }
      return null;
    }
  }, [api]);

  const refresh = useCallback(
    async (currentSession: Session | null) => {
      if (authenticatedUserId.current !== undefined &&
        currentSession?.user.id !== (authenticatedUserId.current ?? undefined)) return;
      const generation = ++refreshGeneration.current;
      setSession(currentSession);
      setError(null);
      if (!currentSession) {
        driverQueueRequest.current += 1;
        setProfile(null);
        setActiveRide(null);
        setCancelledRide(null);
        setRideSnapshotVerified(false);
        setCancellationPolicy(DEFAULT_CANCELLATION_POLICY);
        setCompletedRide(null);
        setOffers([]);
        setDriverState(null);
        setDriverQueue(null);
        setDriverQueueError(null);
        setQueuePriorityAlertId(null);
        setDriverAvatarUrl(null);
        setPassengerAvatarUrl(null);
        setDriverLocation(null);
        setAdminStats(null);
        setAdminMapDrivers([]);
        setFareConfig(null);
        setFareRegions([]);
        setQuickPlaces([]);
        setQuickPlacesLoading(false);
        setQuickPlacesError(null);
        setPassengerHistory([]);
        setPassengerHistoryLoading(false);
        setPassengerHistoryError(null);
        setDriverHistory(null);
        setDriverHistoryLoading(false);
        setDriverHistoryError(null);
        setNotifications([]);
        setNotificationsLoading(false);
        setNotificationsError(null);
        setUnreadNotifications(0);
        setAdminFinance(null);
        realtimeStatusRef.current = "disconnected";
        setRealtimeStatus("disconnected");
        setLoading(false);
        return;
      }
      const { data: foundProfile, error: profileError } = await supabase
        .from("profiles")
        .select("id, role, full_name, phone, avatar_url, blocked")
        .eq("id", currentSession.user.id)
        .single();
      if (generation !== refreshGeneration.current) return;
      if (profileError || !foundProfile) {
        setProfile(null);
        setError("Não foi possível carregar seu perfil. Tentaremos novamente ao reconectar.");
        setLoading(false);
        return;
      }
      const typedProfile = foundProfile as Profile;
      setProfile(typedProfile);
      if (typedProfile.role !== "admin") {
        const active = await api<{
          ride: Ride | null;
          completedRide: Ride | null;
          cancelledRide: CancelledRide | null;
          cancellationPolicy: CancellationPolicy;
          driverLocation: DriverLocation | null;
        }>("/api/rides/active");
        if (generation !== refreshGeneration.current) return;
        setActiveRide(active.ride);
        setCancelledRide(active.cancelledRide);
        setRideSnapshotVerified(true);
        setCancellationPolicy(active.cancellationPolicy);
        setCompletedRide(
          active.completedRide?.id === dismissedCompletedRide.current
            ? null
            : active.completedRide,
        );
        setDriverLocation(active.driverLocation);
      }
      if (typedProfile.blocked) {
        driverQueueRequest.current += 1;
        setOffers([]);
        setDriverQueue(null);
        setQueuePriorityAlertId(null);
        if (typedProfile.role === "driver") {
          const { data: state } = await supabase.from("drivers")
            .select("approval_status, online, available, rating, trips_count, vehicles(brand, model, color, plate)")
            .eq("profile_id", currentSession.user.id).maybeSingle();
          if (generation !== refreshGeneration.current) return;
          setDriverState((state as DriverState | null) || null);
        }
        setAdminStats(null);
        setAdminMapDrivers([]);
        setLoading(false);
        return;
      }
      if (typedProfile.role === "driver") {
        const details = await api<{
          profile: {
            full_name: string;
            phone?: string;
            avatarUrl?: string | null;
          };
          driver: Omit<DriverState, "vehicles">;
          vehicle?: Vehicle | null;
        }>("/api/driver/profile").catch(() => null);
        if (generation !== refreshGeneration.current) return;
        if (details) {
          setProfile({
            ...typedProfile,
            full_name: details.profile.full_name,
            phone: details.profile.phone,
          });
          setDriverState({
            ...details.driver,
            vehicles: details.vehicle ? [details.vehicle] : [],
          });
        } else {
          const { data: state } = await supabase
            .from("drivers")
            .select(
              "approval_status, online, available, rating, trips_count, vehicles(brand, model, color, plate)",
            )
            .eq("profile_id", currentSession.user.id)
            .single();
          if (generation !== refreshGeneration.current) return;
          setDriverState((state as DriverState | null) || null);
        }
        setDriverAvatarUrl(details?.profile.avatarUrl || null);
        const offerResult = await api<{ offers: RideOffer[] }>(
          "/api/rides/offers",
        );
        if (generation !== refreshGeneration.current) return;
        setOffers(offerResult.offers);
        await refreshDriverQueue();
        if (generation !== refreshGeneration.current) return;
        setDriverHistoryLoading(true);
        setDriverHistoryError(null);
        const history = await api<DriverHistory>("/api/history/driver").catch(
          (historyError: unknown) => {
            setDriverHistoryError(
              historyError instanceof Error
                ? historyError.message
                : "Não foi possível carregar seu histórico.",
            );
            return null;
          },
        );
        if (generation !== refreshGeneration.current) return;
        if (history) setDriverHistory(history);
        setDriverHistoryLoading(false);
      }
      if (typedProfile.role === "passenger") {
        if (typedProfile.avatar_url) {
          void api<{ profile: { avatarUrl: string | null } }>("/api/passenger/profile")
            .then((details) => {
              if (generation === refreshGeneration.current) setPassengerAvatarUrl(details.profile.avatarUrl);
            })
            .catch(() => undefined);
        } else setPassengerAvatarUrl(null);
        setQuickPlacesLoading(true);
        setPassengerHistoryLoading(true);
        setPassengerHistoryError(null);
        const [history, quickPlaceResult] = await Promise.all([
          api<{ rides: HistoryRide[] }>("/api/history/passenger").catch(
            (historyError: unknown) => {
              setPassengerHistoryError(
                historyError instanceof Error
                  ? historyError.message
                  : "Não foi possível carregar seu histórico.",
              );
              return null;
            },
          ),
          api<{ places: QuickPlace[] }>("/api/quick-places").catch(
            (quickPlaceError: unknown) => {
              setQuickPlacesError(
                quickPlaceError instanceof Error
                  ? quickPlaceError.message
                  : "Não foi possível carregar os pontos rápidos.",
              );
              return { places: [] as QuickPlace[] };
            },
          ),
        ]);
        if (generation !== refreshGeneration.current) return;
        if (history) setPassengerHistory(history.rides);
        setPassengerHistoryLoading(false);
        setQuickPlaces(quickPlaceResult.places);
        if (quickPlaceResult.places.length) setQuickPlacesError(null);
        setQuickPlacesLoading(false);
      }
      if (typedProfile.role !== "admin") {
        setNotificationsLoading(true);
        setNotificationsError(null);
        const inbox = await api<{
          notifications: NotificationItem[];
          unread: number;
        }>("/api/notifications").catch((notificationError: unknown) => {
          setNotificationsError(
            notificationError instanceof Error
              ? notificationError.message
              : "Não foi possível carregar as notificações.",
          );
          return null;
        });
        if (generation !== refreshGeneration.current) return;
        if (inbox) {
          setNotifications(inbox.notifications);
          setUnreadNotifications(inbox.unread);
        }
        setNotificationsLoading(false);
      }
      if (typedProfile.role === "admin") {
        const inbox = await api<{ notifications: NotificationItem[]; unread: number }>("/api/notifications").catch(() => null);
        if (generation !== refreshGeneration.current) return;
        if (inbox) {
          setNotifications(inbox.notifications);
          setUnreadNotifications(inbox.unread);
        }
        setQuickPlacesLoading(true);
        const [
          overview,
          driverDirectory,
          fareResult,
          dispatchResult,
          fareRegionsResult,
          financeResult,
          mapResult,
        ] = await Promise.all([
          api<Omit<AdminStats, "drivers">>("/api/admin/overview"),
          api<{ drivers: AdminDriver[] }>("/api/admin/drivers"),
          api<{ fare: FareConfig }>("/api/admin/fare"),
          api<{ mode: "round_robin" | "broadcast"; ready: boolean }>("/api/admin/dispatch"),
          api<{ regions: FareRegion[] }>("/api/admin/fare-regions"),
          api<AdminFinance>("/api/admin/finance"),
          api<{ drivers: NearbyDriver[] }>("/api/admin/map"),
        ]);
        if (generation !== refreshGeneration.current) return;
        setAdminStats({
          ...overview,
          drivers: driverDirectory.drivers,
        });
        setAdminMapDrivers(mapResult.drivers);
        setFareConfig(fareResult.fare);
        setDispatchMode(dispatchResult.mode);
        setDispatchReady(dispatchResult.ready);
        setFareRegions(fareRegionsResult.regions);
        setAdminFinance(financeResult);
        const quickPlaceResult = await api<{ places: QuickPlace[] }>(
          "/api/admin/quick-places",
        ).catch((quickPlaceError: unknown) => {
          setQuickPlacesError(
            quickPlaceError instanceof Error
              ? quickPlaceError.message
              : "Não foi possível carregar os pontos rápidos.",
          );
          return { places: [] as QuickPlace[] };
        });
        if (generation !== refreshGeneration.current) return;
        setQuickPlaces(quickPlaceResult.places);
        if (quickPlaceResult.places.length) setQuickPlacesError(null);
        setQuickPlacesLoading(false);
      }
      setLoading(false);
    },
    [api, refreshDriverQueue, supabase],
  );

  useEffect(() => {
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (authenticatedUserId.current !== undefined) return;
        authenticatedUserId.current = data.session?.user.id ?? null;
        return refresh(data.session);
      })
      .catch(() => {
        setError("Não foi possível conectar. Verifique sua internet.");
        setLoading(false);
      });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, next) => {
        if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
        authenticatedUserId.current = next?.user.id ?? null;
        void refresh(next).catch(() => {
          setError("Não foi possível sincronizar sua sessão.");
          setLoading(false);
        });
      },
    );
    return () => listener.subscription.unsubscribe();
  }, [refresh, supabase]);

  const profileRole = profile?.role;
  const activeRideId = activeRide?.id;
  const activeRideDriverId = activeRide?.driver_id;

  useEffect(() => {
    if (!session || !profileRole) return;
    realtimeStatusRef.current = "connecting";
    const connectingTimer = window.setTimeout(
      () => setRealtimeStatus("connecting"),
      0,
    );
    let channel = supabase
      .channel(`moto-vip:${session.user.id}:${activeRideId || "idle"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides" },
        (payload) => {
          const changed = payload.new as Partial<Ride>;
          if (activeRideId && changed.id === activeRideId && changed.status === "cancelada") {
            setActiveRide(null);
            if (profileRole === "driver" && changed.driver_id && changed.passenger_id)
              setCancelledRide({ id: changed.id, driver_id: changed.driver_id, passenger_id: changed.passenger_id,
                status: "cancelada", cancelled_at: changed.cancelled_at || null, cancelled_by: changed.cancelled_by || null,
                cancellation_fee_cents: changed.cancellation_fee_cents, cancellation_fee_reason: changed.cancellation_fee_reason });
          }
          if (profileRole === "driver" && activeRideId && changed.id === activeRideId &&
            changed.driver_id === null && changed.status === "procurando_motorista") {
            setActiveRide(null);
            setDriverLocation(null);
          }
          window.dispatchEvent(new Event("moto-pombal:rides-changed"));
          void refresh(session).catch(() => undefined);
        },
      );
    if (profileRole === "driver")
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ride_requests" },
        () => void refresh(session).catch(() => undefined),
      );
    if (profileRole === "driver")
      channel = channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "drivers" },
        () => void refreshDriverQueue(),
      );
    if (profileRole !== "admin")
      channel = channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        () => void refresh(session).catch(() => undefined),
      );
    if (profileRole === "passenger")
      channel = channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payments" },
        () => void refresh(session).catch(() => undefined),
      );
    if (profileRole === "passenger" && !activeRideId)
      channel = channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "drivers" },
        (payload) => {
          const driver = payload.new as {
            online?: boolean;
            available?: boolean;
          };
          if (
            typeof driver.online === "boolean" &&
            typeof driver.available === "boolean"
          ) {
            setNearbyRevision((value) => value + 1);
          }
        },
      );
    if (
      (profileRole === "passenger" || profileRole === "driver") &&
      activeRideId &&
      activeRideDriverId
    )
      channel = channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "driver_locations",
          filter: `driver_id=eq.${activeRideDriverId}`,
        },
        (payload) => {
          const point = payload.new as {
            driver_id: string;
            ride_id?: string | null;
            latitude: number;
            longitude: number;
            accuracy_meters?: number;
            updated_at: string;
          };
          const incoming: DriverLocation = {
            lat: point.latitude,
            lng: point.longitude,
            accuracyMeters: point.accuracy_meters,
            updatedAt: point.updated_at,
            rideId: point.ride_id,
          };
          setDriverLocation((current) => {
            const next = newerLocation(current, incoming, activeRideId);
            return next === incoming
              ? {
                  ...incoming,
                  stale: false,
                  freshnessSeconds: current?.freshnessSeconds,
                }
              : current;
          });
        },
      );
    if (["passenger", "admin"].includes(profileRole))
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "quick_places" },
        () => void refresh(session).catch(() => undefined),
      );
    channel.subscribe((status) => {
      window.clearTimeout(connectingTimer);
      const next = normalizeRealtimeStatus(status);
      const previous = realtimeStatusRef.current;
      realtimeStatusRef.current = next;
      setRealtimeStatus(next);
      if (shouldResynchronizeRealtime(previous, next)) {
        void refresh(session).catch(() => undefined);
      }
    });
    return () => {
      window.clearTimeout(connectingTimer);
      void supabase.removeChannel(channel);
    };
  }, [activeRideDriverId, activeRideId, profileRole, refresh, refreshDriverQueue, session, supabase]);

  // A consulta curta confirma o estado oficial mesmo se o evento Realtime se perder.
  useEffect(() => {
    if (!session || !activeRideId || profileRole !== "driver") return;
    let stopped = false;
    let inFlight = false;
    const verify = async () => {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const snapshot = await api<{ ride: Ride | null; cancelledRide: CancelledRide | null; cancellationPolicy: CancellationPolicy }>("/api/rides/active");
        if (stopped) return;
        setActiveRide(snapshot.ride);
        setCancelledRide(snapshot.cancelledRide);
        setRideSnapshotVerified(true);
        setCancellationPolicy(snapshot.cancellationPolicy);
        if (!snapshot.ride) void refreshDriverQueue();
      } catch { /* Mantém o último estado até o servidor responder. */ }
      finally { inFlight = false; }
    };
    const interval = window.setInterval(() => void verify(), 5000);
    const foreground = () => { if (!document.hidden) void verify(); };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("moto-vip:network-restored", foreground);
    return () => { stopped = true; window.clearInterval(interval); document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("moto-vip:network-restored", foreground); };
  }, [activeRideId, api, profileRole, refreshDriverQueue, session]);

  useEffect(() => {
    if (!session || !profile) return;
    const interval = window.setInterval(
      () => {
        if (!document.hidden && navigator.onLine)
          void refresh(session).catch(() => undefined);
      },
      profile.role === "admin" || realtimeStatus === "connected" ? 30000 : 10000,
    );
    return () => window.clearInterval(interval);
  }, [profile, realtimeStatus, refresh, session]);

  useEffect(() => {
    if (!session) return;
    const synchronize = () =>
      void refresh(session).catch(() =>
        setError("Reconectando ao MotoPombal..."),
      );
    window.addEventListener("moto-vip:network-restored", synchronize);
    window.addEventListener("focus", synchronize);
    return () => {
      window.removeEventListener("moto-vip:network-restored", synchronize);
      window.removeEventListener("focus", synchronize);
    };
  }, [refresh, session]);

  const updateLocation = useCallback(
    (position: GeolocationPosition, rideId?: string) =>
      api("/api/location", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          heading: position.coords.heading || undefined,
          speedMps: position.coords.speed || undefined,
          rideId,
          recordedAt: new Date(position.timestamp).toISOString(),
        }),
      }),
    [api],
  );

  return {
    session,
    profile,
    activeRide,
    cancelledRide,
    rideSnapshotVerified,
    cancellationPolicy,
    completedRide,
    offers,
    driverState,
    driverQueue,
    driverQueueError,
    queuePriorityAlertId,
    dismissQueuePriorityAlert,
    refreshDriverQueue,
    driverAvatarUrl,
    passengerAvatarUrl,
    driverLocation,
    adminStats,
    adminMapDrivers,
    fareConfig,
    dispatchMode,
    dispatchReady,
    fareRegions,
    quickPlaces,
    quickPlacesLoading,
    quickPlacesError,
    passengerHistory,
    passengerHistoryLoading,
    passengerHistoryError,
    driverHistory,
    driverHistoryLoading,
    driverHistoryError,
    notifications,
    notificationsLoading,
    notificationsError,
    unreadNotifications,
    adminFinance,
    realtimeStatus,
    nearbyRevision,
    passwordRecovery,
    loading,
    error,
    signIn: async (phone: string, password: string) => {
      try {
        const result = await publicApi<{
          session: { accessToken: string; refreshToken: string };
          role: "passenger" | "driver" | "admin";
        }>("/api/auth/login", { phone, password });
        const applied = await supabase.auth.setSession({
          access_token: result.session.accessToken,
          refresh_token: result.session.refreshToken,
        });
        return { data: applied.data, error: applied.error ? { message: friendlyAuthError(applied.error) } : null };
      } catch (error) {
        return { data: { session: null, user: null }, error: { message: error instanceof Error ? error.message : "Não foi possível entrar." } };
      }
    },
    signUp: async (input: {
      password: string;
      fullName: string;
      phone: string;
      role: "passenger" | "driver";
      vehicle?: { plate: string; model: string; color: string };
    }) => {
      try {
        const result = await publicApi<{
          session: { accessToken: string; refreshToken: string };
          role: "passenger" | "driver";
        }>("/api/auth/register", input);
        const applied = await supabase.auth.setSession({
          access_token: result.session.accessToken,
          refresh_token: result.session.refreshToken,
        });
        return { data: applied.data, error: applied.error ? { message: friendlyAuthError(applied.error) } : null };
      } catch (error) {
        return { data: { session: null, user: null }, error: { message: error instanceof Error ? error.message : "Não foi possível criar a conta." } };
      }
    },
    resetPassword: async (_phone: string) => {
      void _phone;
      return {
        data: {},
        error: null,
        message: "A recuperação automática por celular ainda não está disponível. Entre em contato com a central de suporte para recuperar o acesso.",
      };
    },
    updatePassword: async (password: string) => {
      const result = await supabase.auth.updateUser({ password });
      if (!result.error) setPasswordRecovery(false);
      return {
        ...result,
        error: result.error
          ? { message: friendlyAuthError(result.error) }
          : null,
      };
    },
    signOut: async () => {
      const ownsPush = window.localStorage.getItem(PUSH_OWNER_KEY) === sessionUserId;
      if (ownsPush && "serviceWorker" in navigator) {
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          const subscription = await registration?.pushManager?.getSubscription();
          if (subscription) {
            const retired = await retirePushSubscription(subscription, async (endpoint) => {
              await api("/api/push/subscribe", {
                method: "DELETE", body: JSON.stringify({ endpoint }),
              });
            });
            if (!retired) {
              setError("Não foi possível desvincular o Push deste aparelho. Tente novamente antes de sair.");
              return;
            }
          }
        } catch {
          setError("Não foi possível verificar o Push deste aparelho. Tente novamente antes de sair.");
          return;
        }
      }
      if (ownsPush) window.localStorage.removeItem(PUSH_OWNER_KEY);
      await supabase.auth.signOut({ scope: "local" });
    },
    requestRide: async (payload: unknown) => {
      let result: { ride: Ride };
      try {
        result = await api<{ ride: Ride }>("/api/rides/request", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } catch (requestError) {
        // A resposta pode se perder depois que a corrida foi gravada. O banco
        // decide se houve criação; nunca reenviamos automaticamente o POST.
        const current = await api<{ ride: Ride | null }>("/api/rides/active").catch(() => null);
        if (!current?.ride) throw requestError;
        result = { ride: current.ride };
      }
      refreshGeneration.current += 1;
      setCompletedRide(null);
      setActiveRide(result.ride);
      return result.ride;
    },
    estimateRide: (payload: unknown) =>
      api<{
        origin: { address: string; lat: number; lng: number };
        destination: { address: string; lat: number; lng: number };
        distanceMeters: number;
        durationSeconds: number;
        geometry: string;
        fareCents: number;
        originalFareCents: number;
        discountCents: number;
        coupon: { code: string; description: string | null } | null;
        fareRegion: { id: string; name: string; isDefault: boolean };
        serviceArea: { id: string; name: string };
        pricingMode: "region";
        quoteToken: string;
        quoteExpiresAt: string;
      }>("/api/maps/estimate", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    searchAddresses: (query: string, signal?: AbortSignal) =>
      api<{ results: AddressResult[] }>(
        `/api/maps/search?q=${encodeURIComponent(query)}`,
        { signal },
      ),
    reverseAddress: (lat: number, lng: number) =>
      api<AddressResult>("/api/maps/reverse", {
        method: "POST",
        body: JSON.stringify({ lat, lng }),
      }),
    findNearbyDrivers: (origin: { lat: number; lng: number }) =>
      api<{
        freshnessSeconds: number;
        arrivalSeconds: number | null;
        drivers: NearbyDriver[];
      }>("/api/drivers/nearby", {
        method: "POST",
        body: JSON.stringify(origin),
      }),
    listPassengerCoupons: () =>
      api<{
        available: Array<{
          id: string;
          code: string;
          description: string | null;
          discount_type: "fixed" | "percentage";
          discount_value: number;
          min_fare_cents: number;
          ends_at: string | null;
        }>;
        used: Array<{
          code: string;
          description: string | null;
          discountCents: number;
          usedAt: string;
        }>;
      }>("/api/coupons"),
    trackingRoute: (rideId: string, point?: { lat: number; lng: number }) =>
      api<TrackingRoute>(`/api/rides/${rideId}/tracking-route`, point
        ? { method: "POST", body: JSON.stringify(point), signal: AbortSignal.timeout(12_000) } : undefined),
    getRideSnapshot: () => api<{ ride: Ride | null; completedRide: Ride | null; cancelledRide: CancelledRide | null }>("/api/rides/active"),
    getAdminCancellationPolicy: () => api<{ policy: CancellationPolicy; ready: boolean }>("/api/admin/cancellation"),
    updateAdminCancellationPolicy: (policy: CancellationPolicy) => api<{ policy: CancellationPolicy }>("/api/admin/cancellation", {
      method: "POST", body: JSON.stringify(policy),
    }),
    prepareNavigation: (rideId: string, point?: { lat: number; lng: number; accuracyMeters?: number }) =>
      api<{ ride: Ride; routeToPickup: (Pick<TrackingRoute, "phase" | "geometry" | "distanceMeters" | "durationSeconds" | "steps">) | null; routeToDestination: (Pick<TrackingRoute, "phase" | "geometry" | "distanceMeters" | "durationSeconds" | "steps">) | null }>(`/api/rides/${rideId}/navigation-package`, {
        method: "POST", body: JSON.stringify(point), signal: AbortSignal.timeout(12_000),
      }),
    reloadPassengerHistory: async () => {
      setPassengerHistoryLoading(true);
      setPassengerHistoryError(null);
      try {
        const result = await api<{ rides: HistoryRide[] }>(
          "/api/history/passenger",
        );
        setPassengerHistory(result.rides);
      } catch (historyError) {
        setPassengerHistoryError(
          historyError instanceof Error
            ? historyError.message
            : "Não foi possível carregar seu histórico.",
        );
      } finally {
        setPassengerHistoryLoading(false);
      }
    },
    reloadDriverHistory: async () => {
      setDriverHistoryLoading(true);
      setDriverHistoryError(null);
      try {
        setDriverHistory(await api<DriverHistory>("/api/history/driver"));
      } catch (historyError) {
        setDriverHistoryError(
          historyError instanceof Error
            ? historyError.message
            : "Não foi possível carregar seu histórico.",
        );
      } finally {
        setDriverHistoryLoading(false);
      }
    },
    reloadNotifications: async () => {
      setNotificationsLoading(true);
      setNotificationsError(null);
      try {
        const inbox = await api<{
          notifications: NotificationItem[];
          unread: number;
        }>("/api/notifications");
        setNotifications(inbox.notifications);
        setUnreadNotifications(inbox.unread);
      } catch (notificationError) {
        setNotificationsError(
          notificationError instanceof Error
            ? notificationError.message
            : "Não foi possível carregar as notificações.",
        );
      } finally {
        setNotificationsLoading(false);
      }
    },
    acceptRide: (rideId: string) =>
      api(`/api/rides/${rideId}/accept`, { method: "POST" }),
    declineRide: (rideId: string) =>
      api(`/api/rides/${rideId}/decline`, { method: "POST" }),
    transitionRide: (rideId: string, status: string, reason?: string, offlineEvent?: { eventId: string; timestamp: string; coordinates: { lat: number; lng: number } | null }) =>
      api<{ rideId: string; status: string; ride?: Ride }>(`/api/rides/${rideId}/transition`, {
        method: "POST",
        body: JSON.stringify({ status, reason, offlineEvent }),
      }),
    cancelDriverRide: async (rideId: string, reasonCode: string, reason: string) => {
      const result = await api<{ rideId: string; status: string; ride?: Ride }>(`/api/rides/${rideId}/transition`, {
        method: "POST",
        body: JSON.stringify({ status: "cancelada", reasonCode, reason }),
      });
      setActiveRide((current) => current?.id === rideId ? null : current);
      setDriverLocation(null);
      setOffers([]);
      return result;
    },
    endRideEarly: async (rideId: string, reason: string) => {
      const result = await api<{ ride: Ride }>(`/api/rides/${rideId}/early-end`, {
        method: "POST", body: JSON.stringify({ reason }),
      });
      setActiveRide((current) => current?.id === rideId ? null : current);
      setDriverLocation(null);
      setCompletedRide(result.ride);
      return result;
    },
    setDriverStatus: (online: boolean, location?: GeolocationCoordinates) =>
      api("/api/drivers/status", {
        method: "POST",
        body: JSON.stringify({
          online,
          location: location
            ? {
                latitude: location.latitude,
                longitude: location.longitude,
                accuracyMeters: location.accuracy,
              }
            : undefined,
        }),
      }),
    setDriverQueuePaused: (paused: boolean) =>
      api<{ queue: DriverQueue }>("/api/driver/queue", {
        method: "POST",
        body: JSON.stringify({ paused }),
      }),
    saveDriverProfile: (formData: FormData) =>
      api<{ approvalStatus: string; avatarUrl?: string | null }>(
        "/api/driver/profile",
        { method: "POST", body: formData },
      ),
    savePassengerProfile: async (formData: FormData) => {
      const result = await api<{ profile: { full_name: string; phone: string; avatarUrl?: string | null } }>(
        "/api/passenger/profile", { method: "POST", body: formData },
      );
      setProfile((current) => current ? {
        ...current, full_name: result.profile.full_name, phone: result.profile.phone,
      } : current);
      if (result.profile.avatarUrl) setPassengerAvatarUrl(result.profile.avatarUrl);
      return result;
    },
    approveDriver: (
      driverId: string,
      status: "approved" | "rejected" | "blocked" | "pending",
    ) =>
      api(`/api/admin/drivers/${driverId}/approval`, {
        method: "POST",
        body: JSON.stringify({ status }),
      }),
    saveFareConfig: (fare: FareConfig) =>
      api<{ fare: FareConfig }>("/api/admin/fare", {
        method: "POST",
        body: JSON.stringify(fare),
      }),
    saveDispatchMode: (mode: "round_robin" | "broadcast") =>
      api<{ mode: "round_robin" | "broadcast" }>("/api/admin/dispatch", {
        method: "POST",
        body: JSON.stringify({ mode }),
      }),
    saveFareRegion: (region: {
      id?: string;
      name: string;
      amountCents: number;
      active: boolean;
    }) =>
      api<{ region: FareRegion }>("/api/admin/fare-regions", {
        method: "POST",
        body: JSON.stringify(region),
      }),
    saveQuickPlace: (place: {
      id?: string;
      name: string;
      address: string;
      latitude: number;
      longitude: number;
      category: QuickPlace["category"];
      icon: QuickPlace["icon"];
      color: string;
      active: boolean;
      featured: boolean;
      locationVerified: boolean;
      sortOrder: number;
    }) =>
      api<{ place: QuickPlace }>("/api/admin/quick-places", {
        method: "POST",
        body: JSON.stringify(place),
      }),
    deleteQuickPlace: (id: string) =>
      api<{ ok: true }>(
        `/api/admin/quick-places?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
    reorderQuickPlaces: (orderedIds: string[]) =>
      api<{ ok: true }>("/api/admin/quick-places", {
        method: "PATCH",
        body: JSON.stringify({ orderedIds }),
      }),
    geocodeQuickPlace: (address: string) =>
      api<{ address: string; latitude: number; longitude: number }>(
        "/api/admin/quick-places/geocode",
        { method: "POST", body: JSON.stringify({ address }) },
      ),
    dismissCompletedRide: () => {
      dismissedCompletedRide.current = completedRide?.id || null;
      setCompletedRide(null);
    },
    updateLocation,
    rateRide: (rideId: string, score: number, comment?: string) =>
      api("/api/ratings", {
        method: "POST",
        body: JSON.stringify({ rideId, score, comment }),
      }),
    createPixCharge: (rideId: string) =>
      api<{
        paymentId: string;
        status: string;
        qrCode?: string;
        qrCodeImageUrl?: string;
        expiresAt?: string;
      }>("/api/payments/pix", {
        method: "POST",
        body: JSON.stringify({ rideId }),
      }),
    confirmCashPayment: (rideId: string) =>
      api<{ paymentId: string; duplicate: boolean }>("/api/payments/cash", {
        method: "POST",
        body: JSON.stringify({ rideId }),
      }),
    markNotificationsRead: async (id?: string) => {
      await api("/api/notifications", {
        method: "POST",
        body: JSON.stringify(id ? { id } : { all: true }),
      });
      setNotifications((items) =>
        items.map((item) =>
          !id || item.id === id
            ? { ...item, read_at: new Date().toISOString() }
            : item,
        ),
      );
      setUnreadNotifications((count) => (id ? Math.max(0, count - 1) : 0));
    },
    enablePushNotifications: async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
        throw new Error(
          "Este navegador não oferece suporte a notificações Push.",
        );
      if (Notification.permission === "denied")
        throw new Error("As notificações foram negadas. Altere a permissão nas configurações do navegador.");
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey)
        throw new Error(
          "Notificações Push preparadas, aguardando configuração VAPID no servidor.",
        );
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error("Permissão de notificação não concedida.");
      const registration = await navigator.serviceWorker.ready;
      const currentUserId = (await supabase.auth.getSession()).data.session?.user.id;
      if (!currentUserId) throw new Error("Sessão encerrada antes de concluir a inscrição Push.");
      const ownerId = window.localStorage.getItem(PUSH_OWNER_KEY);
      if (ownerId && ownerId !== currentUserId) {
        throw new Error("As notificações deste navegador já pertencem a outra conta. Use outro perfil do navegador para ativá-las nas duas contas.");
      }
      const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
      const raw = atob(
        (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/"),
      );
      const key = Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      try {
        await api("/api/push/subscribe", {
          method: "POST",
          body: JSON.stringify(subscription.toJSON()),
        });
      } catch (error) {
        if (!existing) await subscription.unsubscribe().catch(() => false);
        throw error;
      }
      window.localStorage.setItem(PUSH_OWNER_KEY, currentUserId);
      return true;
    },
    disablePushNotifications: async () => {
      if (!("serviceWorker" in navigator)) return true;
      if (window.localStorage.getItem(PUSH_OWNER_KEY) !== sessionUserId) return true;
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager?.getSubscription();
      if (!subscription) {
        window.localStorage.removeItem(PUSH_OWNER_KEY);
        return true;
      }
      const retired = await retirePushSubscription(subscription, async (endpoint) => {
        await api("/api/push/subscribe", {
          method: "DELETE",
          body: JSON.stringify({ endpoint }),
        });
      });
      if (!retired) throw new Error("Não foi possível desativar as notificações neste aparelho.");
      window.localStorage.removeItem(PUSH_OWNER_KEY);
      return true;
    },
    refresh: () => refresh(session),
  };
}
