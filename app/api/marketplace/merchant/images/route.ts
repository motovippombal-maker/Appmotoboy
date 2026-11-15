import { randomUUID } from "node:crypto";
import { ApiError, audit, consumeRateLimit, jsonError, requireUser } from "@/lib/backend/api";
import { requireManagementImageStore } from "@/lib/backend/marketplace-management-access";
import { requireMarketplaceOperations } from "@/lib/backend/marketplace-operation-mode";
import { managementId, isPublicMarketplaceImage } from "@/lib/marketplace/management";
import { MARKET_IMAGE_BUCKET, MarketImageTooLarge, marketImageExtension, marketImageSignatureValid, marketImageType, readMarketImageBody } from "@/lib/marketplace/image-upload";

export async function POST(request: Request) {
  try {
    const auth = await requireUser(request);
    const storeId = managementId.parse(new URL(request.url).searchParams.get("storeId"));
    await requireManagementImageStore(auth, storeId);
    await requireMarketplaceOperations(auth.supabase);
    await consumeRateLimit(auth.supabase, `market-images:${auth.user.id}`, 12, 60);
    const type = marketImageType(request.headers.get("Content-Type"));
    if (!type) throw new ApiError(415, "Escolha uma imagem JPEG, PNG ou WebP.", "MARKET_IMAGE_TYPE");
    const bytes = await readMarketImageBody(request.body, request.headers.get("Content-Length"));
    if (!marketImageSignatureValid(bytes, type)) throw new ApiError(422, "O arquivo não corresponde a uma imagem válida do formato informado.", "MARKET_IMAGE_SIGNATURE");
    await requireManagementImageStore(auth, storeId);
    const path = `${storeId}/${randomUUID()}.${marketImageExtension(type)}`;
    const bucket = auth.supabase.storage.from(MARKET_IMAGE_BUCKET);
    const { data: { publicUrl } } = bucket.getPublicUrl(path);
    if (!isPublicMarketplaceImage(publicUrl)) throw new ApiError(503, "O endereço público de imagens da loja não está configurado.", "MARKET_IMAGE_STORAGE");
    const { error } = await bucket.upload(path, bytes, { contentType: type, cacheControl: "31536000", upsert: false });
    if (error) throw new ApiError(503, "O armazenamento de imagens não está disponível. Confira a configuração de Compras e tente novamente.", "MARKET_IMAGE_STORAGE");
    try { await audit(auth.supabase, auth.user.id, "marketplace.uploadImage", "market_store", storeId, { path, type, size: bytes.byteLength }); }
    catch {
      await bucket.remove([path]).catch(() => undefined);
      throw new ApiError(503, "Não foi possível registrar a imagem. Tente novamente.", "MARKET_IMAGE_UPLOAD_FAILED");
    }
    return Response.json({ url: publicUrl }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error instanceof MarketImageTooLarge ? new ApiError(413, "Envie uma imagem de até 3 MB.", "MARKET_IMAGE_TOO_LARGE") : error);
  }
}
