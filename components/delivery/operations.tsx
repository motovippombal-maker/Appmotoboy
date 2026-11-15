"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, MapPin, Plus, RefreshCw, Store } from "lucide-react";
import { deliveryApi } from "@/lib/delivery/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { LivePoint } from "@/components/map/real-map";
import { RestaurantStaff } from "@/components/delivery/restaurant-staff";
import "@/app/delivery.css";

const RealMap = dynamic(
  () => import("@/components/map/real-map").then((module) => module.RealMap),
  { ssr: false },
);
const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
const statusNames: Record<string, string> = {
  received: "Recebido",
  accepted: "Aceito",
  preparing: "Em preparo",
  ready: "Pronto",
  assigned: "Entregador designado",
  at_restaurant: "No restaurante",
  picked_up: "Retirado",
  on_the_way: "A caminho",
  delivered: "Entregue",
  rejected: "Recusado",
  cancelled: "Cancelado",
  delivery_failed: "Falha na entrega",
};
type FoodOrder = {
  id: string;
  order_number: number;
  status: string;
  payment_method: string;
  payment_status: string;
  total_cents: number;
  delivery_fee_cents: number;
  address: {
    street: string;
    number: string;
    district: string;
    city: string;
    lat: number;
    lng: number;
  };
  restaurant_snapshot: {
    name: string;
    address: string;
    lat: number;
    lng: number;
  };
  distance_meters: number;
  created_at: string;
  food_pickup_confirmations?: Array<{ confirmed_at: string }>;
  food_order_items?: Array<{
    name: string;
    quantity: number;
    notes: string;
    options: Array<{ name: string }>;
  }>;
};
type Restaurant = {
  id: string;
  name: string;
  status: string;
  accepting_orders: boolean;
  address: string;
  cuisine: string;
  logo_url?: string | null;
  cover_url?: string | null;
  preparation_minutes: number;
  minimum_order_cents: number;
  created_at: string;
};
type Product = {
  id: string;
  name: string;
  price_cents: number;
  image_url?: string | null;
  available: boolean;
  archived: boolean;
  menu_option_groups: Array<{
    id: string;
    name: string;
    min_choices: number;
    max_choices: number;
    menu_options: Array<{ id: string; name: string; price_cents: number }>;
  }>;
};
type Metrics = {
  received: number;
  preparing: number;
  ready: number;
  inDelivery: number;
  delivered: number;
  cancelled: number;
  salesTodayCents: number;
  salesMonthCents: number;
  unpaidCents: number;
};

function MetricsCards({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) return null;
  return (
    <div className="delivery-metrics">
      <div>
        <b>{metrics.received}</b>
        <small>Aguardando aceite</small>
      </div>
      <div>
        <b>{metrics.preparing}</b>
        <small>Em preparo</small>
      </div>
      <div>
        <b>{metrics.ready}</b>
        <small>Prontos</small>
      </div>
      <div>
        <b>{metrics.inDelivery}</b>
        <small>Em entrega</small>
      </div>
      <div>
        <b>{metrics.delivered}</b>
        <small>Entregues</small>
      </div>
      <div>
        <b>{money(metrics.salesTodayCents)}</b>
        <small>Pedidos entregues hoje (bruto)</small>
      </div>
      <div>
        <b>{money(metrics.salesMonthCents)}</b>
        <small>Pedidos entregues no mês (bruto)</small>
      </div>
      <div>
        <b>{money(metrics.unpaidCents)}</b>
        <small>Recebimento ainda não confirmado</small>
      </div>
    </div>
  );
}

