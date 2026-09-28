"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Activity,
  Bell,
  Banknote,
  Bike,
  Building2,
  Bus,
  Calculator,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Crosshair,
  Dumbbell,
  Fuel,
  Gauge,
  GraduationCap,
  Headphones,
  History,
  Home as HomeIcon,
  Hotel,
  Layers,
  Landmark,
  LockKeyhole,
  MapPin,
  Menu,
  MessageCircle,
  Navigation,
  Pill,
  Phone,
  Route,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Star,
  Store,
  Ticket,
  TreePine,
  Trophy,
  Trash2,
  Utensils,
  GripVertical,
  Church,
  Pencil,
  UserRound,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { AuthPortal } from "@/components/auth/auth-portal";
import { RealMap, type LivePoint } from "@/components/map/real-map";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useMotoVip,
  type AddressResult,
  type FareConfig,
  type NearbyDriver,
  type QuickPlace,
  type Ride,
} from "@/hooks/use-moto-vip";

type Backend = ReturnType<typeof useMotoVip>;
type Estimate = {
  origin: { address: string; lat: number; lng: number };
  destination: { address: string; lat: number; lng: number };
  distanceMeters: number;
  durationSeconds: number;
  geometry: string;
  fareCents: number;
  fareRegion: { id: string; name: string; isDefault: boolean };
  pricingMode: "region";
};

function money(cents = 0) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}
function minutes(seconds = 0) {
  return Math.max(1, Math.round(seconds / 60));
}
function initials(name = "Moto VIP") {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}
function routePoints(geometry?: string) {
  try {
    const parsed = JSON.parse(geometry || "{}") as {
      coordinates?: Array<[number, number]>;
    };
    return (
      parsed.coordinates?.map(([lng, lat]) => [lat, lng] as [number, number]) ||
      []
    );
  } catch {
    return [];
  }
}
function durationLabel(seconds = 0) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  return hours ? `${hours}h ${mins}min` : `${Math.max(1, mins)} min`;
}
function paymentLabel(status?: string) {
  return (
    (
      {
        aguardando_pagamento: "Pendente",
        pago: "Pago",
        expirado: "Expirado",
        falhou: "Falhou",
        reembolsado: "Reembolsado",
        cancelado: "Cancelado",
      } as Record<string, string>
    )[status || ""] || "Pendente"
  );
}

const QUICK_PLACE_ICONS = [
  { value: "hospital", label: "Hospital/UPA", icon: Activity },
  { value: "education", label: "Escola/Faculdade", icon: GraduationCap },
  { value: "bus", label: "Rodoviária", icon: Bus },
  { value: "government", label: "Prefeitura/órgão público", icon: Building2 },
  { value: "market", label: "Mercado", icon: ShoppingCart },
  { value: "pharmacy", label: "Farmácia", icon: Pill },
  { value: "square", label: "Praça", icon: TreePine },
  { value: "fuel", label: "Posto", icon: Fuel },
  { value: "bank", label: "Banco", icon: Landmark },
  { value: "atm", label: "Caixa eletrônico", icon: Banknote },
  { value: "restaurant", label: "Restaurante", icon: Utensils },
  { value: "hotel", label: "Hotel", icon: Hotel },
  { value: "church", label: "Igreja", icon: Church },
  { value: "sports", label: "Campo/quadra", icon: Trophy },
  { value: "gym", label: "Academia", icon: Dumbbell },
  { value: "store", label: "Loja", icon: Store },
  { value: "bike", label: "Moto VIP", icon: Bike },
  { value: "pin", label: "Local genérico", icon: MapPin },
] as const;

const QUICK_PLACE_CATEGORIES: Array<{ value: QuickPlace["category"] | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "hospital", label: "Saúde" },
  { value: "education", label: "Educação" },
  { value: "bus_station", label: "Transporte" },
  { value: "government", label: "Serviços públicos" },
  { value: "market", label: "Mercados" },
  { value: "pharmacy", label: "Farmácias" },
  { value: "square", label: "Praças" },
  { value: "fuel", label: "Postos" },
  { value: "bank", label: "Bancos" },
  { value: "atm", label: "Caixas" },
  { value: "restaurant", label: "Restaurantes" },
  { value: "hotel", label: "Hotéis" },
  { value: "church", label: "Igrejas" },
  { value: "sports", label: "Esportes" },
  { value: "gym", label: "Academias" },
  { value: "store", label: "Lojas" },
  { value: "moto_vip", label: "Moto VIP" },
  { value: "generic", label: "Outros" },
];

