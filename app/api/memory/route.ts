import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clearMemory, markExperienced, pairCookie, readMemory, reviewHash, saveExperienceReview, updateFeedback, validPairId } from "../../../lib/memory-store";
import { deriveProfile } from "../../../lib/relationship-memory";
import { interpretPreferenceNote, signalSchema, type PreferenceSignal, type PreferenceEvidence } from "../../../lib/practical-preferences";
import { canExperience, interpretExperience, reviewFingerprint, reviewInputSchema } from "../../../lib/post-experience";
import { normalizeLocale, translate } from "../../../lib/i18n";

export const runtime = "edge";

function pairId(request: NextRequest) {
  const existing = request.cookies.get(pairCookie)?.value;
  return validPairId(existing) ? existing : crypto.randomUUID();
}

function respond(value: unknown, id: string, status = 200) {
  const record = value as { chapters?: Array<{ pairId: string }> };
  const publicValue = record.chapters ? { ...record, chapters: record.chapters.map(chapter => {
    const publicChapter = { ...chapter } as Partial<typeof chapter>;
    delete publicChapter.pairId;
    return publicChapter;
  }) } : value;
  const response = NextResponse.json(publicValue, { status, headers: { "Cache-Control": "no-store" } });
  response.cookies.set(pairCookie, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
  return response;
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

const experienceSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("experienced"), chapterId: z.string().uuid(), locale: z.enum(["en", "ja"]).optional() }).strict(),
  z.object({ action: z.literal("review"), chapterId: z.string().uuid(), review: reviewInputSchema, locale: z.enum(["en", "ja"]).optional() }).strict(),
]);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const locale = normalizeLocale(body && typeof body === "object" ? (body as { locale?: unknown }).locale : undefined);
  if (!sameOrigin(request)) return NextResponse.json({ error: translate(locale, "memory.error.invalidOrigin") }, { status: 403 });
  const parsed = experienceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: translate(locale, "memory.error.invalidReaction") }, { status: 400 });
  const id = pairId(request);
  try {
    if (!env.DB) throw new Error("Storage unavailable");
    const { chapterId, action } = parsed.data;
    const snapshot = await readMemory(env.DB, id);
    const chapter = snapshot.chapters.find(item => item.id === chapterId);
    if (!chapter || !canExperience(chapter)) return respond({ error: translate(locale, "memory.error.liveRequired") }, id, 404);
    if (action === "experienced") {
      if (!await markExperienced(env.DB, id, chapterId)) return respond({ error: translate(locale, "memory.error.notFound") }, id, 404);
    } else {
      if (!chapter.experiencedAt) return respond({ error: translate(locale, "memory.error.markTried") }, id, 409);
      const input = parsed.data.review;
      const hash = await reviewFingerprint(input);
      if ((await reviewHash(env.DB, id, chapterId, input.person))?.hash === hash) return respond(await readMemory(env.DB, id), id);
      const key = process.env.OPENAI_API_KEY;
      if ((input.note || input.chips.length) && !key) return respond({ error: translate(locale, "memory.error.noteUnavailable") }, id, 503);
      const interpreted = input.note || input.chips.length ? await interpretExperience(input, key!, process.env.OPENAI_MODEL ?? "gpt-4o-mini") : { taste: [], practical: [] };
      if (!await saveExperienceReview(env.DB, id, chapterId, input, interpreted, hash)) return respond({ error: translate(locale, "memory.error.notFound") }, id, 404);
    }
    return respond(await readMemory(env.DB, id), id);
  } catch {
    return respond({ error: translate(locale, "memory.error.reactionSave") }, id, 503);
  }
}

export async function GET(request: NextRequest) {
  const id = pairId(request);
  try {
    if (!env.DB) throw new Error("Storage unavailable");
    return respond(await readMemory(env.DB, id), id);
  } catch {
    return respond({ chapters: [], profile: deriveProfile([]), persistence: "unavailable" }, id, 503);
  }
}

const feedbackSchema = z.object({ chapterId: z.string().uuid(), feedback: z.enum(["liked", "good_surprise", "neutral", "not_for_us"]), reflection: z.string().max(2000).optional(), preference: signalSchema.optional(), status: z.enum(["suggested", "tried", "skipped"]).optional(), locale: z.enum(["en", "ja"]).optional() }).strict();

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const locale = normalizeLocale(body && typeof body === "object" ? (body as { locale?: unknown }).locale : undefined);
  if (!sameOrigin(request)) return NextResponse.json({ error: translate(locale, "memory.error.invalidOrigin") }, { status: 403 });
  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: translate(locale, "memory.error.invalidFeedback") }, { status: 400 });
  const id = pairId(request);
  try {
    if (!env.DB) throw new Error("Storage unavailable");
    const { chapterId, feedback, reflection, preference, status } = parsed.data;
    const snapshot = await readMemory(env.DB, id);
    if (!snapshot.chapters.some(chapter => chapter.id === chapterId && chapter.state === "LIVE")) return respond({ error: translate(locale, "memory.error.notFound") }, id, 404);
    const signals: Array<PreferenceSignal & { source: PreferenceEvidence["source"] }> = preference ? [{ ...preference, source: "explicit_chip" }] : [];
    if (reflection?.trim()) {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return respond({ error: translate(locale, "memory.error.preferenceUnavailable") }, id, 503);
      signals.push(...(await interpretPreferenceNote(reflection, key, process.env.OPENAI_MODEL ?? "gpt-4o-mini")).filter(signal => signal.dimension !== preference?.dimension).map(signal => ({ ...signal, source: "free_text" as const })));
    }
    if (!await updateFeedback(env.DB, id, chapterId, feedback, reflection, signals, status ?? (feedback === "not_for_us" ? "skipped" : undefined))) return respond({ error: translate(locale, "memory.error.notFound") }, id, 404);
    return respond(await readMemory(env.DB, id), id);
  } catch {
    return respond({ error: translate(locale, "memory.error.feedbackSave") }, id, 503);
  }
}

export async function DELETE(request: NextRequest) {
  const locale = normalizeLocale(new URL(request.url).searchParams.get("locale"));
  if (!sameOrigin(request)) return NextResponse.json({ error: translate(locale, "memory.error.invalidOrigin") }, { status: 403 });
  const id = pairId(request);
  try {
    if (!env.DB) throw new Error("Storage unavailable");
    await clearMemory(env.DB, id);
    return respond({ chapters: [], profile: deriveProfile([]), persistence: "D1" }, crypto.randomUUID());
  } catch {
    return respond({ error: translate(locale, "memory.error.reset") }, id, 503);
  }
}
