"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Activity,
  Bell,
  Bike,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  GripVertical,
  Headphones,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Plus,
  Route,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { RealMap, type LivePoint } from "@/components/map/real-map";
import { type CancellationPolicy } from "@/lib/backend/cancellation-policy";
import {
  type AdminDriver,
  type QuickPlace,
  useMotoVip,
} from "@/hooks/use-moto-vip";
import "./operations-panel.css";

type Backend = ReturnType<typeof useMotoVip>;
type Section =
  | "overview"
  | "rides"
  | "drivers"
  | "dispatch"
  | "passengers"
  | "finance"
  | "fares"
  | "places"
  | "support"
  | "settings";
type QueueEntry = {
  driverId: string;
  name: string;
  status:
    | "queued"
    | "on_ride"
    | "offer"
    | "paused"
    | "offline"
    | "blocked"
    | "unavailable";
  dispatchOrder: number;
  enteredAt: string | null;
};
type AdminRide = {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  destination_address: string;
  destination_lat: number;
  destination_lng: number;
  distance_meters: number;
  fare_cents: number;
  final_fare_cents: number | null;
  payment_method: string;
  payment_status: string;
  status: string;
  requested_at: string;
  created_at: string;
  accepted_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  cancellation_fee_cents: number;
  cancellation_fee_reason: string | null;
  cancellation_evidence: { distance_to_pickup_meters?: number; elapsed_seconds?: number;
    approach_points?: number; verified_displacement_meters?: number } | null;
  termination_code: string | null;
  no_show_at: string | null;
  early_end_reason: string | null;
  early_end_at: string | null;
  passenger: { full_name: string; phone: string | null } | null;
  driver: { full_name: string; phone: string | null } | null;
};
type DriverCancellation = {
  id: number; ride_id: string; driver_id: string; passenger_id: string;
  previous_status: string; reason_code: string; reason_text: string;
  accepted_at: string | null; arrived_at: string | null; cancelled_at: string;
  gps_lat: number | null; gps_lng: number | null; gps_accuracy_meters: number | null;
  next_driver_id: string | null; next_accepted_at: string | null;
  driver_name: string; passenger_name: string; next_driver_name: string | null;
  ride: { origin_address: string; destination_address: string; requested_at: string; status: string } | null;
};
type CancellationMetric = { driver_id: string; driver_name: string; accepted: number; completed: number; cancelled: number; cancellation_rate: number };
type AdminPassenger = {
  profile_id: string;
  created_at: string;
  profiles: {
    full_name: string;
    phone: string | null;
    blocked: boolean;
  } | null;
  rides: Array<{
    id: string;
    created_at: string;
    status: string;
    origin_address: string;
    destination_address: string;
    fare_cents: number;
    final_fare_cents: number | null;
  }>;
};
const navigation: Array<{ id: Section; label: string; icon: typeof Bike }> = [
  { id: "overview", label: "Visão Geral", icon: LayoutDashboard },
  { id: "rides", label: "Corridas", icon: Route },
  { id: "drivers", label: "Motoristas", icon: Bike },
  { id: "dispatch", label: "Distribuição", icon: Settings2 },
  { id: "fares", label: "Tarifas", icon: CircleDollarSign },
  { id: "passengers", label: "Passageiros", icon: Users },
  { id: "finance", label: "Financeiro", icon: Wallet },
  { id: "places", label: "Pontos da Cidade", icon: MapPin },
  { id: "support", label: "Suporte", icon: Headphones },
];
const categories: Array<{ value: QuickPlace["category"]; label: string }> = [
  { value: "hospital", label: "Hospital" },
  { value: "bus_station", label: "Rodoviária" },
  { value: "education", label: "Escola" },
  { value: "government", label: "Prefeitura" },
  { value: "square", label: "Praça" },
  { value: "market", label: "Comércio" },
  { value: "generic", label: "Serviço / outro" },
];
const emptyPlace = (count: number) => ({
  id: "",
  name: "",
  address: "",
  latitude: "",
  longitude: "",
  category: "generic" as QuickPlace["category"],
  icon: "pin" as QuickPlace["icon"],
  color: "#1688ff",
  active: true,
  featured: false,
  locationVerified: false,
  sortOrder: String((count + 1) * 10),
});
const money = (cents = 0) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
const date = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(value))
    : "—";
const rideLabel = (status: string) =>
  ({
    solicitada: "Solicitada",
    procurando_motorista: "Procurando motorista",
    aceita: "Aceita",
    motorista_a_caminho: "A caminho",
    motorista_chegou: "Motorista chegou",
    em_andamento: "Em andamento",
    finalizada: "Finalizada",
    cancelada: "Cancelada",
  })[status] || status.replaceAll("_", " ");
const driverStatus = (driver: AdminDriver) =>
  driver.profiles?.blocked
    ? "Suspenso"
    : driver.approval_status !== "approved"
      ? "Pendente"
      : !driver.online
        ? "Offline"
        : driver.available
          ? "Disponível"
          : "Em corrida";