function Shell({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <main className="delivery-app delivery-ops">
      <header className="delivery-header">
        <Link href="/">
          <ArrowLeft />
        </Link>
        <span>
          <b>MotoPombal</b>
          <small>{eyebrow}</small>
        </span>
        <Link className="delivery-home-link" href="/">
          Início
        </Link>
      </header>
      <section className="delivery-section">
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

export function RestaurantWorkspace() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [activeId, setActiveId] = useState("");
  const [orders, setOrders] = useState<FoodOrder[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tab, setTab] = useState<"orders" | "menu">("orders");
  const [application, setApplication] = useState({
    name: "",
    responsibleName: "",
    phone: "",
    whatsapp: "",
    document: "",
    cuisine: "",
    description: "",
    address: "",
    city: "Ribeira do Pombal",
    state: "BA",
    latitude: null as number | null,
    longitude: null as number | null,
    preparationMinutes: 30,
    minimumOrderCents: 0,
    opensAt: "",
    closesAt: "",
  });
  const [categoryName, setCategoryName] = useState("");
  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productCategory, setProductCategory] = useState("");
  const [groupProduct, setGroupProduct] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupMin, setGroupMin] = useState(0);
  const [groupMax, setGroupMax] = useState(1);
  const [optionGroup, setOptionGroup] = useState("");
  const [optionName, setOptionName] = useState("");
  const [optionPrice, setOptionPrice] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const active = restaurants.find((item) => item.id === activeId);
  const loadRestaurants = useCallback(async () => {
    const result = await deliveryApi<{ restaurants: Restaurant[] }>(
      "/api/restaurant",
    );
    setRestaurants(result.restaurants);
    setActiveId((current) => current || result.restaurants[0]?.id || "");
  }, []);
  const refresh = useCallback(async (id: string) => {
    const [orderResult, menuResult] = await Promise.all([
      deliveryApi<{ orders: FoodOrder[]; metrics: Metrics }>(
        `/api/restaurant/${id}/orders`,
      ),
      deliveryApi<{
        categories: Array<{ id: string; name: string }>;
        products: Product[];
      }>(`/api/restaurant/${id}/menu`),
    ]);
    setOrders(orderResult.orders);
    setMetrics(orderResult.metrics);
    setCategories(menuResult.categories);
    setProducts(menuResult.products);
  }, []);
  useEffect(() => {
    void Promise.resolve()
      .then(() => loadRestaurants())
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Falha ao abrir restaurante.",
        ),
      );
  }, [loadRestaurants]);
  useEffect(() => {
    if (activeId)
      void Promise.resolve()
        .then(() => refresh(activeId))
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error ? cause.message : "Falha ao carregar dados.",
          ),
        );
  }, [activeId, refresh]);
  useEffect(() => {
    if (!activeId) return;
    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`restaurant-orders-${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "food_orders",
          filter: `restaurant_id=eq.${activeId}`,
        },
        () => void refresh(activeId).catch(() => undefined),
      )
      .subscribe();
    const timer = window.setInterval(
      () => void refresh(activeId).catch(() => undefined),
      15000,
    );
    return () => {
      window.clearInterval(timer);
      void client.removeChannel(channel);
    };
  }, [activeId, refresh]);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      if (activeId) await refresh(activeId);
      await loadRestaurants();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Operação não concluída.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveMenu(body: Record<string, unknown>) {
    if (!activeId) return;
    await run(
      () =>
        deliveryApi(`/api/restaurant/${activeId}/menu`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      "Cardápio atualizado.",
    );
  }
  async function uploadImage(
    kind: "logo" | "cover" | "product",
    file: File,
    productId?: string,
  ) {
    if (!activeId) return;
    const form = new FormData();
    form.set("kind", kind);
    form.set("image", file);
    if (productId) form.set("productId", productId);
    await run(
      () =>
        deliveryApi(`/api/restaurant/${activeId}/images`, {
          method: "POST",
          body: form,
        }),
      "Imagem enviada.",
    );
  }
  const nextStatus: Record<string, string> = {
    received: "accepted",
    accepted: "preparing",
    preparing: "ready",
  };
  return (
    <Shell title="Painel do restaurante" eyebrow="Restaurantes parceiros">
      {error && (
        <p className="delivery-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="delivery-success" role="status">
          {message}
        </p>
      )}
      {restaurants.length === 0 ? (
        <div className="delivery-panel">
          <h2>Solicitar parceria</h2>
          <p>
            Preencha os dados do estabelecimento. A central MotoPombal analisará
            o cadastro antes de liberar pedidos.
          </p>
          <form
            className="delivery-fields"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                application.latitude === null ||
                application.longitude === null
              ) {
                setError("Marque a entrada do restaurante no mapa.");
                return;
              }
              void run(
                () =>
                  deliveryApi("/api/restaurant", {
                    method: "POST",
                    body: JSON.stringify({
                      ...application,
                      opensAt: application.opensAt || null,
                      closesAt: application.closesAt || null,
                    }),
                  }),
                "Cadastro enviado para análise.",
              );
            }}
          >
            {(
              [
                ["name", "Nome comercial"],
                ["responsibleName", "Responsável"],
                ["phone", "Telefone"],
                ["whatsapp", "WhatsApp"],
                ["document", "CPF ou CNPJ"],
                ["cuisine", "Tipo de comida"],
                ["description", "Descrição"],
                ["address", "Endereço completo"],
                ["city", "Cidade"],
                ["state", "UF"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  required={[
                    "name",
                    "responsibleName",
                    "phone",
                    "cuisine",
                    "address",
                    "city",
                    "state",
                  ].includes(key)}
                  value={application[key]}
                  onChange={(event) =>
                    setApplication((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
            <label>
              Preparo estimado (min)
              <input
                type="number"
                min={1}
                max={240}
                value={application.preparationMinutes}
                onChange={(event) =>
                  setApplication((current) => ({
                    ...current,
                    preparationMinutes: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              Pedido mínimo (R$)
              <input
                type="number"
                min={0}
                step="0.01"
                value={application.minimumOrderCents / 100}
                onChange={(event) =>
                  setApplication((current) => ({
                    ...current,
                    minimumOrderCents: Math.round(
                      Number(event.target.value) * 100,
                    ),
                  }))
                }
              />
            </label>
            <label>
              Abre às
              <input
                type="time"
                value={application.opensAt}
                onChange={(event) =>
                  setApplication((current) => ({
                    ...current,
                    opensAt: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Fecha às
              <input
                type="time"
                value={application.closesAt}
                onChange={(event) =>
                  setApplication((current) => ({
                    ...current,
                    closesAt: event.target.value,
                  }))
                }
              />
            </label>
            <div className="delivery-map delivery-form-map">
              <RealMap
                pickPoint={
                  application.latitude !== null &&
                  application.longitude !== null
                    ? { lat: application.latitude, lng: application.longitude }
                    : undefined
                }
                centerTarget={{ lat: -10.8373, lng: -38.5357 }}
                onPick={(point: LivePoint) =>
                  setApplication((current) => ({
                    ...current,
                    latitude: point.lat,
                    longitude: point.lng,
                  }))
                }
              />
            </div>
            <p>Toque no mapa para marcar a entrada do restaurante.</p>
            <button className="delivery-primary" disabled={busy}>
              Enviar cadastro
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="delivery-toolbar">
            <select
              value={activeId}
              onChange={(event) => setActiveId(event.target.value)}
            >
              {restaurants.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <span className="delivery-chip">
              {active?.status === "approved"
                ? "Aprovado"
                : active?.status === "pending"
                  ? "Aguardando aprovação"
                  : active?.status}
            </span>
            <button onClick={() => void refresh(activeId)}>
              <RefreshCw /> Atualizar
            </button>
          </div>
          {active?.status === "approved" && (
            <label className="delivery-toggle">
              <input
                type="checkbox"
                checked={active.accepting_orders}
                disabled={busy}
                onChange={(event) =>
                  void run(
                    () =>
                      deliveryApi("/api/restaurant", {
                        method: "PATCH",
                        body: JSON.stringify({
                          restaurantId: activeId,
                          acceptingOrders: event.target.checked,
                        }),
                      }),
                    "Disponibilidade atualizada.",
                  )
                }
              />{" "}
              Receber novos pedidos
            </label>
          )}
          <MetricsCards metrics={metrics} />
          <div className="delivery-panel">
            <h2>Imagens do restaurante</h2>
            <div className="delivery-image-inputs">
              <label>
                Logomarca
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadImage("logo", file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <label>
                Imagem de capa
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadImage("cover", file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            <small>
              JPG, PNG ou WebP, até 3 MB. As imagens aprovadas aparecem no
              catálogo.
            </small>
          </div>
          <RestaurantStaff key={activeId} restaurantId={activeId} />
          <div className="delivery-tabs">
            <button
              className={tab === "orders" ? "active" : ""}
              onClick={() => setTab("orders")}
            >
              Pedidos
            </button>
            <button
              className={tab === "menu" ? "active" : ""}
              onClick={() => setTab("menu")}
            >
              Cardápio
            </button>
          </div>
          {tab === "orders" ? (
            <div>
              {orders.length === 0 && <p>Nenhum pedido recebido.</p>}
              {orders.map((order) => (
                <div className="delivery-panel" key={order.id}>
                  <div className="delivery-toolbar">
                    <b>Pedido #{order.order_number}</b>
                    <span className="delivery-chip">
                      {statusNames[order.status]}
                    </span>
                    <b>{money(order.total_cents)}</b>
                  </div>
                  <p>
                    {order.address.street}, {order.address.number} ·{" "}
                    {order.address.district}, {order.address.city}
                  </p>
                  {order.food_order_items?.map((item, index) => (
                    <p key={index}>
                      {item.quantity}× {item.name}
                      {item.options?.length
                        ? ` · ${item.options.map((option) => option.name).join(", ")}`
                        : ""}
                      {item.notes ? ` · ${item.notes}` : ""}
                    </p>
                  ))}
                  <small>
                    {order.payment_method === "cash"
                      ? "Dinheiro"
                      : "Cartão na entrega"}{" "}
                    · pagamento{" "}
                    {order.payment_status === "paid"
                      ? "confirmado"
                      : "pendente"}
                  </small>
                  {order.status === "at_restaurant" &&
                    !order.food_pickup_confirmations?.length && (
                      <button
                        className="delivery-secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              deliveryApi(
                                `/api/restaurant/${activeId}/pickup`,
                                {
                                  method: "POST",
                                  body: JSON.stringify({ orderId: order.id }),
                                },
                              ),
                            "Retirada confirmada pelo restaurante.",
                          )
                        }
                      >
                        Confirmar retirada pelo entregador
                      </button>
                    )}
                  {order.status === "delivered" &&
                    order.payment_status === "pending" && (
                      <button
                        className="delivery-secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              deliveryApi(
                                `/api/delivery/payments/${order.id}`,
                                { method: "POST" },
                              ),
                            "Recebimento confirmado.",
                          )
                        }
                      >
                        Confirmar recebimento
                      </button>
                    )}
                  {nextStatus[order.status] && (
                    <button
                      className="delivery-secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            deliveryApi(`/api/restaurant/${activeId}/orders`, {
                              method: "PATCH",
                              body: JSON.stringify({
                                orderId: order.id,
                                status: nextStatus[order.status],
                              }),
                            }),
                          "Pedido atualizado.",
                        )
                      }
                    >
                      {order.status === "received"
                        ? "Aceitar pedido"
                        : order.status === "accepted"
                          ? "Iniciar preparo"
                          : "Marcar como pronto"}
                    </button>
                  )}
                  {order.status === "received" && (
                    <button
                      className="delivery-danger"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt("Motivo da recusa");
                        if (reason)
                          void run(
                            () =>
                              deliveryApi(
                                `/api/restaurant/${activeId}/orders`,
                                {
                                  method: "PATCH",
                                  body: JSON.stringify({
                                    orderId: order.id,
                                    status: "rejected",
                                    reason,
                                  }),
                                },
                              ),
                            "Pedido recusado.",
                          );
                      }}
                    >
                      Recusar
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div className="delivery-panel">
                <h2>Nova categoria</h2>
                <form
                  className="delivery-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveMenu({
                      kind: "category",
                      name: categoryName,
                      sortOrder: categories.length * 10,
                    }).then(() => setCategoryName(""));
                  }}
                >
                  <input
                    required
                    minLength={2}
                    value={categoryName}
                    onChange={(event) => setCategoryName(event.target.value)}
                    placeholder="Ex.: Pizzas"
                  />
                  <button className="delivery-secondary" disabled={busy}>
                    <Plus /> Adicionar
                  </button>
                </form>
              </div>
              <div className="delivery-panel">
                <h2>Novo produto</h2>
                <form
                  className="delivery-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveMenu({
                      kind: "product",
                      name: productName,
                      priceCents: Math.round(
                        Number(productPrice.replace(",", ".")) * 100,
                      ),
                      categoryId: productCategory || null,
                      available: true,
                      sortOrder: products.length * 10,
                    }).then(() => {
                      setProductName("");
                      setProductPrice("");
                    });
                  }}
                >
                  <input
                    required
                    minLength={2}
                    value={productName}
                    onChange={(event) => setProductName(event.target.value)}
                    placeholder="Nome do produto"
                  />
                  <input
                    required
                    inputMode="decimal"
                    value={productPrice}
                    onChange={(event) => setProductPrice(event.target.value)}
                    placeholder="Preço em R$"
                  />
                  <select
                    value={productCategory}
                    onChange={(event) => setProductCategory(event.target.value)}
                  >
                    <option value="">Sem categoria</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <button className="delivery-secondary" disabled={busy}>
                    <Plus /> Adicionar
                  </button>
                </form>
              </div>
              <div className="delivery-panel">
                <h2>Produtos</h2>
                {products.map((product) => (
                  <div className="delivery-list-row" key={product.id}>
                    <span>
                      <b>{product.name}</b>
                      <small>
                        {money(product.price_cents)} ·{" "}
                        {product.menu_option_groups.length} grupo(s) de
                        adicionais
                      </small>
                    </span>
                    <label className="delivery-image-upload">
                      Foto
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file)
                            void uploadImage("product", file, product.id);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            deliveryApi(`/api/restaurant/${activeId}/menu`, {
                              method: "PATCH",
                              body: JSON.stringify({
                                productId: product.id,
                                available: !product.available,
                              }),
                            }),
                          "Disponibilidade alterada.",
                        )
                      }
                    >
                      {product.available ? "Marcar esgotado" : "Reativar"}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            deliveryApi(`/api/restaurant/${activeId}/menu`, {
                              method: "PATCH",
                              body: JSON.stringify({
                                productId: product.id,
                                archived: !product.archived,
                              }),
                            }),
                          "Produto atualizado.",
                        )
                      }
                    >
                      {product.archived ? "Desarquivar" : "Arquivar"}
                    </button>
                  </div>
                ))}
              </div>
              <div className="delivery-panel">
                <h2>Grupo de adicionais</h2>
                <form
                  className="delivery-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveMenu({
                      kind: "optionGroup",
                      productId: groupProduct,
                      name: groupName,
                      minChoices: groupMin,
                      maxChoices: groupMax,
                    }).then(() => setGroupName(""));
                  }}
                >
                  <select
                    required
                    value={groupProduct}
                    onChange={(event) => setGroupProduct(event.target.value)}
                  >
                    <option value="">Produto</option>
                    {products
                      .filter((product) => !product.archived)
                      .map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                  </select>
                  <input
                    required
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    placeholder="Ex.: Tamanho"
                  />
                  <label>
                    Mín.
                    <input
                      type="number"
                      min={0}
                      value={groupMin}
                      onChange={(event) =>
                        setGroupMin(Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    Máx.
                    <input
                      type="number"
                      min={1}
                      value={groupMax}
                      onChange={(event) =>
                        setGroupMax(Number(event.target.value))
                      }
                    />
                  </label>
                  <button className="delivery-secondary" disabled={busy}>
                    Criar grupo
                  </button>
                </form>
              </div>
              <div className="delivery-panel">
                <h2>Adicionar opção</h2>
                <form
                  className="delivery-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveMenu({
                      kind: "option",
                      groupId: optionGroup,
                      name: optionName,
                      priceCents: Math.round(
                        Number(optionPrice.replace(",", ".")) * 100,
                      ),
                    }).then(() => {
                      setOptionName("");
                      setOptionPrice("");
                    });
                  }}
                >
                  <select
                    required
                    value={optionGroup}
                    onChange={(event) => setOptionGroup(event.target.value)}
                  >
                    <option value="">Grupo</option>
                    {products.flatMap((product) =>
                      product.menu_option_groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {product.name} · {group.name}
                        </option>
                      )),
                    )}
                  </select>
                  <input
                    required
                    value={optionName}
                    onChange={(event) => setOptionName(event.target.value)}
                    placeholder="Ex.: Borda recheada"
                  />
                  <input
                    required
                    value={optionPrice}
                    onChange={(event) => setOptionPrice(event.target.value)}
                    placeholder="Adicional em R$"
                  />
                  <button className="delivery-secondary" disabled={busy}>
                    Adicionar
                  </button>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

export function DriverDeliveryWorkspace() {
  const [state, setState] = useState<{
    enabled: boolean;
    driver: { online: boolean; available: boolean; approval_status: string };
    deliveries: FoodOrder[];
    available: FoodOrder[];
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(
    async () => setState(await deliveryApi("/api/driver/deliveries")),
    [],
  );
  useEffect(() => {
    void Promise.resolve()
      .then(() => refresh())
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "Falha ao abrir entregas.",
        ),
      );
    const timer = window.setInterval(
      () => void refresh().catch(() => undefined),
      15000,
    );
    return () => window.clearInterval(timer);
  }, [refresh]);
  const trackingOrderId = state?.deliveries.find((order) =>
    ["assigned", "at_restaurant", "picked_up", "on_the_way"].includes(
      order.status,
    ),
  )?.id;
  useEffect(() => {
    if (!trackingOrderId || !navigator.geolocation) return;
    let lastSentAt = 0;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (position.coords.accuracy > 150 || Date.now() - lastSentAt < 10000)
          return;
        lastSentAt = Date.now();
        void deliveryApi(`/api/driver/deliveries/${trackingOrderId}/location`, {
          method: "POST",
          body: JSON.stringify({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          }),
        }).catch(() => undefined);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [trackingOrderId]);
  async function act(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: Record<string, unknown>,
  ) {
    setBusy(true);
    setError("");
    try {
      await deliveryApi(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Operação não concluída.",
      );
    } finally {
      setBusy(false);
    }
  }
  const next: Record<string, string> = {
    assigned: "at_restaurant",
    at_restaurant: "picked_up",
    picked_up: "on_the_way",
    on_the_way: "delivered",
  };
  return (
    <Shell title="Entregas de restaurantes" eyebrow="Área do motorista">
      <p>
        Use seu cadastro de motorista MotoPombal. A disponibilidade para
        corridas e entregas é compartilhada.
      </p>
      {error && (
        <p className="delivery-error" role="alert">
          {error}
        </p>
      )}
      {state && (
        <>
          <label className="delivery-toggle">
            <input
              type="checkbox"
              checked={state.enabled}
              disabled={busy}
              onChange={(event) =>
                void act("/api/driver/deliveries", "PATCH", {
                  enabled: event.target.checked,
                })
              }
            />{" "}
            Aceitar entregas de restaurantes
          </label>
          <p className="delivery-meta">
            {state.driver.online ? "Online" : "Offline"} ·{" "}
            {state.driver.available ? "Livre" : "Ocupado"} · aprovação:{" "}
            {state.driver.approval_status}
          </p>
          <h2>Em andamento e histórico</h2>
          {state.deliveries.length === 0 && <p>Nenhuma entrega atribuída.</p>}
          {state.deliveries.map((order) => (
            <div className="delivery-panel" key={order.id}>
              <div className="delivery-toolbar">
                <b>Entrega #{order.order_number}</b>
                <span className="delivery-chip">
                  {statusNames[order.status]}
                </span>
              </div>
              <p>
                <Store /> {order.restaurant_snapshot.name}
              </p>
              <p>
                <MapPin />{" "}
                {order.status === "assigned" || order.status === "at_restaurant"
                  ? order.restaurant_snapshot.address
                  : `${order.address.street}, ${order.address.number} · ${order.address.district}`}
              </p>
              <p>
                Taxa de entrega do pedido: {money(order.delivery_fee_cents)}. O
                repasse ao motoboy depende da configuração operacional.
              </p>
              {next[order.status] && (
                <>
                  <a
                    className="delivery-secondary delivery-nav-link"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${order.status === "assigned" || order.status === "at_restaurant" ? `${order.restaurant_snapshot.lat},${order.restaurant_snapshot.lng}` : `${order.address.lat},${order.address.lng}`}`}
                  >
                    Abrir rota
                  </a>
                  <button
                    className="delivery-primary"
                    disabled={
                      busy ||
                      (order.status === "at_restaurant" &&
                        !order.food_pickup_confirmations?.length)
                    }
                    onClick={() =>
                      void act(`/api/driver/deliveries/${order.id}`, "PATCH", {
                        status: next[order.status],
                      })
                    }
                  >
                    {order.status === "assigned"
                      ? "Cheguei ao restaurante"
                      : order.status === "at_restaurant"
                        ? order.food_pickup_confirmations?.length
                          ? "Confirmar retirada"
                          : "Aguardando restaurante"
                        : order.status === "picked_up"
                          ? "Iniciar trajeto ao cliente"
                          : "Confirmar entrega"}
                  </button>
                  {["assigned", "at_restaurant"].includes(order.status) && (
                    <button
                      className="delivery-danger"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(
                          "Por que você precisa devolver esta entrega?",
                        );
                        if (reason)
                          void act(
                            `/api/driver/deliveries/${order.id}`,
                            "DELETE",
                            { reason },
                          );
                      }}
                    >
                      Desistir da entrega
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
          <h2>Disponíveis para aceite</h2>
          {!state.enabled && <p>Ative entregas para receber oportunidades.</p>}
          {state.enabled && state.available.length === 0 && (
            <p>Nenhuma entrega pronta para retirada agora.</p>
          )}
          {state.enabled &&
            state.available.map((order) => (
              <div className="delivery-panel" key={order.id}>
                <b>
                  Pedido #{order.order_number} ·{" "}
                  {order.restaurant_snapshot.name}
                </b>
                <p>{order.restaurant_snapshot.address}</p>
                <p>
                  Distância restaurante → cliente:{" "}
                  {(order.distance_meters / 1000).toFixed(1)} km
                </p>
                <p>
                  Taxa de entrega do pedido: {money(order.delivery_fee_cents)}
                </p>
                <button
                  className="delivery-primary"
                  disabled={
                    busy || !state.driver.online || !state.driver.available
                  }
                  onClick={() =>
                    void act(`/api/driver/deliveries/${order.id}`, "POST")
                  }
                >
                  Aceitar entrega
                </button>
              </div>
            ))}
        </>
      )}
    </Shell>
  );
}

