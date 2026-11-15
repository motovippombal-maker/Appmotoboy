export const MARKET_IMAGE_BUCKET = "marketplace-images";
export const MARKET_IMAGE_LIMIT = 3 * 1024 * 1024;
export const MARKET_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type MarketImageType = (typeof MARKET_IMAGE_TYPES)[number];

export function marketImageType(value: string | null): MarketImageType | null {
  return MARKET_IMAGE_TYPES.find((type) => type === value?.trim().toLowerCase()) ?? null;
}

export function marketImageExtension(type: MarketImageType) {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type];
}

function matches(bytes: Uint8Array, offset: number, signature: readonly number[]) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

export function marketImageSignatureValid(bytes: Uint8Array, type: MarketImageType) {
  if (bytes.length > MARKET_IMAGE_LIMIT) return false;
  if (type === "image/jpeg")
    return bytes.length >= 16 && matches(bytes, 0, [0xff, 0xd8, 0xff]) && matches(bytes, bytes.length - 2, [0xff, 0xd9]);
  if (type === "image/png")
    return bytes.length >= 45 && matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]) &&
      matches(bytes, bytes.length - 12, [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
  if (bytes.length < 30 || !matches(bytes, 0, [82, 73, 70, 70]) || !matches(bytes, 8, [87, 69, 66, 80])) return false;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return header.getUint32(4, true) === bytes.length - 8 && matches(bytes, 12, [86, 80, 56]) &&
    [32, 76, 88].includes(bytes[15]) && header.getUint32(16, true) > 0 && header.getUint32(16, true) <= bytes.length - 20;
}

export class MarketImageTooLarge extends Error {}

export async function readMarketImageBody(body: ReadableStream<Uint8Array> | null, contentLength: string | null) {
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MARKET_IMAGE_LIMIT)) throw new MarketImageTooLarge();
  if (!body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MARKET_IMAGE_LIMIT) {
        void reader.cancel().catch(() => undefined);
        throw new MarketImageTooLarge();
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