export function AdminOperationsPanel({ backend }: { backend: Backend }) {
  const [section, setSection] = useState<Section>("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [driverFilter, setDriverFilter] = useState("Todos");
  const [rideFilter, setRideFilter] = useState("Ativas");
  const [rideDate, setRideDate] = useState("");
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueError, setQueueError] = useState("");
  const [dispatchChoice, setDispatchChoice] = useState<
    "round_robin" | "broadcast" | null
  >(null);
  const [fareForm, setFareForm] = useState<{
    base: string;
    perKm: string;
    perMinute: string;
    minimum: string;
  } | null>(null);
  const [selectedRide, setSelectedRide] = useState<AdminRide | null>(null);
  const [selectedCancellation, setSelectedCancellation] = useState<DriverCancellation | null>(null);
  const [selectedPassenger, setSelectedPassenger] =
    useState<AdminPassenger | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<AdminDriver | null>(
    null,
  );
  const [placeEditor, setPlaceEditor] = useState(false);
  const [placeForm, setPlaceForm] = useState(() =>
    emptyPlace(backend.quickPlaces.length),
  );
  const [mapPoint, setMapPoint] = useState<LivePoint>({
    lat: -10.8373,
    lng: -38.5357,
  });
  const [rides, setRides] = useState<AdminRide[]>([]);
  const [driverCancellations, setDriverCancellations] = useState<DriverCancellation[]>([]);
  const [cancellationMetrics, setCancellationMetrics] = useState<CancellationMetric[]>([]);
  const [passengers, setPassengers] = useState<AdminPassenger[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [listError, setListError] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicy | null>(null);
  const [cancellationReady, setCancellationReady] = useState(false);
  const [dragged, setDragged] = useState("");
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null);
  const stats = backend.adminStats;
  const drivers = stats?.drivers || [];
  const orderedPlaces = orderedIds
    ? orderedIds
        .map((id) => backend.quickPlaces.find((place) => place.id === id))
        .filter((place): place is QuickPlace => Boolean(place))
    : backend.quickPlaces;

  async function adminGet<T>(path: string): Promise<T> {
    const response = await fetch(path, {
      headers: {
        Authorization: `Bearer ${backend.session?.access_token || ""}`,
      },
      cache: "no-store",
    });
    const body = (await response.json()) as { message?: string };
    if (!response.ok)
      throw new Error(body.message || "Não foi possível carregar os dados.");
    return body as T;
  }
  useEffect(() => {
    if (section !== "settings") return;
    let active = true;
    void backend.getAdminCancellationPolicy().then((result) => {
      if (active) { setCancellationPolicy(result.policy); setCancellationReady(result.ready); }
    }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "Política indisponível."); });
    return () => { active = false; };
  // A abertura da seção busca a configuração persistida; salvamentos atualizam o estado diretamente.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [rideData, passengerData, cancellationData] = await Promise.all([
          adminGet<{ rides: AdminRide[] }>("/api/admin/rides"),
          adminGet<{ passengers: AdminPassenger[] }>("/api/admin/passengers"),
          adminGet<{ cancellations: DriverCancellation[]; metrics: CancellationMetric[] }>("/api/admin/driver-cancellations"),
        ]);
        if (!cancelled) {
          setRides(rideData.rides);
          setPassengers(passengerData.passengers);
          setDriverCancellations(cancellationData.cancellations);
          setCancellationMetrics(cancellationData.metrics);
          setListError("");
        }
      } catch (error) {
        if (!cancelled)
          setListError(
            error instanceof Error ? error.message : "Dados indisponíveis.",
          );
      } finally {
        if (!cancelled) setLoadingLists(false);
      }
      try {
        const queueData = await adminGet<{ queue: QueueEntry[] }>(
          "/api/admin/queue",
        );
        if (!cancelled) {
          setQueue(queueData.queue);
          setQueueError("");
        }
      } catch (error) {
        if (!cancelled)
          setQueueError(
            error instanceof Error ? error.message : "Fila indisponível.",
          );
      }
    };
    void load();
    const interval = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    window.addEventListener("moto-pombal:rides-changed", load);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("moto-pombal:rides-changed", load);
    };
    // Session token changes only on reauthentication; the backend refreshes the operational summary separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend.session?.access_token]);
  const activeRides = rides.filter(
    (ride) => !["finalizada", "cancelada"].includes(ride.status),
  );
  const waiting = activeRides.filter((ride) => !ride.driver_id).length;
  const rideResults = rides.filter((ride) => {
    const haystack =
      `${ride.id} ${ride.passenger?.full_name || ""} ${ride.driver?.full_name || ""} ${ride.origin_address} ${ride.destination_address}`.toLowerCase();
    const group =
      rideFilter === "Ativas"
        ? !["solicitada", "procurando_motorista", "finalizada", "cancelada"].includes(ride.status)
        : rideFilter === "Aguardando"
          ? ["solicitada", "procurando_motorista"].includes(ride.status)
          : rideFilter === "Finalizadas"
            ? ride.status === "finalizada"
            : rideFilter === "Canceladas"
              ? ride.status === "cancelada"
              : true;
    return (
      haystack.includes(query.toLowerCase()) &&
      group &&
      (!rideDate || ride.created_at.slice(0, 10) === rideDate)
    );
  });
  const driverResults = drivers.filter(
    (driver) =>
      `${driver.profiles?.full_name || ""} ${driver.profiles?.phone || ""} ${driver.vehicles?.[0]?.plate || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (driverFilter === "Todos" ||
        (driverFilter === "Online"
          ? driver.online
          : driverFilter === "Na fila"
            ? queue.some(
                (entry) =>
                  entry.driverId === driver.profile_id &&
                  entry.status === "queued",
              )
            : driverFilter === "Pendentes"
              ? driver.approval_status === "pending"
              : driverFilter === "Bloqueados"
                ? Boolean(driver.profiles?.blocked)
                : driverStatus(driver) === driverFilter)),
  );
  const passengerResults = passengers.filter((passenger) =>
    `${passenger.profiles?.full_name || ""} ${passenger.profiles?.phone || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const placeResults = orderedPlaces.filter((place) =>
    `${place.name} ${place.address} ${place.category}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const regionalFares = backend.fareRegions.filter(
    (region) => !region.is_default,
  );
  const standardFare = backend.fareRegions.find((region) => region.is_default);
  const pendingDrivers = drivers.filter(
    (driver) => driver.approval_status === "pending",
  ).length;
  const queuedDrivers = queue
    .filter((entry) => entry.status === "queued")
    .sort((a, b) => a.dispatchOrder - b.dispatchOrder);
  const selectedDispatchMode =
    dispatchChoice ?? backend.dispatchMode ?? "round_robin";
  const currentFareForm = fareForm ?? {
    base: ((backend.fareConfig?.baseCents ?? 0) / 100).toFixed(2),
    perKm: ((backend.fareConfig?.perKmCents ?? 0) / 100).toFixed(2),
    perMinute: ((backend.fareConfig?.perMinuteCents ?? 0) / 100).toFixed(2),
    minimum: ((backend.fareConfig?.minimumCents ?? 0) / 100).toFixed(2),
  };
  const notificationItems = backend.notifications.filter((item) =>
    ["ride", "driver", "support", "admin", "trip"].some((part) =>
      `${item.type} ${item.title}`.toLowerCase().includes(part),
    ),
  );

  function navigate(next: Section) {
    setSection(next);
    setQuery("");
    setMobileMenu(false);
    setMessage("");
    setSelectedRide(null);
    setSelectedDriver(null);
    setSelectedPassenger(null);
    window.scrollTo(0, 0);
  }
  async function run(
    key: string,
    action: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(key);
    setMessage("");
    try {
      await action();
      await backend.refresh();
      setMessage(success);
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir a ação.",
      );
      return false;
    } finally {
      setBusy("");
    }
  }
  async function queueAction(driverId: string, paused: boolean) {
    const success = await run(
      driverId,
      async () => {
        const response = await fetch("/api/admin/queue", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${backend.session?.access_token || ""}`,
          },
          body: JSON.stringify({ driverId, paused }),
        });
        const body = (await response.json()) as { message?: string };
        if (!response.ok)
          throw new Error(body.message || "Não foi possível alterar a fila.");
        const refreshed = await adminGet<{ queue: QueueEntry[] }>(
          "/api/admin/queue",
        );
        setQueue(refreshed.queue);
      },
      paused ? "Motorista pausado na fila." : "Motorista reintegrado à fila.",
    );
    if (success) setSelectedDriver(null);
  }
  function editPlace(place?: QuickPlace) {
    setPlaceForm(
      place
        ? {
            id: place.id,
            name: place.name,
            address: place.address,
            latitude: String(place.latitude),
            longitude: String(place.longitude),
            category: place.category,
            icon: place.icon,
            color: place.color,
            active: place.active,
            featured: place.featured,
            locationVerified: true,
            sortOrder: String(place.sort_order),
          }
        : emptyPlace(backend.quickPlaces.length),
    );
    setMapPoint(
      place
        ? { lat: place.latitude, lng: place.longitude, label: place.name }
        : { lat: -10.8373, lng: -38.5357 },
    );
    setPlaceEditor(true);
  }
  async function savePlace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!placeForm.locationVerified) {
      setMessage("Confirme a localização no mapa antes de salvar.");
      return;
    }
    const saved = await run(
      "place",
      () =>
        backend.saveQuickPlace({
          id: placeForm.id || undefined,
          name: placeForm.name,
          address: placeForm.address,
          latitude: Number(placeForm.latitude),
          longitude: Number(placeForm.longitude),
          category: placeForm.category,
          icon: placeForm.icon,
          color: placeForm.color,
          active: placeForm.active,
          featured: placeForm.featured,
          locationVerified: true,
          sortOrder: Number(placeForm.sortOrder),
        }),
      "Ponto salvo com sucesso.",
    );
    if (saved) setPlaceEditor(false);
  }
  async function reorder(target: string) {
    if (!dragged || dragged === target) return;
    const next = orderedPlaces.map((place) => place.id);
    next.splice(next.indexOf(dragged), 1);
    next.splice(next.indexOf(target), 0, dragged);
    setOrderedIds(next);
    setDragged("");
    await run(
      "order",
      () => backend.reorderQuickPlaces(next),
      "Ordem dos pontos atualizada.",
    );
    setOrderedIds(null);
  }
  function empty(icon: React.ReactNode, title: string, description: string) {
    return (
      <div className="ops-empty">
        {icon}
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    );
  }

  return (
    <div className={`ops-shell ${collapsed ? "ops-collapsed" : ""}`}>
      <aside className={`ops-sidebar ${mobileMenu ? "ops-sidebar-open" : ""}`}>
        <div className="ops-brand">
          <Image
            src="/brand/motopombal-badge.png"
            width={38}
            height={38}
            alt=""
          />
          <span>
            <strong>MotoPombal</strong>
            <small>ADMINISTRAÇÃO</small>
          </span>
          <button
            className="ops-collapse"
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            <ChevronLeft />
          </button>
        </div>
        <span className="ops-nav-caption">MENU PRINCIPAL</span>
        <nav aria-label="Menu administrativo">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              className={section === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              <Icon />
              <span>{label}</span>
              {id === "drivers" && pendingDrivers > 0 && (
                <i>{pendingDrivers}</i>
              )}
            </button>
          ))}
        </nav>
        <div className="ops-sidebar-bottom">
          <button
            type="button"
            title="Configurações"
            className={section === "settings" ? "active" : ""}
            onClick={() => navigate("settings")}
          >
            <Settings2 />
            <span>Configurações</span>
          </button>
          <button
            type="button"
            title="Sair da conta"
            onClick={() => void backend.signOut()}
          >
            <LogOut />
            <span>Sair da conta</span>
          </button>
          <div className="ops-sidebar-user">
            <span>
              {(backend.profile?.full_name || "A").slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>
                {backend.profile?.full_name || "Administrador MotoPombal"}
              </strong>
              <small>Administrador</small>
            </div>
          </div>
        </div>
      </aside>
      {mobileMenu && (
        <button
          className="ops-menu-backdrop"
          aria-label="Fechar menu"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <div className="ops-workspace">
        <header className="ops-header">
          <div className="ops-heading">
            <button
              type="button"
              className="ops-mobile-menu"
              onClick={() => setMobileMenu(true)}
              aria-label="Abrir menu"
            >
              <Menu />
            </button>
            <div>
              <h1>
                {section === "overview"
                  ? "Central de Operações"
                  : navigation.find((item) => item.id === section)?.label ||
                    "Configurações"}
              </h1>
              <p>
                {section === "overview"
                  ? "Acompanhamento da operação em tempo real"
                  : section === "places"
                    ? "Locais exibidos no aplicativo do passageiro"
                    : section === "finance"
                      ? "Receitas e pagamentos da operação"
                      : "Gerencie a operação do MotoPombal"}
              </p>
            </div>
          </div>
          <div className="ops-header-actions">
            <span
              className={`ops-connection ${backend.realtimeStatus === "connected" ? "online" : ""}`}
            >
              <i />
              {backend.realtimeStatus === "connected"
                ? "Supabase conectado"
                : "Atualizando conexão"}
            </span>
            <div className="ops-notification-wrap">
              <button
                type="button"
                className="ops-icon-button"
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                aria-label={`Notificações${backend.unreadNotifications ? `: ${backend.unreadNotifications} não lidas` : ""}`}
              >
                <Bell />
                {backend.unreadNotifications > 0 && (
                  <b>{backend.unreadNotifications}</b>
                )}
              </button>
              {notificationsOpen && (
                <div className="ops-notifications">
                  <div>
                    <strong>Notificações</strong>
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen(false)}
                      aria-label="Fechar"
                    >
                      <X />
                    </button>
                  </div>
                  {notificationItems.length ? (
                    notificationItems.slice(0, 8).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={!item.read_at ? "unread" : ""}
                        onClick={() =>
                          void backend.markNotificationsRead(item.id)
                        }
                      >
                        <span>{item.title}</span>
                        <small>{item.body}</small>
                      </button>
                    ))
                  ) : (
                    <p>Nenhuma notificação operacional por enquanto.</p>
                  )}
                  {backend.unreadNotifications > 0 && (
                    <button
                      type="button"
                      className="ops-mark-read"
                      onClick={() => void backend.markNotificationsRead()}
                    >
                      Marcar todas como lidas
                    </button>
                  )}
                </div>
              )}
            </div>
            <span className="ops-avatar">
              {(backend.profile?.full_name || "A").slice(0, 1).toUpperCase()}
            </span>
            <span className="ops-admin-name">
              {backend.profile?.full_name || "Administrador MotoPombal"}
              <small>Administrador</small>
            </span>
          </div>
        </header>
        <main className="ops-content">
          {message && (
            <div className="ops-message" role="status">
              {message}
              <button
                type="button"
                onClick={() => setMessage("")}
                aria-label="Fechar aviso"
              >
                <X />
              </button>
            </div>
          )}
          {listError && (
            <div className="ops-message ops-error" role="alert">
              {listError}
            </div>
          )}
          {section === "overview" && (
            <>
              <div className="ops-kpis">
                <article>
                  <span>
                    <Route />
                  </span>
                  <small>Corridas agora</small>
                  <strong>{activeRides.length}</strong>
                  <em>Em atendimento</em>
                </article>
                <article>
                  <span>
                    <Bike />
                  </span>
                  <small>Motoristas online</small>
                  <strong>{stats?.driversOnline ?? "—"}</strong>
                  <em>{stats?.driversAvailable ?? 0} disponíveis</em>
                </article>
                <article>
                  <span>
                    <Clock3 />
                  </span>
                  <small>Aguardando corrida</small>
                  <strong>{waiting}</strong>
                  <em>Sem motorista atribuído</em>
                </article>
                <article>
                  <span>
                    <CircleDollarSign />
                  </span>
                  <small>Faturamento hoje</small>
                  <strong>{money(stats?.revenueCents)}</strong>
                  <em>Corridas finalizadas</em>
                </article>
              </div>
              <div className="ops-overview-grid">
                <section className="ops-card ops-map-card">
                  <div className="ops-card-head">
                    <div>
                      <h2>Mapa operacional</h2>
                      <p>Ribeira do Pombal · operação em tempo real</p>
                    </div>
                    <span className="ops-live">
                      <i /> AO VIVO
                    </span>
                  </div>
                  <div className="ops-map">
                    <RealMap
                      nearbyDrivers={backend.adminMapDrivers.map((driver) => ({
                        lat: driver.latitude,
                        lng: driver.longitude,
                        label: `${driver.name || "Motorista"} · ${driver.available ? "Disponível" : "Em corrida"} · ${date(driver.updatedAt)}`,
                      }))}
                    />
                  </div>
                  {backend.adminMapDrivers.length === 0 && (
                    <p className="ops-map-note">
                      Motoristas online aparecerão no mapa quando compartilharem
                      a localização.
                    </p>
                  )}
                </section>
                <section className="ops-card ops-now-card">
                  <div className="ops-card-head">
                    <div>
                      <h2>Precisa de atenção</h2>
                      <p>Acesse a tarefa diretamente</p>
                    </div>
                    <Activity />
                  </div>
                  <div className="ops-alerts">
                    {pendingDrivers > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          navigate("drivers");
                          setDriverFilter("Pendentes");
                        }}
                      >
                        <span>
                          {pendingDrivers}{" "}
                          {pendingDrivers === 1
                            ? "motorista aguardando aprovação"
                            : "motoristas aguardando aprovação"}
                        </span>
                        <ChevronRight />
                      </button>
                    )}
                    {waiting > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          navigate("rides");
                          setRideFilter("Aguardando");
                        }}
                      >
                        <span>
                          {waiting}{" "}
                          {waiting === 1
                            ? "corrida aguardando motorista"
                            : "corridas aguardando motorista"}
                        </span>
                        <ChevronRight />
                      </button>
                    )}
                    {backend.dispatchMode === "round_robin" &&
                      queuedDrivers.length > 0 && (
                        <button
                          type="button"
                          onClick={() => navigate("dispatch")}
                        >
                          <span>
                            {queuedDrivers.length}{" "}
                            {queuedDrivers.length === 1
                              ? "motorista na fila"
                              : "motoristas na fila"}
                          </span>
                          <ChevronRight />
                        </button>
                      )}
                    {!pendingDrivers &&
                      !waiting &&
                      (backend.dispatchMode !== "round_robin" ||
                        !queuedDrivers.length) && (
                        <p>Nenhuma pendência neste momento.</p>
                      )}
                  </div>
                </section>
              </div>
            </>
          )}
          {section === "rides" && (
            <>
              <div
                className="ops-filters"
                role="group"
                aria-label="Filtrar corridas"
              >
                {[
                  "Ativas",
                  "Aguardando",
                  "Finalizadas",
                  "Canceladas",
                  "Todas",
                ].map((filter) => (
                  <button
                    type="button"
                    key={filter}
                    className={rideFilter === filter ? "active" : ""}
                    onClick={() => setRideFilter(filter)}
                  >
                    {filter}
                  </button>
                ))}
              </div>
              <section className="ops-card">
                <div className="ops-toolbar">
                  <label className="ops-search">
                    <Search />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Buscar corrida, passageiro ou motorista"
                      aria-label="Buscar corrida"
                    />
                  </label>
                  <input
                    type="date"
                    value={rideDate}
                    onChange={(event) => setRideDate(event.target.value)}
                    aria-label="Filtrar por data"
                  />
                </div>
                {rideResults.length ? (
                  <div className="ops-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Passageiro</th>
                          <th>Motorista</th>
                          <th>Origem → destino</th>
                          <th>Horário</th>
                          <th>Valor</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rideResults.map((ride) => (
                          <tr key={ride.id}>
                            <td>{ride.passenger?.full_name || "Passageiro"}</td>
                            <td>{ride.driver?.full_name || "Aguardando"}</td>
                            <td className="ops-route-cell">
                              {ride.origin_address} → {ride.destination_address}
                            </td>
                            <td>{date(ride.created_at)}</td>
                            <td>
                              {money(ride.final_fare_cents ?? ride.fare_cents)}
                            </td>
                            <td>
                              <span className={`ops-badge ${ride.status}`}>
                                {rideLabel(ride.status)}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="ops-small-button"
                                onClick={() => setSelectedRide(ride)}
                              >
                                Ver corrida
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  empty(
                    <Route />,
                    loadingLists
                      ? "Carregando corridas"
                      : "Nenhuma corrida encontrada",
                    "As corridas desta categoria aparecerão aqui.",
                  )
                )}
              </section>
              <section className="ops-card">
                <div className="ops-card-head"><h2>Cancelamentos pelo motorista</h2></div>
                {driverCancellations.length ? <div className="ops-table-wrap"><table>
                  <thead><tr><th>Corrida</th><th>Motorista</th><th>Passageiro</th><th>Motivo</th><th>Etapa</th><th>Horário</th><th></th></tr></thead>
                  <tbody>{driverCancellations.map((item) => <tr key={item.id}>
                    <td>#{item.ride_id.slice(0, 8)}</td><td>{item.driver_name}</td><td>{item.passenger_name}</td>
                    <td>{item.reason_text}</td><td>{rideLabel(item.previous_status)}</td><td>{date(item.cancelled_at)}</td>
                    <td><button type="button" className="ops-small-button" onClick={() => setSelectedCancellation(item)}>Detalhes</button></td>
                  </tr>)}</tbody>
                </table></div> : <p>Nenhum cancelamento pelo motorista registrado.</p>}
              </section>
              <section className="ops-card">
                <div className="ops-card-head"><h2>Indicadores por motorista</h2></div>
                {cancellationMetrics.length ? <div className="ops-table-wrap"><table>
                  <thead><tr><th>Motorista</th><th>Aceitas</th><th>Concluídas</th><th>Cancelamentos</th><th>Taxa de cancelamento</th></tr></thead>
                  <tbody>{cancellationMetrics.map((item) => <tr key={item.driver_id}><td>{item.driver_name}</td><td>{item.accepted}</td><td>{item.completed}</td><td>{item.cancelled}</td><td>{item.cancellation_rate}%</td></tr>)}</tbody>
                </table></div> : <p>Sem indicadores ainda.</p>}
              </section>
            </>
          )}
          {section === "drivers" && (
            <>
              <div className="ops-page-action">
                <span>
                  {drivers.length} motoristas cadastrados · {pendingDrivers}{" "}
                  pendentes
                </span>
              </div>
              <div
                className="ops-filters"
                role="group"
                aria-label="Filtrar motoristas"
              >
                {[
                  "Todos",
                  "Online",
                  "Em corrida",
                  "Na fila",
                  "Pendentes",
                  "Bloqueados",
                ].map((filter) => (
                  <button
                    type="button"
                    key={filter}
                    className={driverFilter === filter ? "active" : ""}
                    onClick={() => setDriverFilter(filter)}
                  >
                    {filter}
                  </button>
                ))}
              </div>
              <section className="ops-card">
                <div className="ops-toolbar">
                  <label className="ops-search">
                    <Search />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Buscar motorista"
                      aria-label="Buscar motorista"
                    />
                  </label>
                </div>
                {driverResults.length ? (
                  <div className="ops-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Motorista</th>
                          <th>Telefone</th>
                          <th>Moto / placa</th>
                          <th>Situação</th>
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {driverResults.map((driver) => {
                          const queueEntry = queue.find(
                            (entry) => entry.driverId === driver.profile_id,
                          );
                          const pending = driver.approval_status === "pending";
                          return (
                            <tr key={driver.profile_id}>
                              <td>
                                <div className="ops-person">
                                  <span>
                                    {driver.profiles?.full_name?.slice(0, 1) ||
                                      "M"}
                                  </span>
                                  <b>
                                    {driver.profiles?.full_name || "Motorista"}
                                  </b>
                                </div>
                              </td>
                              <td>{driver.profiles?.phone || "—"}</td>
                              <td>
                                {driver.vehicles?.[0]
                                  ? `${driver.vehicles[0].brand} ${driver.vehicles[0].model} · ${driver.vehicles[0].plate}`
                                  : "Moto não cadastrada"}
                              </td>
                              <td>
                                <span
                                  className={`ops-badge ${queueEntry?.status === "paused" ? "pendente" : driverStatus(driver).toLowerCase().replace(" ", "-")}`}
                                >
                                  {queueEntry?.status === "paused"
                                    ? "Pausado"
                                    : driverStatus(driver)}
                                </span>
                              </td>
                              <td>
                                <div className="ops-row-actions">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedDriver(driver)}
                                  >
                                    {pending ? "Ver cadastro" : "Ver"}
                                  </button>
                                  {pending ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={
                                          busy === driver.profile_id ||
                                          !driver.vehicles?.length
                                        }
                                        onClick={() =>
                                          void run(
                                            driver.profile_id,
                                            () =>
                                              backend.approveDriver(
                                                driver.profile_id,
                                                "approved",
                                              ),
                                            "Motorista aprovado.",
                                          )
                                        }
                                      >
                                        Aprovar
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy === driver.profile_id}
                                        onClick={() =>
                                          void run(
                                            driver.profile_id,
                                            () =>
                                              backend.approveDriver(
                                                driver.profile_id,
                                                "rejected",
                                              ),
                                            "Cadastro recusado.",
                                          )
                                        }
                                      >
                                        Recusar
                                      </button>
                                    </>
                                  ) : driver.approval_status === "approved" &&
                                    !driver.profiles?.blocked ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={
                                          busy === driver.profile_id ||
                                          !driver.online ||
                                          queueEntry?.status === "on_ride" ||
                                          queueEntry?.status === "offer"
                                        }
                                        onClick={() =>
                                          void queueAction(
                                            driver.profile_id,
                                            queueEntry?.status !== "paused",
                                          )
                                        }
                                      >
                                        {queueEntry?.status === "paused"
                                          ? "Reintegrar"
                                          : "Pausar"}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busy === driver.profile_id}
                                        onClick={() =>
                                          void run(
                                            driver.profile_id,
                                            () =>
                                              backend.approveDriver(
                                                driver.profile_id,
                                                "blocked",
                                              ),
                                            "Motorista bloqueado.",
                                          )
                                        }
                                      >
                                        Bloquear
                                      </button>
                                    </>
                                  ) : driver.profiles?.blocked ? (
                                    <button
                                      type="button"
                                      disabled={busy === driver.profile_id}
                                      onClick={() =>
                                        void run(
                                          driver.profile_id,
                                          () =>
                                            backend.approveDriver(
                                              driver.profile_id,
                                              "pending",
                                            ),
                                          "Motorista enviado para revisão.",
                                        )
                                      }
                                    >
                                      Revisar
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  empty(
                    <Bike />,
                    "Nenhum motorista encontrado",
                    "Os cadastros aparecerão aqui.",
                  )
                )}
              </section>
            </>
          )}
          {section === "dispatch" && (
            <>
              <div className="ops-dispatch-mode">
                <div>
                  <small>MODO ATUAL</small>
                  <h2>
                    {backend.dispatchMode === "broadcast"
                      ? "Oferta simultânea"
                      : "Fila / rodízio"}
                  </h2>
                  <p>
                    {backend.dispatchMode === "broadcast"
                      ? "Todos os motoristas elegíveis recebem a oferta."
                      : "As ofertas seguem a ordem dos motoristas disponíveis."}
                  </p>
                </div>
                <div className="ops-dispatch-controls">
                  <label>
                    <input
                      type="radio"
                      name="ops-dispatch"
                      checked={selectedDispatchMode === "round_robin"}
                      onChange={() => setDispatchChoice("round_robin")}
                    />{" "}
                    Fila / rodízio
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="ops-dispatch"
                      checked={selectedDispatchMode === "broadcast"}
                      onChange={() => setDispatchChoice("broadcast")}
                    />{" "}
                    Oferta simultânea
                  </label>
                  <button
                    type="button"
                    className="ops-primary"
                    disabled={
                      !backend.dispatchReady ||
                      busy === "dispatch" ||
                      selectedDispatchMode === backend.dispatchMode
                    }
                    onClick={() =>
                      void run(
                        "dispatch",
                        () => backend.saveDispatchMode(selectedDispatchMode),
                        "Modo de distribuição atualizado.",
                      ).then((ok) => {
                        if (ok) setDispatchChoice(null);
                      })
                    }
                  >
                    {busy === "dispatch" ? "Salvando…" : "Aplicar modo"}
                  </button>
                </div>
              </div>
              {!backend.dispatchReady && (
                <div className="ops-message ops-error" role="alert">
                  Atualização do banco de dados necessária para alternar o modo.
                </div>
              )}
              <section className="ops-card">
                <div className="ops-card-head">
                  <div>
                    <h2>
                      {backend.dispatchMode === "broadcast"
                        ? "Motoristas disponíveis"
                        : "Fila de motoristas"}
                    </h2>
                    <p>
                      {backend.dispatchMode === "round_robin"
                        ? "Ordem e situação atualizadas automaticamente"
                        : "Situação atualizada automaticamente"}
                    </p>
                  </div>
                  <span>{queuedDrivers.length} disponíveis</span>
                </div>
                {queueError && <p role="alert">{queueError}</p>}
                {queuedDrivers.length ? (
                  <div className="ops-queue-list">
                    {queuedDrivers.map((entry, index) => (
                      <div key={entry.driverId}>
                        <strong>
                          {backend.dispatchMode === "round_robin" ? (
                            `${index + 1}º`
                          ) : (
                            <Bike aria-hidden="true" />
                          )}
                        </strong>
                        <span>
                          <b>{entry.name}</b>
                          <small>
                            {backend.dispatchMode === "broadcast"
                              ? "Recebe ofertas simultâneas"
                              : index === 0
                                ? "Próximo motorista"
                                : "Disponível na fila"}
                          </small>
                        </span>
                        <span className="ops-badge disponível">Disponível</span>
                        <button
                          type="button"
                          disabled={busy === entry.driverId}
                          onClick={() => void queueAction(entry.driverId, true)}
                        >
                          Pausar
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  empty(
                    <Bike />,
                    backend.dispatchMode === "round_robin"
                      ? "Fila vazia"
                      : "Nenhum motorista disponível",
                    "Motoristas online e disponíveis aparecerão aqui.",
                  )
                )}
              </section>
              <section className="ops-card ops-dispatch-other">
                <div className="ops-card-head">
                  <h2>Em corrida e pausados</h2>
                </div>
                {queue
                  .filter((entry) =>
                    ["on_ride", "offer", "paused"].includes(entry.status),
                  )
                  .map((entry) => (
                    <div className="ops-queue-other" key={entry.driverId}>
                      <b>{entry.name}</b>
                      <span
                        className={`ops-badge ${entry.status === "paused" ? "pendente" : "em-corrida"}`}
                      >
                        {entry.status === "paused"
                          ? "Pausado"
                          : entry.status === "offer"
                            ? "Recebendo oferta"
                            : "Em corrida"}
                      </span>
                      {entry.status === "paused" && (
                        <button
                          type="button"
                          className="ops-small-button"
                          disabled={busy === entry.driverId}
                          onClick={() =>
                            void queueAction(entry.driverId, false)
                          }
                        >
                          Reintegrar
                        </button>
                      )}
                    </div>
                  ))}
                {!queue.some((entry) =>
                  ["on_ride", "offer", "paused"].includes(entry.status),
                ) && <p>Nenhum motorista em corrida ou pausado.</p>}
              </section>
            </>
          )}
          {section === "passengers" && (
            <section className="ops-card">
              <div className="ops-toolbar">
                <label className="ops-search">
                  <Search />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar passageiro por nome ou telefone"
                  />
                </label>
                <span>{passengers.length} passageiros</span>
              </div>
              {passengerResults.length ? (
                <div className="ops-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Nome</th>
                        <th>Telefone</th>
                        <th>Corridas</th>
                        <th>Última corrida</th>
                        <th>Cadastro</th>
                        <th>Status</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {passengerResults.map((passenger) => (
                        <tr key={passenger.profile_id}>
                          <td>
                            <b>
                              {passenger.profiles?.full_name || "Passageiro"}
                            </b>
                          </td>
                          <td>{passenger.profiles?.phone || "—"}</td>
                          <td>{passenger.rides.length}</td>
                          <td>{date(passenger.rides[0]?.created_at)}</td>
                          <td>{date(passenger.created_at)}</td>
                          <td>
                            <span
                              className={`ops-badge ${passenger.profiles?.blocked ? "suspenso" : "disponível"}`}
                            >
                              {passenger.profiles?.blocked
                                ? "Bloqueado"
                                : "Ativo"}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="ops-small-button"
                              onClick={() => setSelectedPassenger(passenger)}
                            >
                              Histórico
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                empty(
                  <Users />,
                  "Nenhum passageiro encontrado",
                  "Novos cadastros aparecerão aqui.",
                )
              )}
            </section>
          )}
          {section === "finance" && (
            <>
              <div className="ops-subkpis">
                <div>
                  <small>Faturamento hoje</small>
                  <strong>{money(stats?.revenueCents)}</strong>
                </div>
                <div>
                  <small>Últimos 30 dias</small>
                  <strong>
                    {money(backend.adminFinance?.summary.grossCents)}
                  </strong>
                </div>
                <div>
                  <small>Recebido</small>
                  <strong>
                    {money(backend.adminFinance?.summary.receivedCents)}
                  </strong>
                </div>
                <div>
                  <small>Corridas finalizadas</small>
                  <strong>
                    {backend.adminFinance?.summary.completedRides || 0}
                  </strong>
                </div>
              </div>
              <div className="ops-finance-grid">
                <section className="ops-card">
                  <div className="ops-card-head">
                    <div>
                      <h2>Faturamento por motorista</h2>
                      <p>Últimos 30 dias</p>
                    </div>
                  </div>
                  {backend.adminFinance?.byDriver.length ? (
                    <div className="ops-chart">
                      {backend.adminFinance.byDriver
                        .slice(0, 8)
                        .map((driver) => (
                          <div key={driver.driverId}>
                            <span>{driver.driverName}</span>
                            <i
                              style={{
                                width: `${Math.max(4, (driver.grossCents / Math.max(...backend.adminFinance!.byDriver.map((item) => item.grossCents))) * 100)}%`,
                              }}
                            />
                            <b>{money(driver.grossCents)}</b>
                          </div>
                        ))}
                    </div>
                  ) : (
                    empty(
                      <Wallet />,
                      "Sem faturamento no período",
                      "O gráfico será formado pelas corridas finalizadas.",
                    )
                  )}
                </section>
                <section className="ops-card">
                  <div className="ops-card-head">
                    <h2>Resumo financeiro</h2>
                  </div>
                  <div className="ops-money-list">
                    <p>
                      <span>Pix confirmado</span>
                      <b>{money(backend.adminFinance?.summary.pixPaidCents)}</b>
                    </p>
                    <p>
                      <span>Dinheiro confirmado</span>
                      <b>
                        {money(backend.adminFinance?.summary.cashPaidCents)}
                      </b>
                    </p>
                    <p>
                      <span>Pendente</span>
                      <b>{money(backend.adminFinance?.summary.pendingCents)}</b>
                    </p>
                    <p>
                      <span>Cancelamentos</span>
                      <b>{backend.adminFinance?.summary.cancellations || 0}</b>
                    </p>
                  </div>
                </section>
              </div>
            </>
          )}
          {section === "fares" && (
            <>
              <div className="ops-fare-hero">
                <div>
                  <small>TARIFA PADRÃO</small>
                  <strong>{money(standardFare?.amount_cents ?? 0)}</strong>
                  <span className="ops-badge disponível">Ativa</span>
                </div>
                <p>Aplicada quando o destino não possui uma tarifa especial.</p>
              </div>
              {standardFare && (
                <section className="ops-card ops-base-fare">
                  <div className="ops-card-head">
                    <div>
                      <h2>Editar tarifa padrão</h2>
                      <p>
                        Valor cobrado quando não há tarifa específica para a
                        região
                      </p>
                    </div>
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      void run(
                        "standard-fare",
                        () =>
                          backend.saveFareRegion({
                            id: standardFare.id,
                            name: String(data.get("name")),
                            amountCents: Math.round(
                              Number(data.get("amount")) * 100,
                            ),
                            active: true,
                          }),
                        "Tarifa padrão atualizada.",
                      );
                    }}
                  >
                    <label>
                      Nome
                      <input
                        name="name"
                        defaultValue={standardFare.name}
                        required
                      />
                    </label>
                    <label>
                      Valor em R$
                      <input
                        name="amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        defaultValue={(standardFare.amount_cents / 100).toFixed(
                          2,
                        )}
                        required
                      />
                    </label>
                    <button
                      className="ops-primary"
                      disabled={busy === "standard-fare"}
                    >
                      Salvar
                    </button>
                  </form>
                </section>
              )}
              <section className="ops-card">
                <div className="ops-card-head">
                  <div>
                    <h2>Regiões com tarifa especial</h2>
                    <p>Valores por bairro ou região da cidade</p>
                  </div>
                  <button
                    type="button"
                    className="ops-primary"
                    onClick={() =>
                      document.getElementById("ops-new-region")?.focus()
                    }
                  >
                    <Plus /> Nova região
                  </button>
                </div>
                <div className="ops-fare-table">
                  <div className="ops-fare-head">
                    <span>Região</span>
                    <span>Valor</span>
                    <span>Status</span>
                    <span>Última alteração</span>
                    <span>Ação</span>
                  </div>
                  {regionalFares.map((region) => (
                    <form
                      key={region.id}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const data = new FormData(event.currentTarget);
                        void run(
                          `fare-${region.id}`,
                          () =>
                            backend.saveFareRegion({
                              id: region.id,
                              name: String(data.get("name")),
                              amountCents: Math.round(
                                Number(data.get("amount")) * 100,
                              ),
                              active: data.get("active") === "on",
                            }),
                          "Tarifa atualizada.",
                        );
                      }}
                    >
                      <input name="name" defaultValue={region.name} required />
                      <input
                        name="amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        defaultValue={(region.amount_cents / 100).toFixed(2)}
                        required
                      />
                      <label>
                        <input
                          type="checkbox"
                          name="active"
                          defaultChecked={region.active}
                        />{" "}
                        Ativa
                      </label>
                      <span>{date(region.updated_at)}</span>
                      <button
                        type="submit"
                        disabled={busy === `fare-${region.id}`}
                      >
                        {busy === `fare-${region.id}` ? "Salvando…" : "Salvar"}
                      </button>
                    </form>
                  ))}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const data = new FormData(form);
                      void run(
                        "new-fare",
                        () =>
                          backend.saveFareRegion({
                            name: String(data.get("name")),
                            amountCents: Math.round(
                              Number(data.get("amount")) * 100,
                            ),
                            active: true,
                          }),
                        "Região cadastrada.",
                      ).then((ok) => {
                        if (ok) form.reset();
                      });
                    }}
                  >
                    <input
                      id="ops-new-region"
                      name="name"
                      placeholder="Nova região"
                      required
                    />
                    <input
                      name="amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Valor em R$"
                      required
                    />
                    <span className="ops-badge disponível">Ativa</span>
                    <span>—</span>
                    <button type="submit" disabled={busy === "new-fare"}>
                      {busy === "new-fare" ? "Salvando…" : "Adicionar"}
                    </button>
                  </form>
                </div>
              </section>
              <section className="ops-card ops-base-fare">
                <div className="ops-card-head">
                  <div>
                    <h2>Tarifa por distância e tempo</h2>
                    <p>
                      Configuração guardada para regras futuras; não altera a
                      cobrança por região atual
                    </p>
                  </div>
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(
                      "base-fare",
                      () =>
                        backend.saveFareConfig({
                          baseCents: Math.round(
                            Number(currentFareForm.base) * 100,
                          ),
                          perKmCents: Math.round(
                            Number(currentFareForm.perKm) * 100,
                          ),
                          perMinuteCents: Math.round(
                            Number(currentFareForm.perMinute) * 100,
                          ),
                          minimumCents: Math.round(
                            Number(currentFareForm.minimum) * 100,
                          ),
                          configured: true,
                        }),
                      "Estrutura futura da tarifa atualizada.",
                    ).then((ok) => {
                      if (ok) setFareForm(null);
                    });
                  }}
                >
                  {(
                    [
                      ["base", "Tarifa base"],
                      ["perKm", "Por km"],
                      ["perMinute", "Por minuto"],
                      ["minimum", "Mínima"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={currentFareForm[key]}
                        onChange={(event) =>
                          setFareForm({
                            ...currentFareForm,
                            [key]: event.target.value,
                          })
                        }
                      />
                    </label>
                  ))}
                  <button
                    className="ops-primary"
                    disabled={busy === "base-fare"}
                  >
                    {busy === "base-fare"
                      ? "Salvando…"
                      : "Salvar para o futuro"}
                  </button>
                </form>
              </section>
            </>
          )}
          {section === "places" && (
            <section className="ops-card">
              <div className="ops-card-head">
                <div>
                  <h2>
                    {backend.quickPlaces.filter((place) => place.active).length}{" "}
                    pontos ativos
                  </h2>
                  <p>Arraste pelo ícone para definir a ordem no aplicativo</p>
                </div>
                <button
                  type="button"
                  className="ops-primary"
                  onClick={() => editPlace()}
                >
                  <Plus /> Novo ponto
                </button>
              </div>
              <div className="ops-toolbar">
                <label className="ops-search">
                  <Search />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar ponto"
                  />
                </label>
              </div>
              {backend.quickPlacesError && (
                <p role="alert">{backend.quickPlacesError}</p>
              )}
              {placeResults.length ? (
                <div className="ops-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Ordem</th>
                        <th>Ponto</th>
                        <th>Endereço</th>
                        <th>Categoria</th>
                        <th>Destaque</th>
                        <th>Status</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {placeResults.map((place) => (
                        <tr
                          key={place.id}
                          draggable
                          onDragStart={() => setDragged(place.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => void reorder(place.id)}
                        >
                          <td>
                            <GripVertical className="ops-drag" />{" "}
                            {place.sort_order}
                          </td>
                          <td>
                            <b>{place.name}</b>
                          </td>
                          <td>{place.address}</td>
                          <td>
                            {categories.find(
                              (item) => item.value === place.category,
                            )?.label || place.category}
                          </td>
                          <td>{place.featured ? "Sim" : "—"}</td>
                          <td>
                            <span
                              className={`ops-badge ${place.active ? "disponível" : "offline"}`}
                            >
                              {place.active ? "Ativo" : "Inativo"}
                            </span>
                          </td>
                          <td>
                            <div className="ops-row-actions">
                              <button
                                type="button"
                                onClick={() => editPlace(place)}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                disabled={busy === `toggle-${place.id}`}
                                onClick={() =>
                                  void run(
                                    `toggle-${place.id}`,
                                    () =>
                                      backend.saveQuickPlace({
                                        id: place.id,
                                        name: place.name,
                                        address: place.address,
                                        latitude: place.latitude,
                                        longitude: place.longitude,
                                        category: place.category,
                                        icon: place.icon,
                                        color: place.color,
                                        active: !place.active,
                                        featured: place.featured,
                                        locationVerified: true,
                                        sortOrder: place.sort_order,
                                      }),
                                    place.active
                                      ? "Ponto desativado."
                                      : "Ponto reativado.",
                                  )
                                }
                              >
                                {place.active ? "Desativar" : "Ativar"}
                              </button>
                              <button
                                type="button"
                                className="danger"
                                disabled={busy === `delete-${place.id}`}
                                onClick={() => {
                                  if (
                                    window.confirm(`Excluir “${place.name}”?`)
                                  )
                                    void run(
                                      `delete-${place.id}`,
                                      () => backend.deleteQuickPlace(place.id),
                                      "Ponto excluído.",
                                    );
                                }}
                                aria-label={`Excluir ${place.name}`}
                              >
                                <Trash2 />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                empty(
                  <MapPin />,
                  "Nenhum ponto encontrado",
                  "Cadastre locais úteis para aparecerem no aplicativo.",
                )
              )}
            </section>
          )}
          {section === "support" && (
            <>
              <div className="ops-subkpis">
                <div>
                  <small>Novos</small>
                  <strong>0</strong>
                </div>
                <div>
                  <small>Em atendimento</small>
                  <strong>0</strong>
                </div>
                <div>
                  <small>Resolvidos</small>
                  <strong>0</strong>
                </div>
              </div>
              <section className="ops-card">
                {empty(
                  <Headphones />,
                  "Nenhuma solicitação de suporte",
                  "Quando houver chamados integrados à operação, eles aparecerão nesta central.",
                )}
              </section>
            </>
          )}
          {section === "settings" && (
            <section className="ops-card ops-settings">
              <ShieldCheck />
              <h2>Configurações da operação</h2>
              <p>
                As tarifas e os pontos da cidade possuem áreas próprias no menu.
                A sessão administrativa está protegida pela autenticação do
                MotoPombal.
              </p>
              <div>
                <button
                  type="button"
                  className="ops-small-button"
                  onClick={() => navigate("fares")}
                >
                  Gerenciar tarifas
                </button>
                <button
                  type="button"
                  className="ops-small-button"
                  onClick={() => navigate("places")}
                >
                  Gerenciar pontos
                </button>
              </div>
              <h3>Chegada, espera e cancelamento</h3>
              {!cancellationReady && <p>Atualização do banco necessária antes de salvar estas regras.</p>}
              {cancellationPolicy && <div className="ops-cancellation-policy">
                <label><input type="checkbox" checked={cancellationPolicy.fee_active}
                  onChange={(event) => setCancellationPolicy({ ...cancellationPolicy, fee_active: event.target.checked })} /> Ativar taxa de cancelamento</label>
                {([
                  ["free_seconds", "Tolerância gratuita (segundos)"],
                  ["minimum_travel_meters", "Deslocamento mínimo comprovado (m)"],
                  ["fee_cents", "Taxa após deslocamento (centavos)"],
                  ["after_arrival_fee_cents", "Taxa após chegada / ausência (centavos)"],
                  ["arrival_radius_meters", "Raio de chegada (m)"],
                  ["no_show_seconds", "Espera por passageiro (segundos)"],
                ] as Array<[Exclude<keyof CancellationPolicy, "fee_active" | "preserve_queue_on_passenger_cancel">, string]>).map(([key,label]) =>
                  <label key={key}>{label}<input type="number" min="0" value={cancellationPolicy[key]}
                    onChange={(event) => setCancellationPolicy({ ...cancellationPolicy, [key]: Number(event.target.value) })} /></label>)}
                <label><input type="checkbox" checked={cancellationPolicy.preserve_queue_on_passenger_cancel}
                  onChange={(event) => setCancellationPolicy({ ...cancellationPolicy, preserve_queue_on_passenger_cancel: event.target.checked })} /> Preservar prioridade quando passageiro cancela</label>
                <button type="button" className="ops-primary" disabled={!cancellationReady || busy === "cancellation"}
                  onClick={() => void run("cancellation", () => backend.updateAdminCancellationPolicy(cancellationPolicy), "Política de cancelamento salva.")}>
                  {busy === "cancellation" ? "Salvando…" : "Salvar regras"}</button>
              </div>}
            </section>
          )}
        </main>
      </div>
      {(selectedRide || selectedCancellation || selectedPassenger || selectedDriver || placeEditor) && (
        <div
          className="ops-drawer-backdrop"
          onClick={() => {
            setSelectedRide(null);
            setSelectedCancellation(null);
            setSelectedPassenger(null);
            setSelectedDriver(null);
            setPlaceEditor(false);
          }}
        >
          <aside
            className="ops-drawer"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ops-drawer-head">
              <div>
                <small>MOTOPOMBAL · ADMIN</small>
                <h2>
                  {selectedCancellation
                    ? `Cancelamento #${selectedCancellation.ride_id.slice(0, 8)}`
                    : selectedRide
                    ? `Corrida #${selectedRide.id.slice(0, 8)}`
                    : selectedPassenger
                      ? selectedPassenger.profiles?.full_name || "Passageiro"
                      : selectedDriver
                        ? selectedDriver.profiles?.full_name || "Motorista"
                        : placeForm.id
                          ? "Editar ponto"
                          : "Novo ponto"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedRide(null);
                  setSelectedCancellation(null);
                  setSelectedPassenger(null);
                  setSelectedDriver(null);
                  setPlaceEditor(false);
                }}
                aria-label="Fechar painel"
              >
                <X />
              </button>
            </div>
            {selectedCancellation && <div className="ops-detail"><dl>
              <dt>Corrida</dt><dd>#{selectedCancellation.ride_id.slice(0, 8)}</dd>
              <dt>Motorista</dt><dd>{selectedCancellation.driver_name}</dd>
              <dt>Passageiro</dt><dd>{selectedCancellation.passenger_name}</dd>
              <dt>Origem</dt><dd>{selectedCancellation.ride?.origin_address || "—"}</dd>
              <dt>Destino</dt><dd>{selectedCancellation.ride?.destination_address || "—"}</dd>
              <dt>Etapa anterior</dt><dd>{rideLabel(selectedCancellation.previous_status)}</dd>
              <dt>Motivo</dt><dd>{selectedCancellation.reason_text}</dd>
              <dt>Solicitada</dt><dd>{date(selectedCancellation.ride?.requested_at)}</dd>
              <dt>Aceita</dt><dd>{date(selectedCancellation.accepted_at)}</dd>
              <dt>Cancelada</dt><dd>{date(selectedCancellation.cancelled_at)}</dd>
              <dt>Tempo após aceite</dt><dd>{selectedCancellation.accepted_at ? `${Math.max(0, Math.round((Date.parse(selectedCancellation.cancelled_at) - Date.parse(selectedCancellation.accepted_at)) / 60000))} min` : "—"}</dd>
              <dt>Chegou ao embarque</dt><dd>{selectedCancellation.arrived_at ? "Sim" : "Não"}</dd>
              <dt>Tempo de espera</dt><dd>{selectedCancellation.arrived_at ? `${Math.max(0, Math.round((Date.parse(selectedCancellation.cancelled_at) - Date.parse(selectedCancellation.arrived_at)) / 60_000))} min` : "—"}</dd>
              <dt>Redistribuída</dt><dd>{selectedCancellation.next_driver_id ? "Sim" : selectedCancellation.ride?.status === "procurando_motorista" ? "Procurando motorista" : "Sem novo motorista"}</dd>
              <dt>Motorista seguinte</dt><dd>{selectedCancellation.next_driver_name || "—"}</dd>
              <dt>GPS registrado</dt><dd>{selectedCancellation.gps_lat != null && selectedCancellation.gps_lng != null ? `${selectedCancellation.gps_lat.toFixed(5)}, ${selectedCancellation.gps_lng.toFixed(5)} (${selectedCancellation.gps_accuracy_meters ?? "?"} m)` : "Indisponível"}</dd>
            </dl></div>}
            {selectedRide && (
              <div className="ops-detail">
                <span className={`ops-badge ${selectedRide.status}`}>
                  {rideLabel(selectedRide.status)}
                </span>
                <dl>
                  <dt>Passageiro</dt>
                  <dd>{selectedRide.passenger?.full_name || "—"}</dd>
                  <dt>Motorista</dt>
                  <dd>{selectedRide.driver?.full_name || "Aguardando"}</dd>
                  <dt>Origem</dt>
                  <dd>{selectedRide.origin_address}</dd>
                  <dt>Destino</dt>
                  <dd>{selectedRide.destination_address}</dd>
                  <dt>Distância</dt>
                  <dd>{(selectedRide.distance_meters / 1000).toFixed(1)} km</dd>
                  <dt>Valor</dt>
                  <dd>
                    {money(
                      selectedRide.final_fare_cents ?? selectedRide.fare_cents,
                    )}
                  </dd>
                  <dt>Pagamento</dt>
                  <dd>
                    {selectedRide.payment_method === "cash"
                      ? "Dinheiro"
                      : "Pix"}{" "}
                    · {selectedRide.payment_status.replaceAll("_", " ")}
                  </dd>
                  <dt>Solicitada</dt>
                  <dd>{date(selectedRide.requested_at)}</dd>
                  <dt>Início</dt>
                  <dd>{date(selectedRide.started_at)}</dd>
                  <dt>Conclusão</dt>
                  <dd>{date(selectedRide.finished_at)}</dd>
                  {selectedRide.early_end_at && <><dt>Encerramento antecipado</dt><dd>{date(selectedRide.early_end_at)}</dd><dt>Motivo informado</dt><dd>{selectedRide.early_end_reason || "—"}</dd></>}
                  {selectedRide.status === "cancelada" && <>
                    <dt>Encerramento</dt><dd>{selectedRide.termination_code === "no_show" ? "Passageiro não apareceu" : "Cancelamento"}</dd>
                    <dt>Cancelada em</dt><dd>{date(selectedRide.cancelled_at)}</dd>
                    <dt>Motivo</dt><dd>{selectedRide.cancellation_reason || "—"}</dd>
                    <dt>Taxa avaliada</dt><dd>{money(selectedRide.cancellation_fee_cents)}</dd>
                    <dt>Motivo da taxa</dt><dd>{selectedRide.cancellation_fee_reason || "Sem taxa"}</dd>
                    <dt>Tempo após aceite</dt><dd>{selectedRide.cancellation_evidence?.elapsed_seconds ?? "—"} s</dd>
                    <dt>Pontos GPS válidos</dt><dd>{selectedRide.cancellation_evidence?.approach_points ?? "—"}</dd>
                    <dt>Deslocamento comprovado</dt><dd>{selectedRide.cancellation_evidence?.verified_displacement_meters ?? "—"} m</dd>
                    <dt>Distância ao embarque</dt><dd>{selectedRide.cancellation_evidence?.distance_to_pickup_meters ?? "—"} m</dd>
                  </>}
                </dl>
                <div className="ops-detail-map">
                  <RealMap
                    origin={{
                      lat: selectedRide.origin_lat,
                      lng: selectedRide.origin_lng,
                      label: selectedRide.origin_address,
                    }}
                    destination={{
                      lat: selectedRide.destination_lat,
                      lng: selectedRide.destination_lng,
                      label: selectedRide.destination_address,
                    }}
                  />
                </div>
                {selectedRide.status === "finalizada" &&
                  selectedRide.payment_method === "cash" &&
                  selectedRide.payment_status === "aguardando_pagamento" && (
                    <button
                      type="button"
                      className="ops-primary"
                      disabled={busy === selectedRide.id}
                      onClick={() =>
                        void run(
                          selectedRide.id,
                          () => backend.confirmCashPayment(selectedRide.id),
                          "Recebimento em dinheiro confirmado.",
                        ).then((ok) => {
                          if (ok) setSelectedRide(null);
                        })
                      }
                    >
                      {busy === selectedRide.id
                        ? "Confirmando…"
                        : "Confirmar dinheiro recebido"}
                    </button>
                  )}
              </div>
            )}
            {selectedPassenger && (
              <div className="ops-detail">
                <dl>
                  <dt>Telefone</dt>
                  <dd>{selectedPassenger.profiles?.phone || "—"}</dd>
                  <dt>Cadastro</dt>
                  <dd>{date(selectedPassenger.created_at)}</dd>
                  <dt>Corridas</dt>
                  <dd>{selectedPassenger.rides.length}</dd>
                </dl>
                <h3>Histórico de corridas</h3>
                {selectedPassenger.rides.length
                  ? selectedPassenger.rides.map((ride) => (
                      <article className="ops-history" key={ride.id}>
                        <b>
                          #{ride.id.slice(0, 8)} · {rideLabel(ride.status)}
                        </b>
                        <small>
                          {date(ride.created_at)} ·{" "}
                          {money(ride.final_fare_cents ?? ride.fare_cents)}
                        </small>
                        <p>
                          {ride.origin_address} → {ride.destination_address}
                        </p>
                      </article>
                    ))
                  : empty(
                      <Route />,
                      "Sem corridas",
                      "Este passageiro ainda não realizou corridas.",
                    )}
              </div>
            )}
            {selectedDriver && (
              <div className="ops-detail">
                <div className="ops-driver-profile">
                  <span>
                    {selectedDriver.profiles?.full_name?.slice(0, 1) || "M"}
                  </span>
                  <div>
                    <strong>
                      {selectedDriver.profiles?.full_name || "Motorista"}
                    </strong>
                    <small>
                      {selectedDriver.profiles?.phone ||
                        "Telefone não informado"}
                    </small>
                  </div>
                </div>
                <span
                  className={`ops-badge ${driverStatus(selectedDriver).toLowerCase().replace(" ", "-")}`}
                >
                  {driverStatus(selectedDriver)}
                </span>
                <dl>
                  <dt>Veículo</dt>
                  <dd>
                    {selectedDriver.vehicles?.[0]
                      ? `${selectedDriver.vehicles[0].brand} ${selectedDriver.vehicles[0].model}`
                      : "Não cadastrado"}
                  </dd>
                  <dt>Placa</dt>
                  <dd>{selectedDriver.vehicles?.[0]?.plate || "—"}</dd>
                  <dt>Corridas</dt>
                  <dd>{selectedDriver.trips_count}</dd>
                  <dt>Avaliação</dt>
                  <dd>{selectedDriver.rating}</dd>
                </dl>
                <div className="ops-drawer-actions">
                  {selectedDriver.approval_status !== "approved" &&
                    !selectedDriver.profiles?.blocked && (
                      <button
                        type="button"
                        className="ops-primary"
                        disabled={
                          busy === selectedDriver.profile_id ||
                          !selectedDriver.vehicles?.length
                        }
                        onClick={() =>
                          void run(
                            selectedDriver.profile_id,
                            () =>
                              backend.approveDriver(
                                selectedDriver.profile_id,
                                "approved",
                              ),
                            "Motorista aprovado.",
                          ).then((ok) => {
                            if (ok) setSelectedDriver(null);
                          })
                        }
                      >
                        <Check /> Aprovar
                      </button>
                    )}
                  {selectedDriver.approval_status === "pending" &&
                    !selectedDriver.profiles?.blocked && (
                      <button
                        type="button"
                        disabled={busy === selectedDriver.profile_id}
                        onClick={() =>
                          void run(
                            selectedDriver.profile_id,
                            () =>
                              backend.approveDriver(
                                selectedDriver.profile_id,
                                "rejected",
                              ),
                            "Cadastro recusado.",
                          ).then((ok) => {
                            if (ok) setSelectedDriver(null);
                          })
                        }
                      >
                        Recusar
                      </button>
                    )}
                  {!selectedDriver.profiles?.blocked && (
                    <button
                      type="button"
                      disabled={busy === selectedDriver.profile_id}
                      onClick={() =>
                        void run(
                          selectedDriver.profile_id,
                          () =>
                            backend.approveDriver(
                              selectedDriver.profile_id,
                              "blocked",
                            ),
                          "Motorista bloqueado.",
                        ).then((ok) => {
                          if (ok) setSelectedDriver(null);
                        })
                      }
                    >
                      Bloquear
                    </button>
                  )}
                  {selectedDriver.profiles?.blocked && (
                    <button
                      type="button"
                      disabled={busy === selectedDriver.profile_id}
                      onClick={() =>
                        void run(
                          selectedDriver.profile_id,
                          () =>
                            backend.approveDriver(
                              selectedDriver.profile_id,
                              "pending",
                            ),
                          "Motorista reativado para revisão.",
                        ).then((ok) => {
                          if (ok) setSelectedDriver(null);
                        })
                      }
                    >
                      Reativar para revisão
                    </button>
                  )}
                </div>
              </div>
            )}
            {placeEditor && (
              <form
                className="ops-place-form"
                onSubmit={(event) => void savePlace(event)}
              >
                <label>
                  Nome do local
                  <input
                    required
                    value={placeForm.name}
                    onChange={(event) =>
                      setPlaceForm({ ...placeForm, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Categoria
                  <select
                    value={placeForm.category}
                    onChange={(event) =>
                      setPlaceForm({
                        ...placeForm,
                        category: event.target.value as QuickPlace["category"],
                      })
                    }
                  >
                    {categories.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Endereço
                  <input
                    required
                    minLength={5}
                    value={placeForm.address}
                    onChange={(event) =>
                      setPlaceForm({
                        ...placeForm,
                        address: event.target.value,
                        locationVerified: false,
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="ops-small-button"
                  disabled={busy === "geocode" || !placeForm.address.trim()}
                  onClick={() =>
                    void run(
                      "geocode",
                      async () => {
                        const result = await backend.geocodeQuickPlace(
                          placeForm.address,
                        );
                        setPlaceForm((current) => ({
                          ...current,
                          latitude: String(result.latitude),
                          longitude: String(result.longitude),
                          address: result.address,
                          locationVerified: true,
                        }));
                        setMapPoint({
                          lat: result.latitude,
                          lng: result.longitude,
                        });
                      },
                      "Endereço localizado. Confira o marcador no mapa.",
                    )
                  }
                >
                  {busy === "geocode" ? "Buscando…" : "Buscar endereço"}
                </button>
                <div className="ops-form-row">
                  <label>
                    Latitude
                    <input
                      required
                      type="number"
                      step="any"
                      value={placeForm.latitude}
                      onChange={(event) =>
                        setPlaceForm({
                          ...placeForm,
                          latitude: event.target.value,
                          locationVerified: false,
                        })
                      }
                    />
                  </label>
                  <label>
                    Longitude
                    <input
                      required
                      type="number"
                      step="any"
                      value={placeForm.longitude}
                      onChange={(event) =>
                        setPlaceForm({
                          ...placeForm,
                          longitude: event.target.value,
                          locationVerified: false,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="ops-place-map">
                  <RealMap
                    pickPoint={mapPoint}
                    onPick={(point) => {
                      setMapPoint(point);
                      setPlaceForm((current) => ({
                        ...current,
                        latitude: point.lat.toFixed(7),
                        longitude: point.lng.toFixed(7),
                        locationVerified: true,
                      }));
                    }}
                  />
                </div>
                <small>
                  {placeForm.locationVerified
                    ? "Localização confirmada no mapa"
                    : "Toque no mapa para confirmar a localização"}
                </small>
                <label>
                  Ícone
                  <select
                    value={placeForm.icon}
                    onChange={(event) =>
                      setPlaceForm({
                        ...placeForm,
                        icon: event.target.value as QuickPlace["icon"],
                      })
                    }
                  >
                    <option value="pin">Pin</option>
                    <option value="hospital">Hospital</option>
                    <option value="bus">Rodoviária</option>
                    <option value="education">Escola</option>
                    <option value="government">Prefeitura</option>
                    <option value="square">Praça</option>
                    <option value="store">Comércio</option>
                  </select>
                </label>
                <div className="ops-form-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={placeForm.featured}
                      onChange={(event) =>
                        setPlaceForm({
                          ...placeForm,
                          featured: event.target.checked,
                        })
                      }
                    />{" "}
                    Destaque
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={placeForm.active}
                      onChange={(event) =>
                        setPlaceForm({
                          ...placeForm,
                          active: event.target.checked,
                        })
                      }
                    />{" "}
                    Ativo
                  </label>
                </div>
                <div className="ops-drawer-actions">
                  <button type="button" onClick={() => setPlaceEditor(false)}>
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="ops-primary"
                    disabled={busy === "place" || !placeForm.locationVerified}
                  >
                    {busy === "place" ? "Salvando…" : "Salvar ponto"}
                  </button>
                </div>
              </form>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