function QuickPlaceIcon({ name, color }: { name: QuickPlace["icon"]; color?: string }) {
  const entry = QUICK_PLACE_ICONS.find((item) => item.value === name) || QUICK_PLACE_ICONS.at(-1)!;
  const Icon = entry.icon;
  return <Icon style={color ? { color } : undefined} aria-hidden="true" />;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup ${compact ? "compact" : ""}`} aria-label="GoSyXP · Moto VIP">
      <Image
        className="brand-logo-image"
        src="/gosyxp-logo.png"
        alt="GoSyXP — Ideias que entregam resultados"
        width={320}
        height={107}
        priority
      />
    </div>
  );
}

function AvatarPhoto({ src, alt }: { src: string; alt: string }) {
  return <Image src={src} alt={alt} fill sizes="52px" unoptimized />;
}

function PasswordRecovery({ backend }: { backend: Backend }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (password.length < 8) {
      setMessage("Use uma senha com pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setMessage("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    const result = await backend.updatePassword(password);
    setMessage(
      result.error?.message ||
        "Senha atualizada. Você já pode continuar no Moto VIP.",
    );
    setBusy(false);
  }
  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="auth-logo">
          <Bike />
        </div>
        <span>
          MOTO <b>VIP</b>
        </span>
        <p>Mobilidade rápida e segura em Ribeira do Pombal.</p>
      </section>
      <section className="auth-card">
        <span className="auth-kicker">RECUPERAÇÃO SEGURA</span>
        <h1>Crie uma nova senha</h1>
        <p>Use pelo menos 8 caracteres.</p>
        <form onSubmit={submit}>
          <label>
            <LockKeyhole />
            <input
              required
              minLength={8}
              type="password"
              placeholder="Nova senha"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            <LockKeyhole />
            <input
              required
              minLength={8}
              type="password"
              placeholder="Confirmar nova senha"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {message && (
            <div className="auth-message" role="status">
              {message}
            </div>
          )}
          <Button disabled={busy} className="primary-cta">
            {busy ? "AGUARDE…" : "SALVAR NOVA SENHA"}
          </Button>
        </form>
      </section>
    </main>
  );
}

function MapCanvas({
  origin,
  destination,
  driver,
  nearbyDrivers = [],
  route = [],
  admin = false,
  connected = true,
  onRequestLocation,
}: {
  origin?: LivePoint;
  destination?: LivePoint;
  driver?: LivePoint;
  nearbyDrivers?: NearbyDriver[];
  route?: Array<[number, number]>;
  admin?: boolean;
  connected?: boolean;
  onRequestLocation?: () => void;
}) {
  const [locationStatus, setLocationStatus] = useState(
    "Usar minha localização",
  );
  const [currentLocation, setCurrentLocation] = useState<LivePoint>();
  function requestLocation() {
    if (!("geolocation" in navigator)) {
      setLocationStatus("GPS indisponível");
      return;
    }
    setLocationStatus("Localizando…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCurrentLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: "Sua localização",
        });
        setLocationStatus("Localização ativa");
      },
      () => setLocationStatus("Permissão necessária"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 },
    );
  }
  return (
    <div
      className={`map-canvas ${admin ? "map-admin" : ""}`}
      role="region"
      aria-label="Mapa da corrida"
    >
      <RealMap
        origin={origin || currentLocation}
        destination={destination}
        driver={driver}
        nearbyDrivers={nearbyDrivers.map((point) => ({
          lat: point.latitude,
          lng: point.longitude,
          label: `Motorista disponível · ${(point.distanceMeters / 1000).toFixed(1)} km`,
        }))}
        route={route}
      />
      {!admin && (
        <div className={`connection-pill ${connected ? "online" : "offline"}`} role="status">
          {connected ? <Wifi /> : <WifiOff />}
          <span>{connected ? "Conectado ao Moto VIP" : "Reconectando ao Moto VIP"}</span>
        </div>
      )}
      <div className="map-tools">
        <button
          aria-label={locationStatus}
          title={locationStatus}
          onClick={onRequestLocation || requestLocation}
        >
          <Crosshair />
        </button>
        <span className="map-provider"><Layers /> OPENSTREETMAP · MAPA REAL</span>
      </div>
    </div>
  );
}

function AddressField({
  backend,
  icon,
  label,
  value,
  selected,
  onChange,
  onSelect,
  accent,
  placeholder = "Digite um endereço",
  onUseGps,
  onOpenMap,
  gpsBusy = false,
  inputId,
}: {
  backend: Backend;
  icon: React.ReactNode;
  label: string;
  value: string;
  selected: AddressResult | null;
  onChange: (value: string) => void;
  onSelect: (result: AddressResult) => void;
  accent?: boolean;
  placeholder?: string;
  onUseGps?: () => void;
  onOpenMap: () => void;
  gpsBusy?: boolean;
  inputId?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const query = value.trim();
    if (!focused || selected || query.length < 3) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError("");
      void backend.searchAddresses(query).then(({ results }) => {
        if (!current) return;
        setSuggestions(results);
        setSearching(false);
        if (!results.length) setSearchError("Nenhum endereço encontrado. Você pode escolher o ponto no mapa.");
      }).catch((error: unknown) => {
        if (!current) return;
        setSearching(false);
        setSearchError(error instanceof Error ? error.message : "Não foi possível buscar endereços.");
      });
    }, 450);
    return () => { current = false; window.clearTimeout(timer); };
  }, [backend, focused, selected, value]);

  return (
    <div className={`smart-address ${focused ? "is-focused" : ""}`}>
      <label className={`address-field ${accent ? "accent" : ""}`}>
        <span className="field-icon">{icon}</span>
        <span className="field-copy">
          <small>{label}</small>
          <input
            id={inputId}
            required
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 180)}
            onChange={(event) => { setSuggestions([]); setSearchError(""); setSearching(event.target.value.trim().length >= 3); onChange(event.target.value); }}
            aria-label={label}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={focused && (suggestions.length > 0 || Boolean(searchError))}
            aria-controls={`${inputId}-suggestions`}
          />
        </span>
        <span className="field-actions">
          {onUseGps && (
            <button type="button" className="field-action" onClick={onUseGps} aria-label="Usar localização atual" disabled={gpsBusy}>
              <Crosshair className={gpsBusy ? "is-spinning" : ""} />
            </button>
          )}
          <button type="button" className="field-action" onClick={onOpenMap} aria-label={`Escolher ${label.toLowerCase()} no mapa`}>
            <MapPin />
          </button>
        </span>
      </label>
      {focused && !selected && value.trim().length >= 3 && (
        <div id={`${inputId}-suggestions`} className="address-suggestions" role="listbox" aria-label={`Sugestões para ${label}`}>
          {searching && <div className="address-search-state"><Search className="is-spinning" /> Buscando endereços…</div>}
          {!searching && suggestions.map((result) => (
            <button key={result.id} type="button" role="option" aria-selected="false" onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelect(result); setFocused(false); }}>
              <MapPin />
              <span><b>{result.shortAddress}</b><small>{result.approximate ? "Número aproximado — ajuste o ponto no mapa se necessário" : result.address}</small></span>
              <ChevronRight />
            </button>
          ))}
          {!searching && searchError && <div className="address-search-state error">{searchError}</div>}
          {!searching && (searchError || suggestions.some((item) => item.approximate)) && (
            <button type="button" className="address-map-option" onMouseDown={(event) => event.preventDefault()} onClick={onOpenMap}><Layers /> Escolher ou ajustar no mapa</button>
          )}
        </div>
      )}
    </div>
  );
}

function MapAddressPicker({
  backend,
  kind,
  initial,
  onClose,
  onConfirm,
}: {
  backend: Backend;
  kind: "origin" | "destination";
  initial: AddressResult | null;
  onClose: () => void;
  onConfirm: (result: AddressResult) => void;
}) {
  const [point, setPoint] = useState<LivePoint>(initial || { lat: -10.8373, lng: -38.5357, label: "Centro de Ribeira do Pombal" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function confirm() {
    setBusy(true);
    setMessage("Identificando o endereço do ponto…");
    try {
      const result = await backend.reverseAddress(point.lat, point.lng);
      onConfirm(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível identificar esse ponto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="map-picker-overlay" role="dialog" aria-modal="true" aria-labelledby="map-picker-title">
      <div className="map-picker-sheet">
        <header>
          <div><small>SELEÇÃO MANUAL</small><h2 id="map-picker-title">Escolher {kind === "origin" ? "origem" : "destino"} no mapa</h2></div>
          <button type="button" onClick={onClose} aria-label="Fechar mapa"><X /></button>
        </header>
        <p>Clique no mapa ou arraste o marcador até o ponto exato. Depois confirme o endereço.</p>
        <div className="map-picker-canvas">
          <RealMap pickPoint={point} onPick={setPoint} />
        </div>
        <div className="map-picker-coordinates"><MapPin /> {point.lat.toFixed(6)}, {point.lng.toFixed(6)}</div>
        {message && <div className="map-picker-message" role="status">{message}</div>}
        <div className="map-picker-actions">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="button" onClick={confirm} disabled={busy}><Check /> {busy ? "Confirmando…" : "Confirmar este ponto"}</button>
        </div>
      </div>
    </div>
  );
}

function gpsPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Este aparelho não oferece acesso ao GPS."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => reject(new Error(geolocationMessage(error))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

function geolocationMessage(error: GeolocationPositionError) {
  if (error.code === 1)
    return "Permissão de localização negada";
  if (error.code === 2)
    return "Não foi possível obter sua localização. Verifique se o GPS está ativado.";
  if (error.code === 3)
    return "Não foi possível obter sua localização. O GPS demorou para responder.";
  return "Não foi possível obter sua localização";
}

function rideStage(ride: Ride | null, hasEstimate: boolean) {
  if (!ride) return hasEstimate ? "quote" : "draft";
  if (["solicitada", "procurando_motorista"].includes(ride.status))
    return "searching";
  if (["aceita", "motorista_a_caminho"].includes(ride.status))
    return "accepted";
  if (ride.status === "motorista_chegou") return "arrived";
  if (ride.status === "em_corrida") return "riding";
  return "draft";
}

function NotificationsPanel({ backend, id }: { backend: Backend; id?: string }) {
  const [pushMessage, setPushMessage] = useState("");
  async function enablePush() {
    setPushMessage("");
    try {
      await backend.enablePushNotifications();
      setPushMessage("Notificações Push ativadas neste aparelho.");
    } catch (error) {
      setPushMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível ativar as notificações Push.",
      );
    }
  }
  return (
    <details className="notification-panel" id={id}>
      <summary>
        <span>
          <Bell /> Notificações
        </span>
        {backend.unreadNotifications > 0 && (
          <b>{backend.unreadNotifications}</b>
        )}
      </summary>
      <div className="notification-actions">
        <button onClick={enablePush}>ATIVAR PUSH</button>
        {backend.unreadNotifications > 0 && (
          <button onClick={() => backend.markNotificationsRead()}>
            MARCAR COMO LIDAS
          </button>
        )}
      </div>
      {pushMessage && (
        <small className="notification-message">{pushMessage}</small>
      )}
      <div className="notification-list">
        {backend.notifications.length ? (
          backend.notifications.slice(0, 8).map((item) => (
            <button
              key={item.id}
              className={item.read_at ? "read" : ""}
              onClick={() =>
                !item.read_at && backend.markNotificationsRead(item.id)
              }
            >
              <b>{item.title}</b>
              <span>{item.body}</span>
              <small>
                {new Intl.DateTimeFormat("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(new Date(item.created_at))}
              </small>
            </button>
          ))
        ) : (
          <p>Nenhuma notificação ainda.</p>
        )}
      </div>
    </details>
  );
}

function PassengerPanel({ backend }: { backend: Backend }) {
  const [originAddress, setOriginAddress] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [originPoint, setOriginPoint] = useState<AddressResult | null>(null);
  const [destinationPoint, setDestinationPoint] = useState<AddressResult | null>(null);
  const [locationStatus, setLocationStatus] = useState("");
  const [gpsBusy, setGpsBusy] = useState(false);
  const [mapPicker, setMapPicker] = useState<"origin" | "destination" | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [nearbyDrivers, setNearbyDrivers] = useState<NearbyDriver[]>([]);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [selectedQuickPlace, setSelectedQuickPlace] = useState<QuickPlace | null>(null);
  const [quickPlacesOpen, setQuickPlacesOpen] = useState(false);
  const [quickPlaceSearch, setQuickPlaceSearch] = useState("");
  const [quickPlaceCategory, setQuickPlaceCategory] = useState<QuickPlace["category"] | "all">("all");
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);
  const ride = backend.activeRide || backend.completedRide;
  const stage =
    backend.completedRide && !backend.activeRide
      ? "finished"
      : rideStage(ride, Boolean(estimate));
  const origin = ride
    ? { lat: ride.origin_lat, lng: ride.origin_lng, label: ride.origin_address }
    : estimate
      ? {
          lat: estimate.origin.lat,
          lng: estimate.origin.lng,
          label: estimate.origin.address,
        }
      : originPoint
        ? { lat: originPoint.lat, lng: originPoint.lng, label: originPoint.shortAddress }
        : undefined;
  const destination = ride
    ? {
        lat: ride.destination_lat,
        lng: ride.destination_lng,
        label: ride.destination_address,
      }
    : estimate
      ? {
          lat: estimate.destination.lat,
          lng: estimate.destination.lng,
          label: estimate.destination.address,
        }
      : destinationPoint
        ? { lat: destinationPoint.lat, lng: destinationPoint.lng, label: destinationPoint.shortAddress }
        : undefined;
  const driverName = ride?.driver?.profiles?.full_name || "Seu Moto VIP";
  const vehicle = ride?.driver?.vehicles?.[0];
  const driverDistance =
    ride && backend.driverLocation
      ? distanceMeters(
          { lat: backend.driverLocation.lat, lng: backend.driverLocation.lng },
          { lat: ride.origin_lat, lng: ride.origin_lng },
        )
      : undefined;
  const route = routePoints(ride?.route_geometry || estimate?.geometry);
  const completedEntry = ride
    ? backend.passengerHistory.find((item) => item.id === ride.id)
    : undefined;
  const payment = completedEntry?.payment;
  const rating = completedEntry?.rating;
  const quickPlaces = backend.quickPlaces || [];
  const featuredQuickPlaces = quickPlaces.filter((place) => place.active && place.featured).slice(0, 6);
  const visibleQuickPlaces = quickPlaces.filter((place) => {
    if (!place.active) return false;
    if (quickPlaceCategory !== "all" && place.category !== quickPlaceCategory) return false;
    const search = quickPlaceSearch.trim().toLocaleLowerCase("pt-BR");
    return !search || `${place.name} ${place.address}`.toLocaleLowerCase("pt-BR").includes(search);
  });

  async function locateDevice() {
    setLocationStatus("Obtendo sua localização…");
    const position = await gpsPosition();
    const result = await backend.reverseAddress(position.coords.latitude, position.coords.longitude);
    await backend.updateLocation(position).catch(() => undefined);
    return result;
  }

  async function useCurrentLocation() {
    setNotice("");
    setGpsBusy(true);
    try {
      const result = await locateDevice();
      setOriginPoint(result);
      setOriginAddress(result.address);
      setEstimate(null);
      setLocationStatus("Localização encontrada");
      setNotice("Localização encontrada");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível obter sua localização";
      setLocationStatus(message);
      setNotice(message);
    } finally {
      setGpsBusy(false);
    }
  }

  function chooseQuickPlace(place: QuickPlace) {
    setSelectedQuickPlace(place);
    setDestinationAddress(place.address);
    setDestinationPoint({ id: place.id, address: place.address, shortAddress: place.name, lat: place.latitude, lng: place.longitude, city: "Ribeira do Pombal", state: "BA", approximate: false });
    setEstimate(null);
    setQuickPlacesOpen(false);
    setNotice(`${place.name} definido como destino. Toque em “Ver valor da corrida” para calcular a rota.`);
    requestAnimationFrame(() => document.getElementById("destination-address")?.focus());
  }

  function openPanel(id: string) {
    const panel = document.getElementById(id) as HTMLDetailsElement | null;
    if (panel) {
      panel.open = true;
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  async function calculate() {
    if (!destinationAddress.trim()) {
      setNotice("Informe o destino.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      let resolvedOrigin = originPoint;
      if (!resolvedOrigin && !originAddress.trim()) {
        resolvedOrigin = await locateDevice();
        setOriginPoint(resolvedOrigin);
        setOriginAddress(resolvedOrigin.address);
        setLocationStatus("Localização encontrada");
      }
      const result = await backend.estimateRide({
        origin: resolvedOrigin
          ? { address: resolvedOrigin.address, lat: resolvedOrigin.lat, lng: resolvedOrigin.lng }
          : { address: originAddress },
        destination: destinationPoint
          ? { address: destinationPoint.address, lat: destinationPoint.lat, lng: destinationPoint.lng }
          : selectedQuickPlace
            ? { address: selectedQuickPlace.address, lat: selectedQuickPlace.latitude, lng: selectedQuickPlace.longitude }
            : { address: destinationAddress },
      });
      const nearby = await backend.findNearbyDrivers(result.origin);
      setEstimate(result);
      setOriginAddress(result.origin.address);
      setDestinationAddress(result.destination.address);
      setOriginPoint({ id: "estimated-origin", address: result.origin.address, shortAddress: result.origin.address.split(",").slice(0, 3).join(","), lat: result.origin.lat, lng: result.origin.lng, city: "", state: "", approximate: false });
      setDestinationPoint({ id: "estimated-destination", address: result.destination.address, shortAddress: result.destination.address.split(",").slice(0, 3).join(","), lat: result.destination.lat, lng: result.destination.lng, city: "", state: "", approximate: false });
      setNearbyDrivers(nearby.drivers);
      setNotice(
        nearby.drivers.length
          ? `${nearby.drivers.length} motorista(s) disponível(is) em até ${nearby.radiusKm.toFixed(1)} km.`
          : `Nenhum motorista online com GPS recente em até ${nearby.radiusKm.toFixed(1)} km.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível calcular a corrida.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function requestRide() {
    if (!estimate) return;
    setBusy(true);
    setNotice("");
    try {
      await backend.requestRide({
        origin: estimate.origin,
        destination: estimate.destination,
        paymentMethod: "pix",
      });
      setEstimate(null);
      setNearbyDrivers([]);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível solicitar a corrida.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancelRide() {
    if (!ride) return;
    setBusy(true);
    try {
      await backend.transitionRide(
        ride.id,
        "cancelada",
        "Cancelada pelo passageiro",
      );
      await backend.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Não foi possível cancelar.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function createPix() {
    if (!ride) return;
    setBusy(true);
    setNotice("");
    try {
      await backend.createPixCharge(ride.id);
      await backend.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar a cobrança Pix.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submitRating() {
    if (!ride) return;
    setBusy(true);
    setNotice("");
    try {
      await backend.rateRide(
        ride.id,
        ratingScore,
        ratingComment.trim() || undefined,
      );
      await backend.refresh();
      setNotice("Avaliação enviada. Obrigado!");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Não foi possível avaliar.",
      );
    } finally {
      setBusy(false);
    }
  }

  const status =
    stage === "draft"
      ? [
          "Pronto para ir?",
          "Peça sua moto",
          "Informe o destino para calcular sua corrida.",
        ]
      : stage === "quote"
        ? [
            "Resumo da corrida",
            "Tudo certo para chamar",
            "Preço e tempo calculados pela rota real.",
          ]
        : stage === "searching"
          ? [
              "Solicitação enviada",
              "Procurando um Moto VIP próximo…",
              "Motoristas online da região receberam sua solicitação.",
            ]
          : stage === "accepted"
            ? [
                "Corrida confirmada",
                `${driverName} está a caminho`,
                "Acompanhe a aproximação em tempo real.",
              ]
            : stage === "arrived"
              ? [
                  "Ele chegou",
                  "Seu Moto VIP está esperando",
                  "Encontre o motorista no ponto de embarque.",
                ]
              : stage === "finished"
                ? [
                    "Viagem concluída",
                    "Corrida finalizada",
                    "Resumo calculado e registrado pelo Moto VIP.",
                  ]
                : [
                    "Corrida em andamento",
                    "Rumo ao destino",
                    `${minutes(ride?.estimated_duration_seconds || ride?.duration_seconds)} min estimados.`,
                  ];
  return (
    <div className="passenger-shell">
      <section className="passenger-map">
        <MapCanvas
          origin={origin}
          destination={destination}
          nearbyDrivers={nearbyDrivers}
          route={route}
          connected={isOnline && backend.realtimeStatus !== "CLOSED"}
          onRequestLocation={useCurrentLocation}
          driver={
            backend.driverLocation
              ? {
                  lat: backend.driverLocation.lat,
                  lng: backend.driverLocation.lng,
                  label: driverName,
                }
              : undefined
          }
        />
      </section>
      <section className="ride-sheet">
        <div className="sheet-handle" />
        <div className="status-heading">
          <div>
            <span>{status[0]}</span>
            <h1>{status[1]}</h1>
            <p>{status[2]}</p>
          </div>
          {stage === "draft" && (
            <div className="rider-watermark" aria-hidden="true"><Bike /></div>
          )}
          {stage === "searching" && (
            <span className="search-pulse">
              <i />
            </span>
          )}
        </div>
        {notice && (
          <div className="auth-message" role="status">
            {notice}
          </div>
        )}
        {(stage === "draft" || stage === "quote") && (
          <>
            <div className="address-stack">
              <AddressField
                backend={backend}
                icon={<MapPin />}
                label="Onde você está?"
                value={originAddress}
                selected={originPoint}
                onChange={(value) => { setOriginAddress(value); setOriginPoint(null); setEstimate(null); setLocationStatus(""); }}
                onSelect={(result) => { setOriginPoint(result); setOriginAddress(result.address); setEstimate(null); setLocationStatus("Localização encontrada"); }}
                placeholder="Digite o endereço ou use o GPS"
                onUseGps={useCurrentLocation}
                onOpenMap={() => setMapPicker("origin")}
                gpsBusy={gpsBusy}
                inputId="origin-address"
              />
              <AddressField
                backend={backend}
                icon={<Navigation />}
                label="Para onde você vai?"
                value={destinationAddress}
                selected={destinationPoint}
                onChange={(value) => {
                  setDestinationAddress(value);
                  setDestinationPoint(null);
                  setSelectedQuickPlace(null);
                  setEstimate(null);
                }}
                onSelect={(result) => {
                  setDestinationPoint(result);
                  setDestinationAddress(result.address);
                  setSelectedQuickPlace(null);
                  setEstimate(null);
                  setNotice(result.approximate ? "Rua encontrada. Confirme ou ajuste o ponto no mapa." : "Destino selecionado.");
                }}
                placeholder="Digite um endereço ou selecione um ponto"
                onOpenMap={() => setMapPicker("destination")}
                inputId="destination-address"
                accent
              />
            </div>
            {locationStatus && <div className={`location-feedback ${locationStatus === "Localização encontrada" ? "success" : ""}`} role="status"><Crosshair /> {locationStatus}</div>}
            <div className="quick-place-section">
              <div className="quick-place-heading">
                <b>Pontos rápidos de Ribeira do Pombal</b>
                <button type="button" onClick={() => setQuickPlacesOpen(true)}>Ver mais <ChevronRight /></button>
              </div>
              {backend.quickPlacesLoading ? (
                <div className="quick-place-state">Carregando pontos rápidos…</div>
              ) : featuredQuickPlaces.length ? (
                <div className="quick-places" aria-label="Destinos rápidos">
                  {featuredQuickPlaces.map((place) => (
                    <button
                      type="button"
                      key={place.id}
                      className="quick-place"
                      onClick={() => chooseQuickPlace(place)}
                      title={place.address}
                    >
                      <QuickPlaceIcon name={place.icon} color={place.color} />
                      <span>{place.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="quick-place-state error">
                  {backend.quickPlacesError || "Nenhum ponto rápido disponível"}
                </div>
              )}
            </div>
            {estimate && (
              <div className="quote-card">
                <div className="quote-product">
                  <span>
                    <Bike />
                  </span>
                  <div>
                    <b>
                      {estimate.fareRegion.isDefault
                        ? "Tarifa padrão da cidade"
                        : `Tarifa ${estimate.fareRegion.name}`}
                    </b>
                    <small>
                      Preço por região · cálculo protegido no servidor
                    </small>
                  </div>
                  <strong>{money(estimate.fareCents)}</strong>
                </div>
                <div className="quote-meta">
                  <span>
                    <Route /> Rota informativa:{" "}
                    {(estimate.distanceMeters / 1000).toFixed(1)} km
                  </span>
                  <span>
                    <Clock3 /> Tempo estimado:{" "}
                    {minutes(estimate.durationSeconds)} min
                  </span>
                  <span>
                    <ShieldCheck /> Preço confirmado novamente ao solicitar
                  </span>
                </div>
              </div>
            )}
            <Button
              disabled={busy}
              className="primary-cta"
              onClick={estimate ? requestRide : calculate}
            >
              {!busy && !estimate && <Calculator />}
              {busy
                ? "AGUARDE…"
                : estimate
                  ? "CHAMAR MOTO VIP"
                  : "VER VALOR DA CORRIDA"}
              <ChevronRight />
            </Button>
            {stage === "draft" && (
              <div className="home-shortcuts" aria-label="Atalhos">
                <button type="button" onClick={() => openPanel("passenger-history")}>
                  <History /><span><b>Minhas corridas</b><small>Ver histórico</small></span><ChevronRight />
                </button>
                <button type="button" onClick={() => openPanel("passenger-notifications")}>
                  <Bell /><span><b>Notificações</b><small>Novidades</small></span><ChevronRight />
                </button>
                <button type="button" onClick={() => setNotice("Perfil e suporte estão disponíveis no menu da conta.")}>
                  <Settings2 /><span><b>Mais opções</b><small>Perfil e suporte</small></span><ChevronRight />
                </button>
              </div>
            )}
          </>
        )}
        {stage === "searching" && (
          <div className="searching-content">
            <div className="finding-riders">
              <span>
                <Bike />
              </span>
              <span>
                <Bike />
              </span>
              <span>
                <Bike />
              </span>
            </div>
            <div className="route-summary">
              <span>
                <MapPin /> {ride?.origin_address}
              </span>
              <i />
              <span>
                <Navigation /> {ride?.destination_address}
              </span>
            </div>
            <Button
              disabled={busy}
              variant="outline"
              className="secondary-cta"
              onClick={cancelRide}
            >
              <X /> Cancelar solicitação
            </Button>
          </div>
        )}
        {stage === "finished" && ride && (
          <div className="completion-card">
            <div className="completion-check">
              <Check />
            </div>
            <div className="completion-route">
              <span>{ride.origin_address}</span>
              <i>→</i>
              <span>{ride.destination_address}</span>
            </div>
            <div className="completion-grid">
              <div>
                <small>Motorista</small>
                <b>{driverName}</b>
              </div>
              <div>
                <small>Distância percorrida</small>
                <b>
                  {((ride.actual_distance_meters || 0) / 1000).toFixed(2)} km
                </b>
              </div>
              <div>
                <small>Duração real</small>
                <b>{durationLabel(ride.actual_duration_seconds)}</b>
              </div>
              <div>
                <small>Valor final</small>
                <b>{money(ride.final_fare_cents ?? ride.fare_cents)}</b>
              </div>
            </div>
            <div className="payment-result">
              <CreditCard />
              <div>
                <small>
                  {ride.payment_method === "cash"
                    ? "DINHEIRO · PAGAMENTO AO MOTORISTA"
                    : "PIX"}
                </small>
                <b>{paymentLabel(payment?.status || ride.payment_status)}</b>
              </div>
              {ride.payment_method === "pix" && payment?.status !== "pago" && (
                <Button disabled={busy} onClick={createPix}>
                  GERAR PIX
                </Button>
              )}
            </div>
            {ride.payment_method === "pix" && (
              <small className="completion-note">
                O valor vem do fechamento do servidor. Sem provedor configurado,
                nenhuma cobrança ou aprovação será criada.
              </small>
            )}
            {rating ? (
              <div className="rating-done">
                <Star /> Avaliação enviada: {rating.score}/5
              </div>
            ) : (
              <div className="rating-form">
                <b>Avalie o motorista</b>
                <div>
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button
                      key={score}
                      className={score <= ratingScore ? "active" : ""}
                      onClick={() => setRatingScore(score)}
                      aria-label={`${score} estrelas`}
                    >
                      <Star />
                    </button>
                  ))}
                </div>
                <textarea
                  maxLength={500}
                  placeholder="Comentário opcional"
                  value={ratingComment}
                  onChange={(event) => setRatingComment(event.target.value)}
                />
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={submitRating}
                >
                  ENVIAR AVALIAÇÃO
                </Button>
              </div>
            )}
            <Button
              className="primary-cta"
              onClick={backend.dismissCompletedRide}
            >
              NOVA CORRIDA
              <ChevronRight />
            </Button>
          </div>
        )}
        {["accepted", "arrived", "riding"].includes(stage) && ride && (
          <>
            <div className="driver-card">
              <div className="driver-avatar">
                {ride.driver?.profiles?.avatar_url ? (
                  <AvatarPhoto
                    src={ride.driver.profiles.avatar_url}
                    alt={`Foto de ${driverName}`}
                  />
                ) : (
                  initials(driverName)
                )}
                <span className="verified">
                  <Check />
                </span>
              </div>
              <div className="driver-copy">
                <b>{driverName}</b>
                <span>
                  <Star /> {ride.driver?.rating?.toFixed(1) || "—"}
                </span>
                <small>
                  {vehicle
                    ? `${vehicle.brand} ${vehicle.model} · ${vehicle.color} · ${vehicle.plate}`
                    : "Veículo cadastrado"}
                </small>
              </div>
              <div className="driver-actions">
                {ride.driver?.profiles?.phone && (
                  <a
                    href={`tel:${ride.driver.profiles.phone}`}
                    aria-label="Ligar"
                  >
                    <Phone />
                  </a>
                )}
                <button aria-label="Mensagem">
                  <MessageCircle />
                </button>
              </div>
            </div>
            <div className="ride-progress">
              <span className="done">
                <Check />
              </span>
              <i className="done" />
              <span className={stage !== "accepted" ? "done" : "active"}>
                {stage !== "accepted" ? <Check /> : "2"}
              </span>
              <i className={stage === "riding" ? "done" : ""} />
              <span className={stage === "riding" ? "active" : ""}>3</span>
              <div>
                <small>Confirmada</small>
                <small>Embarque</small>
                <small>Destino</small>
              </div>
            </div>
            <div className="arrival-note">
              <Clock3 />
              <div>
                <b>
                  {stage === "arrived"
                    ? "Motorista no local"
                    : stage === "riding"
                      ? "Corrida em andamento"
                      : "Motorista a caminho"}
                </b>
                <small>
                  {driverDistance !== undefined && stage !== "riding"
                    ? `${(driverDistance / 1000).toFixed(1)} km até você · `
                    : ""}
                  {minutes(ride.duration_seconds)} min estimados
                </small>
              </div>
            </div>
            {stage !== "riding" && (
              <Button
                disabled={busy}
                variant="outline"
                className="secondary-cta"
                onClick={cancelRide}
              >
                <X /> Cancelar corrida
              </Button>
            )}
          </>
        )}
        {stage === "draft" && (
          <details className="history-panel" id="passenger-history">
            <summary>
              MINHAS CORRIDAS <span>{backend.passengerHistory.length}</span>
            </summary>
            <div>
              {backend.passengerHistory.length ? (
                backend.passengerHistory.map((item) => (
                  <details key={item.id} className="history-item">
                    <summary>
                      <span>
                        {new Intl.DateTimeFormat("pt-BR", {
                          dateStyle: "short",
                        }).format(
                          new Date(item.completed_at || item.created_at),
                        )}
                        <b>{item.destination_address}</b>
                      </span>
                      <strong>
                        {money(item.final_fare_cents ?? item.fare_cents)}
                      </strong>
                    </summary>
                    <div>
                      <p>
                        {item.origin_address} → {item.destination_address}
                      </p>
                      <span>Motorista: {item.driver_name || "—"}</span>
                      <span>
                        {((item.actual_distance_meters || 0) / 1000).toFixed(2)}{" "}
                        km · {durationLabel(item.actual_duration_seconds)}
                      </span>
                      <span>
                        {item.payment?.method === "cash" ? "Dinheiro" : "Pix"} ·{" "}
                        {paymentLabel(item.payment?.status)}
                      </span>
                      <span>
                        {item.rating
                          ? `Avaliação: ${item.rating.score}/5`
                          : "Ainda não avaliada"}
                      </span>
                    </div>
                  </details>
                ))
              ) : (
                <p>Nenhuma corrida concluída.</p>
              )}
            </div>
          </details>
        )}
        {stage === "draft" && <NotificationsPanel backend={backend} id="passenger-notifications" />}
      </section>
      <nav className="passenger-bottom-nav" aria-label="Navegação principal">
        <button type="button" className="active" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <HomeIcon /><span>Início</span>
        </button>
        <button type="button" onClick={() => document.getElementById("destination-address")?.focus()}>
          <Bike /><span>Pedir corrida</span>
        </button>
        <button type="button" onClick={() => setNotice("Nenhum cupom disponível no momento.")}>
          <Ticket /><span>Cupons</span>
        </button>
        <button type="button" onClick={() => setNotice("Use o menu da conta no topo para acessar seu perfil.")}>
          <UserRound /><span>Conta</span>
        </button>
      </nav>
      {quickPlacesOpen && (
        <div className="quick-places-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setQuickPlacesOpen(false)}>
          <section className="quick-places-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-places-title">
            <div className="quick-places-sheet-handle" />
            <header>
              <div><span>DESTINOS DA CIDADE</span><h2 id="quick-places-title">Todos os pontos rápidos</h2></div>
              <button type="button" onClick={() => setQuickPlacesOpen(false)} aria-label="Fechar pontos rápidos"><X /></button>
            </header>
            <label className="quick-place-search">
              <Search />
              <input value={quickPlaceSearch} onChange={(event) => setQuickPlaceSearch(event.target.value)} placeholder="Buscar um local" autoFocus />
            </label>
            <div className="quick-place-filters" aria-label="Filtrar por categoria">
              {QUICK_PLACE_CATEGORIES.filter((category) => category.value === "all" || quickPlaces.some((place) => place.active && place.category === category.value)).map((category) => (
                <button type="button" key={category.value} className={quickPlaceCategory === category.value ? "active" : ""} onClick={() => setQuickPlaceCategory(category.value)}>{category.label}</button>
              ))}
            </div>
            <div className="quick-place-catalog">
              {backend.quickPlacesLoading ? (
                <div className="quick-place-catalog-empty">Carregando pontos rápidos…</div>
              ) : visibleQuickPlaces.length ? visibleQuickPlaces.map((place) => (
                <button type="button" key={place.id} onClick={() => chooseQuickPlace(place)}>
                  <span className="catalog-place-icon" style={{ backgroundColor: `${place.color}18` }}><QuickPlaceIcon name={place.icon} color={place.color} /></span>
                  <span><b>{place.name}</b><small>{place.address}</small></span>
                  <ChevronRight />
                </button>
              )) : (
                <div className="quick-place-catalog-empty">{backend.quickPlacesError || "Nenhum ponto rápido disponível"}</div>
              )}
            </div>
          </section>
        </div>
      )}
      {mapPicker && (
        <MapAddressPicker
          backend={backend}
          kind={mapPicker}
          initial={mapPicker === "origin" ? originPoint : destinationPoint}
          onClose={() => setMapPicker(null)}
          onConfirm={(result) => {
            if (mapPicker === "origin") {
              setOriginPoint(result);
              setOriginAddress(result.address);
              setLocationStatus("Localização encontrada");
            } else {
              setDestinationPoint(result);
              setDestinationAddress(result.address);
              setSelectedQuickPlace(null);
              setNotice("Destino selecionado no mapa.");
            }
            setEstimate(null);
            setMapPicker(null);
          }}
        />
      )}
    </div>
  );
}

function DriverPanel({ backend }: { backend: Backend }) {
  const state = backend.driverState;
  const ride = backend.activeRide;
  const offer = backend.offers[0];
  const online = Boolean(state?.online);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const vehicle = state?.vehicles?.[0];
  const [offerSeconds, setOfferSeconds] = useState(0);
  const [liveLocation, setLiveLocation] = useState<LivePoint>();
  const [gpsStatus, setGpsStatus] = useState("GPS aguardando");
  const [editing, setEditing] = useState(false);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [driverForm, setDriverForm] = useState({
    fullName: backend.profile?.full_name || "",
    phone: backend.profile?.phone || "",
    brand: vehicle?.brand || "",
    model: vehicle?.model || "",
    color: vehicle?.color || "",
    plate: vehicle?.plate || "",
  });
  const rideId = ride?.id;
  const updateLocation = backend.updateLocation;
  useEffect(() => {
    if (!online || !("geolocation" in navigator)) return;
    const activeInterval = rideId ? 5000 : 20000;
    let lastSentAt = 0;
    let sending = false;
    const watcher = navigator.geolocation.watchPosition(
      (position) => {
        setLiveLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: "Sua localização",
        });
        setGpsStatus(
          `GPS ativo · precisão ${Math.round(position.coords.accuracy)} m`,
        );
        const now = Date.now();
        if (sending || now - lastSentAt < activeInterval) return;
        sending = true;
        lastSentAt = now;
        void updateLocation(position, rideId)
          .catch((error) =>
            setGpsStatus(
              error instanceof Error
                ? error.message
                : "Falha temporária ao atualizar o GPS.",
            ),
          )
          .finally(() => {
            sending = false;
          });
      },
      (error) => setGpsStatus(geolocationMessage(error)),
      {
        enableHighAccuracy: Boolean(rideId),
        maximumAge: rideId ? 3000 : 15000,
        timeout: 15000,
      },
    );
    return () => navigator.geolocation.clearWatch(watcher);
  }, [online, rideId, updateLocation]);
  useEffect(() => {
    if (!offer) return;
    const update = () =>
      setOfferSeconds(
        Math.max(
          0,
          Math.ceil((new Date(offer.expires_at).getTime() - Date.now()) / 1000),
        ),
      );
    const first = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [offer]);
  async function toggle(next: boolean) {
    setBusy(true);
    setNotice("");
    try {
      const position = next ? await gpsPosition() : null;
      await backend.setDriverStatus(next, position?.coords);
      if (position) {
        setLiveLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: "Sua localização",
        });
        setGpsStatus(
          `GPS ativo · precisão ${Math.round(position.coords.accuracy)} m`,
        );
      } else {
        setLiveLocation(undefined);
        setGpsStatus("Compartilhamento encerrado");
      }
      await backend.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível alterar o status.",
      );
    } finally {
      setBusy(false);
    }
  }
  function startEditing() {
    setDriverForm({
      fullName: backend.profile?.full_name || "",
      phone: backend.profile?.phone || "",
      brand: vehicle?.brand || "",
      model: vehicle?.model || "",
      color: vehicle?.color || "",
      plate: vehicle?.plate || "",
    });
    setEditing(true);
  }
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const payload = new FormData();
      Object.entries(driverForm).forEach(([key, value]) =>
        payload.set(key, value),
      );
      if (avatar) payload.set("avatar", avatar);
      await backend.saveDriverProfile(payload);
      setEditing(false);
      setAvatar(null);
      setNotice("Dados enviados. Seu cadastro está aguardando aprovação.");
      await backend.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o cadastro.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function accept() {
    if (!offer) return;
    setBusy(true);
    try {
      await backend.acceptRide(offer.ride_id);
      await backend.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Corrida indisponível.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function decline() {
    if (!offer) return;
    setBusy(true);
    try {
      await backend.declineRide(offer.ride_id);
      await backend.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível recusar a oferta.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancelRide() {
    if (!ride) return;
    setBusy(true);
    try {
      await backend.transitionRide(
        ride.id,
        "cancelada",
        "Cancelada pelo motorista",
      );
      await backend.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível cancelar a corrida.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function advance() {
    if (!ride) return;
    const next: Record<string, string> = {
      aceita: "motorista_a_caminho",
      motorista_a_caminho: "motorista_chegou",
      motorista_chegou: "em_corrida",
      em_corrida: "finalizada",
    };
    const status = next[ride.status];
    if (!status) return;
    setBusy(true);
    try {
      await backend.transitionRide(ride.id, status);
      await backend.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar a corrida.",
      );
    } finally {
      setBusy(false);
    }
  }
  const shownRide = ride || offer?.ride;
  const origin = shownRide
    ? {
        lat: shownRide.origin_lat,
        lng: shownRide.origin_lng,
        label: shownRide.origin_address,
      }
    : undefined;
  const destination = shownRide
    ? {
        lat: shownRide.destination_lat,
        lng: shownRide.destination_lng,
        label: shownRide.destination_address,
      }
    : undefined;
  const route = routePoints(shownRide?.route_geometry);
  return (
    <div className="driver-shell">
      <aside className="driver-sidebar">
        <div className="driver-profile">
          <div className="driver-avatar small">
            {backend.driverAvatarUrl ? (
              <AvatarPhoto
                src={backend.driverAvatarUrl}
                alt="Foto do motorista"
              />
            ) : (
              initials(backend.profile?.full_name)
            )}
          </div>
          <div>
            <b>Olá, {backend.profile?.full_name || "motoboy"}</b>
            <small>
              {vehicle
                ? `${vehicle.brand} ${vehicle.model} · ${vehicle.plate}`
                : "Complete o cadastro da sua moto"}
            </small>
          </div>
          <button className="edit-driver" onClick={startEditing}>
            Editar
          </button>
        </div>
        <div className={`online-card ${online ? "is-online" : ""}`}>
          <div>
            <span className="online-dot" />
            <div>
              <b>{online ? "Você está online" : "Você está offline"}</b>
              <small>
                {state?.approval_status === "rejected"
                  ? "Cadastro recusado. Revise os dados."
                  : state?.approval_status === "suspended"
                    ? "Cadastro bloqueado pela central"
                    : state?.approval_status !== "approved"
                      ? "Cadastro aguardando aprovação"
                      : online
                        ? gpsStatus
                        : "Fique online para começar"}
              </small>
            </div>
          </div>
          <Switch
            disabled={busy || state?.approval_status !== "approved" || !vehicle}
            checked={online}
            onCheckedChange={toggle}
            aria-label="Alterar disponibilidade"
          />
        </div>
        {(editing || !vehicle) && (
          <form className="driver-registration" onSubmit={saveProfile}>
            <span>DADOS DO MOTORISTA</span>
            <input
              required
              placeholder="Nome completo"
              value={driverForm.fullName}
              onChange={(event) =>
                setDriverForm((value) => ({
                  ...value,
                  fullName: event.target.value,
                }))
              }
            />
            <input
              required
              placeholder="Telefone"
              value={driverForm.phone}
              onChange={(event) =>
                setDriverForm((value) => ({
                  ...value,
                  phone: event.target.value,
                }))
              }
            />
            <label className="avatar-upload">
              Foto do perfil
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setAvatar(event.target.files?.[0] || null)}
              />
            </label>
            <div className="vehicle-fields">
              <input
                required
                placeholder="Marca"
                value={driverForm.brand}
                onChange={(event) =>
                  setDriverForm((value) => ({
                    ...value,
                    brand: event.target.value,
                  }))
                }
              />
              <input
                required
                placeholder="Modelo"
                value={driverForm.model}
                onChange={(event) =>
                  setDriverForm((value) => ({
                    ...value,
                    model: event.target.value,
                  }))
                }
              />
              <input
                required
                placeholder="Cor"
                value={driverForm.color}
                onChange={(event) =>
                  setDriverForm((value) => ({
                    ...value,
                    color: event.target.value,
                  }))
                }
              />
              <input
                required
                maxLength={7}
                placeholder="Placa"
                value={driverForm.plate}
                onChange={(event) =>
                  setDriverForm((value) => ({
                    ...value,
                    plate: event.target.value.toUpperCase(),
                  }))
                }
              />
            </div>
            <Button disabled={busy}>
              {busy ? "SALVANDO…" : "ENVIAR PARA APROVAÇÃO"}
            </Button>
          </form>
        )}
        <div className="driver-stats">
          <div>
            <Route />
            <span>
              <small>Corridas concluídas</small>
              <b>{state?.trips_count || 0}</b>
            </span>
          </div>
          <div>
            <Star />
            <span>
              <small>Avaliação</small>
              <b>{state?.rating?.toFixed(1) || "—"}</b>
            </span>
          </div>
        </div>
        <div className="safety-card">
          <ShieldCheck />
          <div>
            <b>Central de suporte</b>
            <small>Proteção ativa durante suas corridas</small>
          </div>
          <button>
            <ChevronRight />
          </button>
        </div>
        {backend.driverHistory && (
          <details className="driver-earnings">
            <summary>MINHAS CORRIDAS / GANHOS</summary>
            <div className="earnings-grid">
              <span>
                <small>Hoje</small>
                <b>{money(backend.driverHistory.totals.dayCents)}</b>
              </span>
              <span>
                <small>Semana</small>
                <b>{money(backend.driverHistory.totals.weekCents)}</b>
              </span>
              <span>
                <small>Mês</small>
                <b>{money(backend.driverHistory.totals.monthCents)}</b>
              </span>
            </div>
            <small>Valores brutos. Comissão ainda não configurada.</small>
            <div className="driver-history-list">
              {backend.driverHistory.rides.slice(0, 10).map((item) => (
                <div key={item.id}>
                  <span>
                    {new Intl.DateTimeFormat("pt-BR", {
                      dateStyle: "short",
                    }).format(new Date(item.completed_at || item.created_at))}
                  </span>
                  <b>{money(item.final_fare_cents ?? item.fare_cents)}</b>
                  <small>
                    {item.payment?.method === "cash" ? "Dinheiro" : "Pix"} ·{" "}
                    {paymentLabel(item.payment?.status)}
                  </small>
                </div>
              ))}
            </div>
          </details>
        )}
        <NotificationsPanel backend={backend} />
      </aside>
      <main className="driver-main">
        <MapCanvas
          origin={origin}
          destination={destination}
          driver={liveLocation}
          route={route}
        />
        {notice && <div className="backend-warning">{notice}</div>}
        {!online && (
          <div className="driver-empty">
            <span>
              <Bike />
            </span>
            <h2>
              {state?.approval_status === "approved"
                ? "Pronto para rodar?"
                : "Cadastro em análise"}
            </h2>
            <p>
              {state?.approval_status === "approved"
                ? "Fique online para receber solicitações próximas."
                : "A central precisa aprovar seus dados e sua moto."}
            </p>
            {state?.approval_status === "approved" && (
              <Button disabled={busy} onClick={() => toggle(true)}>
                FICAR ONLINE
              </Button>
            )}
          </div>
        )}
        {online && !ride && !offer && (
          <div className="driver-empty">
            <span>
              <Bike />
            </span>
            <h2>Você está disponível</h2>
            <p>As novas solicitações aparecerão aqui em tempo real.</p>
          </div>
        )}
        {online && !ride && offer && (
          <div className="offer-card">
            <div className="offer-head">
              <div>
                <span>NOVA CORRIDA</span>
                <h2>{offer.passenger_name}</h2>
              </div>
              <b>{offerSeconds}s</b>
            </div>
            <div className="offer-route">
              <div>
                <span className="pickup-dot" />
                <p>
                  <small>BUSCAR</small>
                  <b>{offer.ride.origin_address}</b>
                </p>
              </div>
              <i />
              <div>
                <span className="drop-dot" />
                <p>
                  <small>DESTINO</small>
                  <b>{offer.ride.destination_address}</b>
                </p>
              </div>
            </div>
            <div className="offer-numbers">
              <div>
                <small>Até o passageiro</small>
                <b>
                  {offer.distance_to_pickup_meters === null
                    ? "GPS…"
                    : `${(offer.distance_to_pickup_meters / 1000).toFixed(1)} km`}
                </b>
              </div>
              <div>
                <small>Corrida</small>
                <b>{(offer.ride.distance_meters / 1000).toFixed(1)} km</b>
              </div>
              <div>
                <small>Valor</small>
                <b>{money(offer.ride.fare_cents)}</b>
              </div>
            </div>
            <div className="offer-buttons">
              <Button disabled={busy} variant="outline" onClick={decline}>
                RECUSAR
              </Button>
              <Button disabled={busy} onClick={accept}>
                ACEITAR CORRIDA
              </Button>
            </div>
          </div>
        )}
        {ride && (
          <div className="active-job-card">
            <span className="job-kicker">
              {ride.status === "motorista_chegou"
                ? "NO LOCAL DE EMBARQUE"
                : ride.status === "em_corrida"
                  ? "CORRIDA EM ANDAMENTO"
                  : "VÁ ATÉ O PASSAGEIRO"}
            </span>
            <div className="passenger-row">
              <div className="passenger-avatar">
                {initials(ride.passenger?.full_name || "Passageiro")}
              </div>
              <div>
                <b>{ride.passenger?.full_name || "Passageiro"}</b>
                <small>Corrida protegida</small>
              </div>
              {ride.passenger?.phone && (
                <a href={`tel:${ride.passenger.phone}`} aria-label="Ligar">
                  <Phone />
                </a>
              )}
              <button aria-label="Mensagem">
                <MessageCircle />
              </button>
            </div>
            <div className="job-address">
              <Navigation />
              <div>
                <small>
                  {ride.status === "em_corrida"
                    ? "DESTINO"
                    : "LOCAL DE EMBARQUE"}
                </small>
                <b>
                  {ride.status === "em_corrida"
                    ? ride.destination_address
                    : ride.origin_address}
                </b>
                <span>
                  Rota estimada:{" "}
                  {(
                    (ride.estimated_distance_meters || ride.distance_meters) /
                    1000
                  ).toFixed(1)}{" "}
                  km ·{" "}
                  {minutes(
                    ride.estimated_duration_seconds || ride.duration_seconds,
                  )}{" "}
                  min
                </span>
                {ride.status === "em_corrida" && (
                  <span>
                    Percorrido pelo GPS:{" "}
                    {((ride.tracked_distance_meters || 0) / 1000).toFixed(2)} km
                  </span>
                )}
              </div>
            </div>
            <div className="job-actions">
              {ride.status !== "em_corrida" && (
                <Button disabled={busy} variant="outline" onClick={cancelRide}>
                  CANCELAR
                </Button>
              )}
              <Button disabled={busy} className="primary-cta" onClick={advance}>
                {ride.status === "aceita"
                  ? "IR ATÉ PASSAGEIRO"
                  : ride.status === "motorista_a_caminho"
                    ? "CHEGUEI"
                    : ride.status === "motorista_chegou"
                      ? "INICIAR CORRIDA"
                      : "FINALIZAR CORRIDA"}
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function AdminPanel({ backend }: { backend: Backend }) {
  const stats = backend.adminStats;
  const trips = stats?.recentRides || [];
  const drivers = stats?.drivers || [];
  const finance = backend.adminFinance;
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const emptyQuickPlaceForm = {
    id: "",
    name: "",
    address: "",
    latitude: "",
    longitude: "",
    category: "generic" as QuickPlace["category"],
    icon: "pin" as QuickPlace["icon"],
    color: "#f2ad00",
    active: true,
    featured: false,
    sortOrder: String((backend.quickPlaces.length + 1) * 10),
  };
  const [quickPlaceForm, setQuickPlaceForm] = useState(emptyQuickPlaceForm);
  const [quickPlaceOrder, setQuickPlaceOrder] = useState<string[] | null>(null);
  const orderedQuickPlaces = quickPlaceOrder
    ? quickPlaceOrder.map((id) => backend.quickPlaces.find((place) => place.id === id)).filter((place): place is QuickPlace => Boolean(place))
    : backend.quickPlaces;
  const [draggedPlaceId, setDraggedPlaceId] = useState("");
  const [fareForm, setFareForm] = useState(() => {
    const fare = backend.fareConfig;
    return {
      base: fare ? (fare.baseCents / 100).toFixed(2) : "",
      perKm: fare ? (fare.perKmCents / 100).toFixed(2) : "",
      perMinute: fare ? (fare.perMinuteCents / 100).toFixed(2) : "",
      minimum: fare ? (fare.minimumCents / 100).toFixed(2) : "",
    };
  });
  async function decide(driverId: string, status: "approved" | "rejected") {
    setBusyId(driverId);
    setNotice("");
    try {
      await backend.approveDriver(driverId, status);
      await backend.refresh();
      setNotice(
        status === "approved" ? "Motorista aprovado." : "Cadastro recusado.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o motorista.",
      );
    } finally {
      setBusyId("");
    }
  }
  async function saveFare(event: React.FormEvent) {
    event.preventDefault();
    setBusyId("fare");
    setNotice("");
    const toCents = (value: string) =>
      Math.round(Number(value.replace(",", ".")) * 100);
    const fare: FareConfig = {
      baseCents: toCents(fareForm.base),
      perKmCents: toCents(fareForm.perKm),
      perMinuteCents: toCents(fareForm.perMinute),
      minimumCents: toCents(fareForm.minimum),
      configured: true,
    };
    try {
      await backend.saveFareConfig(fare);
      await backend.refresh();
      setNotice("Estrutura futura de tarifa atualizada.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a tarifa.",
      );
    } finally {
      setBusyId("");
    }
  }
  async function saveRegion(
    event: React.FormEvent<HTMLFormElement>,
    region?: { id: string; is_default: boolean },
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const amountCents = Math.round(
      Number(String(data.get("amount") || "").replace(",", ".")) * 100,
    );
    const active = region?.is_default || data.get("active") === "on";
    const operation = `region-${region?.id || "new"}`;
    setBusyId(operation);
    setNotice("");
    try {
      await backend.saveFareRegion({
        id: region?.id,
        name,
        amountCents,
        active: Boolean(active),
      });
      await backend.refresh();
      if (!region) form.reset();
      setNotice(
        region ? "Tarifa da região atualizada." : "Nova região cadastrada.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a região.",
      );
    } finally {
      setBusyId("");
    }
  }
  async function locateQuickPlace() {
    if (quickPlaceForm.address.trim().length < 5) {
      setNotice("Informe o endereço antes de localizar no mapa.");
      return;
    }
    setBusyId("quick-geocode");
    setNotice("");
    try {
      const result = await backend.geocodeQuickPlace(quickPlaceForm.address);
      setQuickPlaceForm((current) => ({
        ...current,
        address: result.address,
        latitude: String(result.latitude),
        longitude: String(result.longitude),
      }));
      setNotice("Endereço localizado. Confira as coordenadas e salve o ponto.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível localizar o endereço.");
    } finally {
      setBusyId("");
    }
  }
  function editQuickPlace(place: QuickPlace) {
    setQuickPlaceForm({
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
      sortOrder: String(place.sort_order),
    });
    document.getElementById("quick-place-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function saveQuickPlace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId("quick-place-save");
    setNotice("");
    try {
      await backend.saveQuickPlace({
        id: quickPlaceForm.id || undefined,
        name: quickPlaceForm.name,
        address: quickPlaceForm.address,
        latitude: Number(quickPlaceForm.latitude),
        longitude: Number(quickPlaceForm.longitude),
        category: quickPlaceForm.category,
        icon: quickPlaceForm.icon,
        color: quickPlaceForm.color,
        active: quickPlaceForm.active,
        featured: quickPlaceForm.featured,
        sortOrder: Number(quickPlaceForm.sortOrder),
      });
      await backend.refresh();
      setQuickPlaceForm({ ...emptyQuickPlaceForm, sortOrder: String((backend.quickPlaces.length + 2) * 10) });
      setNotice(quickPlaceForm.id ? "Ponto rápido atualizado." : "Ponto rápido cadastrado.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível salvar o ponto rápido.");
    } finally {
      setBusyId("");
    }
  }
  async function deleteQuickPlace(place: QuickPlace) {
    if (!window.confirm(`Excluir “${place.name}”? Essa ação não poderá ser desfeita.`)) return;
    setBusyId(`quick-delete-${place.id}`);
    setNotice("");
    try {
      await backend.deleteQuickPlace(place.id);
      await backend.refresh();
      if (quickPlaceForm.id === place.id) setQuickPlaceForm(emptyQuickPlaceForm);
      setNotice("Ponto rápido excluído.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível excluir o ponto rápido.");
    } finally {
      setBusyId("");
    }
  }
  async function dropQuickPlace(targetId: string) {
    if (!draggedPlaceId || draggedPlaceId === targetId) return;
    const next = [...orderedQuickPlaces];
    const from = next.findIndex((place) => place.id === draggedPlaceId);
    const to = next.findIndex((place) => place.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setQuickPlaceOrder(next.map((place) => place.id));
    setDraggedPlaceId("");
    setBusyId("quick-order");
    try {
      await backend.reorderQuickPlaces(next.map((place) => place.id));
      await backend.refresh();
      setQuickPlaceOrder(null);
      setNotice("Ordem dos pontos rápidos atualizada.");
    } catch (error) {
      setQuickPlaceOrder(null);
      setNotice(error instanceof Error ? error.message : "Não foi possível atualizar a ordem.");
    } finally {
      setBusyId("");
    }
  }
  const approvalLabel = (status: string) =>
    status === "approved"
      ? "Aprovado"
      : status === "rejected"
        ? "Recusado"
        : status === "suspended"
          ? "Bloqueado"
          : "Pendente";
  return (
    <div className="admin-shell">
      <aside className="admin-nav">
        <Brand compact />
        <nav aria-label="Menu administrativo">
          <button className="active">
            <Gauge /> Visão geral
          </button>
          <button>
            <Route /> Corridas
          </button>
          <button>
            <Bike /> Motoboys
          </button>
          <button>
            <Users /> Passageiros
          </button>
          <button>
            <Wallet /> Financeiro
          </button>
          <button onClick={() => document.getElementById("quick-places-admin")?.scrollIntoView({ behavior: "smooth" })}>
            <MapPin /> Pontos rápidos
          </button>
          <button>
            <Headphones /> Suporte
          </button>
        </nav>
        <div className="admin-user">
          <span>MV</span>
          <div>
            <b>{backend.profile?.full_name || "Central Moto VIP"}</b>
            <small>Administrador</small>
          </div>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-header">
          <div>
            <span>
              {new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" })
                .format(new Date())
                .toUpperCase()}
            </span>
            <h1>Operação em tempo real</h1>
          </div>
          <div className="operation-live">
            <i /> Supabase conectado
          </div>
        </header>
        <section className="kpi-grid">
          <article>
            <span className="kpi-icon blue">
              <Activity />
            </span>
            <div>
              <small>Corridas hoje</small>
              <strong>{stats?.ridesToday || 0}</strong>
              <em>Dados reais</em>
            </div>
          </article>
          <article>
            <span className="kpi-icon green">
              <Bike />
            </span>
            <div>
              <small>Motoboys online</small>
              <strong>{stats?.driversOnline || 0}</strong>
              <em>{stats?.driversAvailable || 0} disponíveis</em>
            </div>
          </article>
          <article>
            <span className="kpi-icon red">
              <Clock3 />
            </span>
            <div>
              <small>Espera média</small>
              <strong>
                {stats?.averageWaitMinutes.toFixed(1) || "0,0"} min
              </strong>
              <em>Hoje</em>
            </div>
          </article>
          <article>
            <span className="kpi-icon amber">
              <CircleDollarSign />
            </span>
            <div>
              <small>Faturamento</small>
              <strong>{money(stats?.revenueCents)}</strong>
              <em>Corridas finalizadas</em>
            </div>
          </article>
        </section>
        <section className="admin-grid">
          <article className="live-map-card">
            <div className="card-title">
              <div>
                <span>MAPA OPERACIONAL</span>
                <h2>Ribeira do Pombal agora</h2>
              </div>
            </div>
            <MapCanvas admin />
          </article>
          <article className="demand-card">
            <div className="card-title">
              <div>
                <span>DEMANDA</span>
                <h2>Dados operacionais</h2>
              </div>
            </div>
            <div className="demand-now">
              <Activity />
              <div>
                <b>Monitoramento real ativo</b>
                <small>
                  O histórico será formado conforme as corridas forem
                  concluídas.
                </small>
              </div>
            </div>
          </article>
        </section>
        <section className="quick-places-admin-card" id="quick-places-admin">
          <div className="card-title">
            <div>
              <span>DESTINOS</span>
              <h2>Pontos rápidos</h2>
            </div>
            <em className="approval-status approved">{backend.quickPlaces.filter((place) => place.active).length} ativos</em>
          </div>
          <p>Cadastre locais da cidade, escolha os destaques da Home e arraste os itens para mudar a ordem.</p>
          {backend.quickPlacesError && <div className="auth-message">{backend.quickPlacesError}</div>}
          <div className="quick-places-admin-grid">
            <form id="quick-place-editor" className="quick-place-form" onSubmit={saveQuickPlace}>
              <div className="quick-place-form-title">
                <div><b>{quickPlaceForm.id ? "Editar ponto" : "Novo ponto rápido"}</b><small>Os campos com coordenadas são usados diretamente na rota.</small></div>
                {quickPlaceForm.id && <button type="button" onClick={() => setQuickPlaceForm(emptyQuickPlaceForm)}>Cancelar edição</button>}
              </div>
              <div className="quick-place-fields">
                <label><span>Nome do local</span><input required maxLength={100} value={quickPlaceForm.name} onChange={(event) => setQuickPlaceForm((current) => ({ ...current, name: event.target.value }))} placeholder="Hospital Municipal" /></label>
                <label className="wide"><span>Endereço completo</span><div className="address-geocode"><input required maxLength={240} value={quickPlaceForm.address} onChange={(event) => setQuickPlaceForm((current) => ({ ...current, address: event.target.value }))} placeholder="Rua, número, bairro, Ribeira do Pombal - BA" /><button type="button" onClick={locateQuickPlace} disabled={busyId === "quick-geocode"}><Crosshair /> {busyId === "quick-geocode" ? "Localizando…" : "Localizar"}</button></div></label>
                <label><span>Latitude</span><input required type="number" step="any" min="-90" max="90" value={quickPlaceForm.latitude} onChange={(event) => setQuickPlaceForm((current) => ({ ...current, latitude: event.target.value }))} /></label>
                <label><span>Longitude</span><input required type="number" step="any" min="-180" max="180" value={quickPlaceForm.longitude} onChange={(event) => setQuickPlaceForm((current) => ({ ...current, longitude: event.target.value }))} /></label>
                <label><span>Categoria</span><select value={quickPlaceForm.category} onChange={(event) => setQuickPlaceForm((current) => ({ ...current, category: event.target.value as QuickPlace["category"] }))}>{QUICK_PLACE_CATEGORIES.filter((item) => item.value !== "all").map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
                <label><span>Ordem</span><input required type="number" min="0" max="100000" value={quickPlaceForm.sortOrder} onChange={(event) => setQuickPlaceForm((current) => ({ ...current, sortOrder: event.target.value }))} /></label>
                <label className="color-field"><span>Cor do ícone</span><div><input type="color" value={quickPlaceForm.color} onChange={(event) => setQuickPlaceForm((current) => ({ ...current, color: event.target.value }))} /><input required pattern="^#[0-9A-Fa-f]{6}$" value={quickPlaceForm.color} onChange={(event) => setQuickPlaceForm((current) => ({ ...current, color: event.target.value }))} /></div></label>
              </div>
              <fieldset className="icon-library">
                <legend>Biblioteca de ícones</legend>
                {QUICK_PLACE_ICONS.map((item) => {
                  const Icon = item.icon;
                  return <button type="button" key={item.value} className={quickPlaceForm.icon === item.value ? "active" : ""} onClick={() => setQuickPlaceForm((current) => ({ ...current, icon: item.value }))} title={item.label}><Icon /><span>{item.label}</span></button>;
                })}
              </fieldset>
              <div className="quick-place-options">
                <label><input type="checkbox" checked={quickPlaceForm.active} onChange={(event) => setQuickPlaceForm((current) => ({ ...current, active: event.target.checked }))} /> Ativo</label>
                <label><input type="checkbox" checked={quickPlaceForm.featured} onChange={(event) => setQuickPlaceForm((current) => ({ ...current, featured: event.target.checked }))} /> ⭐ Exibir na tela inicial</label>
              </div>
              <Button disabled={busyId === "quick-place-save"}>{busyId === "quick-place-save" ? "SALVANDO…" : quickPlaceForm.id ? "SALVAR ALTERAÇÕES" : "CADASTRAR PONTO"}</Button>
            </form>
            <div className="quick-place-admin-list">
              <div className="quick-place-list-title"><div><b>Pontos cadastrados</b><small>Arraste pelo ícone para reordenar</small></div>{busyId === "quick-order" && <span>Salvando ordem…</span>}</div>
              {backend.quickPlacesLoading ? <div className="quick-place-state">Carregando…</div> : orderedQuickPlaces.length ? orderedQuickPlaces.map((place) => (
                <article key={place.id} draggable onDragStart={() => setDraggedPlaceId(place.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => void dropQuickPlace(place.id)} className={draggedPlaceId === place.id ? "dragging" : ""}>
                  <GripVertical className="drag-handle" />
                  <span className="admin-place-icon" style={{ backgroundColor: `${place.color}18` }}><QuickPlaceIcon name={place.icon} color={place.color} /></span>
                  <div><b>{place.featured ? "⭐ " : ""}{place.name}</b><small>{place.address}</small><em>{QUICK_PLACE_CATEGORIES.find((item) => item.value === place.category)?.label || place.category} · {place.active ? "Ativo" : "Inativo"}</em></div>
                  <button type="button" onClick={() => editQuickPlace(place)} aria-label={`Editar ${place.name}`}><Pencil /></button>
                  <button type="button" className="delete" disabled={busyId === `quick-delete-${place.id}`} onClick={() => void deleteQuickPlace(place)} aria-label={`Excluir ${place.name}`}><Trash2 /></button>
                </article>
              )) : <div className="quick-place-state">Nenhum ponto rápido cadastrado.</div>}
            </div>
          </div>
        </section>
        <section className="region-fares-card">
          <div className="card-title">
            <div>
              <span>FINANCEIRO</span>
              <h2>Tarifas por Região</h2>
            </div>
            <em className="approval-status approved">Preço por bairro ativo</em>
          </div>
          <p>
            O destino define o preço. Sem uma tarifa especial correspondente,
            o sistema usa a tarifa padrão da cidade.
          </p>
          <div className="region-fare-table">
            <div className="region-fare-head">
              <span>Nome da região/bairro</span>
              <span>Valor da corrida</span>
              <span>Status</span>
              <span>Ação</span>
            </div>
            {backend.fareRegions.map((region) => (
              <form
                key={region.id}
                className="region-fare-row"
                onSubmit={(event) => saveRegion(event, region)}
              >
                <input
                  required
                  name="name"
                  maxLength={80}
                  defaultValue={region.name}
                  aria-label={`Nome da região ${region.name}`}
                />
                <label className="money-input">
                  <span>R$</span>
                  <input
                    required
                    name="amount"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    defaultValue={(region.amount_cents / 100).toFixed(2)}
                    aria-label={`Valor de ${region.name}`}
                  />
                </label>
                <label className="region-active">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={region.active}
                    disabled={region.is_default}
                  />
                  <span>{region.is_default ? "Padrão ativa" : "Ativa"}</span>
                </label>
                <Button disabled={busyId === `region-${region.id}`}>
                  {busyId === `region-${region.id}` ? "SALVANDO…" : "SALVAR"}
                </Button>
              </form>
            ))}
            <form
              className="region-fare-row region-fare-new"
              onSubmit={(event) => saveRegion(event)}
            >
              <input
                required
                name="name"
                maxLength={80}
                placeholder="Novo bairro ou região"
                aria-label="Nome da nova região"
              />
              <label className="money-input">
                <span>R$</span>
                <input
                  required
                  name="amount"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0,00"
                  aria-label="Valor da nova região"
                />
              </label>
              <label className="region-active">
                <input type="checkbox" name="active" defaultChecked />
                <span>Ativa</span>
              </label>
              <Button disabled={busyId === "region-new"}>
                {busyId === "region-new" ? "ADICIONANDO…" : "ADICIONAR"}
              </Button>
            </form>
          </div>
        </section>
        <section className="fare-settings-card">
          <div className="card-title">
            <div>
              <span>ESTRUTURA FUTURA</span>
              <h2>Tarifa por distância e tempo</h2>
            </div>
            <em className="approval-status">Não usada na cobrança atual</em>
          </div>
          <p>
            Estrutura preservada para regras futuras. O valor por minuto inicial
            permanece em R$ 0,00.
          </p>
          <form onSubmit={saveFare}>
            {(
              [
                ["base", "Tarifa base"],
                ["perKm", "Valor por km"],
                ["perMinute", "Valor por minuto"],
                ["minimum", "Tarifa mínima"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <small>{label}</small>
                <span>R$</span>
                <input
                  required
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={fareForm[key]}
                  onChange={(event) =>
                    setFareForm((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
            <Button disabled={busyId === "fare"}>
              {busyId === "fare" ? "SALVANDO…" : "SALVAR PARA O FUTURO"}
            </Button>
          </form>
        </section>
        {finance && (
          <section className="finance-card">
            <div className="card-title">
              <div>
                <span>FINANCEIRO</span>
                <h2>Resumo dos últimos 30 dias</h2>
              </div>
              <em className="approval-status">Comissão não configurada</em>
            </div>
            <div className="finance-summary">
              <div>
                <small>Corridas finalizadas</small>
                <b>{finance.summary.completedRides}</b>
              </div>
              <div>
                <small>Faturamento bruto</small>
                <b>{money(finance.summary.grossCents)}</b>
              </div>
              <div>
                <small>Pix confirmado</small>
                <b>{money(finance.summary.pixPaidCents)}</b>
              </div>
              <div>
                <small>Pagamentos pendentes</small>
                <b>{money(finance.summary.pendingCents)}</b>
              </div>
              <div>
                <small>Cancelamentos</small>
                <b>{finance.summary.cancellations}</b>
              </div>
            </div>
            <div className="finance-drivers">
              {finance.byDriver.length ? (
                finance.byDriver.map((item) => (
                  <div key={item.driverId}>
                    <span>
                      <b>{item.driverName}</b>
                      <small>{item.rides} corrida(s)</small>
                    </span>
                    <span>
                      Bruto <b>{money(item.grossCents)}</b>
                    </span>
                    <span>
                      Confirmado <b>{money(item.paidCents)}</b>
                    </span>
                    <span>
                      Pendente <b>{money(item.pendingCents)}</b>
                    </span>
                  </div>
                ))
              ) : (
                <p>Nenhuma corrida finalizada no período.</p>
              )}
            </div>
          </section>
        )}
        <section className="driver-approval-card">
          <div className="card-title">
            <div>
              <span>CADASTROS</span>
              <h2>Aprovação de motoboys</h2>
            </div>
          </div>
          {notice && <div className="auth-message">{notice}</div>}
          <div className="driver-directory">
            {drivers.length ? (
              drivers.map((driver) => {
                const vehicle = driver.vehicles?.find(
                  (item) => item.active !== false,
                );
                return (
                  <article key={driver.profile_id}>
                    <div className="driver-avatar small">
                      {driver.profiles?.avatarUrl ? (
                        <AvatarPhoto
                          src={driver.profiles.avatarUrl}
                          alt="Foto do motorista"
                        />
                      ) : (
                        initials(driver.profiles?.full_name)
                      )}
                    </div>
                    <div className="directory-copy">
                      <b>
                        {driver.profiles?.full_name || "Nome não informado"}
                      </b>
                      <small>
                        {driver.profiles?.phone || "Telefone não informado"}
                      </small>
                      <span>
                        {vehicle
                          ? `${vehicle.brand} ${vehicle.model} · ${vehicle.color} · ${vehicle.plate}`
                          : "Moto ainda não cadastrada"}
                      </span>
                    </div>
                    <em className={`approval-status ${driver.approval_status}`}>
                      {approvalLabel(driver.approval_status)}
                    </em>
                    {driver.approval_status === "pending" && (
                      <div className="approval-actions">
                        <Button
                          disabled={busyId === driver.profile_id || !vehicle}
                          variant="outline"
                          onClick={() => decide(driver.profile_id, "rejected")}
                        >
                          Recusar
                        </Button>
                        <Button
                          disabled={busyId === driver.profile_id || !vehicle}
                          onClick={() => decide(driver.profile_id, "approved")}
                        >
                          Aprovar
                        </Button>
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="empty-table">Nenhum motorista cadastrado.</div>
            )}
          </div>
        </section>
        <section className="trips-card">
          <div className="card-title">
            <div>
              <span>ACOMPANHAMENTO</span>
              <h2>Corridas recentes</h2>
            </div>
          </div>
          <div className="trips-table">
            <div className="trip-row trip-head">
              <span>Corrida</span>
              <span>Passageiro</span>
              <span>Trajeto</span>
              <span>Status</span>
              <span>Valor</span>
            </div>
            {trips.length ? (
              trips.map((trip) => (
                <div className="trip-row" key={trip.id}>
                  <b>#{trip.id.slice(0, 8)}</b>
                  <span>
                    <b>{trip.passenger_id.slice(0, 8)}</b>
                  </span>
                  <span>
                    {trip.origin_address} → {trip.destination_address}
                  </span>
                  <em
                    className={`trip-status ${trip.status === "finalizada" ? "finished" : ""}`}
                  >
                    {trip.status.replaceAll("_", " ")}
                  </em>
                  <b>{money(trip.fare_cents)}</b>
                </div>
              ))
            ) : (
              <div className="empty-table">
                Nenhuma corrida registrada ainda.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function Home() {
  const backend = useMotoVip();
  const role = backend.profile?.role || "passenger";
  const contextLabel =
    role === "passenger"
      ? "Passageiro"
      : role === "driver"
        ? "Motoboy"
        : "Central";
  if (backend.loading)
    return (
      <main className="auth-page">
        <section className="auth-brand">
          <Brand />
          <p>Conectando com segurança…</p>
        </section>
      </main>
    );
  if (backend.passwordRecovery) return <PasswordRecovery backend={backend} />;
  if (!backend.session)
    return (
      <AuthPortal
        onSignIn={async (email, password) => {
          const { error } = await backend.signIn(email, password);
          return { error };
        }}
        onSignUp={async (input) => {
          const { error, data } = await backend.signUp(input);
          return {
            error,
            message: error
              ? undefined
              : data.session
                ? "Cadastro realizado. Você já está conectado."
                : "Cadastro realizado. Confirme o e-mail enviado para entrar.",
          };
        }}
        onReset={async (email) => {
          const { error } = await backend.resetPassword(email);
          return {
            error,
            message: error
              ? undefined
              : "Se houver uma conta com este e-mail, enviaremos as instruções de recuperação.",
          };
        }}
      />
    );
  return (
    <Tabs value={role} className={`app-root app-role-${role}`}>
      <header className="topbar">
        {role === "passenger" && (
          <details className="mobile-menu">
            <summary aria-label="Abrir menu"><Menu /></summary>
            <nav>
              <a href="#destination-address"><Bike /> Pedir corrida</a>
              <a href="#passenger-history"><History /> Minhas corridas</a>
              <a href="#passenger-notifications"><Bell /> Notificações</a>
              <a href="mailto:suporte@motovip.app"><Headphones /> Suporte</a>
            </nav>
          </details>
        )}
        <Brand />
        {role === "passenger" ? (
          <>
            <nav className="passenger-top-nav" aria-label="Navegação do passageiro">
              <a className="active" href="#destination-address"><HomeIcon /> Início</a>
              <a href="#passenger-history"><History /> Minhas corridas</a>
              <button type="button"><Ticket /> Cupons</button>
              <a href="#passenger-notifications"><Bell /> Notificações{backend.unreadNotifications > 0 && <b>{backend.unreadNotifications}</b>}</a>
              <a href="mailto:suporte@motovip.app"><Headphones /> Suporte</a>
            </nav>
            <button className="header-location" type="button" onClick={() => document.querySelector<HTMLButtonElement>(".field-action")?.click()}>
              <MapPin /><span>Minha localização</span>
            </button>
          </>
        ) : (
          <TabsList className="role-switch" aria-label="Ambiente autorizado">
            {backend.profile?.role === "driver" && (
              <TabsTrigger value="driver"><Bike /> Motoboy</TabsTrigger>
            )}
            {backend.profile?.role === "admin" && (
              <TabsTrigger value="admin"><Gauge /> Central</TabsTrigger>
            )}
          </TabsList>
        )}
        <details className="account-actions">
          <summary aria-label="Abrir menu da conta">
            <span className="account-avatar"><UserRound /></span>
            <span className="account-copy"><b>{backend.profile?.full_name || contextLabel}</b><small>{contextLabel}</small></span>
            <ChevronRight />
          </summary>
          <div><button onClick={() => backend.signOut()}>Sair da conta</button></div>
        </details>
      </header>
      {backend.error && <div className="backend-warning">{backend.error}</div>}
      <TabsContent value="passenger" className="screen">
        <PassengerPanel backend={backend} />
      </TabsContent>
      <TabsContent value="driver" className="screen">
        <DriverPanel backend={backend} />
      </TabsContent>
      <TabsContent value="admin" className="screen">
        <AdminPanel backend={backend} />
      </TabsContent>
    </Tabs>
  );
}
