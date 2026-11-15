import { z } from "zod";
import { ApiError, audit, jsonError, requireUser } from "@/lib/backend/api";
import { productSchema } from "@/lib/delivery/schemas";
import { restaurantForStaff } from "@/lib/delivery/server";

async function contextFor(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser(request);
  const restaurantId = z
    .string()
    .uuid()
    .parse((await context.params).id);
  await restaurantForStaff(auth.supabase, restaurantId, auth.user.id);
  return { ...auth, restaurantId };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, restaurantId } = await contextFor(request, context);
    const [categories, products] = await Promise.all([
      supabase
        .from("menu_categories")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("sort_order"),
      supabase
        .from("menu_products")
        .select(
          "id,category_id,name,description,image_url,price_cents,available,archived,sort_order,menu_option_groups(id,name,min_choices,max_choices,sort_order,menu_options(id,name,price_cents,available,sort_order))",
        )
        .eq("restaurant_id", restaurantId)
        .order("sort_order"),
    ]);
    if (categories.error) throw categories.error;
    if (products.error) throw products.error;
    return Response.json({
      categories: categories.data || [],
      products: products.data || [],
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, restaurantId, user } = await contextFor(request, context);
    const raw: unknown = await request.json();
    const kind = z
      .object({
        kind: z.enum(["category", "product", "optionGroup", "option"]),
      })
      .parse(raw).kind;
    let result: {
      data: Record<string, unknown> | null;
      error: { code?: string; message: string } | null;
    };
    if (kind === "category") {
      const input = z
        .object({
          name: z.string().trim().min(2).max(80),
          sortOrder: z.number().int().default(0),
        })
        .parse(raw);
      result = await supabase
        .from("menu_categories")
        .insert({
          restaurant_id: restaurantId,
          name: input.name,
          sort_order: input.sortOrder,
        })
        .select("*")
        .single();
    } else if (kind === "product") {
      const input = productSchema.parse(raw);
      if (input.categoryId) {
        const { data: category } = await supabase
          .from("menu_categories")
          .select("id")
          .eq("id", input.categoryId)
          .eq("restaurant_id", restaurantId)
          .maybeSingle();
        if (!category)
          throw new ApiError(
            400,
            "Categoria não pertence ao restaurante.",
            "INVALID_CATEGORY",
          );
      }
      const values = {
        restaurant_id: restaurantId,
        category_id: input.categoryId || null,
        name: input.name,
        description: input.description || null,
        price_cents: input.priceCents,
        available: input.available,
        sort_order: input.sortOrder,
      };
      result = input.id
        ? await supabase
            .from("menu_products")
            .update(values)
            .eq("id", input.id)
            .eq("restaurant_id", restaurantId)
            .select("*")
            .single()
        : await supabase
            .from("menu_products")
            .insert(values)
            .select("*")
            .single();
    } else if (kind === "optionGroup") {
      const input = z
        .object({
          productId: z.string().uuid(),
          name: z.string().trim().min(2).max(80),
          minChoices: z.number().int().min(0),
          maxChoices: z.number().int().min(1).max(30),
        })
        .parse(raw);
      if (input.minChoices > input.maxChoices)
        throw new ApiError(
          400,
          "Limites de escolha inválidos.",
          "INVALID_OPTIONS",
        );
      const { data: product } = await supabase
        .from("menu_products")
        .select("id")
        .eq("id", input.productId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (!product)
        throw new ApiError(404, "Produto não encontrado.", "PRODUCT_NOT_FOUND");
      result = await supabase
        .from("menu_option_groups")
        .insert({
          product_id: input.productId,
          name: input.name,
          min_choices: input.minChoices,
          max_choices: input.maxChoices,
        })
        .select("*")
        .single();
    } else {
      const input = z
        .object({
          groupId: z.string().uuid(),
          name: z.string().trim().min(1).max(80),
          priceCents: z.number().int().min(0).max(10000000),
        })
        .parse(raw);
      const { data: group } = await supabase
        .from("menu_option_groups")
        .select("id,menu_products!inner(restaurant_id)")
        .eq("id", input.groupId)
        .eq("menu_products.restaurant_id", restaurantId)
        .maybeSingle();
      if (!group)
        throw new ApiError(
          404,
          "Grupo de adicionais não encontrado.",
          "OPTION_GROUP_NOT_FOUND",
        );
      result = await supabase
        .from("menu_options")
        .insert({
          group_id: input.groupId,
          name: input.name,
          price_cents: input.priceCents,
        })
        .select("*")
        .single();
    }
    if (result.error) throw result.error;
    await audit(
      supabase,
      user.id,
      `menu.${kind}.saved`,
      "restaurant",
      restaurantId,
    );
    return Response.json({ item: result.data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, restaurantId, user } = await contextFor(request, context);
    const input = z
      .object({
        productId: z.string().uuid(),
        available: z.boolean().optional(),
        archived: z.boolean().optional(),
      })
      .refine(
        (value) =>
          value.available !== undefined || value.archived !== undefined,
      )
      .parse(await request.json());
    const { data, error } = await supabase
      .from("menu_products")
      .update({
        ...(input.available !== undefined
          ? { available: input.available }
          : {}),
        ...(input.archived !== undefined ? { archived: input.archived } : {}),
      })
      .eq("id", input.productId)
      .eq("restaurant_id", restaurantId)
      .select("id,available,archived")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new ApiError(404, "Produto não encontrado.", "PRODUCT_NOT_FOUND");
    await audit(
      supabase,
      user.id,
      "menu.product.availability_changed",
      "menu_product",
      input.productId,
    );
    return Response.json({ product: data });
  } catch (error) {
    return jsonError(error);
  }
}
