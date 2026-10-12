import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeLocale, translate } from "../../../lib/i18n";
import { pairCookie, readMemory, validPairId } from "../../../lib/memory-store";
import { createRecoveryCode, hashRecoveryClient, recoveryStatus, recoveryTypes, redeemRecoveryCode, revokeRecoveryCode, type RecoveryType } from "../../../lib/recovery";
import { readSolo, soloCookie, validSoloId } from "../../../lib/solo-store";

export const runtime = "edge";
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), type: z.enum(recoveryTypes), locale: z.enum(["en", "ja"]).optional() }).strict(),
  z.object({ action: z.literal("redeem"), type: z.enum(recoveryTypes), code: z.string().min(1).max(64), locale: z.enum(["en", "ja"]).optional() }).strict(),
  z.object({ action: z.literal("revoke"), type: z.enum(recoveryTypes), locale: z.enum(["en", "ja"]).optional() }).strict(),
]);

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function currentId(request: NextRequest, type: RecoveryType) {
  const value = request.cookies.get(type === "pair" ? pairCookie : soloCookie)?.value;
  return type === "pair" ? validPairId(value) ? value : null : validSoloId(value) ? value : null;
}

function response(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function setProfileCookie(result: NextResponse, type: RecoveryType, id: string) {
  result.cookies.set(type === "pair" ? pairCookie : soloCookie, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
}

export async function GET(request: NextRequest) {
  const type = new URL(request.url).searchParams.get("type");
  if (!recoveryTypes.includes(type as RecoveryType)) return response({ error: "Invalid recovery request" }, 400);
  const id = currentId(request, type as RecoveryType);
  if (!id) return response({ active: false, createdAt: null, lastUsedAt: null });
  try {
    if (!env.DB) throw new Error("Storage unavailable");
    return response(await recoveryStatus(env.DB, type as RecoveryType, id));
  } catch {
    return response({ error: "Recovery is temporarily unavailable" }, 503);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const locale = normalizeLocale(body && typeof body === "object" ? (body as { locale?: unknown }).locale : undefined);
  if (!sameOrigin(request)) return response({ error: translate(locale, "recovery.error.generic") }, 403);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return response({ error: translate(locale, "recovery.error.generic") }, 400);
  try {
    if (!env.DB) throw new Error("Storage unavailable");
    const { action, type } = parsed.data;
    if (action === "redeem") {
      const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const clientHash = await hashRecoveryClient(`${forwarded}|${request.headers.get("user-agent") ?? "unknown"}`);
      const id = await redeemRecoveryCode(env.DB, type, parsed.data.code, clientHash);
      if (!id) return response({ error: translate(locale, "recovery.error.generic") }, 400);
      const result = response({ recovered: true, type });
      setProfileCookie(result, type, id);
      return result;
    }
    const id = currentId(request, type);
    if (!id) return response({ error: translate(locale, "recovery.error.generic") }, 400);
    if (type === "pair") await readMemory(env.DB, id); else await readSolo(env.DB, id);
    if (action === "revoke") {
      await revokeRecoveryCode(env.DB, type, id);
      return response({ active: false });
    }
    const code = await createRecoveryCode(env.DB, type, id);
    return response({ active: true, code });
  } catch {
    return response({ error: translate(locale, "recovery.error.generic") }, 503);
  }
}
