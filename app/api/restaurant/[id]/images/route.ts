import { z } from "zod";
import {
  ApiError,
  audit,
  consumeRateLimit,
  jsonError,
  requireUser,
} from "@/lib/backend/api";
import { restaurantForStaff } from "@/lib/delivery/server";

const imageTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function validImage(bytes: Uint8Array, type: string) {
  if (type === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    );
  if (type === "image/webp")
    return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, user } = await requireUser(request);
    const restaurantId = z.string().uuid().parse((await context.params).id);
    await restaurantForStaff(supabase, restaurantId, user.id);
    await consumeRateLimit(supabase, `restaurant-image:${user.id}`, 30, 3600);
    const form = await request.formData();
    const kind = z.enum(["logo", "cover", "product"]).parse(form.get("kind"));
    const productId = kind === "product" ? z.string().uuid().parse(form.get("productId")) : null;
    const file = form.get("image");
    if (!(file instanceof File) || !imageTypes[file.type] || file.size < 100 || file.size > 3145728)
      throw new ApiError(400, "Envie JPG, PNG ou WebP de até 3 MB.", "INVALID_IMAGE");
    if (productId) {
      const { data: product, error } = await supabase.from("menu_products")
        .select("id").eq("id", productId).eq("restaurant_id", restaurantId).maybeSingle();
      if (error) throw error;
      if (!product) throw new ApiError(404, "Produto não encontrado.", "PRODUCT_NOT_FOUND");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validImage(bytes, file.type)) throw new ApiError(400, "Arquivo de imagem inválido.", "INVALID_IMAGE");
    const path = `${restaurantId}/${crypto.randomUUID()}.${imageTypes[file.type]}`;
    const bucket = supabase.storage.from("restaurant-images");
    const uploaded = await bucket.upload(path, bytes, { contentType: file.type,
      cacheControl: "31536000", upsert: false });
    if (uploaded.error) throw uploaded.error;
    const url = bucket.getPublicUrl(path).data.publicUrl;
    const update = productId
      ? await supabase.from("menu_products").update({ image_url: url }).eq("id", productId).eq("restaurant_id", restaurantId)
      : await supabase.from("restaurants").update({ [kind === "logo" ? "logo_url" : "cover_url"]: url }).eq("id", restaurantId);
    if (update.error) {
      await bucket.remove([path]);
      throw update.error;
    }
    await audit(supabase, user.id, "restaurant.image_uploaded", productId ? "menu_product" : "restaurant", productId || restaurantId, { kind });
    return Response.json({ url });
  } catch (error) { return jsonError(error); }
}
