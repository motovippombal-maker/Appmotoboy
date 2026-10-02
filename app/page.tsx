"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  Bell,
  Banknote,
  Bike,
  Building2,
  Camera,
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
  FileText,
  Gauge,
  GraduationCap,
  Headphones,
  History,
  Home as HomeIcon,
  Hotel,
  Image as ImageIcon,
  Layers,
  Landmark,
  LockKeyhole,
  LogOut,
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
  Share2,
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
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { AuthPortal } from "@/components/auth/auth-portal";
import { AdminOperationsPanel } from "@/components/admin/operations-panel";
import { RealMap, type LivePoint } from "@/components/map/real-map";
import { connectivityManager, type ConnectivityState } from "@/lib/offline/connectivity";
import { loadRegionPackage } from "@/lib/offline/region-package";
import { RoadGraph } from "@/lib/offline/road-graph";
import { isInsideRegion, OFFLINE_REGION } from "@/lib/offline/region";
import { clearOfflineRide, getOfflineRide, makeOfflineRide, queueOfflineTransition, savedRoute, saveOfflineRide, updateOfflineRide, type OfflineRidePackage, type OfflineEventType } from "@/lib/offline/ride-store";
import { syncOfflineRide } from "@/lib/offline/ride-sync";
import { selectDriverRide } from "@/lib/driver/ride-authority";
import { shouldAcceptGpsFix } from "@/lib/tracking/driver-gps";
import { PassengerCentral } from "@/components/passenger/passenger-central";
import { loadSavedPlaces, persistSavedPlaces, type SavedPlace } from "@/lib/passenger/saved-places";
import {
  coordinatesFromGeolocation,
  geolocationErrorMessage,
  isValidCoordinates,
  preserveExactCoordinates,
} from "@/lib/location/coordinates";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useMotoVip,
  BackendApiError,
  type AddressResult,
  type FareConfig,
  type HistoryRide,
  type NearbyDriver,
  type QuickPlace,
  type Ride,
  type TrackingRoute,
} from "@/hooks/use-moto-vip";
import {
  externalNavigationTarget,
  isLocationFresh,
  shouldRecalculateEta,
  shouldSendLocationUpdate,
  trackingPhase,
  type EtaCalculation,
  type LocationSample,
} from "@/lib/tracking/realtime";
import {
  formatNavDistance,
  maneuverSymbol,
  maneuverText,
  metersBetween,
  navigationZoom,
  nextManeuver,
  routeProgress,
  shouldReroute,
} from "@/lib/navigation/driver-navigation";
import {
  DEFAULT_DRIVER_ALERT_PREFERENCES,
  DRIVER_ALERT_PREFERENCES_KEY,
  RideAlertController,
  parseDriverAlertPreferences,
  type DriverAlertPreferences,
} from "@/lib/driver/ride-alert";
import {
  historyPanelState,
  mobileNavItem,
  nextPassengerMobileView,
  notificationPanelState,
  shouldLockBackground,
  type PassengerMobileView,
} from "@/lib/mobile/passenger-navigation";

type Backend = ReturnType<typeof useMotoVip>;
const NO_MAP_LANDMARKS: Array<{ lat: number; lng: number; label: string; category: string }> = [];
const NO_NEARBY_DRIVER_RESULTS: NearbyDriver[] = [];
type Estimate = {
  origin: { address: string; lat: number; lng: number };
  destination: { address: string; lat: number; lng: number };
  distanceMeters: number;
  durationSeconds: number;
  geometry: string;
  fareCents: number;
  originalFareCents?: number;
  discountCents?: number;
  coupon?: { code: string; description: string | null } | null;
  fareRegion: { id: string; name: string; isDefault: boolean };
  serviceArea: { id: string; name: string };
  pricingMode: "region";
  quoteToken: string;
  quoteExpiresAt: string;
};

function prepareOtherAccountLink(event: MouseEvent<HTMLAnchorElement>) {
  event.currentTarget.href = `/?conta=${window.crypto.randomUUID()}`;
}

function coordinateOnlyAddress(
  point: LivePoint,
  shortAddress: string,
): AddressResult {
  return {
    id: `coords-${point.lat}-${point.lng}`,
    address: `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`,
    shortAddress,
    lat: point.lat,
    lng: point.lng,
    city: "",
    state: "",
    approximate: true,
    provider: "coordinates",
  };
}

function quoteFromApiError(error: BackendApiError): Estimate | null {
  const quote = error.payload.quote;
  if (
    !quote ||
    typeof quote !== "object" ||
    !("fareCents" in quote) ||
    typeof quote.fareCents !== "number" ||
    !("quoteToken" in quote) ||
    typeof quote.quoteToken !== "string"
  ) {
    return null;
  }
  return quote as Estimate;
}

function money(cents = 0) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}
function minutes(seconds = 0) {
  return Math.max(1, Math.round(seconds / 60));
}
function shortRideTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
function initials(name = "MotoPombal") {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
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

function FinancialControls({
  estimate, couponCode, setCouponCode, couponExpanded, setCouponExpanded,
  couponBusy, validateCoupon, paymentMethod, setPaymentMethod,
}: {
  estimate: Estimate;
  couponCode: string;
  setCouponCode: (value: string) => void;
  couponExpanded: boolean;
  setCouponExpanded: (value: boolean) => void;
  couponBusy: boolean;
  validateCoupon: () => void;
  paymentMethod: "cash" | "pix";
  setPaymentMethod: (value: "cash" | "pix") => void;
}) {
  return (
    <div className="financial-controls">
      <button type="button" className="ride-config-row" onClick={() => setCouponExpanded(!couponExpanded)} aria-expanded={couponExpanded}>
        <Ticket aria-hidden="true" />
        <span className="ride-config-copy">
          <b>Cupom de desconto</b>
          <small>{estimate.coupon ? `${estimate.coupon.code} aplicado ✓` : "Adicionar cupom"}</small>
        </span>
        <ChevronRight aria-hidden="true" />
      </button>
      {couponExpanded && (
        <div className="coupon-entry">
          <input value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
            placeholder="Digite o código" maxLength={24} aria-label="Código do cupom" />
          <button type="button" onClick={validateCoupon} disabled={couponBusy || couponCode.trim().length < 3}>
            {couponBusy ? "Validando…" : "Aplicar"}
          </button>
        </div>
      )}
      <div className="payment-selector" role="group" aria-label="Forma de pagamento">
        <span className="payment-selector-title"><Wallet aria-hidden="true" /> <b>Forma de pagamento</b></span>
        <div className="payment-selector-options">
          <button type="button" className={paymentMethod === "cash" ? "active" : ""}
            onClick={() => setPaymentMethod("cash")}>Dinheiro</button>
          <span className="payment-unavailable" title="Pix indisponível até a homologação do provedor">
            PIX indisponível
          </span>
        </div>
      </div>
    </div>
  );
}

function rideStatusLabel(status?: string) {
  return (
    (
      {
        finalizada: "Finalizada",
        cancelada: "Cancelada",
        em_corrida: "Em andamento",
        motorista_chegou: "Motorista no local",
        motorista_a_caminho: "Motorista a caminho",
        aceita: "Aceita",
        procurando_motorista: "Procurando motorista",
        solicitada: "Solicitada",
      } as Record<string, string>
    )[status || ""] || status?.replaceAll("_", " ") || "Status indisponível"
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
  { value: "bike", label: "MotoPombal", icon: Bike },
  { value: "pin", label: "Local genérico", icon: MapPin },
] as const;

const QUICK_PLACE_CATEGORIES: Array<{
  value: QuickPlace["category"] | "all";
  label: string;
}> = [
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
  { value: "moto_vip", label: "MotoPombal" },
  { value: "generic", label: "Outros" },
];

const DESTINATION_CITY_CATALOG = [
  { label: "Terminal Rodoviário", aliases: ["terminal rodoviario", "rodoviaria"] },
  { label: "Hospital Municipal", aliases: ["hospital municipal"] },
  { label: "Prefeitura Municipal", aliases: ["prefeitura", "prefeitura municipal"] },
  { label: "Praça da Juventude", aliases: ["praca da juventude"] },
  { label: "C.E.A.S.", aliases: ["ceas", "c e a s"] },
  { label: "Escola Municipal", aliases: ["escola municipal", "outra escola"] },
  { label: "Baraúna", aliases: ["barauna"] },
  { label: "Aroldo Barber", aliases: ["aroldo barber"] },
  { label: "CRG", aliases: ["crg", "colegio crg"] },
  { label: "Godoy Estética", aliases: ["godoy estetica"] },
] as const;

function destinationCityName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f.]/g, "").toLocaleLowerCase("pt-BR").trim();
}

function destinationCityEntry(name: string) {
  const normalizedName = destinationCityName(name);
  return DESTINATION_CITY_CATALOG.find((entry) =>
    entry.aliases.some((alias) => alias === normalizedName),
  );
}

function destinationCityLabel(name: string) {
  return destinationCityEntry(name)?.label || name;
}

function QuickPlaceIcon({
  name,
  color,
}: {
  name: QuickPlace["icon"];
  color?: string;
}) {
  const entry =
    QUICK_PLACE_ICONS.find((item) => item.value === name) ||
    QUICK_PLACE_ICONS.at(-1)!;
  const Icon = entry.icon;
  return <Icon style={color ? { color } : undefined} aria-hidden="true" />;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`brand-lockup ${compact ? "compact" : ""}`}
      aria-label="MotoPombal"
    >
      <Image
        className="brand-logo-image"
        src="/brand/motopombal-wordmark.png"
        alt="MotoPombal"
        width={360}
        height={180}
        priority
      />
    </div>
  );
}

