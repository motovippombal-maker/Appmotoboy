"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Bike,
  Check,
  Clock3,
  Heart,
  MapPin,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Star,
  Trash2,
  Utensils,
} from "lucide-react";
import { deliveryApi } from "@/lib/delivery/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AddressResult } from "@/hooks/use-moto-vip";
import type { LivePoint } from "@/components/map/real-map";
import "@/app/delivery.css";

const RealMap = dynamic(
  () => import("@/components/map/real-map").then((module) => module.RealMap),
  { ssr: false },
);
const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
type Restaurant = {
  id: string;
  name: string;
  description?: string;
  cuisine: string;
  address: string;
  logo_url?: string | null;
  cover_url?: string | null;
  accepting_orders: boolean;
  open: boolean;
  preparation_minutes: number;
  minimum_order_cents: number;
  rating: number | null;
  ratingCount: number;
};
type Option = {
  id: string;
  name: string;
  price_cents: number;
  available: boolean;
};
type Group = {
  id: string;
  name: string;
  min_choices: number;
  max_choices: number;
  menu_options: Option[];
};
type Product = {
  id: string;
  category_id: string | null;
  name: string;
  description?: string;
  image_url?: string | null;
  price_cents: number;
  available: boolean;
  menu_option_groups: Group[];
};
type ProductMatch = {
  id: string;
  name: string;
  price_cents: number;
  restaurant_id: string;
  restaurants: { id: string; name: string };
};
type CartItem = {
  productId: string;
  name: string;
  quantity: number;
  optionIds: string[];
  optionNames: string[];
  unitCents: number;
  notes: string;
};
type Address = {
  street: string;
  number: string;
  district: string;
  complement: string;
  reference: string;
  postalCode: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
};
type SavedAddress = { id: string; label: string; address: Address };
type Order = {
  id: string;
  restaurant_id: string;
  order_number: number;
  status: string;
  payment_method: string;
  payment_status: string;
  total_cents: number;
  subtotal_cents: number;
  delivery_fee_cents: number;
  restaurant_snapshot: { name: string; lat?: number; lng?: number };
  address?: { lat: number; lng: number };
  deliveryLocation?: {
    latitude: number;
    longitude: number;
    updated_at: string;
  } | null;
  created_at: string;
  food_order_items?: Array<{
    product_id: string | null;
    name: string;
    quantity: number;
    line_total_cents: number;
    options: Array<{ id: string; name: string }>;
    notes?: string;
  }>;
  food_order_events?: Array<{ to_status: string; created_at: string }>;
  food_reviews?: Array<{
    restaurant_score: number;
    delivery_score: number | null;
  }>;
  drivers?: {
    profiles?: { full_name: string };
    vehicles?: Array<{ brand: string; model: string; plate: string }>;
  };
};
type View = "browse" | "menu" | "cart" | "checkout" | "orders" | "tracking";
const statusNames: Record<string, string> = {
  received: "Pedido recebido",
  accepted: "Aceito pelo restaurante",
  preparing: "Em preparação",
  ready: "Pronto para retirada",
  assigned: "Entregador designado",
  at_restaurant: "Entregador no restaurante",
  picked_up: "Pedido retirado",
  on_the_way: "A caminho",
  delivered: "Entregue",
  rejected: "Recusado",
  cancelled: "Cancelado",
  delivery_failed: "Entrega não concluída",
};

