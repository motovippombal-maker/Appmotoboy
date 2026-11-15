import { ApiError, jsonError, requireUser } from "@/lib/backend/api";
import { checkoutSchema } from "@/lib/delivery/schemas";
import {
  deliveryDistance,
  deliveryFeeCents,
  deliverySettings,
} from "@/lib/delivery/server";

export async function POST(request: Request) {
  try {
    const { supabase } = await requireUser(request, ["passenger"]);
    const input = checkoutSchema.parse(await request.json());
    const settings = await deliverySettings(supabase);
    if (
      (input.paymentMethod === "cash" && !settings.cash_enabled) ||
      (input.paymentMethod === "card_on_delivery" &&
        !settings.card_on_delivery_enabled)
    )
      throw new ApiError(
        409,
        "Forma de pagamento indisponível.",
        "PAYMENT_METHOD_UNAVAILABLE",
      );
    const { restaurant, route } = await deliveryDistance(
      supabase,
      input.restaurantId,
      input.address,
    );
    const deliveryFeeCentsValue = deliveryFeeCents(
      route.distanceMeters,
      settings,
    );
    const productIds = [...new Set(input.items.map((item) => item.productId))];
    const { data: products, error } = await supabase
      .from("menu_products")
      .select(
        "id,price_cents,available,archived,menu_option_groups(id,min_choices,max_choices,menu_options(id,price_cents,available))",
      )
      .eq("restaurant_id", input.restaurantId)
      .in("id", productIds);
    if (error) throw error;
    const productMap = new Map(
      (products || []).map((product) => [product.id, product]),
    );
    let subtotalCents = 0;
    for (const item of input.items) {
      const product = productMap.get(item.productId);
      if (!product || !product.available || product.archived)
        return Response.json(
          { error: "PRODUCT_UNAVAILABLE", message: "Produto indisponível." },
          { status: 409 },
        );
      let unit = product.price_cents;
      const selected = new Set(item.optionIds);
      if (selected.size !== item.optionIds.length)
        return Response.json(
          { error: "INVALID_OPTIONS", message: "Adicionais repetidos." },
          { status: 400 },
        );
      let matched = 0;
      for (const group of product.menu_option_groups || []) {
        const options = (group.menu_options || []).filter((option) =>
          selected.has(option.id),
        );
        if (
          options.length < group.min_choices ||
          options.length > group.max_choices ||
          options.some((option) => !option.available)
        )
          return Response.json(
            {
              error: "INVALID_OPTIONS",
              message: "Revise os adicionais do produto.",
            },
            { status: 409 },
          );
        matched += options.length;
        unit += options.reduce((sum, option) => sum + option.price_cents, 0);
      }
      if (matched !== selected.size)
        return Response.json(
          { error: "INVALID_OPTIONS", message: "Adicional inválido." },
          { status: 409 },
        );
      subtotalCents += unit * item.quantity;
    }
    if (subtotalCents < restaurant.minimum_order_cents)
      return Response.json(
        {
          error: "MINIMUM_ORDER",
          message: "Pedido abaixo do mínimo do restaurante.",
        },
        { status: 409 },
      );
    return Response.json({
      subtotalCents,
      deliveryFeeCents: deliveryFeeCentsValue,
      totalCents: subtotalCents + deliveryFeeCentsValue,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      preparationMinutes: restaurant.preparation_minutes,
    });
  } catch (error) {
    return jsonError(error);
  }
}