function AvatarPhoto({ src, alt, fallback = "M", sizes = "52px" }: { src: string; alt: string; fallback?: string; sizes?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <span aria-label={alt}>{fallback}</span>;
  return <Image src={src} alt={alt} fill sizes={sizes} unoptimized onError={() => setFailedSrc(src)} />;
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
        "Senha atualizada. Você já pode continuar no MotoPombal.",
    );
    setBusy(false);
  }
  return (
    <main className="auth-page">
      <section className="auth-brand">
        <Brand />
        <span>
          MotoPombal
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
  currentLocation,
  accuracyMeters,
  nearbyDrivers = [],
  route = [],
  admin = false,
  compactRoute = false,
  trackingBadge,
  landmarks = NO_MAP_LANDMARKS,
  hideCurrentLocation = false,
  connected = true,
  onRequestLocation,
}: {
  origin?: LivePoint;
  destination?: LivePoint;
  driver?: LivePoint;
  currentLocation?: LivePoint;
  accuracyMeters?: number;
  nearbyDrivers?: NearbyDriver[];
  route?: Array<[number, number]>;
  admin?: boolean;
  compactRoute?: boolean;
  trackingBadge?: { title: string; detail: string };
  landmarks?: Array<{ lat: number; lng: number; label: string; category: string }>;
  hideCurrentLocation?: boolean;
  connected?: boolean;
  onRequestLocation?: () => void | Promise<void>;
}) {
  const [locationStatus, setLocationStatus] = useState(
    "Usar minha localização",
  );
  const [fallbackLocation, setFallbackLocation] = useState<LivePoint>();
  const [fallbackAccuracy, setFallbackAccuracy] = useState<number>();
  const [centerRequest, setCenterRequest] = useState(0);
  const [connectionExpanded, setConnectionExpanded] = useState(true);
  const [followDriver, setFollowDriver] = useState(false);
  const nearbyDriverPoints = useMemo(() => nearbyDrivers.map((point) => ({
    lat: point.latitude,
    lng: point.longitude,
    label: admin ? "Motorista online" : `Motorista disponível · ${(point.distanceMeters / 1000).toFixed(1)} km`,
  })), [admin, nearbyDrivers]);
  useEffect(() => {
    const reveal = window.setTimeout(() => setConnectionExpanded(true), 0);
    const collapse = connected
      ? window.setTimeout(() => setConnectionExpanded(false), 2800)
      : undefined;
    return () => {
      window.clearTimeout(reveal);
      if (collapse) window.clearTimeout(collapse);
    };
  }, [connected]);
  async function requestLocation() {
    setLocationStatus("Localizando…");
    try {
      const position = await gpsPosition();
      const point = coordinatesFromGeolocation(position.coords);
      setFallbackLocation({ ...point, label: "Você está aqui" });
      setFallbackAccuracy(position.coords.accuracy);
      setLocationStatus("Localização ativa");
    } catch (error) {
      setLocationStatus(
        error instanceof Error ? error.message : "GPS indisponível",
      );
    }
  }
  async function centerMap() {
    if (trackingBadge) {
      setFollowDriver(false);
      setCenterRequest((value) => value + 1);
      return;
    }
    await (onRequestLocation ? onRequestLocation() : requestLocation());
    setCenterRequest((value) => value + 1);
  }
  return (
    <div
      className={`map-canvas ${admin ? "map-admin" : ""}`}
      role="region"
      aria-label="Mapa da corrida"
    >
      <RealMap
        origin={origin}
        destination={destination}
        driver={driver}
        currentLocation={hideCurrentLocation ? undefined : currentLocation || fallbackLocation}
        accuracyMeters={accuracyMeters ?? fallbackAccuracy}
        nearbyDrivers={nearbyDriverPoints}
        route={route}
        compactRoute={compactRoute}
        trackingBadge={trackingBadge}
        landmarks={landmarks}
        followDriver={followDriver}
        centerTarget={
          (followDriver ? driver : undefined) ||
          currentLocation ||
          (hideCurrentLocation ? undefined : fallbackLocation) ||
          (trackingBadge ? origin : undefined) ||
          driver ||
          origin ||
          destination
        }
        centerRequest={centerRequest}
      />
      {!admin && (
        <button
          type="button"
          className={`connection-pill ${connected ? "online" : "offline"} ${connected && !connectionExpanded ? "compact" : ""}`}
          role="status"
          aria-label={
            connected ? "Conectado ao MotoPombal" : "Reconectando ao MotoPombal"
          }
          onClick={() => setConnectionExpanded((value) => !value)}
        >
          {connected ? <Wifi /> : <WifiOff />}
          <span>
            {connected ? "Conectado ao MotoPombal" : "Reconectando ao MotoPombal"}
          </span>
        </button>
      )}
      <div className="map-tools">
        <button
          type="button"
          aria-label={locationStatus}
          title={locationStatus}
          onClick={() => void centerMap()}
        >
          <Crosshair />
        </button>
        {trackingBadge && driver && <button type="button" className="map-follow-driver" aria-label="Acompanhar motorista no mapa" aria-pressed={followDriver} title="Acompanhar motorista" onClick={() => { setFollowDriver((current) => !current); setCenterRequest((value) => value + 1); }}><Bike /></button>}
        <button
          type="button"
          className="map-fit-button"
          aria-label="Mostrar toda a rota no mapa"
          title="Mostrar toda a rota"
          onClick={() => document.dispatchEvent(new Event("moto-syxp:map-layout"))}
        >
          <Navigation />
        </button>
        <span className="map-provider">
          <Layers /> OPENSTREETMAP · MAPA REAL
        </span>
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
  liveSearch = false,
  quickPlaces = [],
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
  liveSearch?: boolean;
  quickPlaces?: QuickPlace[];
}) {
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchSequence = useRef(0);
  const searchAddressesRef = useRef(backend.searchAddresses);
  useEffect(() => {
    searchAddressesRef.current = backend.searchAddresses;
  }, [backend.searchAddresses]);
  const normalizedQuery = value.normalize("NFD").replace(/[\u0300-\u036f.]/g, "").toLocaleLowerCase("pt-BR").trim();
  const matchingPlaces = liveSearch && normalizedQuery.length >= 2
    ? quickPlaces.filter((place) =>
        place.active && place.name
          .normalize("NFD")
          .replace(/[\u0300-\u036f.]/g, "")
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedQuery),
      ).slice(0, 6)
    : [];

  useEffect(() => {
    if (!liveSearch || !focused || selected || value.trim().length < 3) return;
    const sequence = ++searchSequence.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError("");
      try {
        const { results } = await searchAddressesRef.current(value.trim());
        if (searchSequence.current === sequence) setSuggestions(results);
      } catch (error) {
        if (searchSequence.current === sequence) {
          setSuggestions([]);
          setSearchError(error instanceof Error ? error.message : "Não foi possível buscar endereços.");
        }
      } finally {
        if (searchSequence.current === sequence) setSearching(false);
      }
    }, 320);
    return () => {
      window.clearTimeout(timer);
      searchSequence.current += 1;
    };
  }, [focused, liveSearch, selected, value]);

  async function searchExplicitly() {
    const query = value.trim();
    if (query.length < 3) {
      setSearchError("Digite pelo menos 3 caracteres para buscar.");
      return;
    }
    const sequence = searchSequence.current + 1;
    searchSequence.current = sequence;
    setFocused(true);
    setSearching(true);
    setSearchError("");
    try {
      const { results } = await searchAddressesRef.current(query);
      if (searchSequence.current !== sequence) return;
      setSuggestions(results);
      if (!results.length) {
        setSearchError(
          "Nenhum endereço encontrado. Você pode escolher o ponto no mapa.",
        );
      }
    } catch (error) {
      if (searchSequence.current !== sequence) return;
      setSuggestions([]);
      setSearchError(
        error instanceof Error
          ? error.message
          : "Não foi possível buscar endereços.",
      );
    } finally {
      if (searchSequence.current === sequence) setSearching(false);
    }
  }

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
            onChange={(event) => {
              searchSequence.current += 1;
              setSuggestions([]);
              setSearchError("");
              setSearching(false);
              onChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void searchExplicitly();
            }}
            aria-label={label}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={focused && (matchingPlaces.length > 0 || suggestions.length > 0 || Boolean(searchError))}
            aria-controls={`${inputId}-suggestions`}
          />
        </span>
        <span className="field-actions">
          <button
            type="button"
            className="field-action"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void searchExplicitly()}
            aria-label={`Buscar ${label.toLowerCase()}`}
            disabled={searching || value.trim().length < 3}
          >
            <Search className={searching ? "is-spinning" : ""} />
          </button>
          {onUseGps && (
            <button
              type="button"
              className="field-action"
              onClick={onUseGps}
              aria-label="Usar localização atual"
              disabled={gpsBusy}
            >
              <Crosshair className={gpsBusy ? "is-spinning" : ""} />
            </button>
          )}
          <button
            type="button"
            className="field-action"
            onClick={onOpenMap}
            aria-label={`Escolher ${label.toLowerCase()} no mapa`}
          >
            <MapPin />
          </button>
        </span>
      </label>
      {focused && !selected && value.trim().length >= (liveSearch ? 2 : 3) && (
        <div
          id={`${inputId}-suggestions`}
          className="address-suggestions"
          role="listbox"
          aria-label={`Sugestões para ${label}`}
        >
          {searching && (
            <div className="address-search-state">
              <Search className="is-spinning" /> Buscando endereços…
            </div>
          )}
          {matchingPlaces.map((place) => (
            <button
              key={`quick-${place.id}`}
              type="button"
              role="option"
              aria-selected="false"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect({
                  id: place.id,
                  address: place.address,
                  shortAddress: place.name,
                  lat: place.latitude,
                  lng: place.longitude,
                  city: "Ribeira do Pombal",
                  state: "BA",
                  approximate: false,
                });
                setFocused(false);
              }}
            >
              <MapPin />
              <span><b>{place.name}</b><small>{place.address}</small></span>
              <ChevronRight />
            </button>
          ))}
          {!searching &&
            suggestions.map((result) => (
              <button
                key={result.id}
                type="button"
                role="option"
                aria-selected="false"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(result);
                  setFocused(false);
                }}
              >
                <MapPin />
                <span>
                  <b>{result.shortAddress}</b>
                  <small>
                    {result.approximate
                      ? "Número aproximado — ajuste o ponto no mapa se necessário"
                      : result.address}
                  </small>
                </span>
                <ChevronRight />
              </button>
            ))}
          {!searching && searchError && (
            <div className="address-search-state error">{searchError}</div>
          )}
          {!searching && !searchError && !suggestions.length && (
            <div className="address-search-state">
              Digite o endereço e toque em buscar.
            </div>
          )}
          {!searching &&
            (searchError || suggestions.some((item) => item.approximate)) && (
              <button
                type="button"
                className="address-map-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onOpenMap}
              >
                <Layers /> Escolher ou ajustar no mapa
              </button>
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
  const [point, setPoint] = useState<LivePoint>(
    initial || {
      lat: -10.8373,
      lng: -38.5357,
      label: "Centro de Ribeira do Pombal",
    },
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function confirm() {
    setBusy(true);
    setMessage("Identificando o endereço do ponto…");
    try {
      const result = await backend.reverseAddress(point.lat, point.lng);
      onConfirm(preserveExactCoordinates(point, result));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `${error.message} Usando a coordenada exata selecionada.`
          : "Endereço indisponível. Usando a coordenada exata selecionada.",
      );
      onConfirm(coordinateOnlyAddress(point, "Ponto selecionado no mapa"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="map-picker-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="map-picker-title"
    >
      <div className="map-picker-sheet">
        <header>
          <div>
            <small>SELEÇÃO MANUAL</small>
            <h2 id="map-picker-title">
              Escolher {kind === "origin" ? "origem" : "destino"} no mapa
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar mapa">
            <X />
          </button>
        </header>
        <p>
          Clique no mapa ou arraste o marcador até o ponto exato. Depois
          confirme o endereço.
        </p>
        <div className="map-picker-canvas">
          <RealMap pickPoint={point} onPick={setPoint} />
        </div>
        <div className="map-picker-coordinates">
          <MapPin /> {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
        </div>
        {message && (
          <div className="map-picker-message" role="status">
            {message}
          </div>
        )}
        <div className="map-picker-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" onClick={confirm} disabled={busy}>
            <Check /> {busy ? "Confirmando…" : "Confirmar este ponto"}
          </button>
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
      (position) => {
        try {
          coordinatesFromGeolocation(position.coords);
          resolve(position);
        } catch (error) {
          reject(error);
        }
      },
      (error) => reject(new Error(geolocationMessage(error))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

function geolocationMessage(error: GeolocationPositionError) {
  return geolocationErrorMessage(error.code);
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

function NotificationsPanel({
  backend,
  id,
  driverMode = false,
}: {
  backend: Backend;
  id?: string;
  driverMode?: boolean;
}) {
  const [pushMessage, setPushMessage] = useState("");
  const Root = driverMode ? "section" : "details";
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
    <Root className={`notification-panel ${driverMode ? "driver-notifications" : ""}`} id={id}>
      {driverMode ? <div className="driver-notifications-intro"><span><Bell aria-hidden="true" /></span><div><h2>Seus avisos</h2><p>Acompanhe novidades sobre corridas e sua conta.</p></div>{backend.unreadNotifications > 0 && <b>{backend.unreadNotifications} {backend.unreadNotifications === 1 ? "nova" : "novas"}</b>}</div> : <summary>
        <span>
          <Bell /> Notificações
        </span>
        {backend.unreadNotifications > 0 && (
          <b>{backend.unreadNotifications}</b>
        )}
      </summary>}
      <div className="notification-actions">
        <button type="button" onClick={enablePush} disabled={typeof Notification !== "undefined" && Notification.permission === "denied"}>{driverMode ? "Ativar notificações no celular" : "ATIVAR PUSH"}</button>
        {backend.unreadNotifications > 0 && (
          <button type="button" onClick={() => backend.markNotificationsRead()}>
            {driverMode ? "Marcar todas como lidas" : "MARCAR COMO LIDAS"}
          </button>
        )}
      </div>
      {driverMode && typeof Notification !== "undefined" && Notification.permission === "denied" && <p className="driver-notifications-hint">As notificações estão bloqueadas nas permissões deste navegador.</p>}
      {pushMessage && (
        <small className="notification-message">{pushMessage}</small>
      )}
      <div className="notification-list">
        {backend.notificationsLoading ? (
          <p role="status">Carregando notificações…</p>
        ) : backend.notificationsError ? (
          <div className="panel-error" role="alert">
            <p>{backend.notificationsError}</p>
            <button type="button" onClick={backend.reloadNotifications}>
              Tentar novamente
            </button>
          </div>
        ) : backend.notifications.length ? (
          backend.notifications.slice(0, driverMode ? 20 : 8).map((item) => (
            <button
              key={item.id}
              className={item.read_at ? "read" : ""}
              type="button"
              onClick={() =>
                !item.read_at && backend.markNotificationsRead(item.id)
              }
            >
              <b>{driverMode && !item.read_at && <i aria-label="Não lida" />}{item.title}</b>
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
          <div className={driverMode ? "driver-subpage-state" : ""}>{driverMode && <Bell aria-hidden="true" />}<p>Você não possui notificações.</p></div>
        )}
      </div>
    </Root>
  );
}

function PassengerMobilePanel({
  backend,
  view,
  selectedRide,
  savedPlaces,
  initialProfileSection,
  onSavePlace,
  onRemovePlace,
  onChoosePlace,
  onUseCoupon,
  paymentMethod,
  onPaymentMethod,
  onBack,
  onOpenNotifications,
  onOpenRides,
  onOpenRide,
}: {
  backend: Backend;
  view: Exclude<PassengerMobileView, "home">;
  selectedRide: HistoryRide | null;
  savedPlaces: SavedPlace[];
  initialProfileSection: "main" | "places";
  onSavePlace: (place: SavedPlace) => void;
  onRemovePlace: (id: string) => void;
  onChoosePlace: (place: SavedPlace) => void;
  onUseCoupon: (code: string) => void;
  paymentMethod: "pix" | "cash";
  onPaymentMethod: (method: "pix" | "cash") => void;
  onBack: () => void;
  onOpenNotifications: () => void;
  onOpenRides: () => void;
  onOpenRide: (ride: HistoryRide) => void;
}) {
  const [detailRating, setDetailRating] = useState(5);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratedRideId, setRatedRideId] = useState<string | null>(null);
  const [ratingError, setRatingError] = useState("");
  const historyState = historyPanelState({
    loading: backend.passengerHistoryLoading,
    error: backend.passengerHistoryError,
    count: backend.passengerHistory.length,
  });
  const notificationState = notificationPanelState({
    loading: backend.notificationsLoading,
    error: backend.notificationsError,
    count: backend.notifications.length,
  });
  const title =
    view === "rides"
      ? "Minhas corridas"
      : view === "ride-details"
        ? "Detalhes da corrida"
        : view === "notifications"
          ? "Notificações"
          : "Central do Passageiro";
  return (
    <section
      className="passenger-mobile-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="passenger-mobile-panel-title"
    >
      <header>
        <button type="button" onClick={onBack} aria-label="Voltar">
          <ChevronRight />
        </button>
        <h2 id="passenger-mobile-panel-title">{title}</h2>
        <Image src="/brand/motopombal-badge.png" alt="" width={36} height={36} aria-hidden="true" />
      </header>
      <div className="passenger-mobile-panel-content" tabIndex={-1}>
        {view === "rides" && historyState === "loading" && (
          <div className="mobile-panel-state" role="status">
            <History />
            <p>Carregando suas corridas…</p>
          </div>
        )}
        {view === "rides" && historyState === "empty" && (
          <div className="mobile-panel-state">
            <History />
            <p>Você ainda não possui corridas.</p>
          </div>
        )}
        {view === "rides" && historyState === "error" && (
          <div className="mobile-panel-state error" role="alert">
            <History />
            <p>{backend.passengerHistoryError}</p>
            <Button type="button" onClick={backend.reloadPassengerHistory}>
              Tentar novamente
            </Button>
          </div>
        )}
        {view === "rides" && historyState === "success" && (
          <div className="mobile-history-list">
            {backend.passengerHistory.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenRide(item)}
                aria-label={`Ver corrida para ${item.destination_address}`}
              >
                <span>
                  <small>
                    {new Intl.DateTimeFormat("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(item.completed_at || item.created_at))}
                  </small>
                  <b>{item.destination_address}</b>
                  <em>{rideStatusLabel(item.status)}</em>
                </span>
                <strong>{money(item.final_fare_cents ?? item.fare_cents)}</strong>
                <ChevronRight />
              </button>
            ))}
          </div>
        )}
        {view === "ride-details" && selectedRide && (
          <article className="mobile-ride-details">
            <div>
              <small>Origem</small>
              <b>{selectedRide.origin_address}</b>
            </div>
            <div>
              <small>Destino</small>
              <b>{selectedRide.destination_address}</b>
            </div>
            <dl>
              <div>
                <dt>Data e horário</dt>
                <dd>
                  {new Intl.DateTimeFormat("pt-BR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(
                    new Date(selectedRide.completed_at || selectedRide.created_at),
                  )}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{rideStatusLabel(selectedRide.status)}</dd>
              </div>
              <div>
                <dt>Valor</dt>
                <dd>{money(selectedRide.final_fare_cents ?? selectedRide.fare_cents)}</dd>
              </div>
              <div>
                <dt>Motorista</dt>
                <dd>{selectedRide.driver_name || "Não informado"}</dd>
              </div>
              <div>
                <dt>Pagamento</dt>
                <dd>{selectedRide.payment?.method === "pix" ? "PIX" : selectedRide.payment?.method === "cash" ? "Dinheiro" : "Não informado"}</dd>
              </div>
              <div>
                <dt>Avaliação</dt>
                <dd>{selectedRide.rating ? `${selectedRide.rating.score} de 5 estrelas` : "Ainda não avaliada"}</dd>
              </div>
            </dl>
            {selectedRide.status === "finalizada" && !selectedRide.rating && ratedRideId !== selectedRide.id && <div className="central-ride-rating"><h3>Avalie seu motorista</h3><div aria-label="Escolha de 1 a 5 estrelas">{[1,2,3,4,5].map((score) => <button type="button" key={score} aria-label={`${score} estrela${score > 1 ? "s" : ""}`} aria-pressed={detailRating === score} onClick={() => setDetailRating(score)}><Star fill={score <= detailRating ? "currentColor" : "none"} /></button>)}</div><button type="button" disabled={ratingBusy} onClick={() => { setRatingBusy(true); setRatingError(""); void backend.rateRide(selectedRide.id, detailRating).then(async () => { setRatedRideId(selectedRide.id); await backend.reloadPassengerHistory(); }).catch((error: unknown) => setRatingError(error instanceof Error ? error.message : "Não foi possível avaliar." )).finally(() => setRatingBusy(false)); }}>Enviar avaliação</button>{ratingError && <p role="alert">{ratingError}</p>}</div>}
            {ratedRideId === selectedRide.id && <p className="central-message" role="status">Avaliação enviada. Obrigado!</p>}
            <a className="central-ride-support" href={`mailto:suporte@motovip.app?subject=${encodeURIComponent(`MotoPombal - Ajuda com corrida ${selectedRide.id}`)}`}><Headphones /> Preciso de ajuda com esta corrida</a>
          </article>
        )}
        {view === "ride-details" && !selectedRide && (
          <div className="mobile-panel-state">
            <p>Selecione uma corrida no histórico.</p>
          </div>
        )}
        {view === "profile" && <PassengerCentral
          backend={backend} places={savedPlaces} initialSection={initialProfileSection} onSavePlace={onSavePlace}
          onRemovePlace={onRemovePlace} onChoosePlace={onChoosePlace}
          onUseCoupon={onUseCoupon} paymentMethod={paymentMethod}
          onPaymentMethod={onPaymentMethod} onRides={onOpenRides}
          onNotifications={onOpenNotifications}
        />}
        {view === "notifications" && notificationState === "loading" && (
          <div className="mobile-panel-state" role="status">
            <Bell />
            <p>Carregando notificações…</p>
          </div>
        )}
        {view === "notifications" && notificationState === "empty" && (
          <div className="mobile-panel-state">
            <Bell />
            <p>Você não possui notificações.</p>
          </div>
        )}
        {view === "notifications" && notificationState === "error" && (
          <div className="mobile-panel-state error" role="alert">
            <Bell />
            <p>{backend.notificationsError}</p>
            <Button type="button" onClick={backend.reloadNotifications}>
              Tentar novamente
            </Button>
          </div>
        )}
        {view === "notifications" && notificationState === "success" && (
          <div className="mobile-notification-list">
            {backend.unreadNotifications > 0 && (
              <button
                type="button"
                className="mark-all-read"
                onClick={() => backend.markNotificationsRead()}
              >
                Marcar todas como lidas
              </button>
            )}
            {backend.notifications.map((item) => (
              <button
                type="button"
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
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function PassengerPanel({ backend }: { backend: Backend }) {
  const [originAddress, setOriginAddress] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [originPoint, setOriginPoint] = useState<AddressResult | null>(null);
  const [destinationPoint, setDestinationPoint] =
    useState<AddressResult | null>(null);
  const [locationStatus, setLocationStatus] = useState("");
  const [gpsBusy, setGpsBusy] = useState(false);
  const [deviceLocation, setDeviceLocation] = useState<LivePoint>();
  const [gpsAccuracy, setGpsAccuracy] = useState<number>();
  const [gpsTrackingEnabled, setGpsTrackingEnabled] = useState(false);
  const backendRef = useRef(backend);
  const [mapPicker, setMapPicker] = useState<"origin" | "destination" | null>(
    null,
  );
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const quoteRequestRef = useRef(0);
  const rideRequestInFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactMessage, setContactMessage] = useState("");
  const [nearbyDrivers, setNearbyDrivers] = useState<NearbyDriver[]>([]);
  const [nearbyArrivalSeconds, setNearbyArrivalSeconds] = useState<number | null>(null);
  const [trackingEta, setTrackingEta] = useState<TrackingRoute | null>(null);
  const [trackingEtaError, setTrackingEtaError] = useState("");
  const etaCalculationRef = useRef<EtaCalculation | null>(null);
  const nearbyRefreshAtRef = useRef(0);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [selectedQuickPlace, setSelectedQuickPlace] =
    useState<QuickPlace | null>(null);
  const [quickPlacesOpen, setQuickPlacesOpen] = useState(false);
  const [destinationSearchOpen, setDestinationSearchOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<
    "collapsed" | "middle" | "expanded"
  >("middle");
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "cash">("cash");
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [initialProfileSection, setInitialProfileSection] = useState<"main" | "places">("main");
  const [couponCode, setCouponCode] = useState(() => {
    if (typeof window === "undefined") return "";
    const code = new URL(window.location.href).searchParams.get("cupom")?.trim().toUpperCase();
    return code && code.length >= 3 && code.length <= 24 ? code : "";
  });
  const [couponExpanded, setCouponExpanded] = useState(() =>
    typeof window !== "undefined" && new URL(window.location.href).searchParams.has("cupom"),
  );
  const [couponBusy, setCouponBusy] = useState(false);
  const sheetDragStart = useRef<{
    y: number;
    mode: "collapsed" | "middle" | "expanded";
  } | null>(null);
  const sheetDragged = useRef(false);
  const [quickPlaceSearch, setQuickPlaceSearch] = useState("");
  const [quickPlaceCategory, setQuickPlaceCategory] = useState<
    QuickPlace["category"] | "all"
  >("all");
  const [mobileView, setMobileView] =
    useState<PassengerMobileView>("home");
  const [selectedHistoryRide, setSelectedHistoryRide] =
    useState<HistoryRide | null>(null);
  const activeMobileNav = mobileNavItem(mobileView);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const userId = backend.profile?.role === "passenger" ? backend.profile.id : "";
    const timer = window.setTimeout(() => {
      setSavedPlaces(loadSavedPlaces(userId));
      const preferred = userId && window.localStorage.getItem(`motopombal:passenger-payment:${userId}`);
      setPaymentMethod(preferred === "pix" ? "pix" : "cash");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [backend.profile?.id, backend.profile?.role]);
  function updateSavedPlaces(updater: (current: SavedPlace[]) => SavedPlace[]) {
    const userId = backend.profile?.id;
    if (!userId) return;
    setSavedPlaces((current) => {
      const next = updater(current);
      persistSavedPlaces(userId, next);
      return next;
    });
  }
  function savePlace(place: SavedPlace) {
    updateSavedPlaces((current) => {
      const withoutSameSlot = current.filter((item) => item.id !== place.id &&
        !(place.kind !== "favorite" && item.kind === place.kind));
      return [...withoutSameSlot, place];
    });
  }
  function preferredPayment(method: "pix" | "cash") {
    setPaymentMethod(method);
    if (backend.profile?.id) window.localStorage.setItem(`motopombal:passenger-payment:${backend.profile.id}`, method);
  }
  useEffect(() => {
    backendRef.current = backend;
  }, [backend]);
  useEffect(() => {
    if (!gpsTrackingEnabled || !("geolocation" in navigator)) return;
    const watcher = navigator.geolocation.watchPosition(
      (position) => {
        if (
          !isValidCoordinates({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          })
        ) {
          setLocationStatus("O GPS retornou coordenadas inválidas.");
          return;
        }
        setDeviceLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: "Você está aqui",
        });
        setGpsAccuracy(position.coords.accuracy);
        void backendRef.current.updateLocation(position).catch(() => undefined);
      },
      (error) => {
        setLocationStatus(geolocationMessage(error));
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(watcher);
  }, [gpsTrackingEnabled]);
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
  useEffect(() => {
    const openRides = () => {
      setSelectedHistoryRide(null);
      setMobileView("rides");
    };
    const openNotifications = () => {
      setSelectedHistoryRide(null);
      setMobileView("notifications");
    };
    const openProfile = () => {
      setSelectedHistoryRide(null);
      setInitialProfileSection("main");
      setMobileView("profile");
    };
    const openDestination = () => setDestinationSearchOpen(true);
    document.addEventListener("moto-syxp:open-rides", openRides);
    document.addEventListener(
      "moto-syxp:open-notifications",
      openNotifications,
    );
    document.addEventListener("moto-syxp:open-profile", openProfile);
    document.addEventListener("moto-syxp:open-destination", openDestination);
    return () => {
      document.removeEventListener("moto-syxp:open-rides", openRides);
      document.removeEventListener(
        "moto-syxp:open-notifications",
        openNotifications,
      );
      document.removeEventListener("moto-syxp:open-profile", openProfile);
      document.removeEventListener("moto-syxp:open-destination", openDestination);
    };
  }, []);
  useEffect(() => {
    if (!shouldLockBackground(mobileView)) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileView]);
  const ride = backend.activeRide || backend.completedRide;
  const stage =
    backend.completedRide && !backend.activeRide
      ? "finished"
      : rideStage(ride, Boolean(estimate));
  useEffect(() => {
    if (stage !== "arrived" || !ride?.id) return;
    const key = `motopombal:arrival-alert:${ride.id}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
    void backendRef.current.reloadNotifications().catch(() => undefined);
    navigator.vibrate?.([160, 90, 160]);
    if (document.visibilityState !== "visible") return;
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(760, context.currentTime);
      oscillator.frequency.setValueAtTime(940, context.currentTime + 0.16);
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.34);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.35);
      window.setTimeout(() => { void context.close().catch(() => undefined); }, 500);
    } catch { /* O aviso visual e a notificação da corrida continuam disponíveis. */ }
  }, [stage, ride?.id]);
  const activeRide = backend.activeRide;
  useEffect(() => {
    if (!activeRide || mobileView === "home") return;
    const timer = window.setTimeout(() => {
      setMobileView("home");
      setSelectedHistoryRide(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeRide, mobileView]);
  useEffect(() => {
    if (activeRide || !estimate) return;
    let cancelled = false;
    const refreshNearby = () => {
      if (document.hidden || !navigator.onLine) return;
      nearbyRefreshAtRef.current = Date.now();
      void backendRef.current
        .findNearbyDrivers(estimate.origin)
        .then((result) => {
          if (!cancelled) {
            setNearbyDrivers(result.drivers);
            setNearbyArrivalSeconds(result.arrivalSeconds);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setNearbyDrivers([]);
            setNearbyArrivalSeconds(null);
          }
        });
    };
    const wait = Math.max(0, 10_000 - (Date.now() - nearbyRefreshAtRef.current));
    const timer = window.setTimeout(refreshNearby, wait);
    const interval = window.setInterval(refreshNearby, 10_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [activeRide, backend.nearbyRevision, estimate]);
  const driverLocation = backend.driverLocation;
  useEffect(() => {
    const phase = trackingPhase(activeRide?.status);
    if (!activeRide || !phase) {
      etaCalculationRef.current = null;
      const timer = window.setTimeout(() => {
        setTrackingEta(null);
        setTrackingEtaError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const freshnessSeconds = driverLocation?.freshnessSeconds || 45;
    if (
      !driverLocation ||
      driverLocation.stale ||
      !isLocationFresh(driverLocation, freshnessSeconds)
    ) {
      const timer = window.setTimeout(() => {
        setTrackingEta(null);
        setTrackingEtaError(
          driverLocation
            ? "Localização do motorista desatualizada."
            : "Aguardando a localização do motorista.",
        );
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (
      !shouldRecalculateEta(
        etaCalculationRef.current,
        phase,
        driverLocation,
      )
    ) {
      return;
    }
    let cancelled = false;
    etaCalculationRef.current = {
      phase,
      location: driverLocation,
      calculatedAt: Date.now(),
    };
    void backendRef.current
      .trackingRoute(activeRide.id)
      .then((result) => {
        if (cancelled) return;
        setTrackingEta(result);
        setTrackingEtaError("");
        etaCalculationRef.current = {
          phase: result.phase,
          location: driverLocation,
          calculatedAt: Date.parse(result.calculatedAt) || Date.now(),
        };
      })
      .catch(() => {
        if (cancelled) return;
        setTrackingEta(null);
        setTrackingEtaError("Tempo estimado temporariamente indisponível.");
      });
    return () => {
      cancelled = true;
    };
  }, [activeRide, driverLocation]);
  useEffect(() => {
    const refreshMap = () =>
      document.dispatchEvent(new Event("moto-syxp:map-layout"));
    const frame = window.requestAnimationFrame(refreshMap);
    const settled = window.setTimeout(refreshMap, 280);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settled);
    };
  }, [destinationSearchOpen, mapPicker, quickPlacesOpen, sheetMode, stage]);
  const origin = useMemo(() => ride
    ? { lat: ride.origin_lat, lng: ride.origin_lng, label: ride.origin_address }
    : estimate
      ? {
          lat: estimate.origin.lat,
          lng: estimate.origin.lng,
          label: estimate.origin.address,
        }
      : originPoint
        ? {
            lat: originPoint.lat,
            lng: originPoint.lng,
            label: originPoint.shortAddress,
          }
        : undefined, [ride, estimate, originPoint]);
  const destination = useMemo(() => ride
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
        ? {
            lat: destinationPoint.lat,
            lng: destinationPoint.lng,
            label: destinationPoint.shortAddress,
          }
        : undefined, [ride, estimate, destinationPoint]);
  const driverName = ride?.driver?.profiles?.full_name || "Seu MotoPombal";
  const vehicle = ride?.driver?.vehicles?.[0];
  const pickupStage = stage === "accepted" || stage === "arrived";
  const tripStage = stage === "riding";
  const trackingPhaseNow = pickupStage ? "pickup" : tripStage ? "trip" : null;
  const freshDriver = driverLocation && !driverLocation.stale &&
    isLocationFresh(driverLocation, driverLocation.freshnessSeconds || 45);
  const liveTracking = trackingPhaseNow && trackingEta?.phase === trackingPhaseNow &&
    freshDriver && Date.now() - Date.parse(trackingEta.calculatedAt) < 60_000
    ? trackingEta : null;
  const trackingDistance = liveTracking?.distanceMeters ?? (pickupStage && freshDriver ? driverLocation.distanceToOriginMeters : null);
  const driverApproaching = stage === "accepted" && trackingDistance != null && trackingDistance <= 180;
  const trackingTitle = stage === "arrived" ? "Motorista no local" : driverApproaching ? "Motorista chegando" : tripStage ? "A caminho do destino" : "Motorista a caminho";
  const trackingDetail = stage === "arrived" ? "Aguardando o embarque" : liveTracking
    ? `${(liveTracking.distanceMeters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km • ${minutes(liveTracking.durationSeconds)} min`
    : "Atualizando trajeto";
  const routeGeometry = stage === "arrived" ? undefined : trackingPhaseNow ? liveTracking?.geometry : ride?.route_geometry || estimate?.geometry;
  const route = useMemo(() => routePoints(routeGeometry), [routeGeometry]);
  const mapOrigin = tripStage ? undefined : origin;
  const mapDestination = pickupStage ? undefined : destination;
  const completedEntry = ride
    ? backend.passengerHistory.find((item) => item.id === ride.id)
    : undefined;
  const payment = completedEntry?.payment;
  const rating = completedEntry?.rating;
  const quickPlaces = backend.quickPlaces || [];
  const destinationCityPlaces = Array.from(quickPlaces.reduce((places, place) => {
    const entry = destinationCityEntry(place.name);
    if (place.active && entry && !places.has(entry.label)) places.set(entry.label, place);
    return places;
  }, new Map<string, QuickPlace>()).values()).sort((left, right) => {
    const leftLabel = destinationCityLabel(left.name);
    const rightLabel = destinationCityLabel(right.name);
    return DESTINATION_CITY_CATALOG.findIndex((entry) => entry.label === leftLabel)
      - DESTINATION_CITY_CATALOG.findIndex((entry) => entry.label === rightLabel);
  });
  const recentDestinations = Array.from(
    new Map(
      backend.passengerHistory
        .filter((item) => Boolean(item.destination_address))
        .map((item) => [item.destination_address, item]),
    ).values(),
  ).slice(0, 3);
  const featuredQuickPlaces = quickPlaces
    .filter((place) => place.active && place.featured)
    .slice(0, 6);
  const mapLandmarks = useMemo(() => (backend.quickPlaces || [])
    .filter((place) => place.active && place.featured)
    .slice(0, 5)
    .map((place) => ({ lat: place.latitude, lng: place.longitude, label: place.name, category: place.category })), [backend.quickPlaces]);
  const visibleQuickPlaces = quickPlaces.filter((place) => {
    if (!place.active) return false;
    if (quickPlaceCategory !== "all" && place.category !== quickPlaceCategory)
      return false;
    const search = quickPlaceSearch.trim().toLocaleLowerCase("pt-BR");
    return (
      !search ||
      `${place.name} ${place.address}`
        .toLocaleLowerCase("pt-BR")
        .includes(search)
    );
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSheetMode(
        stage === "riding"
          ? "collapsed"
          : stage === "finished"
            ? "expanded"
            : "middle",
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    if (!destinationSearchOpen) return;
    const frame = window.requestAnimationFrame(() =>
      document.getElementById("destination-search-address")?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [destinationSearchOpen]);

  function changeSheetByDrag(clientY: number) {
    const start = sheetDragStart.current;
    if (!start) return;
    const delta = clientY - start.y;
    if (Math.abs(delta) < 42) return;
    const modes = ["collapsed", "middle", "expanded"] as const;
    const current = modes.indexOf(start.mode);
    const next = delta < 0 ? Math.min(current + 1, 2) : Math.max(current - 1, 0);
    setSheetMode(modes[next]);
  }

  async function locateDevice() {
    setLocationStatus("Obtendo sua localização…");
    const position = await gpsPosition();
    const exact = coordinatesFromGeolocation(position.coords);
    setDeviceLocation({ ...exact, label: "Você está aqui" });
    setGpsAccuracy(position.coords.accuracy);
    setGpsTrackingEnabled(true);
    let result: AddressResult;
    try {
      result = await backend.reverseAddress(exact.lat, exact.lng);
    } catch {
      result = coordinateOnlyAddress(exact, "Minha localização");
    }
    await backend.updateLocation(position).catch(() => undefined);
    return preserveExactCoordinates(exact, result);
  }

  async function requestCurrentLocation() {
    setNotice("");
    setGpsBusy(true);
    try {
      const result = await locateDevice();
      setOriginPoint(result);
      setOriginAddress(result.address);
      setEstimate(null);
      setLocationStatus("Localização encontrada");
      if (destinationPoint) void calculate(destinationPoint, result);
      setNotice(
        result.provider === "coordinates"
          ? "Localização encontrada. O endereço não pôde ser identificado; a coordenada exata foi preservada."
          : "Localização encontrada",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível obter sua localização";
      setLocationStatus(message);
      setNotice(message);
      setSheetMode("expanded");
    } finally {
      setGpsBusy(false);
    }
  }

  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let cancelled = false;
    void navigator.permissions.query({ name: "geolocation" }).then((permission) => {
      if (cancelled || permission.state !== "granted") return;
      void requestCurrentLocation();
    }).catch(() => undefined);
    return () => { cancelled = true; };
    // A permissão já concedida é verificada somente ao abrir o mapa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function centerOnCurrentLocation() {
    setNotice("");
    setGpsBusy(true);
    try {
      const result = await locateDevice();
      setLocationStatus("Mapa centralizado na localização atual");
      if (result.provider === "coordinates") {
        setNotice(
          "Mapa centralizado no GPS. O endereço não pôde ser identificado.",
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível obter sua localização";
      setLocationStatus(message);
      setNotice(message);
    } finally {
      setGpsBusy(false);
    }
  }

  function chooseDestination(result: AddressResult, message = "Destino selecionado") {
    setDestinationAddress(result.address);
    setDestinationPoint(result);
    setSelectedQuickPlace(null);
    setEstimate(null);
    setDestinationSearchOpen(false);
    setSheetMode("middle");
    setNotice(`${message}. Calculando a melhor rota…`);
    void calculate(result);
  }

  function chooseQuickPlace(place: QuickPlace) {
    const result: AddressResult = {
      id: place.id,
      address: place.address,
      shortAddress: place.name,
      lat: place.latitude,
      lng: place.longitude,
      city: "Ribeira do Pombal",
      state: "BA",
      approximate: false,
    };
    setDestinationAddress(result.address);
    setDestinationPoint(result);
    setSelectedQuickPlace(place);
    setEstimate(null);
    setQuickPlacesOpen(false);
    setDestinationSearchOpen(false);
    setSheetMode("middle");
    setNotice(`${place.name} definido pelas coordenadas oficiais. Calculando a melhor rota…`);
    void calculate(result);
  }

  function chooseSavedPlace(place: SavedPlace) {
    setMobileView("home");
    chooseDestination(place.address, `${place.label} selecionado`);
  }
  function chooseRecentDestination(item: HistoryRide) {
    chooseDestination({
      id: `recent-${item.id}`,
      address: item.destination_address,
      shortAddress: item.destination_address.split(",")[0],
      lat: item.destination_lat,
      lng: item.destination_lng,
      city: "Ribeira do Pombal",
      state: "BA",
      approximate: false,
    }, "Destino recente selecionado");
  }
  function handleRecentDestinationClick(event: MouseEvent<HTMLButtonElement>) {
    const item = backend.passengerHistory.find((ride) => ride.id === event.currentTarget.dataset.rideId);
    if (item) chooseRecentDestination(item);
  }

  function openPanel(id: string) {
    if (
      id === "passenger-history" &&
      window.matchMedia("(max-width: 950px)").matches
    ) {
      setSelectedHistoryRide(null);
      setMobileView("rides");
      return;
    }
    const panel = document.getElementById(id) as HTMLDetailsElement | null;
    if (panel) {
      panel.open = true;
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  async function calculate(destinationOverride?: AddressResult, originOverride?: AddressResult) {
    const requestId = ++quoteRequestRef.current;
    const resolvedDestination = destinationOverride || destinationPoint;
    const requestedDestination =
      resolvedDestination?.address || destinationAddress.trim();
    if (!requestedDestination) {
      setBusy(false);
      setNotice("Informe o destino.");
      return;
    }
    setEstimate(null);
    setNearbyDrivers([]);
    setNearbyArrivalSeconds(null);
    setBusy(true);
    setNotice("");
    try {
      let resolvedOrigin = originOverride || originPoint;
      if (!resolvedOrigin && !originAddress.trim()) {
        resolvedOrigin = await locateDevice();
        setOriginPoint(resolvedOrigin);
        setOriginAddress(resolvedOrigin.address);
        setLocationStatus("Localização encontrada");
      }
      const result = await backend.estimateRide({
        origin: resolvedOrigin
          ? {
              address: resolvedOrigin.address,
              lat: resolvedOrigin.lat,
              lng: resolvedOrigin.lng,
            }
          : { address: originAddress },
        destination: resolvedDestination
          ? {
              address: resolvedDestination.address,
              lat: resolvedDestination.lat,
              lng: resolvedDestination.lng,
            }
          : selectedQuickPlace
            ? {
                address: selectedQuickPlace.address,
                lat: selectedQuickPlace.latitude,
                lng: selectedQuickPlace.longitude,
              }
            : { address: requestedDestination },
      });
      if (requestId !== quoteRequestRef.current) return;
      const nearby = await backend.findNearbyDrivers(result.origin);
      if (requestId !== quoteRequestRef.current) return;
      setEstimate(result);
      setOriginAddress(result.origin.address);
      setDestinationAddress(result.destination.address);
      setOriginPoint({
        id: "estimated-origin",
        address: result.origin.address,
        shortAddress: result.origin.address.split(",").slice(0, 3).join(","),
        lat: result.origin.lat,
        lng: result.origin.lng,
        city: "",
        state: "",
        approximate: false,
      });
      setDestinationPoint({
        id: "estimated-destination",
        address: result.destination.address,
        shortAddress: result.destination.address
          .split(",")
          .slice(0, 3)
          .join(","),
        lat: result.destination.lat,
        lng: result.destination.lng,
        city: "",
        state: "",
        approximate: false,
      });
      setNearbyDrivers(nearby.drivers);
      setNearbyArrivalSeconds(nearby.arrivalSeconds);
      setDestinationSearchOpen(false);
      setSheetMode("middle");
      setNotice("");
    } catch (error) {
      if (requestId !== quoteRequestRef.current) return;
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível calcular a corrida.",
      );
    } finally {
      if (requestId === quoteRequestRef.current) setBusy(false);
    }
  }
  async function requestRide() {
    if (!estimate || rideRequestInFlight.current) return;
    rideRequestInFlight.current = true;
    setBusy(true);
    setNotice("");
    try {
      await backend.requestRide({
        origin: estimate.origin,
        destination: estimate.destination,
        paymentMethod,
        couponCode: estimate.coupon?.code,
        quoteToken: estimate.quoteToken,
      });
      setEstimate(null);
      setNearbyDrivers([]);
      setNearbyArrivalSeconds(null);
    } catch (error) {
      if (
        error instanceof BackendApiError &&
        (error.code === "QUOTE_PRICE_CHANGED" ||
          error.code === "QUOTE_EXPIRED")
      ) {
        const refreshed = quoteFromApiError(error);
        if (refreshed) {
          setEstimate(refreshed);
          setNotice(`${error.message} Novo valor: ${money(refreshed.fareCents)}.`);
          return;
        }
      }
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível solicitar a corrida.",
      );
    } finally {
      rideRequestInFlight.current = false;
      setBusy(false);
    }
  }
  async function validateCoupon() {
    if (!estimate || couponCode.trim().length < 3) {
      setNotice("Digite um cupom válido.");
      return;
    }
    setCouponBusy(true);
    setNotice("");
    try {
      const result = await backend.estimateRide({
        origin: estimate.origin,
        destination: estimate.destination,
        couponCode: couponCode.trim(),
      });
      setEstimate(result);
      setCouponCode(result.coupon?.code || couponCode.trim().toUpperCase());
      setCouponExpanded(false);
      setNotice(
        result.discountCents
          ? `Cupom ${result.coupon?.code} aplicado: ${money(result.discountCents)} de desconto.`
          : "Cupom validado.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Não foi possível validar o cupom.",
      );
    } finally {
      setCouponBusy(false);
    }
  }
  async function cancelRide() {
    if (!ride) return;
    setCancelConfirmOpen(false);
    setBusy(true);
    try {
      const cancelled = await backend.transitionRide(
        ride.id,
        "cancelada",
        "Cancelada pelo passageiro",
      );
      await backend.refresh();
      setNotice(cancelled.ride?.cancellation_fee_cents
        ? `Corrida cancelada. Taxa avaliada: ${money(cancelled.ride.cancellation_fee_cents)}.`
        : "Corrida cancelada sem taxa.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Não foi possível cancelar.",
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
              ride?.redispatch_started_at ? "Motorista cancelou" : "Solicitação enviada",
              ride?.redispatch_started_at ? "Procurando novo motorista..." : "Procurando um MotoPombal próximo…",
              ride?.redispatch_started_at ? "O motorista precisou cancelar. Estamos procurando outro motorista para você." : "Motoristas online da região receberam sua solicitação.",
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
                  "Seu MotoPombal está esperando",
                  "Encontre o motorista no ponto de embarque.",
                ]
              : stage === "finished"
                ? [
                    "Viagem concluída",
                    "Corrida finalizada",
                    "Resumo calculado e registrado pelo MotoPombal.",
                  ]
                : [
                    "Corrida em andamento",
                    "Rumo ao destino",
                    trackingEta?.phase === "trip"
                      ? `${minutes(trackingEta.durationSeconds)} min até o destino.`
                      : trackingEtaError || "Calculando o tempo até o destino…",
                  ];
  function clearBookingPoint(kind: "origin" | "destination") {
    quoteRequestRef.current += 1;
    setBusy(false);
    setEstimate(null);
    setNearbyDrivers([]);
    setNearbyArrivalSeconds(null);
    if (kind === "origin") {
      setOriginAddress("");
      setOriginPoint(null);
      setSheetMode("expanded");
    } else {
      setDestinationAddress("");
      setDestinationPoint(null);
      setDestinationSearchOpen(true);
    }
  }

  function swapBookingPoints() {
    quoteRequestRef.current += 1;
    setBusy(false);
    const oldOrigin = originPoint;
    const oldDestination = destinationPoint;
    setOriginPoint(oldDestination);
    setDestinationPoint(oldOrigin);
    setOriginAddress(destinationAddress);
    setDestinationAddress(originAddress);
    setEstimate(null);
    setNearbyDrivers([]);
    setNearbyArrivalSeconds(null);
    if (oldOrigin && oldDestination) void calculate(oldOrigin, oldDestination);
  }
  return (
    <div
      className={`passenger-shell passenger-stage-${stage} sheet-${sheetMode}`}
    >
      <section className="passenger-map">
        <MapCanvas
          compactRoute
          origin={mapOrigin}
          destination={mapDestination}
          currentLocation={pickupStage ? undefined : deviceLocation}
          hideCurrentLocation={pickupStage}
          accuracyMeters={gpsAccuracy}
          nearbyDrivers={trackingPhaseNow ? NO_NEARBY_DRIVER_RESULTS : nearbyDrivers}
          route={route}
          trackingBadge={trackingPhaseNow && freshDriver ? { title: trackingTitle, detail: trackingDetail } : undefined}
          landmarks={trackingPhaseNow ? mapLandmarks : NO_MAP_LANDMARKS}
          connected={isOnline && backend.realtimeStatus === "connected"}
          onRequestLocation={centerOnCurrentLocation}
          driver={
            freshDriver
              ? {
                  lat: driverLocation.lat,
                  lng: driverLocation.lng,
                  label: driverName,
                }
              : undefined
          }
        />
        {(stage === "draft" || stage === "quote") && (
          <button className="motovip-map-location" type="button" onClick={() => void centerOnCurrentLocation()}>
            <Crosshair />
            <span><b>{deviceLocation ? "Você está aqui" : "Encontrar minha localização"}</b><small>{originAddress || "Ribeira do Pombal - BA"}</small></span>
          </button>
        )}
      </section>
      <section className={`ride-sheet sheet-${sheetMode}`}>
        <button
          type="button"
          className="sheet-handle"
          aria-label={`Painel ${sheetMode === "collapsed" ? "recolhido" : sheetMode === "middle" ? "intermediário" : "expandido"}. Arraste para ajustar.`}
          onPointerDown={(event) => {
            sheetDragStart.current = { y: event.clientY, mode: sheetMode };
            sheetDragged.current = false;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            if (
              sheetDragStart.current &&
              Math.abs(event.clientY - sheetDragStart.current.y) >= 42
            ) {
              sheetDragged.current = true;
            }
            changeSheetByDrag(event.clientY);
            sheetDragStart.current = null;
          }}
          onClick={() => {
            if (sheetDragged.current) {
              sheetDragged.current = false;
              return;
            }
            setSheetMode((mode) =>
              mode === "collapsed"
                ? "middle"
                : mode === "middle"
                  ? "expanded"
                  : "middle",
            );
          }}
        />
        {stage === "draft" && <div className="passenger-home-sheet">
          <h1>Para onde vamos?</h1>
          <button type="button" className="passenger-home-search" onClick={() => setDestinationSearchOpen(true)}><Search /><span>Digite seu destino</span><ChevronRight /></button>
          <div className="passenger-home-saved" aria-label="Lugares favoritos">
            {(["home", "work"] as const).map((kind) => {
              const place = savedPlaces.find((item) => item.kind === kind);
              return <button type="button" key={kind} onClick={() => { if (place) chooseSavedPlace(place); else { setInitialProfileSection("places"); setMobileView("profile"); } }}>
                {kind === "home" ? <HomeIcon /> : <Building2 />}<span>{kind === "home" ? "Casa" : "Trabalho"}</span>
              </button>;
            })}
            <button type="button" onClick={() => { setDestinationSearchOpen(true); }}><Star /><span>Favoritos</span></button>
            <button type="button" onClick={() => setDestinationSearchOpen(true)}><History /><span>Recentes</span></button>
          </div>
          {!!featuredQuickPlaces.length && <><div className="passenger-home-points-heading"><b>Pontos da cidade</b><button type="button" onClick={() => setQuickPlacesOpen(true)}>Ver mais <ChevronRight /></button></div><div className="passenger-home-points">{featuredQuickPlaces.map((place) => <button type="button" key={place.id} onClick={() => chooseQuickPlace(place)}><QuickPlaceIcon name={place.icon} /><span>{place.name}</span></button>)}</div></>}
        </div>}
        {(stage === "draft" || stage === "quote") && (
          <div className="motovip-booking">
            <div className="motovip-address-card">
              <div className="motovip-address-row">
                <button
                  type="button"
                  className="motovip-address-pickup"
                  onClick={() => void requestCurrentLocation()}
                  disabled={gpsBusy}
                  aria-label="Usar minha localização atual como origem"
                  aria-busy={gpsBusy}
                >
                  <span className="motovip-address-icon origin"><Crosshair className={gpsBusy ? "is-spinning" : ""} /></span>
                  <span className="motovip-address-main">
                    <small>Onde você está?</small>
                    <b>{gpsBusy ? "Obtendo sua localização…" : originAddress || "Definir local de partida"}</b>
                  </span>
                </button>
                <button type="button" className="motovip-address-action" aria-label="Limpar origem" onClick={() => clearBookingPoint("origin")}><X /></button>
              </div>
              <div className="motovip-address-row">
                <span className="motovip-address-icon destination"><MapPin /></span>
                <button type="button" className="motovip-address-main" onClick={() => setDestinationSearchOpen(true)}>
                  <small>Para onde você vai?</small>
                  <b>{destinationAddress || "Escolher destino"}</b>
                </button>
                <button type="button" className="motovip-address-action" aria-label="Limpar destino" onClick={() => clearBookingPoint("destination")}><X /></button>
                <button type="button" className="motovip-swap" aria-label="Inverter origem e destino" disabled={!originPoint || !destinationPoint} onClick={swapBookingPoints}><GripVertical /></button>
              </div>
            </div>
            <div className="motovip-trip-metrics" aria-label="Resumo da rota">
              <div><Route /><span><small>Distância</small><b>{estimate ? `${(estimate.distanceMeters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km` : "—"}</b></span></div>
              <div><Clock3 /><span><small>Tempo estimado</small><b>{estimate ? `${minutes(estimate.durationSeconds)} min` : "—"}</b></span></div>
              <div><CircleDollarSign /><span><small>Preço estimado</small><b>{estimate ? money(estimate.fareCents) : "—"}</b></span></div>
            </div>
            <button className={`motovip-availability ${estimate && nearbyDrivers.length ? "available" : "unavailable"}`} type="button" aria-label="Ver rota e motoristas no mapa" onClick={() => setSheetMode("collapsed")}>
              <Bike />
              <span className="motovip-availability-dot" aria-hidden="true" />
              <span>
                <b>{estimate && nearbyDrivers.length ? "Motoristas no mapa" : estimate ? "Motoristas disponíveis" : "Escolha o destino para consultar motoristas"}</b>
                <small>{estimate && nearbyDrivers.length ? nearbyArrivalSeconds != null ? `Tempo estimado de chegada: ${minutes(nearbyArrivalSeconds)} min.` : "Tempo de chegada indisponível no momento." : estimate ? "A solicitação seguirá o modo de distribuição escolhido pela central." : "Disponibilidade atualizada após calcular a rota."}</small>
              </span>
              <ChevronRight />
            </button>
            <button className="motovip-request" type="button" disabled={busy || backend.profile?.blocked} onClick={() => estimate ? void requestRide() : destinationPoint || destinationAddress ? void calculate() : setDestinationSearchOpen(true)}>
              <Bike /><span><b>{busy ? "Aguarde…" : "Chamar Moto"}</b><small>{estimate ? "Confirmar e solicitar corrida" : "Escolha o destino para continuar"}</small></span>
            </button>
          </div>
        )}
        <div className="status-heading">
          <div>
            <span>{status[0]}</span>
            <h1>{status[1]}</h1>
            <p>{status[2]}</p>
          </div>
          {stage === "draft" && (
            <div className="rider-watermark" aria-hidden="true">
              <Bike />
            </div>
          )}
          {stage === "searching" && (
            <span className="search-pulse">
              <i />
            </span>
          )}
        </div>
        {stage === "quote" && estimate && nearbyDrivers.length === 0 && (
          <div className="quote-availability" role="status">
            Nenhum motorista com localização recente para mostrar no mapa. As ofertas consideram os motoristas online e disponíveis, conforme o modo escolhido pela central.
          </div>
        )}
        {notice && (
          <div className="auth-message" role="status">
            {notice}
          </div>
        )}
        {(stage === "draft" || stage === "quote") && (
          <>
            <div className="passenger-progressive-flow">
              {stage === "draft" && (
                <>
                  <button
                    type="button"
                    className="destination-launch"
                    onClick={() => setDestinationSearchOpen(true)}
                  >
                    <Search />
                    <span>
                      <b>Para onde vamos?</b>
                      <small>Busque rua, número ou ponto conhecido</small>
                    </span>
                    <ChevronRight />
                  </button>
                  {locationStatus && (
                    <div
                      className={`location-feedback ${locationStatus === "Localização encontrada" ? "success" : ""}`}
                      role="status"
                    >
                      <Crosshair /> {locationStatus}
                      {locationStatus !== "Localização encontrada" && (
                        <button type="button" onClick={requestCurrentLocation}>
                          Tentar novamente
                        </button>
                      )}
                    </div>
                  )}
                  <div className="progressive-quick-places" aria-label="Atalhos de destino">
                    {featuredQuickPlaces.slice(0, 5).map((place) => (
                      <button
                        type="button"
                        key={place.id}
                        onClick={() => chooseQuickPlace(place)}
                        title={place.address}
                      >
                        <QuickPlaceIcon name={place.icon} color={place.color} />
                        <span>{place.name}</span>
                      </button>
                    ))}
                    <button type="button" onClick={() => setQuickPlacesOpen(true)}>
                      <span className="quick-more">•••</span>
                      <span>Ver mais</span>
                    </button>
                  </div>
                  {recentDestinations.length > 0 && (
                    <div className="recent-destinations">
                      <header>
                        <b>Destinos recentes</b>
                        <button
                          type="button"
                          onClick={() => openPanel("passenger-history")}
                        >
                          Ver todos
                        </button>
                      </header>
                      {recentDestinations.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() =>
                            chooseDestination(
                              {
                                id: `recent-${item.id}`,
                                address: item.destination_address,
                                shortAddress: item.destination_address
                                  .split(",")
                                  .slice(0, 2)
                                  .join(","),
                                lat: item.destination_lat,
                                lng: item.destination_lng,
                                city: "Ribeira do Pombal",
                                state: "BA",
                                approximate: false,
                              },
                              "Destino recente selecionado",
                            )
                          }
                        >
                          <MapPin />
                          <span>
                            <b>{item.destination_address.split(",")[0]}</b>
                            <small>
                              {item.destination_address
                                .split(",")
                                .slice(1, 3)
                                .join(",") || "Ribeira do Pombal - BA"}
                            </small>
                          </span>
                          <History />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {stage === "quote" && estimate && (
                <div className="mobile-route-preview">
                  <div className="route-destination-copy">
                    <MapPin />
                    <span>
                      <small>DESTINO</small>
                      <b>{estimate.destination.address.split(",")[0]}</b>
                      <em>{estimate.destination.address.split(",").slice(1).join(",").trim() || "Ribeira do Pombal - BA"}</em>
                    </span>
                    <button
                      type="button"
                      onClick={() => setDestinationSearchOpen(true)}
                    >
                      Alterar
                    </button>
                  </div>
                  <div className="route-metrics">
                    <span>
                      <Route />
                      <b>{(estimate.distanceMeters / 1000).toFixed(1)} km</b>
                      <small>Distância</small>
                    </span>
                    <span>
                      <Clock3 />
                      <b>{minutes(estimate.durationSeconds)} min</b>
                      <small>Tempo estimado</small>
                    </span>
                  </div>
                  <div className="ride-option-card">
                    <span className="ride-option-bike">
                      <Bike />
                    </span>
                    <span>
                      <b>MotoPombal</b>
                      <small>
                        {nearbyDrivers.length
                          ? `${nearbyDrivers.length} motorista(s) com posição recente no mapa`
                          : "A oferta seguirá o modo de distribuição escolhido pela central."}
                      </small>
                    </span>
                    <span className="ride-option-price">
                      {Boolean(estimate.discountCents) && (
                        <small>{money(estimate.originalFareCents || estimate.fareCents)}</small>
                      )}
                      <strong>{money(estimate.fareCents)}</strong>
                    </span>
                  </div>
                  <FinancialControls
                    estimate={estimate} couponCode={couponCode} setCouponCode={setCouponCode}
                    couponExpanded={couponExpanded} setCouponExpanded={setCouponExpanded}
                    couponBusy={couponBusy} validateCoupon={() => void validateCoupon()}
                    paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
                  />
                  <Button
                    disabled={busy || backend.profile?.blocked}
                    className="primary-cta progressive-request-cta"
                    onClick={() => void requestRide()}
                  >
                    {busy ? "AGUARDE…" : "CHAMAR MOTO"}
                    <ChevronRight />
                  </Button>
                </div>
              )}
            </div>
            <div className="address-stack legacy-passenger-controls">
              <AddressField
                backend={backend}
                icon={<MapPin />}
                label="Onde você está?"
                value={originAddress}
                selected={originPoint}
                onChange={(value) => {
                  quoteRequestRef.current += 1;
                  setBusy(false);
                  setOriginAddress(value);
                  setOriginPoint(null);
                  setEstimate(null);
                  setLocationStatus("");
                }}
                onSelect={(result) => {
                  setOriginPoint(result);
                  setOriginAddress(result.address);
                  setEstimate(null);
                  setLocationStatus("Localização encontrada");
                  if (destinationPoint) void calculate(destinationPoint, result);
                }}
                placeholder="Digite o endereço ou use o GPS"
                onUseGps={requestCurrentLocation}
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
                  quoteRequestRef.current += 1;
                  setBusy(false);
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
                  setNotice(
                    result.approximate
                      ? "Rua encontrada. Confirme ou ajuste o ponto no mapa."
                      : "Destino selecionado.",
                  );
                  void calculate(result);
                }}
                placeholder="Digite um endereço ou selecione um ponto"
                onOpenMap={() => setMapPicker("destination")}
                inputId="destination-address"
                accent
              />
            </div>
            {locationStatus && (
              <div
                className={`location-feedback ${locationStatus === "Localização encontrada" ? "success" : ""}`}
                role="status"
              >
                <Crosshair /> {locationStatus}
              </div>
            )}
            <div className="quick-place-section legacy-passenger-controls">
              <div className="quick-place-heading">
                <b>Pontos rápidos de Ribeira do Pombal</b>
                <button type="button" onClick={() => setQuickPlacesOpen(true)}>
                  Ver mais <ChevronRight />
                </button>
              </div>
              {backend.quickPlacesLoading ? (
                <div className="quick-place-state">
                  Carregando pontos rápidos…
                </div>
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
              <div className="quote-card legacy-passenger-controls">
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
            {estimate && (
              <div className="legacy-passenger-controls">
                <FinancialControls
                  estimate={estimate} couponCode={couponCode} setCouponCode={setCouponCode}
                  couponExpanded={couponExpanded} setCouponExpanded={setCouponExpanded}
                  couponBusy={couponBusy} validateCoupon={() => void validateCoupon()}
                  paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
                />
              </div>
            )}
            <Button
              disabled={busy || backend.profile?.blocked}
              className="primary-cta legacy-passenger-controls"
              onClick={() =>
                estimate ? void requestRide() : void calculate()
              }
            >
              {!busy && !estimate && <Calculator />}
              {busy
                ? "AGUARDE…"
                : estimate
                  ? "PEDIR MOTO"
                  : "VER VALOR DA CORRIDA"}
              <ChevronRight />
            </Button>
            {stage === "draft" && (
              <div
                className="home-shortcuts legacy-passenger-controls"
                aria-label="Atalhos"
              >
                <button
                  type="button"
                  onClick={() => openPanel("passenger-history")}
                >
                  <History />
                  <span>
                    <b>Minhas corridas</b>
                    <small>Ver histórico</small>
                  </span>
                  <ChevronRight />
                </button>
                <button
                  type="button"
                  onClick={() => openPanel("passenger-notifications")}
                >
                  <Bell />
                  <span>
                    <b>Notificações</b>
                    <small>Novidades</small>
                  </span>
                  <ChevronRight />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setNotice(
                      "Perfil e suporte estão disponíveis no menu da conta.",
                    )
                  }
                >
                  <Settings2 />
                  <span>
                    <b>Mais opções</b>
                    <small>Perfil e suporte</small>
                  </span>
                  <ChevronRight />
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
              onClick={() => setCancelConfirmOpen(true)}
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
                  {(ride.final_fare_cents ?? ride.fare_cents) === 0
                    ? "CUPOM INTEGRAL · SEM COBRANÇA"
                    : ride.payment_method === "cash"
                    ? "DINHEIRO · PAGAMENTO AO MOTORISTA"
                    : "PIX"}
                </small>
                <b>{(ride.final_fare_cents ?? ride.fare_cents) === 0 ? "Quitado (gratuito)" : paymentLabel(payment?.status || ride.payment_status)}</b>
              </div>
            </div>
            {ride.payment_method === "pix" && (ride.final_fare_cents ?? ride.fare_cents) > 0 && (
              <small className="completion-note">
                Pix indisponível até a homologação de um provedor.
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
            <div className="passenger-tracking-header" role="status">
              <div><h2>{stage === "arrived" ? "Seu motorista chegou" : driverApproaching ? "Seu motorista está chegando" : tripStage ? "Você está a caminho do destino" : "Seu motorista está a caminho"}</h2><p>{stage === "arrived" ? "Está aguardando no ponto de embarque" : tripStage ? "Acompanhe sua rota em tempo real" : "Acompanhe em tempo real"}</p></div>
              <div className="passenger-tracking-eta"><Clock3 /><span><b>{stage === "arrived" ? "0 min" : liveTracking ? `${minutes(liveTracking.durationSeconds)} min` : "—"}</b><small>{stage === "arrived" ? "Muito próximo" : liveTracking ? `${(liveTracking.distanceMeters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km de distância` : "Atualizando rota"}</small></span></div>
            </div>
            <div className="driver-card passenger-driver-card">
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
                  <Star /> {ride.driver?.rating?.toFixed(1) || "—"} · {ride.driver?.trips_count ?? 0} corridas
                </span>
                <small>
                  {vehicle
                    ? `${vehicle.brand} ${vehicle.model} · ${vehicle.color}`
                    : "Veículo cadastrado"}
                </small>
                {vehicle && <strong className="passenger-vehicle-plate"><small>PLACA</small>{vehicle.plate}</strong>}
              </div>
              <div className="passenger-vehicle-fallback" aria-label="Ilustração genérica de moto; foto do veículo não cadastrada"><Image src="/brand/motopombal-moto-marker.svg" alt="" width={80} height={55} /><small>Moto cadastrada</small></div>
              <div className="driver-actions passenger-driver-actions">
                {ride.driver?.profiles?.phone ? (
                  <a
                    href={`tel:${ride.driver.profiles.phone}`}
                    aria-label="Ligar"
                  >
                    <Phone /><small>Ligar</small>
                  </a>
                ) : <button type="button" disabled title="Telefone do motorista indisponível"><Phone /><small>Ligar</small></button>}
                <button type="button" disabled={!ride.driver?.profiles?.phone} aria-label="Abrir mensagem para o motorista" onClick={() => setContactOpen(true)}>
                    <MessageCircle /><small>Mensagem</small>
                </button>
                <button type="button" aria-label="Compartilhar informações da corrida" onClick={() => {
                  const text = `Minha corrida MotoPombal: ${driverName}${vehicle ? `, ${vehicle.brand} ${vehicle.model}, placa ${vehicle.plate}` : ""}. Destino: ${ride.destination_address}.`;
                  if (navigator.share) void navigator.share({ title: "Minha corrida MotoPombal", text }).catch(() => undefined);
                  else void navigator.clipboard?.writeText(text).then(() => setNotice("Informações da corrida copiadas.")).catch(() => setNotice("Não foi possível compartilhar nesta versão do navegador."));
                }}><Share2 /><small>Compartilhar</small></button>
                {stage !== "riding" && <button type="button" disabled={busy} aria-label="Cancelar corrida" onClick={() => setCancelConfirmOpen(true)}><X /><small>Cancelar</small></button>}
              </div>
            </div>
            <div className="passenger-tracking-timeline" aria-label="Etapas da corrida">
              <div className="done"><span><Check /></span><b>Solicitação</b><small>{shortRideTime(ride.requested_at || ride.created_at)}</small></div>
              <div className="line done" />
              <div className={tripStage ? "done" : "active"}><span>{tripStage ? <Check /> : "2"}</span><b>{tripStage || stage === "arrived" ? "Embarque" : "Motorista a caminho"}</b><small>{shortRideTime(tripStage ? ride.started_at : stage === "arrived" ? ride.arrived_at : ride.accepted_at)}</small></div>
              <div className={`line ${tripStage ? "done" : ""}`} />
              <div className={tripStage ? "active" : "upcoming"}><span>3</span><b>{tripStage ? "A caminho do destino" : stage === "arrived" ? "Destino" : "Embarque"}</b><small>{tripStage ? shortRideTime(ride.started_at) : ""}</small></div>
            </div>
            {stage === "arrived" && <div className="passenger-arrival-note" role="status"><Clock3 /><span><b>Motorista no local</b><small>Motorista aguardando no ponto de embarque</small></span></div>}
            {trackingEtaError && !liveTracking && <p className="passenger-tracking-feedback" role="status">{trackingEtaError}</p>}
          </>
        )}
        {stage === "draft" && (
          <details className="history-panel" id="passenger-history">
            <summary>
              MINHAS CORRIDAS <span>{backend.passengerHistory.length}</span>
            </summary>
            <div>
              {backend.passengerHistoryLoading ? (
                <p role="status">Carregando suas corridas…</p>
              ) : backend.passengerHistoryError ? (
                <div className="panel-error" role="alert">
                  <p>{backend.passengerHistoryError}</p>
                  <button type="button" onClick={backend.reloadPassengerHistory}>
                    Tentar novamente
                  </button>
                </div>
              ) : backend.passengerHistory.length ? (
                backend.passengerHistory.map((item) => (
                  <details key={item.id} className="history-item">
                    <summary>
                      <span>
                        {new Intl.DateTimeFormat("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
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
                      <span>Status: {rideStatusLabel(item.status)}</span>
                      <span>
                        {((item.actual_distance_meters || 0) / 1000).toFixed(2)}{" "}
                        km · {durationLabel(item.actual_duration_seconds)}
                      </span>
                      <span>
                        {(item.final_fare_cents ?? item.fare_cents) === 0 ? "Gratuita · Quitada" : `${item.payment?.method === "cash" ? "Dinheiro" : "Pix"} · ${paymentLabel(item.payment?.status)}`}
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
                <p>Você ainda não possui corridas.</p>
              )}
            </div>
          </details>
        )}
        {stage === "draft" && (
          <NotificationsPanel backend={backend} id="passenger-notifications" />
        )}
      </section>
      {contactOpen && ride?.driver?.profiles?.phone && <div className="passenger-tracking-overlay" role="presentation" onClick={() => setContactOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="passenger-message-title" onClick={(event) => event.stopPropagation()}><button type="button" className="tracking-modal-close" aria-label="Fechar mensagem" onClick={() => setContactOpen(false)}><X /></button><MessageCircle /><h2 id="passenger-message-title">Mensagem para {driverName}</h2><p>Escreva uma mensagem. O aplicativo de SMS do seu celular abrirá para enviá-la.</p><textarea value={contactMessage} onChange={(event) => setContactMessage(event.target.value)} placeholder="Digite sua mensagem" maxLength={300} /><div className="tracking-modal-actions"><button type="button" onClick={() => setContactOpen(false)}>Voltar</button><a href={`sms:${ride.driver.profiles.phone}?body=${encodeURIComponent(contactMessage.trim())}`} aria-disabled={!contactMessage.trim()} onClick={(event) => { if (!contactMessage.trim()) event.preventDefault(); else setContactOpen(false); }}>Abrir SMS</a></div></section></div>}
      {cancelConfirmOpen && ride && <div className="passenger-tracking-overlay" role="presentation" onClick={() => setCancelConfirmOpen(false)}><section role="alertdialog" aria-modal="true" aria-labelledby="passenger-cancel-title" aria-describedby="passenger-cancel-description" onClick={(event) => event.stopPropagation()}><button type="button" className="tracking-modal-close" aria-label="Fechar confirmação" onClick={() => setCancelConfirmOpen(false)}><X /></button><h2 id="passenger-cancel-title">Deseja cancelar esta corrida?</h2><p id="passenger-cancel-description">A solicitação será encerrada conforme as regras de cancelamento do MotoPombal.</p><div className="tracking-modal-actions"><button type="button" onClick={() => setCancelConfirmOpen(false)}>Voltar</button><button type="button" className="danger" disabled={busy} onClick={() => void cancelRide()}>{busy ? "Cancelando…" : "Cancelar corrida"}</button></div></section></div>}
      {mobileView !== "home" && (
        <PassengerMobilePanel
          backend={backend}
          view={mobileView}
          selectedRide={selectedHistoryRide}
          savedPlaces={savedPlaces}
          initialProfileSection={initialProfileSection}
          onSavePlace={savePlace}
          onRemovePlace={(id) => updateSavedPlaces((current) => current.filter((item) => item.id !== id))}
          onChoosePlace={chooseSavedPlace}
          onUseCoupon={(code) => {
            setCouponCode(code);
            setCouponExpanded(true);
            setMobileView("home");
            setNotice(`Cupom ${code} selecionado. O desconto será confirmado no resumo da corrida.`);
          }}
          paymentMethod={paymentMethod}
          onPaymentMethod={preferredPayment}
          onBack={() => {
            const next = nextPassengerMobileView(mobileView, "back");
            setMobileView(next);
            if (next !== "ride-details") setSelectedHistoryRide(null);
          }}
          onOpenNotifications={() =>
            setMobileView(
              nextPassengerMobileView(mobileView, "open-notifications"),
            )
          }
          onOpenRides={() => setMobileView("rides")}
          onOpenRide={(historyRide) => {
            setSelectedHistoryRide(historyRide);
            setMobileView(
              nextPassengerMobileView(mobileView, "open-ride-details"),
            );
          }}
        />
      )}
      <nav
        className={`passenger-bottom-nav ${["searching", "accepted", "arrived", "riding"].includes(stage) ? "ride-critical" : ""}`}
        aria-label="Navegação principal"
      >
        <button
          type="button"
          className={activeMobileNav === "home" ? "active" : ""}
          aria-current={activeMobileNav === "home" ? "page" : undefined}
          onClick={() => {
            setMobileView(
              nextPassengerMobileView(mobileView, "open-home"),
            );
            setSelectedHistoryRide(null);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <HomeIcon />
          <span>Início</span>
        </button>
        <button
          type="button"
          className={activeMobileNav === "rides" ? "active" : ""}
          aria-current={activeMobileNav === "rides" ? "page" : undefined}
          onClick={() => {
            setSelectedHistoryRide(null);
            setMobileView(
              nextPassengerMobileView(mobileView, "open-rides"),
            );
          }}
        >
          <History />
          <span>Corridas</span>
        </button>
        <button
          type="button"
          className={activeMobileNav === "profile" ? "active" : ""}
          aria-current={activeMobileNav === "profile" ? "page" : undefined}
          onClick={() => {
            setSelectedHistoryRide(null);
            setInitialProfileSection("main");
            setMobileView(
              nextPassengerMobileView(mobileView, "open-profile"),
            );
          }}
        >
          <UserRound />
          <span>Conta</span>
        </button>
      </nav>
      {destinationSearchOpen && (
        <section
          className="destination-search-screen"
          role="dialog"
          aria-modal="true"
          aria-labelledby="destination-search-title"
        >
          <header>
            <button
              className="destination-header-back"
              type="button"
              onClick={() => setDestinationSearchOpen(false)}
              aria-label="Voltar para o mapa"
            >
              <ChevronRight />
            </button>
            <Image className="destination-header-logo" src="/brand/motopombal-wordmark.png" alt="MotoPombal" width={144} height={72} />
            <div className="destination-header-copy">
              <h2 id="destination-search-title">Selecionar destino</h2>
              <p>Para onde você quer ir?</p>
            </div>
            <button
              className="destination-header-map"
              type="button"
              onClick={() => { setDestinationSearchOpen(false); setMapPicker("destination"); }}
              aria-label="Selecionar destino no mapa"
            >
              <MapPin />
            </button>
          </header>
          <div className="destination-search-fields">
            <AddressField
              backend={backend}
              icon={<Crosshair />}
              label="Origem"
              value={originAddress}
              selected={originPoint}
              onChange={(value) => {
                setOriginAddress(value);
                setOriginPoint(null);
                setEstimate(null);
              }}
              onSelect={(result) => {
                setOriginPoint(result);
                setOriginAddress(result.address);
                setEstimate(null);
                setLocationStatus("Localização encontrada");
              }}
              placeholder="Minha localização atual"
              onUseGps={requestCurrentLocation}
              onOpenMap={() => {
                setDestinationSearchOpen(false);
                setMapPicker("origin");
              }}
              gpsBusy={gpsBusy}
              inputId="origin-search-address"
            />
            <AddressField
              backend={backend}
              icon={<Search />}
              label="Destino"
              value={destinationAddress}
              selected={destinationPoint}
              onChange={(value) => {
                setDestinationAddress(value);
                setDestinationPoint(null);
                setSelectedQuickPlace(null);
                setEstimate(null);
              }}
              onSelect={(result) =>
                chooseDestination(
                  result,
                  result.approximate
                    ? "Rua encontrada; ajuste o ponto se necessário"
                    : "Destino selecionado",
                )
              }
              placeholder="Para onde vamos?"
              onOpenMap={() => {
                setDestinationSearchOpen(false);
                setMapPicker("destination");
              }}
              inputId="destination-search-address"
              liveSearch
              quickPlaces={destinationCityPlaces}
              accent
            />
          </div>
          {gpsAccuracy !== undefined && locationStatus === "Localização encontrada" && (
            <div className="destination-search-status" role="status">
              <Crosshair /> Localização encontrada
            </div>
          )}
          <div className="destination-search-suggestions">
            <h3>Meus lugares</h3>
            {savedPlaces.length ? savedPlaces.map((place) => <button type="button" key={place.id} onClick={() => chooseSavedPlace(place)}><MapPin /><span><b>{place.label}</b><small>{place.address.address}</small></span><ChevronRight /></button>) : <p className="destination-places-empty">Salve Casa, Trabalho e favoritos na sua conta.</p>}
            <h3>Destinos recentes</h3>
            {recentDestinations.length ? recentDestinations.map((item) => <button type="button" key={item.id} data-ride-id={item.id} onClick={handleRecentDestinationClick}><History /><span><b>{item.destination_address.split(",")[0]}</b><small>{item.destination_address}</small></span><ChevronRight /></button>) : <p className="destination-places-empty">Seus destinos recentes aparecerão aqui.</p>}
            <h3>Pontos da cidade</h3>
            {destinationCityPlaces.map((place) => (
              <button
                type="button"
                key={`city-${place.id}`}
                onClick={() => chooseQuickPlace(place)}
              >
                <span
                  className={`destination-place-icon destination-place-${place.icon} destination-place-category-${place.category}`}
                  style={{ "--destination-place-color": place.color } as React.CSSProperties}
                >
                  <QuickPlaceIcon name={place.icon} />
                </span>
                <span>
                  <b>{destinationCityLabel(place.name)}</b>
                  <small>{place.address}</small>
                </span>
                <ChevronRight />
              </button>
            ))}
            {backend.quickPlacesLoading && (
              <p className="destination-places-empty" role="status">Carregando pontos da cidade…</p>
            )}
            {!backend.quickPlacesLoading && destinationCityPlaces.length === 0 && (
              <p className="destination-places-empty">Nenhum ponto da cidade cadastrado. Busque um endereço acima ou escolha no mapa.</p>
            )}
          </div>
        </section>
      )}
      {quickPlacesOpen && (
        <div
          className="quick-places-overlay"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setQuickPlacesOpen(false)
          }
        >
          <section
            className="quick-places-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-places-title"
          >
            <div className="quick-places-sheet-handle" />
            <header>
              <div>
                <span>DESTINOS DA CIDADE</span>
                <h2 id="quick-places-title">Todos os pontos rápidos</h2>
              </div>
              <button
                type="button"
                onClick={() => setQuickPlacesOpen(false)}
                aria-label="Fechar pontos rápidos"
              >
                <X />
              </button>
            </header>
            <label className="quick-place-search">
              <Search />
              <input
                value={quickPlaceSearch}
                onChange={(event) => setQuickPlaceSearch(event.target.value)}
                placeholder="Buscar um local"
                autoFocus
              />
            </label>
            <div
              className="quick-place-filters"
              aria-label="Filtrar por categoria"
            >
              {QUICK_PLACE_CATEGORIES.filter(
                (category) =>
                  category.value === "all" ||
                  quickPlaces.some(
                    (place) =>
                      place.active && place.category === category.value,
                  ),
              ).map((category) => (
                <button
                  type="button"
                  key={category.value}
                  className={
                    quickPlaceCategory === category.value ? "active" : ""
                  }
                  onClick={() => setQuickPlaceCategory(category.value)}
                >
                  {category.label}
                </button>
              ))}
            </div>
            <div className="quick-place-catalog">
              {backend.quickPlacesLoading ? (
                <div className="quick-place-catalog-empty">
                  Carregando pontos rápidos…
                </div>
              ) : visibleQuickPlaces.length ? (
                visibleQuickPlaces.map((place) => (
                  <button
                    type="button"
                    key={place.id}
                    onClick={() => chooseQuickPlace(place)}
                  >
                    <span
                      className="catalog-place-icon"
                      style={{ backgroundColor: `${place.color}18` }}
                    >
                      <QuickPlaceIcon name={place.icon} color={place.color} />
                    </span>
                    <span>
                      <b>{place.name}</b>
                      <small>{place.address}</small>
                    </span>
                    <ChevronRight />
                  </button>
                ))
              ) : (
                <div className="quick-place-catalog-empty">
                  {backend.quickPlacesError || "Nenhum ponto rápido disponível"}
                </div>
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
              setMapPicker(null);
              chooseDestination(result, "Destino selecionado no mapa");
              return;
            }
            setEstimate(null);
            setMapPicker(null);
          }}
        />
      )}
    </div>
  );
}

const DRIVER_CANCEL_REASONS = [
  { code: "mechanical", label: "Problema mecânico" },
  { code: "personal", label: "Problema pessoal/emergência" },
  { code: "cannot_reach", label: "Não consigo chegar ao passageiro" },
  { code: "no_show", label: "Passageiro não apareceu" },
  { code: "unsafe", label: "Local inseguro" },
  { code: "passenger_requested", label: "Passageiro solicitou o cancelamento" },
  { code: "address", label: "Problema com endereço/localização" },
  { code: "other", label: "Outro motivo" },
] as const;
type DriverCancelReason = (typeof DRIVER_CANCEL_REASONS)[number]["code"];

function DriverPanel({ backend }: { backend: Backend }) {
  const state = backend.driverState;
  const [busy, setBusy] = useState(false);
  const [noShowConfirmOpen, setNoShowConfirmOpen] = useState(false);
  const [offlinePackage, setOfflinePackage] = useState<OfflineRidePackage | null>(null);
  const [roadGraph, setRoadGraph] = useState<RoadGraph | null>(null);
  const [connectivity, setConnectivity] = useState<ConnectivityState>(connectivityManager.current);
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [offlineConflict, setOfflineConflict] = useState("");
  const syncInFlightRef = useRef(false);
  const cancelRetryingRef = useRef(false);
  const pendingOfflineCount = offlinePackage?.offlineEvents.filter((event) => event.status !== "synced").length || 0;
  const driverId = backend.session?.user.id;
  const serverRide = backend.activeRide;
  const pendingLocalStatus = (!serverRide || offlinePackage?.ride.id === serverRide.id)
    && offlinePackage?.offlineEvents.some((event) => event.status !== "synced");
  const ride = useMemo(() => selectDriverRide({ serverRide, offlinePackage,
    cancelledRideId: backend.cancelledRide?.id,
    serverVerified: backend.rideSnapshotVerified, serverReachable: connectivity !== "OFFLINE" }),
  [backend.cancelledRide?.id, backend.rideSnapshotVerified, connectivity, offlinePackage, serverRide]);
  const currentOfflinePackage = offlinePackage?.ride.id === ride?.id ? offlinePackage : null;
  const localFinished = currentOfflinePackage?.navigationState === "finalizada" && pendingOfflineCount > 0;
  const completedRide = ride ? null : backend.completedRide;
  const offer = backend.offers[0];
  const online = Boolean(state?.online);
  const hasActiveRide = Boolean(ride);
  const trackingGps = online || hasActiveRide;
  const pendingCancellationKey = driverId ? `moto-pombal:pending-driver-cancel:${driverId}` : "";
  useEffect(() => {
    if (!pendingCancellationKey) return;
    let disposed = false;
    const retry = async () => {
      if (disposed || cancelRetryingRef.current || !navigator.onLine) return;
      let pending: { rideId: string; reasonCode: string; reason: string } | null = null;
      try { pending = JSON.parse(window.localStorage.getItem(pendingCancellationKey) || "null"); } catch { window.localStorage.removeItem(pendingCancellationKey); }
      if (!pending?.rideId || !pending.reasonCode || !pending.reason) return;
      cancelRetryingRef.current = true;
      try {
        await backendRef.current.cancelDriverRide(pending.rideId, pending.reasonCode, pending.reason);
        window.localStorage.removeItem(pendingCancellationKey);
        await clearOfflineRide(pending.rideId).catch(() => undefined);
        if (!disposed) {
          setOfflinePackage(null);
          setGpsExpanded(false);
          setCancelStep(0);
          setNotice("Cancelamento confirmado após reconectar.");
          await backendRef.current.refresh().catch(() => undefined);
        }
      } catch (error) {
        if (error instanceof BackendApiError && ["RIDE_STATE_CHANGED", "RIDE_NOT_FOUND", "CANCELLATION_REASON_REQUIRED", "FORBIDDEN", "CANCELLATION_NOT_ALLOWED"].includes(error.code)) {
          window.localStorage.removeItem(pendingCancellationKey);
          if (!disposed) await backendRef.current.refresh().catch(() => undefined);
        }
      } finally { cancelRetryingRef.current = false; }
    };
    void retry();
    window.addEventListener("online", retry);
    const timer = window.setInterval(retry, 15000);
    return () => { disposed = true; window.removeEventListener("online", retry); window.clearInterval(timer); };
  }, [pendingCancellationKey]);
  useEffect(() => {
    connectivityManager.start();
    return () => connectivityManager.stop();
  }, []);
  useEffect(() => connectivityManager.subscribe(setConnectivity), []);
  useEffect(() => {
    if (!driverId || !pendingOfflineCount || connectivity === "OFFLINE" ||
      (backend.activeRide && backend.activeRide.id !== offlinePackage?.ride.id)) return;
    let cancelled = false;
    const synchronize = () => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      if (!cancelled) setSyncingOffline(true);
      void syncOfflineRide(driverId, { getSnapshot: () => backendRef.current.getRideSnapshot(),
        transition: (id, status, event) => backendRef.current.transitionRide(id, status, undefined, event.type === "RIDE_EN_ROUTE" ? undefined : event) })
        .then(async (result) => {
          if (cancelled) return;
          setOfflinePackage(await getOfflineRide(driverId));
          if (result.cancelled) {
            setNotice("Corrida cancelada no servidor.");
            setOfflineConflict("");
            await backendRef.current.refresh().catch(() => undefined);
            return;
          }
          if (result.conflict) { setOfflineConflict(result.conflict); setNotice(result.conflict); }
          else if (result.confirmed) setOfflineConflict("");
          if (result.confirmed) await backendRef.current.refresh().catch(() => undefined);
        }).catch(() => undefined)
        .finally(() => { syncInFlightRef.current = false; if (!cancelled) setSyncingOffline(false); });
    };
    const timer = window.setTimeout(synchronize, 0);
    const interval = window.setInterval(synchronize, 15000);
    return () => { cancelled = true; window.clearTimeout(timer); window.clearInterval(interval); };
  }, [driverId, pendingOfflineCount, connectivity, backend.activeRide?.id, offlinePackage?.ride.id]);
  useEffect(() => {
    if (!driverId) return;
    let active = true;
    void getOfflineRide(driverId).then((data) => { if (active) setOfflinePackage(data); }).catch(() => undefined);
    return () => { active = false; };
  }, [driverId]);
  useEffect(() => {
    if (!offlinePackage || busy ||
      (backend.cancelledRide?.id !== offlinePackage.ride.id && (!backend.rideSnapshotVerified || connectivity === "OFFLINE"))) return;
    if (backend.activeRide?.id === offlinePackage.ride.id) return;
    const obsoleteRideId = offlinePackage.ride.id;
    if (backend.activeRide) {
      void clearOfflineRide(obsoleteRideId).then(() => setOfflinePackage((current) =>
        current?.ride.id === obsoleteRideId ? null : current)).catch(() => undefined);
      return;
    }
    const cancelledByPassenger = backend.cancelledRide?.id === offlinePackage.ride.id
      && backend.cancelledRide.cancelled_by === offlinePackage.ride.passenger_id;
    setNotice(cancelledByPassenger
      ? `Corrida cancelada pelo passageiro.${backend.cancelledRide?.cancellation_fee_cents
        ? ` Taxa avaliada: ${money(backend.cancelledRide.cancellation_fee_cents)}.` : ""}`
      : "Corrida encerrada no servidor.");
    void clearOfflineRide(obsoleteRideId).then(() => setOfflinePackage((current) =>
      current?.ride.id === obsoleteRideId ? null : current)).catch(() => undefined);
    void backendRef.current.refreshDriverQueue();
  }, [offlinePackage, busy, backend.rideSnapshotVerified, backend.activeRide, backend.cancelledRide, connectivity]);
  useEffect(() => {
    if (!offlinePackage || pendingOfflineCount || connectivity === "OFFLINE") return;
    const serverStatus = backend.completedRide?.id === offlinePackage.ride.id ? backend.completedRide.status
      : backend.activeRide?.id === offlinePackage.ride.id ? backend.activeRide.status : null;
    if (serverStatus !== "finalizada" && serverStatus !== "cancelada") return;
    const obsoleteRideId = offlinePackage.ride.id;
    void clearOfflineRide(obsoleteRideId).then(() => setOfflinePackage((current) =>
      current?.ride.id === obsoleteRideId ? null : current)).catch(() => undefined);
  }, [offlinePackage, pendingOfflineCount, connectivity, backend.completedRide, backend.activeRide]);
  useEffect(() => {
    if (!online && !hasActiveRide) return;
    let active = true;
    void loadRegionPackage().then((graph) => { if (active) setRoadGraph(graph); }).catch(() => undefined);
    return () => { active = false; };
  }, [online, hasActiveRide]);
  const [cashBusyRide, setCashBusyRide] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [confirmQueuePause, setConfirmQueuePause] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  async function confirmDriverCash(rideId: string) {
    setCashBusyRide(rideId);
    try {
      await backend.confirmCashPayment(rideId);
      await backend.reloadDriverHistory();
      setNotice("Recebimento em dinheiro confirmado.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível confirmar o recebimento.");
    } finally {
      setCashBusyRide(null);
    }
  }
  const vehicle = state?.vehicles?.[0];
  const [offerSeconds, setOfferSeconds] = useState(0);
  const [alertPreferences, setAlertPreferences] = useState<DriverAlertPreferences>(DEFAULT_DRIVER_ALERT_PREFERENCES);
  const [alertPreferencesReady, setAlertPreferencesReady] = useState(false);
  const alertControllerRef = useRef<RideAlertController | null>(null);
  const queue = backend.driverQueue;
  const { queuePriorityAlertId, dismissQueuePriorityAlert } = backend;
  const queueModeActive = queue?.mode !== "broadcast";
  const queuePosition = queueModeActive && queue?.status === "queued" ? queue.position : null;
  const queueLabel = backend.profile?.blocked || (state && state.approval_status !== "approved") ? "INDISPONÍVEL"
    : backend.driverQueueError ? "FILA INDISPONÍVEL"
    : !queue ? "SINCRONIZANDO FILA"
      : !queueModeActive ? queue.status === "paused" ? "PAUSADO" : online ? "ONLINE • OFERTA SIMULTÂNEA" : "OFFLINE"
      : queue.status === "offer" ? "CORRIDA DISPONÍVEL"
        : queue.status === "on_ride" ? "EM CORRIDA"
          : queue.status === "paused" ? "PAUSADO"
            : queue.status === "offline" ? "OFFLINE"
              : queue.status === "suspended" ? "INDISPONÍVEL"
                : queue.status === "unavailable" ? "FORA DA FILA"
                  : queuePosition === 1 ? "PRÓXIMO • 1º NA FILA" : queuePosition ? `ONLINE • ${queuePosition}º NA FILA` : "FILA INDISPONÍVEL";
  const queueMessage = queuePosition === 1
    ? "Você é o próximo motorista elegível. Fique disponível para receber uma corrida."
    : queuePosition === 2
      ? "Fique atento. Há apenas 1 motorista antes de você."
      : queuePosition === 3
        ? "Sua vez está se aproximando."
        : queuePosition ? "Você está na fila. Pode aguardar." : "A posição aparecerá quando você estiver disponível.";
  useEffect(() => {
    if (!queuePriorityAlertId) return;
    if (queuePosition !== 1 || offer || ride) {
      dismissQueuePriorityAlert();
      return;
    }
    if (!alertPreferencesReady) return;
    void alertControllerRef.current?.start({ ...alertPreferences, notifications: false });
    const timer = window.setTimeout(() => {
      alertControllerRef.current?.stop();
      dismissQueuePriorityAlert();
    }, 2500);
    return () => { window.clearTimeout(timer); alertControllerRef.current?.stop(); };
  }, [queuePriorityAlertId, dismissQueuePriorityAlert, queuePosition, offer, ride, alertPreferences, alertPreferencesReady]);
  async function setQueuePaused(paused: boolean) {
    setQueueBusy(true);
    setNotice("");
    try {
      await backend.setDriverQueuePaused(paused);
      setConfirmQueuePause(false);
      await backend.refresh();
      setNotice(paused ? "Recebimento pausado. Você não receberá novas corridas." : "Você voltou para a fila.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível alterar sua pausa.");
    } finally {
      setQueueBusy(false);
    }
  }
  const expiredOfferRef = useRef("");
  const [testingAlert, setTestingAlert] = useState(false);
  const [gpsExpanded, setGpsExpanded] = useState(false);
  const [mapTilesUnavailable, setMapTilesUnavailable] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [cancelStep, setCancelStep] = useState<0 | 1 | 2>(0);
  const [cancelReason, setCancelReason] = useState<DriverCancelReason | "">("");
  const [cancelOther, setCancelOther] = useState("");
  const [earlyEndOpen, setEarlyEndOpen] = useState(false);
  const [earlyEndReason, setEarlyEndReason] = useState("");
  const [followDriver, setFollowDriver] = useState(true);
  const [navigationCenterRequest, setNavigationCenterRequest] = useState(0);
  const [liveLocation, setLiveLocation] = useState<LivePoint>();
  const [navSample, setNavSample] = useState<{ accuracy: number; speed: number | null; heading: number | null; timestamp: number }>();
  const previousGpsRef = useRef<LivePoint | null>(null);
  const lastGpsTimestampRef = useRef(0);
  const currentGpsPositionRef = useRef<GeolocationPosition | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const announcedRef = useRef(new Set<string>());
  const offRouteSamplesRef = useRef(0);
  const lastDeviationSampleRef = useRef(0);
  const lastRerouteRef = useRef(0);
  const [rerouting, setRerouting] = useState(false);
  const [navClock, setNavClock] = useState(0);
  const [gpsStatus, setGpsStatus] = useState("GPS aguardando");
  const [locationSyncError, setLocationSyncError] = useState("");
  const [gpsRetrying, setGpsRetrying] = useState(false);
  const manualGpsRetryRef = useRef(false);
  const [trackingEta, setTrackingEta] = useState<TrackingRoute | null>(null);
  const [trackingEtaError, setTrackingEtaError] = useState("");
  const etaCalculationRef = useRef<EtaCalculation | null>(null);
  const etaInFlightKeyRef = useRef("");
  const etaFailuresRef = useRef(0);
  const lastSavedPositionRef = useRef(0);
  const lastNavigationTargetRef = useRef("");
  const backendRef = useRef(backend);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [driverView, setDriverView] = useState<"menu" | "profile" | "rides" | "earnings" | "notifications" | "settings" | "support">("menu");
  useEffect(() => {
    if (menuOpen) document.querySelector<HTMLElement>(".driver-sidebar")?.scrollTo(0, 0);
  }, [menuOpen, driverView]);
  useEffect(() => {
    const openQueue = () => {
      setQueueOpen(true);
      setDriverView("settings");
      setMenuOpen(true);
    };
    const openNotifications = () => {
      setDriverView("notifications");
      setMenuOpen(true);
    };
    document.addEventListener("moto-pombal:open-driver-queue", openQueue);
    document.addEventListener("moto-syxp:open-notifications", openNotifications);
    return () => {
      document.removeEventListener("moto-pombal:open-driver-queue", openQueue);
      document.removeEventListener("moto-syxp:open-notifications", openNotifications);
    };
  }, []);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  useEffect(() => () => {
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
  }, [avatarPreviewUrl]);
  const [driverForm, setDriverForm] = useState({
    fullName: backend.profile?.full_name || "",
    phone: backend.profile?.phone || "",
    brand: vehicle?.brand || "",
    model: vehicle?.model || "",
    color: vehicle?.color || "",
    plate: vehicle?.plate || "",
  });
  const rideId = ride?.id;
  const rideIdRef = useRef(rideId);
  rideIdRef.current = rideId;
  const updateLocation = backend.updateLocation;
  useEffect(() => {
    backendRef.current = backend;
  }, [backend]);
  useEffect(() => {
    if (!currentOfflinePackage?.lastKnownPosition || liveLocation) return;
    const last = currentOfflinePackage.lastKnownPosition;
    const timer = window.setTimeout(() => {
      setLiveLocation({ lat: last.lat, lng: last.lng, label: "Última posição conhecida" });
      setGpsStatus("Localização temporariamente indisponível; aguardando GPS.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentOfflinePackage, liveLocation]);
  useEffect(() => {
    if (online || rideId || !("geolocation" in navigator)) return;
    let active = true;
    navigator.geolocation.getCurrentPosition((position) => {
      if (active && isValidCoordinates({ lat: position.coords.latitude, lng: position.coords.longitude })) {
        setLiveLocation({ lat: position.coords.latitude, lng: position.coords.longitude, label: "Sua localização" });
      }
    }, () => undefined, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 });
    return () => { active = false; };
  }, [online, rideId]);
  useEffect(() => {
    if (!trackingGps) return;
    if (!("geolocation" in navigator)) {
      const timer = window.setTimeout(
        () => setGpsStatus("Este aparelho não oferece acesso ao GPS."),
        0,
      );
      return () => window.clearTimeout(timer);
    }
    let permissionStatus: PermissionStatus | null = null;
    let permissionCheckActive = true;
    const reportPermission = (status: PermissionStatus) => {
      if (permissionCheckActive && status.state === "denied") {
        permissionDenied = true;
        setGpsStatus("Localização bloqueada neste site. Toque no ícone ao lado do endereço e permita a localização.");
      }
    };
    const onPermissionChange = () => {
      if (!permissionStatus || !permissionCheckActive) return;
      reportPermission(permissionStatus);
      if (permissionStatus.state !== "denied") {
        permissionDenied = false;
        startWatch();
      }
    };
    void navigator.permissions?.query({ name: "geolocation" }).then((status) => {
      if (!permissionCheckActive) return;
      permissionStatus = status;
      reportPermission(status);
      status.addEventListener("change", onPermissionChange);
    }).catch(() => undefined);
    let lastSentSample: LocationSample | null = null;
    let lastSentRideId: string | undefined;
    let sending = false;
    let queuedPosition: GeolocationPosition | null = null;
    let disposed = false;
    let lastFixAt = Date.now();
    let fallbackPending = false;
    let fallbackStartedAt = 0;
    let permissionDenied = false;
    let watcher: number | null = null;
    let lastWatchStartAt = 0;
    const uploadPosition = (position: GeolocationPosition) => {
      const currentRideId = rideIdRef.current;
      const sample: LocationSample = {
        lat: position.coords.latitude, lng: position.coords.longitude,
        accuracyMeters: position.coords.accuracy, timestamp: position.timestamp,
      };
      if (sending) { queuedPosition = position; return; }
      if (lastSentRideId === currentRideId && !shouldSendLocationUpdate(lastSentSample, sample, Boolean(currentRideId))) return;
      sending = true;
      void updateLocation(position, currentRideId)
        .then(() => { lastSentSample = sample; lastSentRideId = currentRideId; setLocationSyncError(""); })
        .catch(() => { setLocationSyncError("Posição recebida no aparelho, mas ainda não enviada. Tentando novamente."); })
        .finally(() => {
          sending = false;
          const queued = queuedPosition;
          queuedPosition = null;
          if (queued && !disposed) uploadPosition(queued);
        });
    };
    const handlePosition = (position: GeolocationPosition) => {
        if (disposed) return;
        if (
          !isValidCoordinates({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          })
        ) {
          setGpsStatus("O GPS retornou coordenadas inválidas.");
          return;
        }
        if (position.timestamp <= lastGpsTimestampRef.current) return;
        lastGpsTimestampRef.current = position.timestamp;
        lastFixAt = Date.now();
        permissionDenied = false;
        if (!shouldAcceptGpsFix(currentGpsPositionRef.current, position)) return;
        currentGpsPositionRef.current = position;
        const nextPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: "Sua localização",
        };
        const previousPoint = previousGpsRef.current;
        const movement = previousPoint ? metersBetween(previousPoint, nextPoint) : 0;
        const derivedHeading = previousPoint && movement > 8
          ? (Math.atan2((nextPoint.lng - previousPoint.lng) * Math.cos(nextPoint.lat * Math.PI / 180), nextPoint.lat - previousPoint.lat) * 180 / Math.PI + 360) % 360
          : null;
        previousGpsRef.current = nextPoint;
        setLiveLocation(nextPoint);
        setNavSample({
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          heading: position.coords.heading ?? derivedHeading,
          timestamp: position.timestamp,
        });
        setGpsStatus(
          `GPS ativo · precisão ${Math.round(position.coords.accuracy)} m`,
        );
        const currentRideId = rideIdRef.current;
        if (currentRideId && position.timestamp - lastSavedPositionRef.current >= 5000) {
          lastSavedPositionRef.current = position.timestamp;
          void updateOfflineRide(currentRideId, (data) => ({ ...data, lastKnownPosition: {
            lat: position.coords.latitude, lng: position.coords.longitude,
            accuracy: position.coords.accuracy, timestamp: position.timestamp,
          } })).catch(() => undefined);
        }
        uploadPosition(position);
      };
    const handleError = (error: GeolocationPositionError) => {
      if (disposed) return;
      if (error.code === 1) permissionDenied = true;
      setGpsStatus(error.code === 1 || permissionDenied
        ? "Localização bloqueada neste site. Toque no ícone ao lado do endereço e permita a localização."
        : error.code === 3
          ? "O GPS demorou para responder. Confira a localização do aparelho e tente novamente."
          : "GPS indisponível no momento; confira a localização do aparelho.");
    };
    const startWatch = () => {
      if (watcher !== null) navigator.geolocation.clearWatch(watcher);
      lastWatchStartAt = Date.now();
      watcher = navigator.geolocation.watchPosition(handlePosition, handleError,
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
    };
    startWatch();
    const recover = () => {
      if (fallbackPending && Date.now() - fallbackStartedAt > 25_000) fallbackPending = false;
      if (document.hidden || permissionDenied || manualGpsRetryRef.current || fallbackPending || Date.now() - lastFixAt < 8_000) return;
      if (Date.now() - lastFixAt > 30_000 && Date.now() - lastWatchStartAt > 30_000) startWatch();
      fallbackPending = true;
      fallbackStartedAt = Date.now();
      navigator.geolocation.getCurrentPosition(
        (position) => { fallbackPending = false; handlePosition(position); },
        (error) => {
          if (error.code === 1) { fallbackPending = false; handleError(error); return; }
          // A network-based fix can keep the map usable while the device's
          // high-accuracy provider is unavailable. Arrival still needs a new
          // precise fix and is checked separately.
          navigator.geolocation.getCurrentPosition(
            (position) => { fallbackPending = false; handlePosition(position); },
            (fallbackError) => { fallbackPending = false; handleError(fallbackError); },
            { enableHighAccuracy: false, maximumAge: 10_000, timeout: 12_000 },
          );
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 8_000 },
      );
    };
    const recoveryTimer = window.setInterval(recover, 5000);
    const foreground = () => { if (!document.hidden) { permissionDenied = false; recover(); } };
    document.addEventListener("visibilitychange", foreground);
    return () => {
      disposed = true;
      permissionCheckActive = false;
      permissionStatus?.removeEventListener("change", onPermissionChange);
      if (watcher !== null) navigator.geolocation.clearWatch(watcher);
      window.clearInterval(recoveryTimer);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [trackingGps, updateLocation]);
  const retryGps = () => {
    if (!("geolocation" in navigator)) {
      setGpsStatus("Este aparelho não oferece acesso ao GPS.");
      return;
    }
    manualGpsRetryRef.current = true;
    setGpsRetrying(true);
    const finish = () => {
      manualGpsRetryRef.current = false;
      setGpsRetrying(false);
    };
    const acceptPosition = (position: GeolocationPosition) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude, label: "Sua localização" };
        if (!isValidCoordinates(point)) {
          setGpsStatus("O GPS retornou coordenadas inválidas.");
          finish();
          return;
        }
        if (position.timestamp <= lastGpsTimestampRef.current ||
          !shouldAcceptGpsFix(currentGpsPositionRef.current, position)) {
          finish();
          return;
        }
        lastGpsTimestampRef.current = position.timestamp;
        currentGpsPositionRef.current = position;
        previousGpsRef.current = point;
        setLiveLocation(point);
        setNavSample({ accuracy: position.coords.accuracy, speed: position.coords.speed,
          heading: position.coords.heading, timestamp: position.timestamp });
        setGpsStatus(`GPS ativo · precisão ${Math.round(position.coords.accuracy)} m`);
        const currentRideId = rideIdRef.current;
        if (currentRideId) {
          void updateOfflineRide(currentRideId, (data) => ({ ...data, lastKnownPosition: {
            lat: point.lat, lng: point.lng, accuracy: position.coords.accuracy, timestamp: position.timestamp,
          } })).catch(() => undefined);
        }
        void updateLocation(position, currentRideId).catch(() => undefined);
        finish();
      };
    const fail = (error: GeolocationPositionError) => {
        setGpsStatus(error.code === 1
          ? "Permita a localização nas configurações do navegador para navegar."
          : error.code === 3
            ? "O GPS demorou para responder. Confira a localização do aparelho e tente novamente."
            : "GPS indisponível no momento; confira a localização do aparelho.");
        finish();
      };
    navigator.geolocation.getCurrentPosition(
      acceptPosition,
      (error) => {
        if (error.code === 1) { fail(error); return; }
        setGpsStatus("GPS de alta precisão demorou; tentando localização pela rede.");
        navigator.geolocation.getCurrentPosition(acceptPosition, fail,
          { enableHighAccuracy: false, maximumAge: 10_000, timeout: 12_000 });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 8_000 },
    );
  };
  useEffect(() => {
    if (!rideId) return;
    const first = window.setTimeout(() => setNavClock(Date.now()), 0);
    const timer = window.setInterval(() => setNavClock(Date.now()), 5000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [rideId]);
  useEffect(() => {
    const phase = trackingPhase(ride?.status);
    const targetKey = ride ? `${ride.id}:${phase}:${phase === "trip" ? `${ride.destination_lat},${ride.destination_lng}` : `${ride.origin_lat},${ride.origin_lng}`}` : "";
    if (lastNavigationTargetRef.current !== targetKey) {
      lastNavigationTargetRef.current = targetKey;
      etaCalculationRef.current = null;
      etaInFlightKeyRef.current = "";
      etaFailuresRef.current = 0;
    }
    if (!ride || !phase) {
      etaCalculationRef.current = null;
      const timer = window.setTimeout(() => {
        setTrackingEta(null);
        setTrackingEtaError("");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const routeTarget = phase === "trip"
      ? { lat: ride.destination_lat, lng: ride.destination_lng }
      : { lat: ride.origin_lat, lng: ride.origin_lng };
    if (!isValidCoordinates(routeTarget) || (routeTarget.lat === 0 && routeTarget.lng === 0)) {
      const timer = window.setTimeout(() => setTrackingEtaError("O ponto da corrida não possui coordenadas válidas."), 0);
      return () => window.clearTimeout(timer);
    }
    const routeLocation = liveLocation && navSample && Date.now() - navSample.timestamp < 15_000
      ? { lat: liveLocation.lat, lng: liveLocation.lng, updatedAt: new Date(navSample.timestamp).toISOString(), accuracyMeters: navSample.accuracy }
      : null;
    if (!routeLocation) {
      const timer = window.setTimeout(() => {
        setTrackingEtaError("Aguardando uma posição válida do GPS.");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const requestKey = `${ride.id}:${targetKey}`;
    if (etaInFlightKeyRef.current === requestKey) return;
    if (
      !shouldRecalculateEta(
        etaCalculationRef.current,
        phase,
        routeLocation,
      )
    ) {
      return;
    }
    etaInFlightKeyRef.current = requestKey;
    etaCalculationRef.current = {
      phase,
      location: routeLocation,
      calculatedAt: Date.now(),
    };
    if (process.env.NODE_ENV !== "production") console.info("[ROUTE_A_REQUEST]", {
      phase, origin: { lat: routeLocation.lat, lng: routeLocation.lng },
      destination: phase === "trip" ? { lat: ride.destination_lat, lng: ride.destination_lng } : { lat: ride.origin_lat, lng: ride.origin_lng },
      adapter: "POST /api/rides/:id/tracking-route",
    });
    void backendRef.current
      .trackingRoute(ride.id, { lat: routeLocation.lat, lng: routeLocation.lng })
      .then((result) => {
        if (lastNavigationTargetRef.current !== targetKey) return;
        if (process.env.NODE_ENV !== "production") console.info("[ROUTE_A_RESPONSE]", { phase: result.phase, distanceMeters: result.distanceMeters, durationSeconds: result.durationSeconds, geometryPresent: Boolean(result.geometry) });
        setTrackingEta(result);
        setTrackingEtaError("");
        etaFailuresRef.current = 0;
        etaCalculationRef.current = {
          phase: result.phase,
          location: routeLocation,
          calculatedAt: Date.parse(result.calculatedAt) || Date.now(),
        };
      })
      .catch(async (error: unknown) => {
        if (lastNavigationTargetRef.current !== targetKey) return;
        etaFailuresRef.current += 1;
        const retryDelay = etaFailuresRef.current === 1 ? 3_000 : etaFailuresRef.current === 2 ? 8_000 : 45_000;
        etaCalculationRef.current = { phase, location: routeLocation, calculatedAt: Date.now() - (45_000 - retryDelay) };
        if (process.env.NODE_ENV !== "production") console.error("[ROUTE_A_RESPONSE] falha", error);
        try {
          const graph = roadGraph || await loadRegionPackage();
          const target = phase === "trip"
            ? { lat: ride.destination_lat, lng: ride.destination_lng }
            : { lat: ride.origin_lat, lng: ride.origin_lng };
          const localRoute = graph.route(routeLocation, target, phase);
          if (lastNavigationTargetRef.current !== targetKey) return;
          if (localRoute) {
            setRoadGraph(graph);
            setTrackingEta({ ...localRoute,
              from: { ...routeLocation }, to: target, calculatedAt: new Date().toISOString() });
            setTrackingEtaError("Rota estimada pelas ruas locais; confira o trajeto.");
            return;
          }
        } catch { /* Sem cobertura local: manter o erro original da rota online. */ }
        setTrackingEtaError(etaFailuresRef.current < 3 ? "" : error instanceof Error ? error.message : "Rota temporariamente indisponível.");
      }).finally(() => {
        if (etaInFlightKeyRef.current === requestKey) etaInFlightKeyRef.current = "";
      });
  }, [liveLocation, navSample, navClock, ride, roadGraph]);
  const navPhase = trackingPhase(ride?.status);
  const targetLat = ride ? navPhase === "trip" ? ride.destination_lat : ride.origin_lat : undefined;
  const targetLng = ride ? navPhase === "trip" ? ride.destination_lng : ride.origin_lng : undefined;
  const savedNavigationRoute = navPhase === "trip" ? currentOfflinePackage?.routeToDestination : currentOfflinePackage?.routeToPickup;
  const onlineNavEta = trackingEta && trackingEta.phase === navPhase && targetLat !== undefined && targetLng !== undefined
    && Math.abs(trackingEta.to.lat - targetLat) < 0.000001 && Math.abs(trackingEta.to.lng - targetLng) < 0.000001
    ? trackingEta : null;
  const navEta: TrackingRoute | null = onlineNavEta ? onlineNavEta : savedNavigationRoute && targetLat !== undefined && targetLng !== undefined
    ? { ...savedNavigationRoute, from: { lat: liveLocation?.lat ?? 0, lng: liveLocation?.lng ?? 0, updatedAt: currentOfflinePackage?.updatedAt || "" },
      to: { lat: targetLat, lng: targetLng }, calculatedAt: currentOfflinePackage?.updatedAt || "" }
    : null;
  const navGeometry = navEta?.geometry;
  const navigationRoute = useMemo(() => routePoints(navGeometry), [navGeometry]);
  const navigationTargetPoint = useMemo(() => targetLat !== undefined && targetLng !== undefined
    ? { lat: targetLat, lng: targetLng } : null, [targetLat, targetLng]);
  const navigationProgress = liveLocation && navigationRoute.length > 1
    ? routeProgress(liveLocation, navigationRoute) : null;
  const offRouteMeters = navigationProgress?.offRouteMeters;
  const upcomingManeuver = liveLocation && navEta?.steps
    ? nextManeuver(liveLocation, navigationRoute, navEta.steps) : null;
  const distanceToTarget = liveLocation && navigationTargetPoint
    ? metersBetween(liveLocation, navigationTargetPoint) : Infinity;
  const noShowRemaining = ride?.status === "motorista_chegou" && ride.arrival_server_at
    ? Math.max(0, backend.cancellationPolicy.no_show_seconds - Math.floor((navClock - Date.parse(ride.arrival_server_at)) / 1000))
    : null;
  const gpsWeak = !navSample || navClock - navSample.timestamp > 15_000 || navSample.accuracy > 80;
  const gpsAlert = !navSample || navClock - navSample.timestamp > 15_000
    ? gpsStatus === "GPS aguardando" || gpsStatus.startsWith("GPS ativo")
      ? navSample && navSample.accuracy > 500
        ? `Última localização imprecisa (${Math.round(navSample.accuracy)} m). Tentando obter uma posição melhor.`
        : "Aguardando nova posição do GPS. Tentando recuperar automaticamente."
      : gpsStatus
    : navSample.accuracy > 80
      ? `GPS com precisão de ${Math.round(navSample.accuracy)} m. Aguarde uma posição mais precisa.`
      : gpsStatus;
  const arrivalReady = Boolean(ride?.status === "motorista_a_caminho" && liveLocation && navSample &&
    navSample.accuracy <= 40 && distanceToTarget <= backend.cancellationPolicy.arrival_radius_meters);
  const navDestination = useMemo(() => targetLat !== undefined && targetLng !== undefined
    ? { lat: targetLat, lng: targetLng, label: navPhase === "pickup" ? "Passageiro" : "Destino" }
    : undefined, [targetLat, targetLng, navPhase]);
  const navMap = useMemo(() => liveLocation ? {
    position: liveLocation,
    heading: navSample?.heading ?? null,
    zoom: navigationZoom(navSample?.speed ?? null, upcomingManeuver?.distanceMeters ?? null),
  } : undefined, [liveLocation, navSample?.heading, navSample?.speed, upcomingManeuver?.distanceMeters]);
  useEffect(() => {
    if (!ride || offlinePackage?.ride.id !== ride.id || offlinePackage.mapReady || !roadGraph ||
      !liveLocation || !navSample || gpsWeak) return;
    const pickupPoint = { lat: ride.origin_lat, lng: ride.origin_lng };
    const destinationPoint = { lat: ride.destination_lat, lng: ride.destination_lng };
    if (![liveLocation, pickupPoint, destinationPoint].every((point) => isInsideRegion(point.lat, point.lng))) return;
    const pickup = savedRoute(roadGraph.route(liveLocation, pickupPoint, "pickup"));
    const trip = offlinePackage.routeToDestination || savedRoute(roadGraph.route(pickupPoint, destinationPoint, "trip"));
    if (!pickup || !trip) return;
    void updateOfflineRide(ride.id, (data) => ({ ...data, routeToPickup: pickup,
      routeToDestination: trip, mapReady: true,
      lastKnownPosition: { lat: liveLocation.lat, lng: liveLocation.lng,
        accuracy: navSample.accuracy, timestamp: navSample.timestamp },
    })).then((updated) => { if (updated && rideIdRef.current === ride.id) setOfflinePackage(updated); })
      .catch(() => undefined);
  }, [ride, offlinePackage, roadGraph, liveLocation, navSample, gpsWeak]);
  useEffect(() => {
    if (!ride || !navPhase || offRouteMeters === undefined || !navSample || gpsWeak || rerouting) return;
    if (lastDeviationSampleRef.current === navSample.timestamp) return;
    lastDeviationSampleRef.current = navSample.timestamp;
    const threshold = Math.max(45, navSample.accuracy * 1.5);
    offRouteSamplesRef.current = offRouteMeters > threshold ? offRouteSamplesRef.current + 1 : 0;
    if (!shouldReroute(offRouteMeters, navSample.accuracy, offRouteSamplesRef.current, lastRerouteRef.current, Date.now())) return;
    lastRerouteRef.current = Date.now();
    offRouteSamplesRef.current = 0;
    setRerouting(true);
    if (connectivity === "OFFLINE" && !navigator.onLine && roadGraph && liveLocation && navigationTargetPoint) {
      const rerouted = roadGraph.route(liveLocation, navigationTargetPoint, navPhase);
      if (rerouted) {
        void updateOfflineRide(ride.id, (data) => ({ ...data,
          ...(navPhase === "pickup" ? { routeToPickup: savedRoute(rerouted) } : { routeToDestination: savedRoute(rerouted) }),
        })).then((updated) => { setOfflinePackage(updated); setTrackingEtaError(""); })
          .catch(() => setTrackingEtaError("Nova rota local calculada, mas não foi possível salvá-la."))
          .finally(() => setRerouting(false));
      } else {
        window.setTimeout(() => {
          setTrackingEtaError("Fora da rota. Siga pelo mapa até voltar ao trajeto; nova rota local indisponível.");
          setRerouting(false);
        }, 0);
      }
      return;
    }
    void backendRef.current.trackingRoute(ride.id, liveLocation ? { lat: liveLocation.lat, lng: liveLocation.lng } : undefined)
      .then((result) => { setTrackingEta(result); setTrackingEtaError(""); })
      .catch(() => setTrackingEtaError("Rota temporariamente indisponível; siga com atenção."))
      .finally(() => setRerouting(false));
  }, [ride, navPhase, offRouteMeters, navSample, gpsWeak, rerouting, connectivity, roadGraph, liveLocation, navigationTargetPoint]);
  useEffect(() => {
    if (!voiceOn || !ride || !navSample || gpsWeak || !("speechSynthesis" in window)) return;
    const closeToPickup = navPhase === "pickup" && distanceToTarget <= 45 && ride.status !== "motorista_chegou";
    const message = closeToPickup
      ? "Você chegou ao local do passageiro"
      : upcomingManeuver && upcomingManeuver.distanceMeters <= 220
        ? `${upcomingManeuver.distanceMeters <= 55 ? "Agora, " : `Em ${Math.round(upcomingManeuver.distanceMeters / 10) * 10} metros, `}${maneuverText(upcomingManeuver.step).replace(" — ", " na ")}`
        : "";
    const key = closeToPickup ? `${ride.id}:arrive` : upcomingManeuver
      ? `${ride.id}:${navPhase}:${upcomingManeuver.step.location.join(",")}:${upcomingManeuver.distanceMeters <= 55 ? "now" : "near"}` : "";
    if (!message || !key || announcedRef.current.has(key)) return;
    announcedRef.current.add(key);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "pt-BR";
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }, [voiceOn, ride, navPhase, navSample, gpsWeak, distanceToTarget, upcomingManeuver]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  useEffect(() => {
    alertControllerRef.current ||= new RideAlertController();
    const timer = window.setTimeout(() => {
      setAlertPreferences(parseDriverAlertPreferences(window.localStorage.getItem(DRIVER_ALERT_PREFERENCES_KEY)));
      setAlertPreferencesReady(true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      alertControllerRef.current?.stop();
    };
  }, []);
  useEffect(() => {
    if (!rideId || !navPhase) {
      const closeTimer = window.setTimeout(() => setContactOpen(false), 0);
      return () => window.clearTimeout(closeTimer);
    }
    const timer = window.setTimeout(() => {
      setGpsExpanded(true);
      setFollowDriver(true);
      setNavigationCenterRequest((value) => value + 1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [rideId, navPhase]);
  const offerAlertId = offer?.id;
  const offerAlertExpiresAt = offer?.expires_at;
  useEffect(() => {
    const controller = alertControllerRef.current;
    const liveOffer = Boolean(offerAlertId && offerAlertExpiresAt && new Date(offerAlertExpiresAt).getTime() > Date.now());
    if (!controller || !alertPreferencesReady || !online || rideId || !liveOffer) {
      controller?.stop();
      return;
    }
    void controller.start(alertPreferences);
    return () => controller.stop();
  }, [alertPreferences, alertPreferencesReady, offerAlertId, offerAlertExpiresAt, online, rideId]);
  useEffect(() => {
    if (!offer) {
      const timer = window.setTimeout(() => setOfferSeconds(0), 0);
      return () => window.clearTimeout(timer);
    }
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
  useEffect(() => {
    if (!offer || offerSeconds > 0 || new Date(offer.expires_at).getTime() > Date.now() || expiredOfferRef.current === offer.id) return;
    expiredOfferRef.current = offer.id;
    alertControllerRef.current?.stop();
    closeRideOfferNotification(offer.ride_id);
    void backend.refresh().catch(() => setNotice("Oferta expirada. Reconectando para buscar novas corridas…"));
  }, [backend, offer, offerSeconds]);
  async function toggle(next: boolean) {
    setBusy(true);
    setNotice("");
    try {
      if (next) {
        await alertControllerRef.current?.unlock();
        if (alertPreferences.notifications) {
          try {
            await backend.enablePushNotifications();
          } catch (pushError) {
            setNotice(pushError instanceof Error ? pushError.message : "Ative as notificações nas configurações do aparelho.");
          }
        }
      }
      await backend.setDriverStatus(next);
      if (next) {
        setGpsStatus("Aguardando localização GPS");
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
  async function updateAlertPreference(key: keyof DriverAlertPreferences, enabled: boolean) {
    const previous = alertPreferences;
    const next = { ...previous, [key]: enabled };
    setAlertPreferences(next);
    window.localStorage.setItem(DRIVER_ALERT_PREFERENCES_KEY, JSON.stringify(next));
    if (key !== "notifications") return;
    setBusy(true);
    setNotice("");
    try {
      if (enabled) await backend.enablePushNotifications();
      else await backend.disablePushNotifications();
      setNotice(enabled ? "Notificações de corrida ativadas." : "Notificações de corrida desativadas neste aparelho.");
    } catch (error) {
      setAlertPreferences(previous);
      window.localStorage.setItem(DRIVER_ALERT_PREFERENCES_KEY, JSON.stringify(previous));
      setNotice(error instanceof Error ? error.message : "Não foi possível alterar as notificações.");
    } finally {
      setBusy(false);
    }
  }
  async function testRideAlert() {
    if (!alertPreferences.sound && !alertPreferences.vibration) {
      setNotice("Ative som ou vibração para testar o alerta.");
      return;
    }
    setTestingAlert(true);
    setNotice("Teste de alerta em andamento.");
    await alertControllerRef.current?.start(alertPreferences);
    window.setTimeout(() => {
      alertControllerRef.current?.stop();
      setTestingAlert(false);
      setNotice("Teste concluído.");
    }, 3_500);
  }
  function closeRideOfferNotification(rideIdToClose: string) {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage({ type: "CLOSE_RIDE_OFFER", rideId: rideIdToClose });
    });
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
    window.requestAnimationFrame(() => {
      document.querySelector(".driver-profile-content > .driver-registration")?.scrollIntoView({ block: "start" });
    });
  }
  function selectAvatar(file: File | null) {
    if (!file) return;
    setAvatar(file);
    setAvatarPreviewUrl(URL.createObjectURL(file));
    if (!editing) startEditing();
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
      setAvatarPreviewUrl(null);
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
  async function prepareNavigationForRide(acceptedRide: Ride) {
    if (!driverId) throw new Error("Sessão do motorista indisponível.");
    // Accepting a ride must not wait for a fresh GPS fix. The watch keeps trying;
    // the last known point is only a route preview, never a live GPS report.
    // The online route must be ready first. The regional offline package is
    // already prefetched separately and must never delay the accepted ride.
    const graph = roadGraph;
    const latestPosition = currentGpsPositionRef.current;
    // A previous fix is useful for a clearly labelled route preview. It is
    // never treated as a live position or used to confirm arrival.
    const recentPosition = latestPosition && Date.now() - latestPosition.timestamp < 15 * 60_000
      && Number.isFinite(latestPosition.coords.accuracy) && latestPosition.coords.accuracy <= 500
      ? latestPosition : null;
    const point = recentPosition && isValidCoordinates({ lat: recentPosition.coords.latitude, lng: recentPosition.coords.longitude })
      ? { lat: recentPosition.coords.latitude, lng: recentPosition.coords.longitude }
      : offlinePackage?.lastKnownPosition && Date.now() - offlinePackage.lastKnownPosition.timestamp < 15 * 60_000
        && offlinePackage.lastKnownPosition.accuracy <= 500
        && isValidCoordinates(offlinePackage.lastKnownPosition)
        ? offlinePackage.lastKnownPosition : null;
    const freshPoint = point && latestPosition && Date.now() - latestPosition.timestamp < 15_000 && latestPosition.coords.accuracy <= 80
      ? point : null;
    const prepared = await backend.prepareNavigation(acceptedRide.id,
      point ? { lat: point.lat, lng: point.lng } : undefined).catch(() => null);
    const baseRide = { ...(prepared?.ride || acceptedRide), driver_id: driverId, status: "aceita" };
    const pickupPoint = { lat: baseRide.origin_lat, lng: baseRide.origin_lng };
    const destinationPoint = { lat: baseRide.destination_lat, lng: baseRide.destination_lng };
    const pickup = savedRoute(prepared?.routeToPickup || (point && graph?.route(point, pickupPoint, "pickup")) || null);
    const trip = savedRoute(prepared?.routeToDestination || graph?.route(pickupPoint, destinationPoint, "trip") ||
      (baseRide.route_geometry ? { phase: "trip" as const, geometry: baseRide.route_geometry, distanceMeters: baseRide.distance_meters, durationSeconds: baseRide.duration_seconds, steps: [] } : null));
    const mapReady = Boolean(freshPoint && graph && [freshPoint, pickupPoint, destinationPoint].every((item) => isInsideRegion(item.lat, item.lng)));
    const data = makeOfflineRide(baseRide, driverId, pickup, trip, mapReady);
    const confirmed = await backend.getRideSnapshot().catch(() => null);
    if (confirmed ? confirmed.ride?.id !== acceptedRide.id : rideIdRef.current !== acceptedRide.id) return false;
    if (rideIdRef.current && rideIdRef.current !== acceptedRide.id) return false;
    await saveOfflineRide(data);
    if (rideIdRef.current && rideIdRef.current !== acceptedRide.id) {
      await clearOfflineRide(acceptedRide.id);
      return false;
    }
    setOfflinePackage(data);
    if (!freshPoint) {
      setNotice(pickup
        ? "Corrida aceita. Rota de referência salva; aguardando GPS atual para acompanhar o deslocamento."
        : "Corrida aceita. Sem posição recente e confiável para traçar a ida ao passageiro; confira a permissão de localização ou abra a rota em outro mapa.");
    } else if ((!pickup || !trip || !mapReady) && !navigator.onLine) {
      setNotice("Corrida aceita. O pacote offline ainda não cobre toda esta rota; mantenha a conexão para navegar com segurança.");
    }
    return Boolean(pickup && trip && mapReady);
  }
  async function accept() {
    if (!offer) return;
    const acceptedOffer = offer;
    setBusy(true);
    setNotice("");
    alertControllerRef.current?.stop();
    closeRideOfferNotification(acceptedOffer.ride_id);
    let accepted = false;
    try {
      await backend.acceptRide(acceptedOffer.ride_id);
      accepted = true;
      const currentPosition = currentGpsPositionRef.current;
      if (currentPosition && Date.now() - currentPosition.timestamp < 30_000)
        void backend.updateLocation(currentPosition, acceptedOffer.ride_id).catch(() => undefined);
      setGpsExpanded(true);
      setFollowDriver(true);
      await backend.refresh();
      void prepareNavigationForRide(acceptedOffer.ride).catch(() => {
        if (rideIdRef.current === acceptedOffer.ride_id)
          setNotice("Corrida aceita. Não foi possível salvar o mapa offline agora; a navegação online continua disponível.");
      });
    } catch (error) {
      setNotice(
        accepted
          ? "Corrida aceita. Atualizando a tela; confira a corrida em andamento."
          : error instanceof Error ? error.message : "Corrida indisponível.",
      );
      await backend.refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  async function decline() {
    if (!offer) return;
    setBusy(true);
    alertControllerRef.current?.stop();
    closeRideOfferNotification(offer.ride_id);
    try {
      await backend.declineRide(offer.ride_id);
      await backend.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível recusar a oferta.",
      );
      await backend.refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  async function cancelRide(reason = "NO_SHOW") {
    if (!ride) return;
    setBusy(true);
    try {
      await backend.transitionRide(
        ride.id,
        "cancelada",
        reason,
      );
      setOfflinePackage(null);
      setGpsExpanded(false);
      setContactOpen(false);
      await clearOfflineRide(ride.id).catch(() => undefined);
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
  async function confirmDriverCancellation() {
    if (!ride || !cancelReason || cancelReason === "no_show" || (cancelReason === "other" && !cancelOther.trim()) || busy) return;
    const cancellingRideId = ride.id;
    const label = DRIVER_CANCEL_REASONS.find((item) => item.code === cancelReason)?.label || "Cancelamento";
    const reason = cancelReason === "other" ? cancelOther.trim() : label;
    setBusy(true);
    cancelRetryingRef.current = true;
    try { window.localStorage.setItem(pendingCancellationKey, JSON.stringify({ rideId: cancellingRideId, reasonCode: cancelReason, reason })); } catch { /* A confirmação ainda funciona sem armazenamento local. */ }
    try {
      await backend.cancelDriverRide(cancellingRideId, cancelReason, reason);
      window.localStorage.removeItem(pendingCancellationKey);
      setOfflinePackage(null);
      setGpsExpanded(false);
      setContactOpen(false);
      setCancelStep(0);
      setCancelReason("");
      setCancelOther("");
      setOfflineConflict("");
      setNotice("Corrida cancelada. O passageiro está procurando outro motorista.");
      await clearOfflineRide(cancellingRideId).catch(() => undefined);
      await backend.refresh().catch(() => undefined);
      await backend.refreshDriverQueue().catch(() => undefined);
    } catch (error) {
      if (error instanceof BackendApiError && ["RIDE_STATE_CHANGED", "RIDE_NOT_FOUND", "CANCELLATION_REASON_REQUIRED", "FORBIDDEN", "CANCELLATION_NOT_ALLOWED"].includes(error.code))
        window.localStorage.removeItem(pendingCancellationKey);
      setNotice(error instanceof Error ? error.message : "Não foi possível confirmar agora. Tentaremos novamente quando a conexão voltar.");
      await backend.refresh().catch(() => undefined);
    } finally {
      cancelRetryingRef.current = false;
      setBusy(false);
    }
  }
  async function confirmEarlyEnd() {
    if (!ride || ride.status !== "em_corrida" || earlyEndReason.trim().length < 3 || busy) return;
    const endingRideId = ride.id;
    setBusy(true);
    try {
      await backend.endRideEarly(endingRideId, earlyEndReason.trim());
      setOfflinePackage(null);
      setGpsExpanded(false);
      setEarlyEndOpen(false);
      setEarlyEndReason("");
      setNotice("Viagem encerrada antecipadamente e registrada para o administrador.");
      await clearOfflineRide(endingRideId).catch(() => undefined);
      await backend.refresh().catch(() => undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível encerrar a viagem.");
      await backend.refresh().catch(() => undefined);
    } finally { setBusy(false); }
  }
  async function advance() {
    if (!ride) return;
    if (offlineConflict) { setNotice(offlineConflict); return; }
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
      let arrivalPosition: GeolocationPosition | null = null;
      if (status === "motorista_chegou") {
        arrivalPosition = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!("geolocation" in navigator)) {
            reject(new Error("Este aparelho não oferece acesso ao GPS."));
            return;
          }
          navigator.geolocation.getCurrentPosition(resolve, (error) => reject(new Error(error.code === 1
            ? "Permita o acesso à localização para confirmar a chegada."
            : "O GPS não respondeu. Confira a localização do aparelho e tente novamente.")),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 });
        });
        const pickup = { lat: ride.origin_lat, lng: ride.origin_lng };
        const actual = { lat: arrivalPosition.coords.latitude, lng: arrivalPosition.coords.longitude };
        if (Date.now() - arrivalPosition.timestamp > 30_000 || !Number.isFinite(arrivalPosition.coords.accuracy) || arrivalPosition.coords.accuracy > 40 ||
          !isValidCoordinates(actual) || metersBetween(actual, pickup) > backend.cancellationPolicy.arrival_radius_meters)
          throw new Error("GPS sem precisão suficiente ou fora do embarque. Tente novamente ao chegar.");
        currentGpsPositionRef.current = arrivalPosition;
        lastGpsTimestampRef.current = Math.max(lastGpsTimestampRef.current, arrivalPosition.timestamp);
        setLiveLocation({ ...actual, label: "Sua localização" });
        setNavSample({ accuracy: arrivalPosition.coords.accuracy, speed: arrivalPosition.coords.speed,
          heading: arrivalPosition.coords.heading, timestamp: arrivalPosition.timestamp });
      }
      const offlineType: OfflineEventType | null = status === "motorista_chegou" ? "ARRIVED_AT_PICKUP"
        : status === "em_corrida" ? "RIDE_STARTED" : status === "finalizada" ? "RIDE_COMPLETED" : null;
      if (connectivity !== "OFFLINE" && !pendingLocalStatus) {
        try {
          if (arrivalPosition) await backend.updateLocation(arrivalPosition, ride.id);
          await backend.transitionRide(ride.id, status);
          await backend.refresh();
          if (offlinePackage?.ride.id === ride.id) {
            const updated = await updateOfflineRide(ride.id, (data) => ({ ...data, navigationState: status, ride: { ...data.ride, status } }));
            setOfflinePackage(updated);
            if (status === "finalizada") { await clearOfflineRide(ride.id); setOfflinePackage(null); }
          }
          return;
        } catch (error) {
          if (arrivalPosition || error instanceof BackendApiError) throw error;
        }
      }
      if (!offlineType || !currentOfflinePackage || !currentOfflinePackage.mapReady || !currentOfflinePackage.routeToPickup || !currentOfflinePackage.routeToDestination)
        throw new Error("Pacote offline incompleto. Aguarde a conexão antes de alterar esta corrida.");
      const updated = await queueOfflineTransition(ride.id, offlineType,
        arrivalPosition ? { lat: arrivalPosition.coords.latitude, lng: arrivalPosition.coords.longitude }
          : liveLocation && navSample && !gpsWeak ? { lat: liveLocation.lat, lng: liveLocation.lng } : null);
      if (!updated) throw new Error("Não foi possível salvar esta etapa no aparelho.");
      setOfflinePackage(updated);
      setNotice(status === "finalizada" ? "Corrida concluída neste aparelho. Sincronização pendente; pagamento ainda não confirmado."
        : "Etapa salva neste aparelho. Será sincronizada automaticamente quando a conexão voltar.");
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
  const origin = useMemo(() => shownRide
    ? { lat: shownRide.origin_lat, lng: shownRide.origin_lng, label: shownRide.origin_address }
    : undefined, [shownRide]);
  const destination = useMemo(() => shownRide
    ? { lat: shownRide.destination_lat, lng: shownRide.destination_lng, label: shownRide.destination_address }
    : undefined, [shownRide]);
  const route = useMemo(() => routePoints(shownRide?.route_geometry), [shownRide?.route_geometry]);
  const navigationTarget = ride
    ? externalNavigationTarget(ride.status, ride)
    : null;
  const profileName = backend.profile?.full_name?.trim() || (backend.loading ? "Carregando perfil…" : "Motorista");
  const profileRating = state?.rating && state.rating > 0 ? state.rating.toFixed(1) : "—";
  const profileTrips = state?.trips_count;
  const profileStatus = backend.profile?.blocked || state?.approval_status === "suspended"
    ? "Motorista indisponível"
    : state?.approval_status === "approved" ? "Motorista ativo"
      : state?.approval_status === "rejected" ? "Cadastro recusado"
        : backend.loading && !state ? "Carregando cadastro…"
          : backend.error && !state ? "Dados indisponíveis" : "Cadastro em análise";
  const profileStatusClass = state?.approval_status === "approved" && !backend.profile?.blocked ? "is-active" : "is-pending";
  const documentStatus = state?.approval_status === "approved" ? "Cadastro aprovado"
    : state?.approval_status === "rejected" ? "Cadastro recusado"
      : backend.loading && !state ? "Carregando…"
        : backend.error && !state ? "Dados indisponíveis" : "Em análise pela central";
  const motorcycleDescription = vehicle
    ? [vehicle.brand, vehicle.model].filter(Boolean).join(" ") + (vehicle.color ? ` · ${vehicle.color}` : "")
    : backend.loading ? "Carregando…" : "Moto não cadastrada";
  const profileAvatar = avatarPreviewUrl || backend.driverAvatarUrl;
  return (
    <div className={`driver-shell ${ride && navPhase ? "has-navigation" : ""}`}>
      {!(ride && navPhase) && <header className="driver-work-header">
        <Brand compact />
        <div className="driver-work-actions">
          {online && <button type="button" className="driver-online-pill" onClick={() => { setQueueOpen(true); setDriverView("settings"); setMenuOpen(true); }}><span /> ONLINE</button>}
          <button type="button" className="driver-header-avatar" aria-label="Abrir meu perfil" onClick={() => { setDriverView("profile"); setMenuOpen(true); }}>
            {backend.driverAvatarUrl ? <AvatarPhoto src={backend.driverAvatarUrl} alt="Foto do motorista" /> : initials(backend.profile?.full_name)}
          </button>
          <button type="button" className="driver-menu-trigger" aria-label="Abrir menu do motorista" onClick={() => { setDriverView("menu"); setMenuOpen(true); }}><Menu /></button>
        </div>
      </header>}
      {menuOpen && <button type="button" className="driver-menu-backdrop" aria-label="Fechar menu" onClick={() => { setMenuOpen(false); setQueueOpen(false); }} />}
      <aside className={`driver-sidebar ${menuOpen ? "is-open" : ""} driver-view-${driverView}`} aria-hidden={!menuOpen} inert={!menuOpen}>
        <div className="driver-menu-top"><button type="button" onClick={() => { setQueueOpen(false); if (driverView === "menu") setMenuOpen(false); else setDriverView("menu"); }} aria-label="Voltar">←</button><strong>{driverView === "menu" ? "Menu do motorista" : driverView === "profile" ? "Meu Perfil" : driverView === "rides" ? "Minhas corridas" : driverView === "earnings" ? "Meus ganhos" : driverView === "notifications" ? "Notificações" : driverView === "settings" ? "Configurações" : "Ajuda e suporte"}</strong><button type="button" onClick={() => { setMenuOpen(false); setQueueOpen(false); }} aria-label="Fechar"><X /></button></div>
        {driverView === "menu" && <nav className="driver-menu-list" aria-label="Menu do motorista">
          <div className="driver-menu-identity"><span className="driver-menu-photo">{backend.driverAvatarUrl ? <AvatarPhoto src={backend.driverAvatarUrl} alt="Foto do motorista" /> : initials(backend.profile?.full_name)}</span><span><strong>{backend.profile?.full_name || "Motorista"}</strong><small><Star /> {state?.rating?.toFixed(1) || "—"} · Motorista</small></span></div>
          {([["profile", "Meu Perfil", UserRound], ["rides", "Minhas corridas", History], ["earnings", "Meus ganhos", Wallet], ["notifications", "Notificações", Bell], ["settings", "Configurações", Settings2], ["support", "Ajuda e suporte", Headphones]] as const).map(([view, label, Icon]) => <button type="button" key={view} onClick={() => setDriverView(view)}><Icon /> {label}<ChevronRight /></button>)}
        </nav>}
        {driverView === "profile" && <section className="driver-profile-overview" aria-label="Meu Perfil">
          <div className="driver-profile-hero">
            <div className="driver-profile-photo-wrap">
              <div className="driver-profile-photo">
                {profileAvatar ? <AvatarPhoto src={profileAvatar} alt={`Foto de ${profileName}`} fallback={initials(profileName)} sizes="124px" /> : initials(profileName)}
              </div>
              <label className="driver-profile-camera" title="Trocar foto">
                <Camera aria-hidden="true" />
                <span className="sr-only">Trocar foto do perfil</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectAvatar(event.target.files?.[0] || null)} disabled={backend.profile?.blocked} />
              </label>
            </div>
            <h2>{profileName}</h2>
            <p className="driver-profile-rating"><Star aria-hidden="true" /> <strong>{profileRating}</strong> <span>({profileTrips ?? "—"} {profileTrips === 1 ? "corrida" : "corridas"})</span></p>
            <span className={`driver-profile-status ${profileStatusClass}`}><span aria-hidden="true" />{profileStatus}</span>
          </div>
          <div className="driver-profile-content">
            <button type="button" className="driver-profile-edit" onClick={startEditing} disabled={backend.profile?.blocked}><Pencil aria-hidden="true" /> Editar perfil</button>
            {!backend.profile?.blocked && (editing || !vehicle) && (
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
                <div className="driver-photo-fields"><span>Foto do perfil {avatar && `· ${avatar.name}`}</span><div><label><Camera /> Tirar foto<input type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={(event) => selectAvatar(event.target.files?.[0] || null)} /></label><label><ImageIcon /> Escolher imagem<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectAvatar(event.target.files?.[0] || null)} /></label></div></div>
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
                  {busy ? "SALVANDO…" : editing ? "SALVAR PERFIL" : "ENVIAR PARA APROVAÇÃO"}
                </Button>
              </form>
            )}
            {backend.error && !state && <div className="driver-profile-error" role="alert">Não foi possível carregar todos os dados. <button type="button" onClick={() => void backend.refresh()}>Tentar novamente</button></div>}
            <div className="driver-profile-data-card">
              <h3><span className="driver-profile-data-icon"><UserRound aria-hidden="true" /></span>Dados do motorista</h3>
              <button type="button" className="driver-profile-data-row" onClick={startEditing} disabled={backend.profile?.blocked}>
                <span className="driver-profile-row-icon"><Phone aria-hidden="true" /></span><span className="driver-profile-row-copy"><span>Telefone</span><strong>{backend.profile?.phone || (backend.loading ? "Carregando…" : "Não informado")}</strong></span><ChevronRight aria-hidden="true" />
              </button>
              <button type="button" className="driver-profile-data-row" onClick={startEditing} disabled={backend.profile?.blocked}>
                <span className="driver-profile-row-icon"><Bike aria-hidden="true" /></span><span className="driver-profile-row-copy"><span>Dados da moto</span><strong>{motorcycleDescription}</strong></span><ChevronRight aria-hidden="true" />
              </button>
              <button type="button" className="driver-profile-data-row" onClick={startEditing} disabled={backend.profile?.blocked}>
                <span className="driver-profile-row-icon"><CreditCard aria-hidden="true" /></span><span className="driver-profile-row-copy"><span>Placa</span><strong>{vehicle?.plate || "Não cadastrada"}</strong></span><ChevronRight aria-hidden="true" />
              </button>
              <div className="driver-profile-data-row">
                <span className="driver-profile-row-icon"><FileText aria-hidden="true" /></span><span className="driver-profile-row-copy"><span>Documentos</span><strong className={state?.approval_status === "approved" ? "is-approved" : ""}>{documentStatus}</strong></span>{state?.approval_status === "approved" && <Check className="driver-profile-approved-icon" aria-label="Aprovado" />}
              </div>
            </div>
            <h3 className="driver-profile-section-title">Ações rápidas</h3>
            <div className="driver-profile-actions">
              <button type="button" onClick={() => setDriverView("rides")}><span className="driver-profile-action-icon is-rides"><History aria-hidden="true" /></span><strong>Histórico de corridas</strong><ChevronRight aria-hidden="true" /></button>
              <button type="button" onClick={() => setDriverView("earnings")}><span className="driver-profile-action-icon is-earnings"><Wallet aria-hidden="true" /></span><strong>Ganhos</strong><ChevronRight aria-hidden="true" /></button>
              <button type="button" onClick={() => setDriverView("notifications")}><span className="driver-profile-action-icon is-notifications"><Bell aria-hidden="true" /></span><strong>Notificações</strong><ChevronRight aria-hidden="true" /></button>
              <button type="button" onClick={() => setDriverView("settings")}><span className="driver-profile-action-icon is-settings"><Settings2 aria-hidden="true" /></span><strong>Configurações</strong><ChevronRight aria-hidden="true" /></button>
            </div>
            <h3 className="driver-profile-section-title">Meus números</h3>
            <div className="driver-profile-numbers">
              <div><span className="driver-profile-number-icon is-rides"><Route aria-hidden="true" /></span><span><small>Corridas concluídas</small><strong>{profileTrips ?? "—"}</strong></span></div>
              <div><span className="driver-profile-number-icon is-rating"><Star aria-hidden="true" /></span><span><small>Avaliação</small><strong>{profileRating}</strong></span></div>
            </div>
            <button type="button" className="driver-profile-signout" onClick={() => backend.signOut()}><LogOut aria-hidden="true" /> Sair da conta</button>
          </div>
        </section>}
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
            <b>Olá, {backend.profile?.full_name || "motorista"}</b>
            <small>
              {vehicle
                ? `${vehicle.brand} ${vehicle.model} · ${vehicle.plate}`
                : "Complete o cadastro da sua moto"}
            </small>
          </div>
          <button className="edit-driver" onClick={startEditing} disabled={backend.profile?.blocked}>
            Editar
          </button>
        </div>
        {driverView === "settings" && <div className="driver-subpage-intro driver-settings-intro"><Settings2 aria-hidden="true" /><h2>Preferências do motorista</h2><p>Controle sua disponibilidade e os alertas de novas corridas.</p></div>}
        {driverView === "settings" && <section className="driver-offline-settings" aria-label="Navegação offline">
          <h3><Navigation aria-hidden="true" /> Navegação</h3>
          <p><strong>Região:</strong> {OFFLINE_REGION.name}</p>
          <p><strong>Mapa e ruas:</strong> {roadGraph ? "disponíveis neste aparelho" : "ainda não preparados"}</p>
          {roadGraph && <p><strong>Dados:</strong> {roadGraph.data.roads.length} vias · versão {roadGraph.data.version}</p>}
          {offlinePackage && offlinePackage.ride.id === ride?.id && <p><strong>Corrida:</strong> {offlinePackage.mapReady && offlinePackage.routeToPickup && offlinePackage.routeToDestination ? "duas rotas preparadas" : "cobertura offline incompleta"}</p>}
          <button type="button" onClick={() => void loadRegionPackage().then(setRoadGraph).catch(() => setNotice("Não foi possível atualizar o mapa neste momento."))}>Verificar mapa agora</button>
        </section>}
        <div className={`online-card ${online ? "is-online" : ""}`}>
          <div>
            <span className="online-dot" />
            <div>
              <b>{queue?.status === "paused" ? "Você está pausado" : online ? "Você está online" : "Você está offline"}</b>
              <small>
                {state?.approval_status === "rejected"
                  ? "Cadastro recusado. Revise os dados."
                  : state?.approval_status === "suspended"
                    ? "Cadastro bloqueado pela central"
                    : state?.approval_status !== "approved"
                      ? "Cadastro aguardando aprovação"
                      : online
                        ? queue?.status === "paused" ? "Sem receber novas corridas" : gpsStatus
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
        {(queueModeActive || queue?.status === "paused") && <button type="button" className={`driver-queue-chip ${queuePosition === 1 ? "is-next" : ""}`} onClick={() => { setQueueOpen(true); setDriverView("settings"); setMenuOpen(true); }} aria-label={`Abrir Minha Fila: ${queueLabel}`}>
          <span>MINHA FILA</span>
          <strong>{queueLabel}</strong>
          {queuePosition && <small>{queue?.ahead} {queue?.ahead === 1 ? "motorista" : "motoristas"} na sua frente</small>}
          <ChevronRight aria-hidden="true" />
        </button>}
        {queueOpen && (queueModeActive || queue?.status === "paused") && <div className="driver-queue-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setQueueOpen(false); }}>
          <section className="driver-queue-dialog" role="dialog" aria-modal="true" aria-labelledby="driver-queue-title">
            <header><div><small>MOTOPOMBAL</small><h2 id="driver-queue-title">{queueModeActive ? "MINHA FILA" : "RECEBIMENTO"}</h2></div><button type="button" onClick={() => setQueueOpen(false)} aria-label="Fechar painel"><X /></button></header>
            <div className={`driver-queue-hero ${queuePosition === 1 ? "is-next" : ""}`}>
              <span>{queueLabel}</span>
              {queuePosition ? <><strong>{queuePosition}º <small>lugar</small></strong><p>{queue?.ahead} {queue?.ahead === 1 ? "motorista" : "motoristas"} na sua frente</p></> : <strong className="driver-queue-state">{queue?.status === "paused" ? "Recebimento pausado" : queue?.status === "on_ride" ? "Corrida em andamento" : queue?.status === "offer" ? "Responda à oferta" : queue?.status === "offline" ? "Entre online para participar" : "Aguardando sua disponibilidade"}</strong>}
              <p>{queueModeActive ? queueMessage : "Volte a receber ofertas quando estiver pronto."}</p>
            </div>
            {queue && queueModeActive && <dl className="driver-queue-facts">
              <div><dt>Posição atual</dt><dd>{queuePosition ? `${queuePosition}º` : "—"}</dd></div>
              <div><dt>Na sua frente</dt><dd>{queuePosition ? queue.ahead : "—"}</dd></div>
              <div><dt>Disponíveis na fila</dt><dd>{queue.total}</dd></div>
              <div><dt>Status</dt><dd>{queueLabel}</dd></div>
              <div><dt>Entrada na fila</dt><dd>{queue.enteredAt ? new Date(queue.enteredAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Não registrada"}</dd></div>
              <div><dt>Atualização</dt><dd>{new Date(queue.updatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</dd></div>
            </dl>}
            {backend.driverQueueError && <p className="driver-queue-error" role="alert">{backend.driverQueueError}</p>}
            {queue?.status === "queued" && (confirmQueuePause ? <div className="driver-queue-confirm"><p>Enquanto estiver pausado, você não receberá novas corridas.</p><div><Button type="button" variant="outline" onClick={() => setConfirmQueuePause(false)}>CANCELAR</Button><Button type="button" disabled={queueBusy} onClick={() => void setQueuePaused(true)}>{queueBusy ? "PAUSANDO…" : "CONFIRMAR PAUSA"}</Button></div></div> : <Button type="button" variant="outline" disabled={queueBusy} onClick={() => setConfirmQueuePause(true)}>PAUSAR RECEBIMENTO</Button>)}
            {queue?.status === "paused" && <div className="driver-queue-confirm"><p>{queueModeActive ? queue.returnPolicy === "end" ? "Ao voltar, você entrará no final da fila conforme a política da central." : "Sua posição de retorno seguirá a política da central." : "Ao voltar, você poderá receber ofertas simultâneas com os outros motoristas disponíveis."}</p><Button type="button" disabled={queueBusy} onClick={() => void setQueuePaused(false)}>{queueBusy ? "VOLTANDO…" : queueModeActive ? "VOLTAR PARA A FILA" : "VOLTAR A RECEBER CORRIDAS"}</Button></div>}
            <small className="driver-queue-footnote">{queueModeActive ? "A ordem segue o rodízio de motoristas elegíveis. A próxima corrida depende de uma solicitação de passageiro." : "Na oferta simultânea, o primeiro motorista elegível a aceitar assume a corrida."}</small>
          </section>
        </div>}
        <section className="driver-alert-settings" aria-label="Alertas de corrida">
          <h3><Bell aria-hidden="true" /> Alertas de corrida</h3>
          <label>
            <span><b>Notificações</b><small>Alertar com o PWA minimizado, quando permitido</small></span>
            <Switch disabled={busy} checked={alertPreferences.notifications} onCheckedChange={(enabled) => void updateAlertPreference("notifications", enabled)} aria-label="Notificações de novas corridas" />
          </label>
          <label>
            <span><b>Som de nova corrida</b><small>Toque contínuo até responder ou expirar</small></span>
            <Switch checked={alertPreferences.sound} onCheckedChange={(enabled) => void updateAlertPreference("sound", enabled)} aria-label="Som de novas corridas" />
          </label>
          <label>
            <span><b>Vibração</b><small>Usa a vibração disponível no aparelho</small></span>
            <Switch checked={alertPreferences.vibration} onCheckedChange={(enabled) => void updateAlertPreference("vibration", enabled)} aria-label="Vibração de novas corridas" />
          </label>
          <Button type="button" variant="outline" disabled={testingAlert || Boolean(offer)} onClick={() => void testRideAlert()}>
            {testingAlert ? "TESTANDO…" : "TESTAR SOM E VIBRAÇÃO"}
          </Button>
        </section>

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
          <a href="mailto:suporte@motovip.app?subject=MotoPombal%20-%20Ajuda%20ao%20motorista" aria-label="Enviar e-mail à central de suporte">
            <ChevronRight />
          </a>
        </div>
        {(driverView === "rides" || driverView === "earnings") && <section className="driver-earnings" aria-label={driverView === "earnings" ? "Meus ganhos" : "Histórico de corridas"}>
          {driverView === "earnings" ? <div className="earnings-hero">
            <span>GANHOS DA SEMANA</span>
            <strong>{backend.driverHistory && !backend.driverHistoryLoading ? money(backend.driverHistory.totals.weekCents) : "—"}</strong>
            <small>Valor bruto das corridas concluídas</small>
          </div> : <div className="driver-subpage-intro"><History aria-hidden="true" /><h2>Suas corridas</h2><p>Confira suas corridas concluídas e os pagamentos.</p></div>}
          <div className="driver-earnings-body">
            {backend.driverHistoryLoading ? <div className="driver-subpage-state" role="status">Carregando suas corridas…</div>
              : backend.driverHistoryError ? <div className="driver-subpage-state is-error" role="alert"><p>{backend.driverHistoryError}</p><button type="button" onClick={() => void backend.reloadDriverHistory()}>Tentar novamente</button></div>
                : backend.driverHistory ? <>
                  {driverView === "earnings" && <>
                    <h3 className="driver-subpage-heading">Por período</h3>
                    <div className="earnings-period-grid">
                      <div><span>Hoje</span><strong>{money(backend.driverHistory.totals.dayCents)}</strong></div>
                      <div><span>Este mês</span><strong>{money(backend.driverHistory.totals.monthCents)}</strong></div>
                    </div>
                    <h3 className="driver-subpage-heading">Pagamentos</h3>
                    <div className="earnings-payment-grid">
                      <div><span className="earnings-payment-icon is-received"><Check aria-hidden="true" /></span><span>Recebido no total</span><strong>{money(backend.driverHistory.totals.receivedCents)}</strong></div>
                      <div><span className="earnings-payment-icon is-pending"><Clock3 aria-hidden="true" /></span><span>Pendente no total</span><strong>{money(backend.driverHistory.totals.pendingCents)}</strong></div>
                    </div>
                    <p className="earnings-note">Valores brutos das corridas{backend.driverHistory.totals.commissionConfigured ? "." : ". Comissão ainda não configurada."}</p>
                  </>}
                  <div className="driver-history-heading"><h3 className="driver-subpage-heading">Corridas recentes</h3>{driverView === "earnings" && <button type="button" onClick={() => setDriverView("rides")}>Ver histórico <ChevronRight aria-hidden="true" /></button>}</div>
                  <div className="driver-history-list">
                    {backend.driverHistory.rides.length ? backend.driverHistory.rides.slice(0, driverView === "earnings" ? 3 : 20).map((item) => (
                      <div key={item.id}>
                        <span className="driver-history-date">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(item.completed_at || item.created_at))}</span>
                        <b>{money(item.final_fare_cents ?? item.fare_cents)}</b>
                        <strong>{item.passenger_name || "Passageiro não informado"}</strong>
                        <small>{rideStatusLabel(item.status)} · {(item.final_fare_cents ?? item.fare_cents) === 0 ? "Gratuita · Quitada" : `${item.payment?.method === "cash" ? "Dinheiro" : "Pix"} · ${paymentLabel(item.payment?.status)}`}</small>
                        {item.payment?.method === "cash" && item.payment.status === "aguardando_pagamento" && <button type="button" disabled={cashBusyRide === item.id} onClick={() => void confirmDriverCash(item.id)}>{cashBusyRide === item.id ? "Confirmando…" : "Confirmar recebimento em dinheiro"}</button>}
                      </div>
                    )) : <div className="driver-subpage-state"><History aria-hidden="true" /><p>Você ainda não possui corridas concluídas.</p></div>}
                  </div>
                </> : <div className="driver-subpage-state is-error"><p>Não foi possível carregar suas corridas.</p><button type="button" onClick={() => void backend.reloadDriverHistory()}>Tentar novamente</button></div>}
          </div>
        </section>}
        <NotificationsPanel backend={backend} driverMode />
      </aside>
      <main className="driver-main">
        <div className="driver-map-layer">
          <RealMap
            origin={ride && navPhase ? undefined : origin}
            destination={ride && navPhase ? navDestination : destination}
            driver={liveLocation}
            route={ride && navPhase ? navigationRoute : route}
            navigationMode={Boolean(ride && navPhase)}
            navigation={ride && navPhase ? navMap : undefined}
            navigationFollow={followDriver}
            centerTarget={liveLocation}
            centerRequest={navigationCenterRequest}
            onNavigationInteraction={ride && navPhase ? () => setFollowDriver(false) : undefined}
            offlineRoads={connectivity === "OFFLINE" ? roadGraph?.data : null}
            offlineMapActive={connectivity === "OFFLINE"}
            onTilesUnavailableChange={setMapTilesUnavailable}
            diagnostics
          />
        </div>
        {!(ride && navPhase) && <button type="button" className="driver-map-center" aria-label="Centralizar minha localização" onClick={() => setNavigationCenterRequest((value) => value + 1)}><Crosshair /></button>}
        {ride && navPhase && gpsExpanded && (
          <section className="driver-navigation" aria-label="Navegação da corrida">
            <div className="driver-nav-top">
              <div className="driver-nav-toolbar">
                <div className="driver-nav-stage">{ride.status === "aceita" ? "PREPARANDO NAVEGAÇÃO" : ride.status === "motorista_chegou" ? "AGUARDANDO PASSAGEIRO" : navPhase === "pickup" ? "INDO BUSCAR PASSAGEIRO" : "LEVANDO AO DESTINO"}</div>
                {connectivity !== "ONLINE" && <span className={`driver-nav-connection ${connectivity.toLowerCase()}`} role="status">{connectivity === "OFFLINE" ? navigator.onLine ? "Servidor indisponível" : "Navegação offline" : connectivity === "RECOVERING" ? "Reconectando…" : "Conexão fraca"}</span>}
                <button type="button" className="driver-nav-exit" onClick={() => { setDriverView("menu"); setMenuOpen(true); }} aria-label="Abrir menu do motorista"><Menu /></button>
              </div>
              <div className="driver-nav-instruction">
                <span className="driver-nav-arrow" aria-hidden="true">{maneuverSymbol(gpsWeak ? undefined : upcomingManeuver?.step)}</span>
                <div>
                  <strong>{ride.status === "motorista_chegou" ? "Você chegou" : gpsWeak ? navEta ? "Rota de referência" : "Aguardando localização" : distanceToTarget <= 45 ? "Local de chegada próximo" : upcomingManeuver ? `Em ${formatNavDistance(upcomingManeuver.distanceMeters)}` : "Siga pela rota"}</strong>
                  <span>{ride.status === "motorista_chegou" ? "Aguarde o embarque" : !gpsWeak && upcomingManeuver ? maneuverText(upcomingManeuver.step) : navPhase === "pickup" ? ride.origin_address : ride.destination_address}</span>
                </div>
                <button type="button" className="driver-nav-sound" aria-label={voiceOn ? "Desligar som" : "Ligar som"} aria-pressed={voiceOn} onClick={() => {
                  if (voiceOn) window.speechSynthesis?.cancel();
                  announcedRef.current.clear();
                  setVoiceOn(!voiceOn);
                }}>{voiceOn ? <Volume2 /> : <VolumeX />}</button>
              </div>
              {(gpsWeak || rerouting || trackingEtaError || locationSyncError) && <div className="driver-nav-alert" role="status">
                <span>{rerouting ? "Recalculando rota…" : gpsWeak ? gpsAlert : locationSyncError || trackingEtaError}</span>
                {gpsWeak && <button type="button" onClick={retryGps} disabled={gpsRetrying}>{gpsRetrying ? "Buscando GPS…" : "Tentar GPS"}</button>}
              </div>}
              {mapTilesUnavailable && connectivity !== "OFFLINE" && <div className="driver-nav-alert" role="status">O mapa de ruas não carregou. Use outro mapa para seguir até {navPhase === "pickup" ? "o passageiro" : "o destino"} enquanto tentamos recuperar a conexão.</div>}
            </div>
            <div className="driver-nav-floats">
              <button type="button" aria-label={voiceOn ? "Desligar orientação por voz" : "Ligar orientação por voz"} onClick={() => { if (voiceOn) window.speechSynthesis?.cancel(); announcedRef.current.clear(); setVoiceOn(!voiceOn); }}>{voiceOn ? <Volume2 /> : <VolumeX />}</button>
              <button type="button" aria-label="Mensagem ao passageiro" onClick={() => setContactOpen(true)}><MessageCircle /></button>
              {ride.passenger?.phone && <a href={`tel:${ride.passenger.phone}`} aria-label="Ligar para o passageiro"><Phone /></a>}
            </div>
            <button type="button" className={`driver-nav-center ${followDriver ? "is-following" : ""}`} aria-label="Centralizar mapa no motorista" onClick={() => {
              setFollowDriver(true);
              setNavigationCenterRequest((value) => value + 1);
            }}><Crosshair /></button>
            <div className="driver-nav-bottom">
              <div className="driver-nav-summary">
                <strong>{gpsWeak ? navEta ? "Rota de referência" : "Obtendo localização…" : navEta ? `${minutes(Math.round(navEta.durationSeconds * Math.min(1, (navigationProgress?.remainingMeters ?? navEta.distanceMeters) / Math.max(1, navEta.distanceMeters))))} min` : "Calculando…"}</strong>
                <span>{gpsWeak ? navEta ? `${formatNavDistance(navEta.distanceMeters)} desde a última posição conhecida; aguarde GPS atual.` : gpsAlert : navEta ? formatNavDistance(navigationProgress?.remainingMeters ?? navEta.distanceMeters) : trackingEtaError || "Calculando rota…"}</span>
                <span>{ride.status === "aceita" ? "Corrida aceita · preparando rota" : ride.status === "motorista_chegou" ? "Aguardando passageiro" : navPhase === "pickup" ? "Indo buscar o passageiro" : "Em corrida para o destino"}</span>
              </div>
              {navPhase === "trip" && connectivity === "ONLINE" && Number(ride.tracked_distance_meters) > 0 && <div className="driver-nav-trip">Percorrido pelo GPS: {(Number(ride.tracked_distance_meters) / 1000).toFixed(2).replace(".", ",")} km</div>}
              <div className="driver-nav-actions">
                <button type="button" className="driver-nav-primary"
                  disabled={busy}
                  onClick={advance}>{ride.status === "aceita" ? "Ir até passageiro" : ride.status === "motorista_a_caminho" ? "Cheguei" : ride.status === "motorista_chegou" ? "Iniciar corrida" : "Finalizar corrida"}</button>
              </div>
              {ride.status !== "em_corrida" && <button type="button" className="driver-nav-fallback" disabled={busy} onClick={() => setCancelStep(1)}>Cancelar corrida</button>}
              {ride.status === "em_corrida" && <button type="button" className="driver-nav-fallback" disabled={busy} onClick={() => setEarlyEndOpen(true)}>Encerrar viagem antecipadamente</button>}
              {ride.status === "motorista_a_caminho" && distanceToTarget > backend.cancellationPolicy.arrival_radius_meters &&
                <p className="driver-nav-notice">Chegue a até {backend.cancellationPolicy.arrival_radius_meters} m do embarque para confirmar.</p>}
              {ride.status === "motorista_a_caminho" && distanceToTarget <= backend.cancellationPolicy.arrival_radius_meters && !arrivalReady &&
                <p className="driver-nav-notice">Para confirmar chegada, aguarde GPS recente com precisão de até 40 m.</p>}
              {ride.status === "motorista_chegou" && noShowRemaining !== null &&
                <div className="driver-waiting"><span>Esperando passageiro · {String(Math.floor(noShowRemaining / 60)).padStart(2,"0")}:{String(noShowRemaining % 60).padStart(2,"0")}</span>
                  <button type="button" disabled={busy || noShowRemaining > 0} onClick={() => setNoShowConfirmOpen(true)}>Passageiro não apareceu</button></div>}
              {(!navEta || gpsWeak || mapTilesUnavailable) && navigationTarget && <button type="button" className="driver-nav-fallback" onClick={() => window.open(navigationTarget.url, "_blank", "noopener,noreferrer")}>Abrir rota em outro mapa</button>}
              {notice && <p className="driver-nav-notice" role="alert">{notice}</p>}
            </div>
            {contactOpen && <div className="driver-contact-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setContactOpen(false); }}>
              <section className="driver-contact-sheet" role="dialog" aria-modal="true" aria-labelledby="driver-contact-title">
                <header><div><small>CONTATO DA CORRIDA</small><h2 id="driver-contact-title">{ride.passenger?.full_name || "Passageiro"}</h2></div><button type="button" onClick={() => setContactOpen(false)} aria-label="Fechar contato"><X /></button></header>
                <p>Use uma ligação ou mensagem para combinar o embarque. Volte ao mapa antes de seguir viagem.</p>
                {ride.passenger?.phone ? <div className="driver-contact-actions">
                  <a href={`tel:${ride.passenger.phone}`}><Phone /> Ligar</a>
                  <a href={`sms:${ride.passenger.phone}`}><MessageCircle /> Enviar SMS</a>
                </div> : <p>O telefone do passageiro não está disponível nesta corrida.</p>}
                {ride.status !== "em_corrida" && <button type="button" className="driver-contact-cancel" disabled={busy} onClick={() => { setContactOpen(false); setCancelStep(1); }}>Cancelar corrida</button>}
              </section>
            </div>}
            {noShowConfirmOpen && <div className="driver-contact-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNoShowConfirmOpen(false); }}>
              <section className="driver-contact-sheet" role="alertdialog" aria-modal="true" aria-labelledby="no-show-title">
                <header><h2 id="no-show-title">Passageiro não apareceu?</h2><button type="button" onClick={() => setNoShowConfirmOpen(false)} aria-label="Fechar"><X /></button></header>
                <p>Confirme somente se aguardou no ponto de embarque. O servidor verificará o tempo de espera e a taxa configurada.</p>
                <div className="driver-contact-actions"><button type="button" onClick={() => setNoShowConfirmOpen(false)}>Voltar</button>
                  <button type="button" disabled={busy} onClick={() => { setNoShowConfirmOpen(false); void cancelRide("NO_SHOW"); }}>Confirmar ausência</button></div>
              </section>
            </div>}
          </section>
        )}
        {ride && cancelStep > 0 && ride.status !== "em_corrida" && <div className="driver-contact-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCancelStep(0); }}>
          <section className="driver-contact-sheet driver-cancel-sheet" role="alertdialog" aria-modal="true" aria-labelledby="driver-cancel-title">
            <header><h2 id="driver-cancel-title">Cancelar esta corrida?</h2><button type="button" disabled={busy} onClick={() => setCancelStep(0)} aria-label="Fechar"><X /></button></header>
            {cancelStep === 1 ? <>
              <p>Informe o motivo do cancelamento. O passageiro continuará procurando outro motorista.</p>
              <div className="driver-cancel-reasons" role="radiogroup" aria-label="Motivo do cancelamento">
                {DRIVER_CANCEL_REASONS.map((item) => <label key={item.code}><input type="radio" name="driver-cancel-reason" value={item.code} checked={cancelReason === item.code} disabled={item.code === "no_show" && (ride.status !== "motorista_chegou" || !ride.arrival_verified || noShowRemaining === null || noShowRemaining > 0)} onChange={() => setCancelReason(item.code)} />{item.label}</label>)}
              </div>
              {cancelReason === "other" && <label className="driver-cancel-other">Descreva o motivo<textarea value={cancelOther} maxLength={300} onChange={(event) => setCancelOther(event.target.value)} /></label>}
              <div className="driver-contact-actions"><button type="button" onClick={() => setCancelStep(0)}>Voltar</button><button type="button" disabled={!cancelReason || (cancelReason === "other" && !cancelOther.trim()) || busy} onClick={() => {
                if (cancelReason === "no_show") { setCancelStep(0); setNoShowConfirmOpen(true); }
                else setCancelStep(2);
              }}>Continuar</button></div>
            </> : <>
              <p>Confirma o cancelamento por <strong>{DRIVER_CANCEL_REASONS.find((item) => item.code === cancelReason)?.label}</strong>? Esta ação será registrada para o administrador.</p>
              <div className="driver-contact-actions"><button type="button" disabled={busy} onClick={() => setCancelStep(1)}>Voltar</button><button type="button" disabled={busy} onClick={() => void confirmDriverCancellation()}>{busy ? "Cancelando…" : "Confirmar cancelamento"}</button></div>
            </>}
          </section>
        </div>}
        {ride?.status === "em_corrida" && earlyEndOpen && <div className="driver-contact-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEarlyEndOpen(false); }}>
          <section className="driver-contact-sheet driver-cancel-sheet" role="alertdialog" aria-modal="true" aria-labelledby="early-end-title">
            <header><h2 id="early-end-title">Encerrar viagem antecipadamente?</h2><button type="button" disabled={busy} onClick={() => setEarlyEndOpen(false)} aria-label="Fechar"><X /></button></header>
            <p>Esta viagem já começou. O encerramento será registrado para o administrador, com o motivo e o valor calculado pelas regras vigentes.</p>
            <label className="driver-cancel-other">Motivo obrigatório<textarea value={earlyEndReason} maxLength={300} onChange={(event) => setEarlyEndReason(event.target.value)} /></label>
            <div className="driver-contact-actions"><button type="button" disabled={busy} onClick={() => setEarlyEndOpen(false)}>Voltar</button><button type="button" disabled={busy || earlyEndReason.trim().length < 3} onClick={() => void confirmEarlyEnd()}>{busy ? "Encerrando…" : "Confirmar encerramento"}</button></div>
          </section>
        </div>}
        {notice && <div className="backend-warning">{notice}</div>}
        {offlineConflict && <div className="driver-offline-conflict" role="alert"><strong>Sincronização requer atenção</strong><span>{offlineConflict}</span><small>Não continue etapas desta corrida até a central confirmar o estado.</small></div>}
        {syncingOffline && pendingOfflineCount > 0 && <div className="driver-offline-sync" role="status">Sincronizando {pendingOfflineCount} {pendingOfflineCount === 1 ? "etapa" : "etapas"} da corrida…</div>}
        {offlinePackage?.navigationState === "finalizada" && pendingOfflineCount > 0 && <div className="driver-offline-completed" role="status"><Check /><strong>Corrida concluída neste aparelho</strong><span>Sincronização pendente. O pagamento ainda depende de confirmação do servidor.</span></div>}
        {online && !ride && !offer && !completedRide && queuePosition && (
          <button type="button" className="driver-queue-map-card" aria-label={`Você está em ${queuePosition}º na fila. Ver detalhes.`} onClick={() => { setQueueOpen(true); setDriverView("settings"); setMenuOpen(true); }}><span className="driver-queue-map-icon"><Users aria-hidden="true" /></span><span><strong>{queuePosition === 1 ? "Você é o próximo da fila" : `Você está em ${queuePosition}º na fila`}</strong><small>Aguarde, você será chamado em breve.</small></span><ChevronRight aria-hidden="true" /></button>
        )}
        {!online && !ride && !completedRide && (
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
                ? "Fique online para entrar na fila de corridas."
                : "A central precisa aprovar seus dados e sua moto."}
            </p>
            {state?.approval_status === "approved" && (
              <Button disabled={busy} onClick={() => toggle(true)}>
                FICAR ONLINE
              </Button>
            )}
          </div>
        )}
        {online && !ride && !offer && !completedRide && !queuePosition && (
          <div className="driver-empty">
            <span>
              <Bike />
            </span>
            <h2>{queue?.status === "paused" ? "Recebimento pausado" : !queueModeActive ? "Ofertas simultâneas ativas" : queuePosition === 1 ? "Você é o próximo da fila" : queuePosition ? `Você está em ${queuePosition}º lugar` : "Você está disponível"}</h2>
            <p>{queue?.status === "paused" ? "Volte a receber corridas quando estiver pronto." : !queueModeActive ? "As novas corridas serão oferecidas a todos os motoristas disponíveis." : queuePosition ? queueMessage : "As novas solicitações aparecerão aqui em tempo real."}</p>
          </div>
        )}
        {online && !ride && offer && offerSeconds > 0 && (
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
                <small>Distância</small>
                <b>{(offer.ride.distance_meters / 1000).toFixed(1)} km</b>
              </div>
              <div>
                <small>Valor</small>
                <b>{money(offer.ride.fare_cents)}</b>
              </div>
            </div>
            <div className="offer-payment"><CreditCard /> {offer.ride.payment_method === "cash" ? "Pagamento em dinheiro" : "Pagamento via Pix"}</div>
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
        {completedRide && !offer && (
          <div className="completion-card driver-completion-card">
            <div className="completion-check"><Check /></div>
            <h2>Corrida finalizada!</h2>
            {queuePosition && <p className="driver-queue-return">Você retornou automaticamente para a fila. Nova posição: <b>{queuePosition}º</b>. {queue?.ahead} {queue?.ahead === 1 ? "motorista está" : "motoristas estão"} na sua frente.</p>}
            <div className="completion-route">
              <span>{completedRide.origin_address}</span>
              <i>→</i>
              <span>{completedRide.destination_address}</span>
            </div>
            <div className="completion-grid">
              <div><small>Valor</small><b>{money(completedRide.final_fare_cents ?? completedRide.fare_cents)}</b></div>
              <div><small>Pagamento</small><b>{completedRide.payment_method === "cash" ? "Dinheiro" : "Pix"}</b></div>
              <div><small>Distância</small><b>{completedRide.actual_distance_meters == null ? "A confirmar" : `${(completedRide.actual_distance_meters / 1000).toFixed(2).replace(".", ",")} km`}</b></div>
              <div><small>Duração</small><b>{durationLabel(completedRide.actual_duration_seconds)}</b></div>
            </div>
            <Button type="button" onClick={backend.dismissCompletedRide}>OK</Button>
          </div>
        )}
        {ride && !localFinished && (!navPhase || !gpsExpanded) && (
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
              <button type="button" aria-label="Contato com passageiro" onClick={() => { setGpsExpanded(true); setContactOpen(true); }}>
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
                  {trackingEta
                    ? `Rota atual: ${(trackingEta.distanceMeters / 1000).toFixed(1)} km · ${minutes(trackingEta.durationSeconds)} min`
                    : trackingEtaError || "Calculando a rota atual…"}
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
              {navPhase && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setFollowDriver(true);
                    setNavigationCenterRequest((value) => value + 1);
                    setGpsExpanded(true);
                  }}
                >
                  <Navigation /> ABRIR GPS
                </Button>
              )}
              {navigationTarget && (
                <Button disabled={busy} variant="outline" onClick={() => window.open(navigationTarget.url, "_blank", "noopener,noreferrer")}>
                  <Navigation /> OUTRO MAPA
                </Button>
              )}
              {ride.status !== "em_corrida" && (
                <Button disabled={busy} variant="outline" onClick={() => setCancelStep(1)}>
                  CANCELAR
                </Button>
              )}
              {ride.status === "em_corrida" && <Button disabled={busy} variant="outline" onClick={() => setEarlyEndOpen(true)}>ENCERRAR ANTECIPADAMENTE</Button>}
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
        {!(ride && navPhase) && <nav className="driver-bottom-nav" aria-label="Navegação do motorista">
          <button type="button" className="active" onClick={() => setMenuOpen(false)}><HomeIcon />Início</button>
          <button type="button" onClick={() => { setDriverView("rides"); setMenuOpen(true); }}><History />Corridas</button>
          <button type="button" onClick={() => { setDriverView("earnings"); setMenuOpen(true); }}><Wallet />Ganhos</button>
          <button type="button" onClick={() => { setDriverView("support"); setMenuOpen(true); }}><Headphones />Suporte</button>
        </nav>}
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
  const [dispatchModeChoice, setDispatchModeChoice] = useState<"round_robin" | "broadcast" | null>(null);
  const selectedDispatchMode = dispatchModeChoice ?? backend.dispatchMode ?? "round_robin";
  async function saveDispatchMode() {
    setBusyId("dispatch");
    setNotice("");
    try {
      await backend.saveDispatchMode(selectedDispatchMode);
      await backend.refresh();
      setDispatchModeChoice(null);
      setNotice(selectedDispatchMode === "round_robin"
        ? "Fila ativada. As próximas ofertas seguirão o rodízio."
        : "Fila desativada. As próximas corridas serão oferecidas a todos os disponíveis.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível salvar o modo de distribuição.");
    } finally {
      setBusyId("");
    }
  }
  async function confirmAdminCash(rideId: string) {
    setBusyId(rideId);
    try {
      await backend.confirmCashPayment(rideId);
      await backend.refresh();
      setNotice("Recebimento em dinheiro confirmado.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível confirmar o recebimento.");
    } finally {
      setBusyId("");
    }
  }
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
    locationVerified: false,
    sortOrder: String((backend.quickPlaces.length + 1) * 10),
  };
  const [quickPlaceForm, setQuickPlaceForm] = useState(emptyQuickPlaceForm);
  const [quickPlaceMapOpen, setQuickPlaceMapOpen] = useState(false);
  const [quickPlaceMapPoint, setQuickPlaceMapPoint] = useState<LivePoint>({
    lat: -10.8373,
    lng: -38.5357,
    label: "Centro de Ribeira do Pombal",
  });
  const [quickPlaceOrder, setQuickPlaceOrder] = useState<string[] | null>(null);
  const orderedQuickPlaces = quickPlaceOrder
    ? quickPlaceOrder
        .map((id) => backend.quickPlaces.find((place) => place.id === id))
        .filter((place): place is QuickPlace => Boolean(place))
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
  async function decide(driverId: string, status: "approved" | "rejected" | "blocked" | "pending") {
    setBusyId(driverId);
    setNotice("");
    try {
      await backend.approveDriver(driverId, status);
      await backend.refresh();
      setNotice(
        { approved: "Motorista aprovado.", rejected: "Cadastro recusado.", blocked: "Motorista bloqueado.", pending: "Motorista desbloqueado; aguardando revisão." }[status],
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
  function openQuickPlaceMap() {
    const latitude = Number(quickPlaceForm.latitude);
    const longitude = Number(quickPlaceForm.longitude);
    setQuickPlaceMapPoint(
      Number.isFinite(latitude) && Number.isFinite(longitude)
        ? { lat: latitude, lng: longitude, label: quickPlaceForm.name || "Ponto da cidade" }
        : { lat: -10.8373, lng: -38.5357, label: "Centro de Ribeira do Pombal" },
    );
    setQuickPlaceMapOpen(true);
  }
  function confirmQuickPlaceMap() {
    setQuickPlaceForm((current) => ({
      ...current,
      latitude: quickPlaceMapPoint.lat.toFixed(7),
      longitude: quickPlaceMapPoint.lng.toFixed(7),
      locationVerified: true,
    }));
    setQuickPlaceMapOpen(false);
    setNotice("📍 Localização definida. As coordenadas do PIN serão a fonte oficial do destino.");
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
      locationVerified: true,
      sortOrder: String(place.sort_order),
    });
    document
      .getElementById("quick-place-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function saveQuickPlace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quickPlaceForm.locationVerified) {
      setNotice("Defina a localização exata no mapa antes de salvar o ponto.");
      return;
    }
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
        locationVerified: quickPlaceForm.locationVerified,
        sortOrder: Number(quickPlaceForm.sortOrder),
      });
      await backend.refresh();
      setQuickPlaceForm({
        ...emptyQuickPlaceForm,
        sortOrder: String((backend.quickPlaces.length + 2) * 10),
      });
      setNotice(
        quickPlaceForm.id
          ? "Ponto da cidade atualizado com coordenadas confirmadas."
          : "Ponto da cidade cadastrado com coordenadas confirmadas.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o ponto rápido.",
      );
    } finally {
      setBusyId("");
    }
  }
  async function deleteQuickPlace(place: QuickPlace) {
    if (
      !window.confirm(
        `Excluir “${place.name}”? Essa ação não poderá ser desfeita.`,
      )
    )
      return;
    setBusyId(`quick-delete-${place.id}`);
    setNotice("");
    try {
      await backend.deleteQuickPlace(place.id);
      await backend.refresh();
      if (quickPlaceForm.id === place.id)
        setQuickPlaceForm(emptyQuickPlaceForm);
      setNotice("Ponto rápido excluído.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir o ponto rápido.",
      );
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
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar a ordem.",
      );
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
          <button className="active" onClick={() => document.getElementById("admin-overview")?.scrollIntoView({ behavior: "smooth" })}>
            <Gauge /> Visão geral
          </button>
          <button onClick={() => document.getElementById("admin-rides")?.scrollIntoView({ behavior: "smooth" })}>
            <Route /> Corridas
          </button>
          <button onClick={() => document.getElementById("admin-drivers")?.scrollIntoView({ behavior: "smooth" })}>
            <Bike /> Motoristas
          </button>
          <button onClick={() => document.getElementById("admin-dispatch")?.scrollIntoView({ behavior: "smooth" })}>
            <Route /> Distribuição
          </button>
          <button onClick={() => document.getElementById("admin-fares")?.scrollIntoView({ behavior: "smooth" })}>
            <CircleDollarSign /> Tarifas
          </button>
          <button disabled title="Ainda não disponível">
            <Users /> Passageiros
          </button>
          <button onClick={() => document.getElementById("admin-finance")?.scrollIntoView({ behavior: "smooth" })}>
            <Wallet /> Financeiro
          </button>
          <button
            onClick={() =>
              document
                .getElementById("quick-places-admin")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <MapPin /> Pontos da cidade
          </button>
          <button disabled title="Ainda não disponível">
            <Headphones /> Suporte
          </button>
        </nav>
        <div className="admin-user">
          <span>MV</span>
          <div>
            <b>{backend.profile?.full_name || "Central MotoPombal"}</b>
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
        <section className="kpi-grid" id="admin-overview">
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
              <small>Motoristas online</small>
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
        <section className="admin-dispatch-card" id="admin-dispatch" aria-labelledby="admin-dispatch-title">
          <div className="card-title">
            <div><span>DISTRIBUIÇÃO DE CORRIDAS</span><h2 id="admin-dispatch-title">Modo escolhido pelo ADM</h2></div>
            <em className={`approval-status ${backend.dispatchMode === "round_robin" ? "approved" : ""}`}>
              {!backend.dispatchReady ? "Banco aguardando atualização" : backend.dispatchMode === "round_robin" ? "Fila ativa" : backend.dispatchMode === "broadcast" ? "Oferta simultânea" : "Carregando"}
            </em>
          </div>
          <p>Esta escolha vale para novas ofertas. Todos os motoristas online, disponíveis, aprovados e em turno são considerados, independentemente da distância.</p>
          {!backend.dispatchReady && <p className="admin-dispatch-pending">Para liberar esta escolha, aplique a atualização do banco de dados do modo de distribuição.</p>}
          <div className="admin-dispatch-options" role="radiogroup" aria-label="Modo de distribuição">
            <label className={selectedDispatchMode === "round_robin" ? "selected" : ""}>
              <input type="radio" name="dispatch-mode" value="round_robin" checked={selectedDispatchMode === "round_robin"} onChange={() => setDispatchModeChoice("round_robin")} />
              <span><strong>Fila / rodízio</strong><small>Uma oferta por vez, na ordem da fila. O motorista vê sua posição no mapa.</small></span>
            </label>
            <label className={selectedDispatchMode === "broadcast" ? "selected" : ""}>
              <input type="radio" name="dispatch-mode" value="broadcast" checked={selectedDispatchMode === "broadcast"} onChange={() => setDispatchModeChoice("broadcast")} />
              <span><strong>Oferta simultânea</strong><small>A corrida aparece para todos os motoristas elegíveis; o primeiro a aceitar assume.</small></span>
            </label>
          </div>
          <Button type="button" disabled={busyId === "dispatch" || !backend.dispatchReady || !backend.dispatchMode || selectedDispatchMode === backend.dispatchMode} onClick={() => void saveDispatchMode()}>
            {busyId === "dispatch" ? "SALVANDO…" : "APLICAR MODO"}
          </Button>
        </section>
        <section className="admin-grid">
          <article className="live-map-card">
            <div className="card-title">
              <div>
                <span>MAPA OPERACIONAL</span>
                <h2>Ribeira do Pombal agora</h2>
              </div>
            </div>
            <MapCanvas admin nearbyDrivers={backend.adminMapDrivers} />
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
              <h2>Pontos da cidade</h2>
            </div>
            <em className="approval-status approved">
              {backend.quickPlaces.filter((place) => place.active).length}{" "}
              ativos
            </em>
          </div>
          <p>
            Cadastre locais da cidade, escolha os destaques da Home e arraste os
            itens para mudar a ordem.
          </p>
          {backend.quickPlacesError && (
            <div className="auth-message">{backend.quickPlacesError}</div>
          )}
          <div className="quick-places-admin-grid">
            <form
              id="quick-place-editor"
              className="quick-place-form"
              onSubmit={saveQuickPlace}
            >
              <div className="quick-place-form-title">
                <div>
                  <b>
                    {quickPlaceForm.id ? "Editar ponto" : "Novo ponto rápido"}
                  </b>
                  <small>
                    Os campos com coordenadas são usados diretamente na rota.
                  </small>
                </div>
                {quickPlaceForm.id && (
                  <button
                    type="button"
                    onClick={() => setQuickPlaceForm(emptyQuickPlaceForm)}
                  >
                    Cancelar edição
                  </button>
                )}
              </div>
              <div className="quick-place-fields">
                <label>
                  <span>Nome do local</span>
                  <input
                    required
                    maxLength={100}
                    value={quickPlaceForm.name}
                    onChange={(event) =>
                      setQuickPlaceForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Hospital Municipal"
                  />
                </label>
                <label className="wide">
                  <span>Endereço completo</span>
                  <input
                    required
                    maxLength={240}
                    value={quickPlaceForm.address}
                    onChange={(event) =>
                      setQuickPlaceForm((current) => ({
                        ...current,
                        address: event.target.value,
                      }))
                    }
                    placeholder="Rua, número, bairro, Ribeira do Pombal - BA"
                  />
                </label>
                <label>
                  <span>Latitude</span>
                  <input
                    required
                    type="number"
                    step="any"
                    min="-90"
                    max="90"
                    value={quickPlaceForm.latitude}
                    onChange={(event) =>
                      setQuickPlaceForm((current) => ({
                        ...current,
                        latitude: event.target.value,
                        locationVerified: false,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Longitude</span>
                  <input
                    required
                    type="number"
                    step="any"
                    min="-180"
                    max="180"
                    value={quickPlaceForm.longitude}
                    onChange={(event) =>
                      setQuickPlaceForm((current) => ({
                        ...current,
                        longitude: event.target.value,
                        locationVerified: false,
                      }))
                    }
                  />
                </label>
                <div className="quick-place-map-control wide">
                  <button type="button" onClick={openQuickPlaceMap}>
                    <MapPin /> DEFINIR LOCALIZAÇÃO NO MAPA
                  </button>
                  <span className={quickPlaceForm.locationVerified ? "verified" : "pending"} role="status">
                    <MapPin />
                    {quickPlaceForm.locationVerified
                      ? "Localização definida"
                      : "Localização ainda não confirmada no mapa"}
                  </span>
                </div>
                <label>
                  <span>Categoria</span>
                  <select
                    value={quickPlaceForm.category}
                    onChange={(event) =>
                      setQuickPlaceForm((current) => ({
                        ...current,
                        category: event.target.value as QuickPlace["category"],
                      }))
                    }
                  >
                    {QUICK_PLACE_CATEGORIES.filter(
                      (item) => item.value !== "all",
                    ).map((item) => (
                      <option value={item.value} key={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Ordem</span>
                  <input
                    required
                    type="number"
                    min="0"
                    max="100000"
                    value={quickPlaceForm.sortOrder}
                    onChange={(event) =>
                      setQuickPlaceForm((current) => ({
                        ...current,
                        sortOrder: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="color-field">
                  <span>Cor do ícone</span>
                  <div>
                    <input
                      type="color"
                      value={quickPlaceForm.color}
                      onChange={(event) =>
                        setQuickPlaceForm((current) => ({
                          ...current,
                          color: event.target.value,
                        }))
                      }
                    />
                    <input
                      required
                      pattern="^#[0-9A-Fa-f]{6}$"
                      value={quickPlaceForm.color}
                      onChange={(event) =>
                        setQuickPlaceForm((current) => ({
                          ...current,
                          color: event.target.value,
                        }))
                      }
                    />
                  </div>
                </label>
              </div>
              <fieldset className="icon-library">
                <legend>Biblioteca de ícones</legend>
                {QUICK_PLACE_ICONS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      type="button"
                      key={item.value}
                      className={
                        quickPlaceForm.icon === item.value ? "active" : ""
                      }
                      onClick={() =>
                        setQuickPlaceForm((current) => ({
                          ...current,
                          icon: item.value,
                        }))
                      }
                      title={item.label}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </fieldset>
              <div className="quick-place-options">
                <label>
                  <input
                    type="checkbox"
                    checked={quickPlaceForm.active}
                    onChange={(event) =>
                      setQuickPlaceForm((current) => ({
                        ...current,
                        active: event.target.checked,
                      }))
                    }
                  />{" "}
                  Ativo
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={quickPlaceForm.featured}
                    onChange={(event) =>
                      setQuickPlaceForm((current) => ({
                        ...current,
                        featured: event.target.checked,
                      }))
                    }
                  />{" "}
                  ⭐ Exibir na tela inicial
                </label>
              </div>
              <Button disabled={busyId === "quick-place-save" || !quickPlaceForm.locationVerified}>
                {busyId === "quick-place-save"
                  ? "SALVANDO…"
                  : quickPlaceForm.id
                    ? "SALVAR ALTERAÇÕES"
                    : "CADASTRAR PONTO"}
              </Button>
            </form>
            <div className="quick-place-admin-list">
              <div className="quick-place-list-title">
                <div>
                  <b>Pontos cadastrados</b>
                  <small>Arraste pelo ícone para reordenar</small>
                </div>
                {busyId === "quick-order" && <span>Salvando ordem…</span>}
              </div>
              {backend.quickPlacesLoading ? (
                <div className="quick-place-state">Carregando…</div>
              ) : orderedQuickPlaces.length ? (
                orderedQuickPlaces.map((place) => (
                  <article
                    key={place.id}
                    draggable
                    onDragStart={() => setDraggedPlaceId(place.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void dropQuickPlace(place.id)}
                    className={draggedPlaceId === place.id ? "dragging" : ""}
                  >
                    <GripVertical className="drag-handle" />
                    <span
                      className="admin-place-icon"
                      style={{ backgroundColor: `${place.color}18` }}
                    >
                      <QuickPlaceIcon name={place.icon} color={place.color} />
                    </span>
                    <div>
                      <b>
                        {place.featured ? "⭐ " : ""}
                        {place.name}
                      </b>
                      <small>{place.address}</small>
                      <em>
                        {QUICK_PLACE_CATEGORIES.find(
                          (item) => item.value === place.category,
                        )?.label || place.category}{" "}
                        · 📍 Coordenadas salvas
                        · {place.active ? "Ativo" : "Inativo"}
                      </em>
                    </div>
                    <button
                      type="button"
                      onClick={() => editQuickPlace(place)}
                      aria-label={`Editar ${place.name}`}
                    >
                      <Pencil />
                    </button>
                    <button
                      type="button"
                      className="delete"
                      disabled={busyId === `quick-delete-${place.id}`}
                      onClick={() => void deleteQuickPlace(place)}
                      aria-label={`Excluir ${place.name}`}
                    >
                      <Trash2 />
                    </button>
                  </article>
                ))
              ) : (
                <div className="quick-place-state">
                  Nenhum ponto rápido cadastrado.
                </div>
              )}
            </div>
          </div>
        </section>
        <section className="region-fares-card" id="admin-fares">
          <div className="card-title">
            <div>
              <span>FINANCEIRO</span>
              <h2>Tarifas por Região</h2>
            </div>
            <em className="approval-status approved">Preço por bairro ativo</em>
          </div>
          <p>
            O destino define o preço. Sem uma tarifa especial correspondente, o
            sistema usa a tarifa padrão da cidade.
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
          <section className="finance-card" id="admin-finance">
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
                <small>Dinheiro confirmado</small>
                <b>{money(finance.summary.cashPaidCents)}</b>
              </div>
              <div>
                <small>Total recebido</small>
                <b>{money(finance.summary.receivedCents)}</b>
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
        <section className="driver-approval-card" id="admin-drivers">
          <div className="card-title">
            <div>
              <span>CADASTROS</span>
              <h2>Aprovação de motoristas</h2>
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
                    {driver.approval_status === "approved" && !driver.profiles?.blocked && (
                      <div className="approval-actions">
                        <Button disabled={busyId === driver.profile_id} variant="outline" onClick={() => decide(driver.profile_id, "blocked")}>Bloquear</Button>
                      </div>
                    )}
                    {driver.profiles?.blocked && (
                      <div className="approval-actions">
                        <Button disabled={busyId === driver.profile_id} variant="outline" onClick={() => decide(driver.profile_id, "pending")}>Desbloquear para revisão</Button>
                      </div>
                    )}
                    {driver.approval_status === "rejected" && !driver.profiles?.blocked && (
                      <div className="approval-actions">
                        <Button disabled={busyId === driver.profile_id || !vehicle} onClick={() => decide(driver.profile_id, "approved")}>Aprovar</Button>
                      </div>
                    )}
                    {!driver.profiles?.blocked && driver.approval_status !== "approved" && (
                      <div className="approval-actions">
                        <Button disabled={busyId === driver.profile_id} variant="outline" onClick={() => decide(driver.profile_id, "blocked")}>Bloquear</Button>
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
        <section className="trips-card" id="admin-rides">
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
                  <span>
                    <b>{money(trip.final_fare_cents ?? trip.fare_cents)}</b>
                    {trip.status === "finalizada" && trip.payment_method === "cash" &&
                      trip.payment_status === "aguardando_pagamento" && (
                        <button type="button" disabled={busyId === trip.id}
                          onClick={() => void confirmAdminCash(trip.id)}>
                          {busyId === trip.id ? "Confirmando…" : "Confirmar dinheiro"}
                        </button>
                      )}
                  </span>
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
      {quickPlaceMapOpen && (
        <div className="map-picker-overlay" role="dialog" aria-modal="true" aria-labelledby="quick-place-map-title">
          <div className="map-picker-sheet quick-place-map-picker">
            <header>
              <div>
                <small>COORDENADA OFICIAL DO PONTO</small>
                <h2 id="quick-place-map-title">Definir localização no mapa</h2>
              </div>
              <button type="button" onClick={() => setQuickPlaceMapOpen(false)} aria-label="Fechar mapa">
                <X />
              </button>
            </header>
            <p>Toque no prédio ou na entrada correta. Arraste o PIN para fazer o ajuste fino antes de confirmar.</p>
            <div className="map-picker-canvas">
              <RealMap pickPoint={quickPlaceMapPoint} onPick={setQuickPlaceMapPoint} />
            </div>
            <div className="map-picker-coordinates">
              <MapPin /> {quickPlaceMapPoint.lat.toFixed(7)}, {quickPlaceMapPoint.lng.toFixed(7)}
            </div>
            <div className="map-picker-actions">
              <button type="button" onClick={() => setQuickPlaceMapOpen(false)}>Cancelar</button>
              <button type="button" onClick={confirmQuickPlaceMap}>Usar esta localização</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const backend = useMotoVip();
  const [recoverableOfflineRide, setRecoverableOfflineRide] = useState<OfflineRidePackage | null>(null);
  const backendRef = useRef(backend);
  const pushContextOpened = useRef(false);
  useEffect(() => { backendRef.current = backend; }, [backend]);
  useEffect(() => {
    const userId = backend.session?.user.id;
    if (!userId) return;
    let active = true;
    void getOfflineRide(userId).then((data) => { if (active) setRecoverableOfflineRide(data); }).catch(() => undefined);
    return () => { active = false; };
  }, [backend.session?.user.id]);
  useEffect(() => {
    if (backend.loading || !backend.session || pushContextOpened.current) return;
    const url = new URL(window.location.href);
    const open = url.searchParams.get("open");
    if (open !== "notifications" && open !== "driver-queue") return;
    pushContextOpened.current = true;
    void backendRef.current.refresh().catch(() => undefined).finally(() => {
      if (open === "driver-queue" && backendRef.current.profile?.role === "driver") {
        document.dispatchEvent(new Event("moto-pombal:open-driver-queue"));
      } else {
        document.dispatchEvent(new Event("moto-syxp:open-notifications"));
        const panel = document.querySelector<HTMLDetailsElement>(".notification-panel");
        if (panel instanceof HTMLDetailsElement) panel.open = true;
      }
      url.searchParams.delete("open");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    });
  }, [backend.loading, backend.session]);
  const role = backend.profile?.role || (recoverableOfflineRide?.driverId === backend.session?.user.id ? "driver" : "passenger");
  const contextLabel =
    role === "passenger"
      ? "Passageiro"
      : role === "driver"
        ? "Motorista"
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
        onSignIn={async (phone, password) => {
          const { error } = await backend.signIn(phone, password);
          return { error };
        }}
        onSignUp={async (input) => {
          const { error } = await backend.signUp(input);
          return { error, message: error ? undefined : "Conta criada. Entrando…" };
        }}
        onReset={async (phone) => {
          const { error, message } = await backend.resetPassword(phone);
          return {
            error,
            message: error ? undefined : message,
          };
        }}
      />
    );
  return (
    <Tabs value={role} className={`app-root app-role-${role}`}>
      <header className="topbar">
        {role === "passenger" && (
          <details className="mobile-menu">
            <summary aria-label="Abrir menu">
              <Menu />
            </summary>
            <nav>
              <button type="button" onClick={() => document.dispatchEvent(new Event("moto-syxp:open-destination"))}>
                <Bike /> Pedir corrida
              </button>
              <Link href="/passageiro/corridas">
                <History /> Minhas corridas
              </Link>
              <Link href="/passageiro/cupons">
                <Ticket /> Cupons
              </Link>
              <Link href="/passageiro/notificacoes">
                <Bell /> Notificações
                {backend.unreadNotifications > 0 && <b className="menu-unread-count">{backend.unreadNotifications}</b>}
              </Link>
              <Link href="/passageiro/suporte">
                <Headphones /> Suporte
              </Link>
            </nav>
          </details>
        )}
        <Brand />
        {role === "passenger" && (
          <div className="motovip-mobile-brand" aria-label="MotoPombal">
            <Image src="/brand/motopombal-wordmark.png" alt="MotoPombal" width={360} height={180} priority />
          </div>
        )}
        {role === "passenger" ? (
          <>
            <nav
              className="passenger-top-nav"
              aria-label="Navegação do passageiro"
            >
              <a className="active" href="#destination-address">
                <HomeIcon /> Início
              </a>
              <Link href="/passageiro/corridas">
                <History /> Minhas corridas
              </Link>
              <Link href="/passageiro/cupons">
                <Ticket /> Cupons
              </Link>
              <Link href="/passageiro/notificacoes">
                <Bell /> Notificações
                {backend.unreadNotifications > 0 && (
                  <b>{backend.unreadNotifications}</b>
                )}
              </Link>
              <Link href="/passageiro/suporte">
                <Headphones /> Suporte
              </Link>
            </nav>
            <button className="mobile-announcements" type="button" aria-label={`Notificações${backend.unreadNotifications ? `: ${backend.unreadNotifications} não lidas` : ""}`} onClick={() => document.dispatchEvent(new Event("moto-syxp:open-notifications"))}>
              <Bell />{backend.unreadNotifications > 0 && <i aria-hidden="true" />}
            </button>
            <button className="mobile-profile-trigger" type="button" aria-label="Abrir minha conta" onClick={() => document.dispatchEvent(new Event("moto-syxp:open-profile"))}>
              {backend.passengerAvatarUrl ? <AvatarPhoto src={backend.passengerAvatarUrl} alt="Minha conta" fallback={initials(backend.profile?.full_name)} sizes="48px" /> : <UserRound />}
            </button>
          </>
        ) : (
          <TabsList className="role-switch" aria-label="Ambiente autorizado">
            {backend.profile?.role === "driver" && (
              <TabsTrigger value="driver">
                <Bike /> Motorista
              </TabsTrigger>
            )}
            {backend.profile?.role === "admin" && (
              <TabsTrigger value="admin">
                <Gauge /> Central
              </TabsTrigger>
            )}
          </TabsList>
        )}
        <details className="account-actions">
          <summary aria-label="Abrir menu da conta">
            <span className="account-avatar">
              {role === "passenger" && backend.passengerAvatarUrl ? <AvatarPhoto src={backend.passengerAvatarUrl} alt="Minha conta" fallback={initials(backend.profile?.full_name)} sizes="48px" /> : <UserRound />}
            </span>
            <span className="account-copy">
              <b>{backend.profile?.full_name || contextLabel}</b>
              <small>{contextLabel}</small>
            </span>
            <ChevronRight />
          </summary>
          <div>
            {role === "passenger" && <button type="button" onClick={() => document.dispatchEvent(new Event("moto-syxp:open-profile"))}>Central do Passageiro</button>}
            <a href="/?conta=2" target="_blank" rel="noopener noreferrer" onClick={prepareOtherAccountLink}>Abrir outra conta em nova aba</a>
            <button onClick={() => backend.signOut()}>Sair da conta</button>
          </div>
        </details>
      </header>
      {backend.error && <div className="backend-warning">{backend.error}</div>}
      {backend.profile?.blocked && <div className="backend-warning" role="alert">Conta bloqueada pela central. Novas corridas e ações administrativas estão indisponíveis. {backend.activeRide ? "A corrida em andamento permanece acessível para conclusão ou cancelamento seguro." : "Entre em contato com o suporte."}</div>}
      <TabsContent value="passenger" className="screen">
        <PassengerPanel backend={backend} />
      </TabsContent>
      <TabsContent value="driver" className="screen">
        <DriverPanel backend={backend} />
      </TabsContent>
      <TabsContent value="admin" className="screen">
        <AdminOperationsPanel backend={backend} />
      </TabsContent>
    </Tabs>
  );
}
