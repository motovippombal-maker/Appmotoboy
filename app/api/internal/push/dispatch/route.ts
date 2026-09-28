import { timingSafeEqual } from "node:crypto";
import { ApiError, jsonError } from "@/lib/backend/api";
import { dispatchPushQueue } from "@/lib/backend/push";

function matchesSecret(received: string | null, expected: string) {
  if (!received?.startsWith("Bearer ")) return false;
  const token = Buffer.from(received.slice(7));
  const secret = Buffer.from(expected);
  return token.length === secret.length && timingSafeEqual(token, secret);
}

export async function POST(request: Request) {
  try {
    const secret = process.env.PUSH_DISPATCH_SECRET?.trim();
    if (!secret) throw new ApiError(503, "O disparador Push ainda não foi configurado.", "PUSH_DISPATCH_NOT_CONFIGURED");
    if (!matchesSecret(request.headers.get("authorization"), secret)) throw new ApiError(401, "Credencial do disparador inválida.", "INVALID_PUSH_DISPATCH_SECRET");
    return Response.json(await dispatchPushQueue());
  } catch (error) {
    return jsonError(error);
  }
}