export function AdminDeliveryWorkspace() {
  const [state, setState] = useState<{
    restaurants: Array<
      Restaurant & { responsible_name: string; phone: string; document: string }
    >;
    settings: {
      enabled: boolean;
      cash_enabled: boolean;
      card_on_delivery_enabled: boolean;
      minimum_fee_cents: number | null;
      per_km_cents: number | null;
      max_distance_meters: number | null;
    };
    orders: FoodOrder[];
    metrics: Metrics;
  } | null>(null);
  const [settings, setSettings] = useState({
    enabled: false,
    cashEnabled: true,
    cardOnDeliveryEnabled: false,
    minimumFeeCents: "",
    perKmCents: "",
    maxDistanceMeters: "",
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const result = await deliveryApi<typeof state>("/api/admin/delivery");
    if (!result) return;
    setState(result);
    setSettings({
      enabled: result.settings.enabled,
      cashEnabled: result.settings.cash_enabled,
      cardOnDeliveryEnabled: result.settings.card_on_delivery_enabled,
      minimumFeeCents:
        result.settings.minimum_fee_cents === null
          ? ""
          : String(result.settings.minimum_fee_cents / 100),
      perKmCents:
        result.settings.per_km_cents === null
          ? ""
          : String(result.settings.per_km_cents / 100),
      maxDistanceMeters:
        result.settings.max_distance_meters === null
          ? ""
          : String(result.settings.max_distance_meters),
    });
  }, []);
  useEffect(() => {
    void Promise.resolve()
      .then(() => refresh())
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Falha ao abrir administração.",
        ),
      );
  }, [refresh]);
  async function change(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await deliveryApi("/api/admin/delivery", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await refresh();
      setMessage(success);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Operação não concluída.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title="Administração do delivery" eyebrow="Central MotoPombal">
      {error && (
        <p className="delivery-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="delivery-success" role="status">
          {message}
        </p>
      )}
      <p>
        Fretes de restaurantes são independentes das tarifas de corrida. Os
        valores só entram em operação após configuração e ativação.
      </p>
      <MetricsCards metrics={state?.metrics || null} />
      <div className="delivery-panel">
        <h2>Configuração de entrega</h2>
        <form
          className="delivery-fields"
          onSubmit={(event) => {
            event.preventDefault();
            void change(
              {
                kind: "settings",
                enabled: settings.enabled,
                cashEnabled: settings.cashEnabled,
                cardOnDeliveryEnabled: settings.cardOnDeliveryEnabled,
                minimumFeeCents:
                  settings.minimumFeeCents === ""
                    ? null
                    : Math.round(
                        Number(settings.minimumFeeCents.replace(",", ".")) *
                          100,
                      ),
                perKmCents:
                  settings.perKmCents === ""
                    ? null
                    : Math.round(
                        Number(settings.perKmCents.replace(",", ".")) * 100,
                      ),
                maxDistanceMeters:
                  settings.maxDistanceMeters === ""
                    ? null
                    : Number(settings.maxDistanceMeters),
              },
              "Configuração salva.",
            );
          }}
        >
          <label>
            Taxa mínima (R$)
            <input
              inputMode="decimal"
              value={settings.minimumFeeCents}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  minimumFeeCents: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Taxa por km (R$)
            <input
              inputMode="decimal"
              value={settings.perKmCents}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  perKmCents: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Distância máxima (m)
            <input
              type="number"
              min={1}
              value={settings.maxDistanceMeters}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  maxDistanceMeters: event.target.value,
                }))
              }
            />
          </label>
          <label className="delivery-toggle">
            <input
              type="checkbox"
              checked={settings.cashEnabled}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  cashEnabled: event.target.checked,
                }))
              }
            />{" "}
            Dinheiro na entrega
          </label>
          <label className="delivery-toggle">
            <input
              type="checkbox"
              checked={settings.cardOnDeliveryEnabled}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  cardOnDeliveryEnabled: event.target.checked,
                }))
              }
            />{" "}
            Cartão na entrega (somente se a operação tiver maquininha)
          </label>
          <label className="delivery-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  enabled: event.target.checked,
                }))
              }
            />{" "}
            Ativar pedidos
          </label>
          <button className="delivery-primary" disabled={busy}>
            Salvar configuração
          </button>
        </form>
      </div>
      <h2>Restaurantes</h2>
      {state?.restaurants.length === 0 && (
        <p>Nenhuma solicitação registrada.</p>
      )}
      {state?.restaurants.map((restaurant) => (
        <div className="delivery-panel" key={restaurant.id}>
          <div className="delivery-toolbar">
            <b>{restaurant.name}</b>
            <span className="delivery-chip">{restaurant.status}</span>
          </div>
          <p>
            {restaurant.responsible_name} · {restaurant.phone} ·{" "}
            {restaurant.document || "Documento não informado"}
          </p>
          <p>{restaurant.address}</p>
          {restaurant.status !== "approved" && (
            <button
              className="delivery-secondary"
              disabled={busy}
              onClick={() =>
                void change(
                  { kind: "restaurant", id: restaurant.id, status: "approved" },
                  "Restaurante aprovado. O proprietário pode ativar os pedidos.",
                )
              }
            >
              Aprovar
            </button>
          )}
          {restaurant.status !== "suspended" && (
            <button
              className="delivery-danger"
              disabled={busy}
              onClick={() =>
                void change(
                  {
                    kind: "restaurant",
                    id: restaurant.id,
                    status: "suspended",
                  },
                  "Restaurante suspenso.",
                )
              }
            >
              Suspender
            </button>
          )}
          {restaurant.status === "pending" && (
            <button
              className="delivery-danger"
              disabled={busy}
              onClick={() =>
                void change(
                  { kind: "restaurant", id: restaurant.id, status: "rejected" },
                  "Cadastro rejeitado.",
                )
              }
            >
              Rejeitar
            </button>
          )}
        </div>
      ))}
      <h2>Pedidos recentes</h2>
      {state?.orders.map((order) => (
        <div className="delivery-list-row" key={order.id}>
          <b>#{order.order_number}</b>
          <span>{statusNames[order.status]}</span>
          <b>{money(order.total_cents)}</b>
          <small>{new Date(order.created_at).toLocaleString("pt-BR")}</small>
          {!["delivered", "cancelled", "rejected", "delivery_failed"].includes(
            order.status,
          ) && (
            <button
              className="delivery-danger"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("Motivo do cancelamento");
                if (reason)
                  void change(
                    {
                      kind: "order",
                      id: order.id,
                      status: "cancelled",
                      reason,
                    },
                    "Pedido cancelado.",
                  );
              }}
            >
              Cancelar
            </button>
          )}
        </div>
      ))}
    </Shell>
  );
}