export function DeliveryCustomer() {
  const [userId, setUserId] = useState("");
  const [view, setView] = useState<View>("browse");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [productMatches, setProductMatches] = useState<ProductMatch[]>([]);
  const [selectedCuisine, setSelectedCuisine] = useState("");
  const [restaurantCount, setRestaurantCount] = useState(0);
  const [restaurantPage, setRestaurantPage] = useState(0);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartRestaurant, setCartRestaurant] = useState("");
  const [cartOwner, setCartOwner] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState<Address>({
    street: "",
    number: "",
    district: "",
    complement: "",
    reference: "",
    postalCode: "",
    city: "Ribeira do Pombal",
    state: "BA",
    lat: null,
    lng: null,
  });
  const [addressResults, setAddressResults] = useState<AddressResult[]>([]);
  const [addressSearch, setAddressSearch] = useState("");
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [savedAddressOwner, setSavedAddressOwner] = useState("");
  const [addressLabel, setAddressLabel] = useState("Casa");
  const [quote, setQuote] = useState<{
    subtotalCents: number;
    deliveryFeeCents: number;
    totalCents: number;
    durationSeconds: number;
    preparationMinutes: number;
  } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "card_on_delivery"
  >("cash");
  const [paymentConfig, setPaymentConfig] = useState({
    enabled: false,
    cashEnabled: true,
    cardOnDeliveryEnabled: false,
  });
  const [changeFor, setChangeFor] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [restaurantScore, setRestaurantScore] = useState(5);
  const [deliveryScore, setDeliveryScore] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    void client.auth
      .getSession()
      .then(({ data }) => setUserId(data.session?.user.id || ""));
    const { data: listener } = client.auth.onAuthStateChange(
      (_event, session) => setUserId(session?.user.id || ""),
    );
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!userId) return;
    const timer = window.setTimeout(() => {
      try {
        const stored = JSON.parse(
          sessionStorage.getItem(`motopombal:food-cart:${userId}`) || "null",
        ) as { restaurantId: string; items: CartItem[] } | null;
        setCart(stored && Array.isArray(stored.items) ? stored.items : []);
        setCartRestaurant(stored?.restaurantId || "");
      } catch {
        /* Carrinho local inválido é descartado. */
      }
      setCartOwner(userId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [userId]);
  useEffect(() => {
    if (userId && cartOwner === userId)
      sessionStorage.setItem(
        `motopombal:food-cart:${userId}`,
        JSON.stringify({ restaurantId: cartRestaurant, items: cart }),
      );
  }, [userId, cartOwner, cartRestaurant, cart]);

  const loadRestaurants = useCallback(async (search = "", page = 0) => {
    const response = await fetch(
      `/api/delivery/restaurants?q=${encodeURIComponent(search)}&page=${page}`,
    );
    const result = (await response.json()) as {
      restaurants?: Restaurant[];
      products?: ProductMatch[];
      count?: number;
      message?: string;
    };
    if (!response.ok)
      throw new Error(result.message || "Falha ao buscar restaurantes.");
    setRestaurants(result.restaurants || []);
    setProductMatches(result.products || []);
    setRestaurantCount(result.count || 0);
    setRestaurantPage(page);
  }, []);
  useEffect(() => {
    void Promise.resolve()
      .then(() => loadRestaurants())
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Falha ao buscar restaurantes.",
        ),
      );
  }, [loadRestaurants]);
  useEffect(() => {
    if (!userId) return;
    void deliveryApi<{ ids: string[] }>("/api/delivery/favorites")
      .then((result) => setFavorites(result.ids))
      .catch(() => undefined);
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void deliveryApi<{ addresses: SavedAddress[] }>("/api/delivery/addresses")
      .then((result) => {
        if (!cancelled) {
          setSavedAddresses(result.addresses);
          setSavedAddressOwner(userId);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);
  useEffect(() => {
    void fetch("/api/delivery/config")
      .then(
        (response) =>
          response.json() as Promise<{
            enabled?: boolean;
            cashEnabled?: boolean;
            cardOnDeliveryEnabled?: boolean;
          }>,
      )
      .then((config) => {
        setPaymentConfig({
          enabled: !!config.enabled,
          cashEnabled: !!config.cashEnabled,
          cardOnDeliveryEnabled: !!config.cardOnDeliveryEnabled,
        });
        if (!config.cashEnabled && config.cardOnDeliveryEnabled)
          setPaymentMethod("card_on_delivery");
      })
      .catch(() => undefined);
  }, []);

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.unitCents * item.quantity, 0),
    [cart],
  );
  const selectedPrice = selected
    ? selected.price_cents +
      selected.menu_option_groups
        .flatMap((group) => group.menu_options)
        .filter((option) => selectedOptions.includes(option.id))
        .reduce((sum, option) => sum + option.price_cents, 0)
    : 0;
  const currentRestaurant =
    restaurant ||
    restaurants.find((entry) => entry.id === cartRestaurant) ||
    null;
  async function toggleFavorite(id: string) {
    setError("");
    try {
      if (favorites.includes(id)) {
        await deliveryApi(
          `/api/delivery/favorites?restaurantId=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        setFavorites((previous) => previous.filter((item) => item !== id));
      } else {
        await deliveryApi("/api/delivery/favorites", {
          method: "POST",
          body: JSON.stringify({ restaurantId: id }),
        });
        setFavorites((previous) => [...previous, id]);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível alterar favoritos.",
      );
    }
  }
  async function submitReview() {
    if (!activeOrder) return;
    setBusy(true);
    setError("");
    try {
      await deliveryApi("/api/delivery/reviews", {
        method: "POST",
        body: JSON.stringify({
          orderId: activeOrder.id,
          restaurantScore,
          deliveryScore: activeOrder.drivers ? deliveryScore : null,
          comment: reviewComment,
        }),
      });
      await refreshOrder(activeOrder.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Avaliação não registrada.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function repeatOrder() {
    if (!activeOrder) return;
    setBusy(true);
    setError("");
    try {
      if (
        cartRestaurant &&
        cartRestaurant !== activeOrder.restaurant_id &&
        !window.confirm("Substituir o carrinho de outro restaurante?")
      )
        return;
      const response = await fetch(
        `/api/delivery/restaurants/${activeOrder.restaurant_id}`,
      );
      const detail = (await response.json()) as {
        restaurant?: Restaurant;
        products?: Product[];
        message?: string;
      };
      if (!response.ok || !detail.restaurant || !detail.products)
        throw new Error(detail.message || "Cardápio indisponível.");
      const current = new Map(
        detail.products.map((product) => [product.id, product]),
      );
      const restored: CartItem[] = [];
      for (const item of activeOrder.food_order_items || []) {
        const product = item.product_id ? current.get(item.product_id) : null;
        if (!product?.available) continue;
        const optionIds = (item.options || []).map((option) => option.id);
        let optionPrice = 0;
        let valid = true;
        for (const group of product.menu_option_groups) {
          const chosen = group.menu_options.filter((option) =>
            optionIds.includes(option.id),
          );
          if (
            chosen.length < group.min_choices ||
            chosen.length > group.max_choices ||
            chosen.some((option) => !option.available)
          )
            valid = false;
          optionPrice += chosen.reduce(
            (sum, option) => sum + option.price_cents,
            0,
          );
        }
        if (
          !valid ||
          optionIds.length !==
            product.menu_option_groups
              .flatMap((group) => group.menu_options)
              .filter((option) => optionIds.includes(option.id)).length
        )
          continue;
        restored.push({
          productId: product.id,
          name: product.name,
          quantity: item.quantity,
          optionIds,
          optionNames: product.menu_option_groups
            .flatMap((group) => group.menu_options)
            .filter((option) => optionIds.includes(option.id))
            .map((option) => option.name),
          unitCents: product.price_cents + optionPrice,
          notes: item.notes || "",
        });
      }
      if (!restored.length)
        throw new Error("Os itens deste pedido não estão mais disponíveis.");
      setRestaurant(detail.restaurant);
      setProducts(detail.products);
      setCart(restored);
      setCartRestaurant(activeOrder.restaurant_id);
      setQuote(null);
      setView("cart");
      if (restored.length !== activeOrder.food_order_items?.length)
        setError(
          "Alguns itens ou adicionais não estão mais disponíveis e foram omitidos. Revise o carrinho.",
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível repetir o pedido.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openRestaurant(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/delivery/restaurants/${id}`);
      const result = (await response.json()) as {
        restaurant: Restaurant;
        products: Product[];
        categories: Array<{ id: string; name: string }>;
        message?: string;
      };
      if (!response.ok)
        throw new Error(result.message || "Restaurante indisponível.");
      setRestaurant(result.restaurant);
      setProducts(result.products);
      setCategories(result.categories);
      setView("menu");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao carregar cardápio.",
      );
    } finally {
      setBusy(false);
    }
  }
  function addProduct() {
    if (!selected || !restaurant) return;
    for (const group of selected.menu_option_groups) {
      const count = group.menu_options.filter((option) =>
        selectedOptions.includes(option.id),
      ).length;
      if (count < group.min_choices || count > group.max_choices) {
        setError(`Revise as escolhas em ${group.name}.`);
        return;
      }
    }
    if (
      cartRestaurant &&
      cartRestaurant !== restaurant.id &&
      !window.confirm(
        "Seu carrinho contém produtos de outro restaurante. Substituir o carrinho?",
      )
    )
      return;
    const optionNames = selected.menu_option_groups
      .flatMap((group) => group.menu_options)
      .filter((option) => selectedOptions.includes(option.id))
      .map((option) => option.name);
    const next = {
      productId: selected.id,
      name: selected.name,
      quantity,
      optionIds: selectedOptions,
      optionNames,
      unitCents: selectedPrice,
      notes,
    };
    setCart((previous) =>
      cartRestaurant && cartRestaurant !== restaurant.id
        ? [next]
        : [...previous, next],
    );
    setCartRestaurant(restaurant.id);
    setSelected(null);
    setSelectedOptions([]);
    setQuantity(1);
    setNotes("");
    setQuote(null);
    setError("");
  }
  function cartPayload() {
    if (!cartRestaurant || address.lat === null || address.lng === null)
      throw new Error("Selecione e confirme o ponto de entrega no mapa.");
    return {
      restaurantId: cartRestaurant,
      idempotencyKey,
      items: cart.map(({ productId, quantity, optionIds, notes }) => ({
        productId,
        quantity,
        optionIds,
        notes,
      })),
      address: { ...address, lat: address.lat, lng: address.lng },
      paymentMethod,
      changeForCents:
        paymentMethod === "cash" && changeFor
          ? Math.round(Number(changeFor.replace(",", ".")) * 100)
          : null,
    };
  }
  async function calculateQuote() {
    setBusy(true);
    setError("");
    setQuote(null);
    try {
      setQuote(
        await deliveryApi("/api/delivery/quote", {
          method: "POST",
          body: JSON.stringify(cartPayload()),
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Cotação indisponível.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function confirmOrder() {
    if (!quote) return;
    setBusy(true);
    setError("");
    try {
      const result = await deliveryApi<{ order: Order }>(
        "/api/delivery/orders",
        {
          method: "POST",
          body: JSON.stringify({
            ...cartPayload(),
            expectedSubtotalCents: quote.subtotalCents,
            expectedDeliveryFeeCents: quote.deliveryFeeCents,
          }),
        },
      );
      setActiveOrder(result.order);
      setCart([]);
      setCartRestaurant("");
      setQuote(null);
      setIdempotencyKey(crypto.randomUUID());
      setView("tracking");
      void refreshOrder(result.order.id).catch(() => undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Pedido não confirmado.",
      );
      setQuote(null);
    } finally {
      setBusy(false);
    }
  }
  async function loadOrders() {
    setBusy(true);
    setError("");
    try {
      const result = await deliveryApi<{ orders: Order[] }>(
        "/api/delivery/orders",
      );
      setOrders(result.orders);
      setView("orders");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao carregar pedidos.",
      );
    } finally {
      setBusy(false);
    }
  }
  const refreshOrder = useCallback(async (id: string) => {
    const result = await deliveryApi<{ order: Order }>(
      `/api/delivery/orders/${id}`,
    );
    setActiveOrder(result.order);
  }, []);
  const activeOrderId = activeOrder?.id;
  const activeOrderStatus = activeOrder?.status;
  useEffect(() => {
    if (
      view !== "tracking" ||
      !activeOrderId ||
      ["delivered", "cancelled", "rejected", "delivery_failed"].includes(
        activeOrderStatus || "",
      )
    )
      return;
    const id = activeOrderId;
    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`food-order-${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "food_orders",
          filter: `id=eq.${id}`,
        },
        () => {
          void refreshOrder(id).catch(() => undefined);
        },
      )
      .subscribe();
    const timer = window.setInterval(() => {
      void refreshOrder(id).catch(() => undefined);
    }, 15000);
    return () => {
      window.clearInterval(timer);
      void client.removeChannel(channel);
    };
  }, [view, activeOrderId, activeOrderStatus, refreshOrder]);
  async function searchAddress() {
    setBusy(true);
    setError("");
    try {
      const result = await deliveryApi<{ results: AddressResult[] }>(
        `/api/maps/search?q=${encodeURIComponent(addressSearch)}`,
      );
      setAddressResults(result.results || []);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Endereço não encontrado.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveAddress() {
    if (address.lat === null || address.lng === null) {
      setError("Marque o ponto de entrega no mapa antes de salvar.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await deliveryApi<{ address: SavedAddress }>(
        "/api/delivery/addresses",
        {
          method: "POST",
          body: JSON.stringify({ label: addressLabel, address }),
        },
      );
      setSavedAddresses((previous) =>
        savedAddressOwner === userId
          ? [result.address, ...previous]
          : [result.address],
      );
      setSavedAddressOwner(userId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Endereço não salvo.");
    } finally {
      setBusy(false);
    }
  }
  async function removeAddress(id: string) {
    setBusy(true);
    setError("");
    try {
      await deliveryApi("/api/delivery/addresses", {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
      setSavedAddresses((previous) =>
        previous.filter((item) => item.id !== id),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Endereço não removido.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="delivery-app">
      <header className="delivery-header">
        <Link href="/" aria-label="Voltar ao MotoPombal">
          <ArrowLeft />
        </Link>
        <span>
          <b>MotoPombal</b>
          <small>Comida na sua porta</small>
        </span>
        <button
          type="button"
          onClick={() => setView("cart")}
          aria-label="Abrir carrinho"
        >
          <ShoppingBag />
          {cart.length > 0 && (
            <b>{cart.reduce((sum, item) => sum + item.quantity, 0)}</b>
          )}
        </button>
      </header>
      <nav className="delivery-nav">
        <button
          className={view === "browse" || view === "menu" ? "active" : ""}
          onClick={() => setView("browse")}
        >
          <Utensils /> Restaurantes
        </button>
        <button
          className={view === "orders" || view === "tracking" ? "active" : ""}
          onClick={() => void loadOrders()}
        >
          <Clock3 /> Pedidos
        </button>
        <Link href="/">
          <Bike /> Pedir moto
        </Link>
      </nav>
      {error && (
        <p className="delivery-error" role="alert">
          {error}
        </p>
      )}
      {!userId && (
        <p className="delivery-notice">
          Entre na sua conta MotoPombal para fazer pedidos.{" "}
          <Link href="/">Acessar conta</Link>
        </p>
      )}
      {!paymentConfig.enabled && (
        <p className="delivery-notice" role="status">
          Os pedidos de comida ainda não estão disponíveis. Você pode conhecer
          os restaurantes enquanto a operação é configurada.
        </p>
      )}
      {view === "browse" && (
        <section className="delivery-section">
          <div className="delivery-hero">
            <small>DELIVERY MOTO POMBAL</small>
            <h1>O que vamos pedir hoje?</h1>
            <p>
              Escolha um restaurante parceiro e acompanhe seu pedido pelo mesmo
              aplicativo.
            </p>
          </div>
          <form
            className="delivery-search"
            onSubmit={(event) => {
              event.preventDefault();
              void loadRestaurants(query, 0).catch((cause: unknown) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Busca indisponível.",
                ),
              );
            }}
          >
            <Search />
            <input
              aria-label="Buscar restaurante ou categoria"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Restaurante ou tipo de comida"
            />
            <button>Buscar</button>
          </form>
          {productMatches.length > 0 && (
            <>
              <h2>Produtos encontrados</h2>
              <div className="delivery-grid">
                {productMatches.map((match) => (
                  <button
                    className="delivery-product"
                    key={match.id}
                    onClick={() => void openRestaurant(match.restaurant_id)}
                  >
                    <b>{match.name}</b>
                    <small>{match.restaurants.name}</small>
                    <span>{money(match.price_cents)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <h2>Restaurantes parceiros</h2>
          <div className="delivery-cuisines">
            <button
              className={!selectedCuisine ? "active" : ""}
              onClick={() => setSelectedCuisine("")}
            >
              Todos
            </button>
            {[...new Set(restaurants.map((entry) => entry.cuisine))].map(
              (cuisine) => (
                <button
                  className={selectedCuisine === cuisine ? "active" : ""}
                  key={cuisine}
                  onClick={() => setSelectedCuisine(cuisine)}
                >
                  {cuisine}
                </button>
              ),
            )}
          </div>
          <button
            className="delivery-secondary"
            onClick={() => setOnlyFavorites((value) => !value)}
          >
            <Heart /> {onlyFavorites ? "Ver todos" : "Meus favoritos"}
          </button>
          <button
            className="delivery-secondary"
            onClick={() => setOnlyOpen((value) => !value)}
          >
            {onlyOpen ? "Ver abertos e fechados" : "Aberto agora"}
          </button>
          {restaurants.length === 0 && (
            <p>Nenhum restaurante aprovado disponível no momento.</p>
          )}
          <div className="delivery-grid">
            {restaurants
              .filter(
                (entry) =>
                  (!onlyFavorites || favorites.includes(entry.id)) &&
                  (!onlyOpen || entry.open) &&
                  (!selectedCuisine || entry.cuisine === selectedCuisine),
              )
              .map((entry) => (
                <button
                  className="delivery-restaurant"
                  key={entry.id}
                  onClick={() => void openRestaurant(entry.id)}
                >
                  <span className="delivery-restaurant-icon">
                    {entry.logo_url ? (
                      <Image
                        src={entry.logo_url}
                        alt=""
                        fill
                        sizes="45px"
                        unoptimized
                      />
                    ) : (
                      <Utensils />
                    )}
                  </span>
                  <span>
                    <b>{entry.name}</b>
                    <small>
                      {entry.cuisine} · {entry.preparation_minutes} min de
                      preparo
                    </small>
                    <small>
                      {entry.rating === null
                        ? "Sem avaliações"
                        : `★ ${entry.rating} (${entry.ratingCount})`}
                    </small>
                    <small>
                      {entry.open
                        ? "Aceitando pedidos"
                        : "Fechado para pedidos"}
                    </small>
                  </span>
                  <span>Ver cardápio →</span>
                </button>
              ))}
          </div>
          {restaurantCount > 20 && (
            <div className="delivery-pagination">
              <button
                disabled={restaurantPage === 0}
                onClick={() => void loadRestaurants(query, restaurantPage - 1)}
              >
                Anterior
              </button>
              <span>
                Página {restaurantPage + 1} de {Math.ceil(restaurantCount / 20)}
              </span>
              <button
                disabled={(restaurantPage + 1) * 20 >= restaurantCount}
                onClick={() => void loadRestaurants(query, restaurantPage + 1)}
              >
                Próxima
              </button>
            </div>
          )}
          <p className="delivery-fineprint">
            A taxa de entrega é calculada após selecionar seu endereço.
          </p>
        </section>
      )}
      {view === "menu" && restaurant && (
        <section className="delivery-section">
          <button className="delivery-back" onClick={() => setView("browse")}>
            ‹ Restaurantes
          </button>
          <h1>{restaurant.name}</h1>
          {restaurant.cover_url && (
            <div className="delivery-cover">
              <Image
                src={restaurant.cover_url}
                alt={`Capa de ${restaurant.name}`}
                fill
                sizes="(max-width: 700px) 100vw, 900px"
                unoptimized
              />
            </div>
          )}
          <button
            className="delivery-secondary"
            onClick={() => void toggleFavorite(restaurant.id)}
          >
            <Heart />{" "}
            {favorites.includes(restaurant.id)
              ? "Remover dos favoritos"
              : "Favoritar"}
          </button>
          <p>{restaurant.description || restaurant.cuisine}</p>
          <p className="delivery-meta">
            <Clock3 /> {restaurant.preparation_minutes} min de preparo · Pedido
            mínimo {money(restaurant.minimum_order_cents)}
          </p>
          {!restaurant.open && (
            <p className="delivery-notice">
              Este restaurante não está recebendo pedidos agora.
            </p>
          )}
          {categories.map((category) => (
            <div key={category.id}>
              <h2>{category.name}</h2>
              <div className="delivery-grid">
                {products
                  .filter((product) => product.category_id === category.id)
                  .map((product) => (
                    <button
                      className="delivery-product"
                      key={product.id}
                      disabled={
                        !product.available ||
                        !restaurant.open ||
                        !paymentConfig.enabled
                      }
                      onClick={() => {
                        setSelected(product);
                        setSelectedOptions([]);
                        setQuantity(1);
                        setNotes("");
                        setError("");
                      }}
                    >
                      {product.image_url && (
                        <span className="delivery-product-image">
                          <Image
                            src={product.image_url}
                            alt=""
                            fill
                            sizes="260px"
                            unoptimized
                          />
                        </span>
                      )}
                      <b>{product.name}</b>
                      <small>{product.description}</small>
                      <span>
                        {product.available
                          ? money(product.price_cents)
                          : "Esgotado"}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
          <h2>Outros itens</h2>
          <div className="delivery-grid">
            {products
              .filter((product) => !product.category_id)
              .map((product) => (
                <button
                  className="delivery-product"
                  key={product.id}
                  disabled={
                    !product.available ||
                    !restaurant.open ||
                    !paymentConfig.enabled
                  }
                  onClick={() => {
                    setSelected(product);
                    setSelectedOptions([]);
                    setQuantity(1);
                    setNotes("");
                  }}
                >
                  {product.image_url && (
                    <span className="delivery-product-image">
                      <Image
                        src={product.image_url}
                        alt=""
                        fill
                        sizes="260px"
                        unoptimized
                      />
                    </span>
                  )}
                  <b>{product.name}</b>
                  <small>{product.description}</small>
                  <span>
                    {product.available
                      ? money(product.price_cents)
                      : "Esgotado"}
                  </span>
                </button>
              ))}
          </div>
        </section>
      )}
      {selected && (
        <div className="delivery-modal-backdrop">
          <section
            className="delivery-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Personalizar ${selected.name}`}
          >
            <button
              className="delivery-close"
              aria-label="Fechar personalização"
              onClick={() => setSelected(null)}
            >
              ✕
            </button>
            <h2>{selected.name}</h2>
            <p>{selected.description}</p>
            {selected.menu_option_groups.map((group) => (
              <fieldset key={group.id}>
                <legend>
                  {group.name}{" "}
                  <small>
                    Escolha de {group.min_choices} a {group.max_choices}
                  </small>
                </legend>
                {group.menu_options
                  .filter((option) => option.available)
                  .map((option) => (
                    <label key={option.id}>
                      <input
                        type="checkbox"
                        checked={selectedOptions.includes(option.id)}
                        onChange={(event) =>
                          setSelectedOptions((previous) =>
                            event.target.checked
                              ? [...previous, option.id]
                              : previous.filter((id) => id !== option.id),
                          )
                        }
                      />
                      {option.name}
                      <span>+ {money(option.price_cents)}</span>
                    </label>
                  ))}
              </fieldset>
            ))}
            <label className="delivery-field">
              Observações
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={300}
                placeholder="Ex.: sem cebola"
              />
            </label>
            <div className="delivery-stepper">
              <button
                aria-label="Diminuir quantidade"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
              >
                <Minus />
              </button>
              <b>{quantity}</b>
              <button
                aria-label="Aumentar quantidade"
                onClick={() => setQuantity(Math.min(99, quantity + 1))}
              >
                <Plus />
              </button>
            </div>
            <button className="delivery-primary" onClick={addProduct}>
              Adicionar · {money(selectedPrice * quantity)}
            </button>
          </section>
        </div>
      )}
      {view === "cart" && (
        <section className="delivery-section">
          <button
            className="delivery-back"
            onClick={() => setView(restaurant ? "menu" : "browse")}
          >
            ‹ Voltar
          </button>
          <h1>Meu carrinho</h1>
          {cart.length === 0 ? (
            <p>Seu carrinho está vazio.</p>
          ) : (
            <>
              <p>{currentRestaurant?.name || "Restaurante"}</p>
              {cart.map((item, index) => (
                <div
                  className="delivery-cart-item"
                  key={`${item.productId}-${index}`}
                >
                  <span>
                    <b>
                      {item.quantity}× {item.name}
                    </b>
                    <small>{item.optionNames.join(", ")}</small>
                    {item.notes && <small>{item.notes}</small>}
                  </span>
                  <div className="delivery-stepper">
                    <button
                      aria-label={`Diminuir ${item.name}`}
                      onClick={() =>
                        setCart((previous) =>
                          previous.map((entry, position) =>
                            position === index
                              ? {
                                  ...entry,
                                  quantity: Math.max(1, entry.quantity - 1),
                                }
                              : entry,
                          ),
                        )
                      }
                    >
                      <Minus />
                    </button>
                    <b>{item.quantity}</b>
                    <button
                      aria-label={`Aumentar ${item.name}`}
                      onClick={() =>
                        setCart((previous) =>
                          previous.map((entry, position) =>
                            position === index
                              ? {
                                  ...entry,
                                  quantity: Math.min(99, entry.quantity + 1),
                                }
                              : entry,
                          ),
                        )
                      }
                    >
                      <Plus />
                    </button>
                  </div>
                  <b>{money(item.unitCents * item.quantity)}</b>
                  <button
                    aria-label={`Remover ${item.name}`}
                    onClick={() =>
                      setCart((previous) =>
                        previous.filter((_, position) => position !== index),
                      )
                    }
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
              <div className="delivery-total">
                <span>Subtotal</span>
                <b>{money(subtotal)}</b>
              </div>
              <button
                className="delivery-primary"
                onClick={() => {
                  setView("checkout");
                  setQuote(null);
                }}
              >
                Continuar para entrega
              </button>
            </>
          )}
        </section>
      )}
      {view === "checkout" && (
        <section className="delivery-section">
          <button className="delivery-back" onClick={() => setView("cart")}>
            ‹ Carrinho
          </button>
          <h1>Confirmar pedido</h1>
          <p>
            {currentRestaurant?.name} · {cart.length} item(ns)
          </p>
          <h2>Endereço de entrega</h2>
          {userId &&
            savedAddressOwner === userId &&
            savedAddresses.length > 0 && (
              <div className="delivery-saved-addresses">
                <strong>Endereços salvos</strong>
                {savedAddresses.map((entry) => (
                  <div className="delivery-list-row" key={entry.id}>
                    <button
                      type="button"
                      className="delivery-secondary"
                      onClick={() => {
                        setAddress(entry.address);
                        setQuote(null);
                      }}
                    >
                      {entry.label} · {entry.address.street},{" "}
                      {entry.address.number}
                    </button>
                    <button
                      type="button"
                      className="delivery-danger"
                      aria-label={`Remover endereço ${entry.label}`}
                      disabled={busy}
                      onClick={() => void removeAddress(entry.id)}
                    >
                      Remover
                    </button>
                  </div>
                ))}
              </div>
            )}
          <div className="delivery-search">
            <Search />
            <input
              value={addressSearch}
              onChange={(event) => setAddressSearch(event.target.value)}
              placeholder="Busque rua, número e cidade"
            />
            <button
              type="button"
              disabled={busy || addressSearch.length < 3}
              onClick={() => void searchAddress()}
            >
              Buscar
            </button>
          </div>
          {addressResults.length > 0 && (
            <div className="delivery-results">
              {addressResults.slice(0, 5).map((result) => (
                <button
                  key={result.id}
                  onClick={() => {
                    setAddress((previous) => ({
                      ...previous,
                      street: result.shortAddress || result.address,
                      district: result.district || previous.district,
                      city: result.city || previous.city,
                      state: result.state || previous.state,
                      lat: result.lat,
                      lng: result.lng,
                    }));
                    setAddressResults([]);
                    setQuote(null);
                  }}
                >
                  <MapPin />
                  {result.address}
                </button>
              ))}
            </div>
          )}
          <div className="delivery-fields">
            {(
              [
                ["street", "Rua"],
                ["number", "Número"],
                ["district", "Bairro"],
                ["complement", "Complemento"],
                ["reference", "Referência"],
                ["postalCode", "CEP"],
                ["city", "Cidade"],
                ["state", "UF"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={address[key]}
                  onChange={(event) => {
                    setAddress((previous) => ({
                      ...previous,
                      [key]: event.target.value,
                      ...(key === "street" ||
                      key === "number" ||
                      key === "city" ||
                      key === "district"
                        ? { lat: null, lng: null }
                        : {}),
                    }));
                    setQuote(null);
                  }}
                />
              </label>
            ))}
          </div>
          <p className="delivery-meta">
            <Check />{" "}
            {address.lat !== null
              ? "Confira o ponto no mapa ou toque para corrigir."
              : "Toque no mapa para marcar o endereço exato."}
          </p>
          <div className="delivery-map">
            <RealMap
              pickPoint={
                address.lat !== null && address.lng !== null
                  ? { lat: address.lat, lng: address.lng }
                  : undefined
              }
              centerTarget={
                address.lat !== null && address.lng !== null
                  ? { lat: address.lat, lng: address.lng }
                  : { lat: -10.8373, lng: -38.5357 }
              }
              onPick={(point: LivePoint) => {
                setAddress((previous) => ({
                  ...previous,
                  lat: point.lat,
                  lng: point.lng,
                }));
                setQuote(null);
              }}
            />
          </div>
          {userId && (
            <div className="delivery-inline-form">
              <label>
                Nome deste endereço
                <input
                  value={addressLabel}
                  maxLength={50}
                  onChange={(event) => setAddressLabel(event.target.value)}
                  placeholder="Ex.: Casa"
                />
              </label>
              <button
                type="button"
                className="delivery-secondary"
                disabled={busy || address.lat === null || address.lng === null}
                onClick={() => void saveAddress()}
              >
                Salvar endereço
              </button>
            </div>
          )}
          <h2>Pagamento na entrega</h2>
          <div className="delivery-payments">
            {paymentConfig.cashEnabled && (
              <label>
                <input
                  type="radio"
                  checked={paymentMethod === "cash"}
                  onChange={() => {
                    setPaymentMethod("cash");
                    setQuote(null);
                  }}
                />{" "}
                Dinheiro
              </label>
            )}
            {paymentConfig.cardOnDeliveryEnabled && (
              <label>
                <input
                  type="radio"
                  checked={paymentMethod === "card_on_delivery"}
                  onChange={() => {
                    setPaymentMethod("card_on_delivery");
                    setQuote(null);
                  }}
                />{" "}
                Cartão na entrega
              </label>
            )}
            {!paymentConfig.cashEnabled &&
              !paymentConfig.cardOnDeliveryEnabled && (
                <p>Formas de pagamento ainda não configuradas.</p>
              )}
          </div>
          {paymentMethod === "cash" && paymentConfig.cashEnabled && (
            <label className="delivery-field">
              Troco para (opcional)
              <input
                inputMode="decimal"
                value={changeFor}
                onChange={(event) => {
                  setChangeFor(event.target.value);
                  setQuote(null);
                }}
                placeholder="Ex.: 50,00"
              />
            </label>
          )}
          <button
            className="delivery-secondary"
            disabled={
              busy ||
              !paymentConfig.enabled ||
              !cart.length ||
              (!paymentConfig.cashEnabled &&
                !paymentConfig.cardOnDeliveryEnabled)
            }
            onClick={() => void calculateQuote()}
          >
            {busy ? "Calculando…" : "Calcular entrega e total"}
          </button>
          {quote && (
            <div className="delivery-summary">
              <div>
                <span>Itens</span>
                <b>{money(quote.subtotalCents)}</b>
              </div>
              <div>
                <span>Entrega</span>
                <b>{money(quote.deliveryFeeCents)}</b>
              </div>
              <div>
                <span>Total</span>
                <b>{money(quote.totalCents)}</b>
              </div>
              <small>
                Preparo estimado: {quote.preparationMinutes} min · trajeto
                estimado: {Math.ceil(quote.durationSeconds / 60)} min
              </small>
              <button
                className="delivery-primary"
                disabled={busy}
                onClick={() => void confirmOrder()}
              >
                Confirmar pedido · {money(quote.totalCents)}
              </button>
            </div>
          )}
        </section>
      )}
      {view === "orders" && (
        <section className="delivery-section">
          <h1>Meus pedidos</h1>
          {orders.length === 0 && <p>Nenhum pedido registrado.</p>}
          {orders.map((order) => (
            <button
              className="delivery-order-card"
              key={order.id}
              onClick={() => {
                setActiveOrder(order);
                setView("tracking");
                void refreshOrder(order.id).catch(() => undefined);
              }}
            >
              <b>
                #{order.order_number} · {order.restaurant_snapshot.name}
              </b>
              <small>
                {statusNames[order.status] || order.status} ·{" "}
                {new Date(order.created_at).toLocaleString("pt-BR")}
              </small>
              <strong>{money(order.total_cents)}</strong>
            </button>
          ))}
        </section>
      )}
      {view === "tracking" && activeOrder && (
        <section className="delivery-section">
          <button className="delivery-back" onClick={() => void loadOrders()}>
            ‹ Meus pedidos
          </button>
          <h1>Pedido #{activeOrder.order_number}</h1>
          <p>{activeOrder.restaurant_snapshot.name}</p>
          {activeOrder.status === "delivered" && (
            <button
              className="delivery-secondary"
              disabled={busy}
              onClick={() => void repeatOrder()}
            >
              Pedir novamente com preços atuais
            </button>
          )}
          <div className="delivery-status">
            <Clock3 />
            <span>
              <b>{statusNames[activeOrder.status] || activeOrder.status}</b>
              <small>Atualização automática durante o pedido</small>
            </span>
          </div>
          {activeOrder.food_order_events
            ?.sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((event, index) => (
              <p className="delivery-event" key={index}>
                <Check />
                {statusNames[event.to_status] || event.to_status}{" "}
                <small>
                  {new Date(event.created_at).toLocaleTimeString("pt-BR")}
                </small>
              </p>
            ))}
          {activeOrder.drivers?.profiles && (
            <p className="delivery-notice">
              Entregador: {activeOrder.drivers.profiles.full_name}
            </p>
          )}
          {activeOrder.deliveryLocation &&
            activeOrder.address &&
            activeOrder.restaurant_snapshot.lat !== undefined &&
            activeOrder.restaurant_snapshot.lng !== undefined && (
              <>
                <h2>Localização do entregador</h2>
                <div className="delivery-map">
                  <RealMap
                    origin={{
                      lat: activeOrder.restaurant_snapshot.lat,
                      lng: activeOrder.restaurant_snapshot.lng,
                    }}
                    destination={{
                      lat: activeOrder.address.lat,
                      lng: activeOrder.address.lng,
                    }}
                    driver={{
                      lat: activeOrder.deliveryLocation.latitude,
                      lng: activeOrder.deliveryLocation.longitude,
                    }}
                  />
                </div>
                <small>
                  Última posição:{" "}
                  {new Date(
                    activeOrder.deliveryLocation.updated_at,
                  ).toLocaleTimeString("pt-BR")}
                </small>
              </>
            )}
          <div className="delivery-summary">
            <div>
              <span>Itens</span>
              <b>{money(activeOrder.subtotal_cents)}</b>
            </div>
            <div>
              <span>Entrega</span>
              <b>{money(activeOrder.delivery_fee_cents)}</b>
            </div>
            <div>
              <span>Total</span>
              <b>{money(activeOrder.total_cents)}</b>
            </div>
            <small>
              Pagamento{" "}
              {activeOrder.payment_method === "cash"
                ? "em dinheiro"
                : "com cartão na entrega"}{" "}
              ·{" "}
              {activeOrder.payment_status === "paid"
                ? "confirmado"
                : "pendente de confirmação"}
            </small>
          </div>
          {activeOrder.status === "delivered" &&
            (activeOrder.food_reviews?.length ? (
              <p className="delivery-success">
                <Star /> Avaliação registrada:{" "}
                {activeOrder.food_reviews[0].restaurant_score} de 5
              </p>
            ) : (
              <div className="delivery-panel">
                <h2>Avaliar pedido</h2>
                <label className="delivery-field">
                  Restaurante
                  <select
                    value={restaurantScore}
                    onChange={(event) =>
                      setRestaurantScore(Number(event.target.value))
                    }
                  >
                    {[5, 4, 3, 2, 1].map((score) => (
                      <option key={score} value={score}>
                        {score} estrela(s)
                      </option>
                    ))}
                  </select>
                </label>
                {activeOrder.drivers && (
                  <label className="delivery-field">
                    Entrega
                    <select
                      value={deliveryScore}
                      onChange={(event) =>
                        setDeliveryScore(Number(event.target.value))
                      }
                    >
                      {[5, 4, 3, 2, 1].map((score) => (
                        <option key={score} value={score}>
                          {score} estrela(s)
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="delivery-field">
                  Comentário opcional
                  <textarea
                    value={reviewComment}
                    maxLength={500}
                    onChange={(event) => setReviewComment(event.target.value)}
                  />
                </label>
                <button
                  className="delivery-primary"
                  disabled={busy}
                  onClick={() => void submitReview()}
                >
                  Enviar avaliação
                </button>
              </div>
            ))}
          {activeOrder.status === "received" && (
            <button
              className="delivery-secondary"
              onClick={async () => {
                const reason = window.prompt("Motivo do cancelamento");
                if (!reason) return;
                try {
                  await deliveryApi(`/api/delivery/orders/${activeOrder.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ reason }),
                  });
                  await refreshOrder(activeOrder.id);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Não foi possível cancelar.",
                  );
                }
              }}
            >
              Cancelar pedido
            </button>
          )}
        </section>
      )}
      {busy && (
        <p className="delivery-loading" role="status">
          Aguarde…
        </p>
      )}
    </main>
  );
}
