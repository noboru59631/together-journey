import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clearMemory, pairCookie, readMemory, updateFeedback, validPairId } from "../../../lib/memory-store";
import { deriveProfile } from "../../../lib/relationship-memory";
import { interpretPreferenceNote, signalSchema, type PreferenceSignal, type PreferenceEvidence } from "../../../lib/practical-preferences";

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

export async function GET(request: NextRequest) {
  const id = pairId(request);
  try {
    if (!env.DB) throw new Error("Storage unavailable");
    return respond(await readMemory(env.DB, id), id);
  } catch {
    return respond({ chapters: [], profile: deriveProfile([]), persistence: "unavailable" }, id, 503);
  }
}

const feedbackSchema = z.object({ chapterId: z.string().uuid(), feedback: z.enum(["liked", "good_surprise", "neutral", "not_for_us"]), reflection: z.string().max(2000).optional(), preference: signalSchema.optional(), status: z.enum(["suggested", "tried", "skipped"]).optional() }).strict();

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = feedbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });
  const id = pairId(request);
  try {
    if (!env.DB) throw new Error("Storage unavailable");
    const { chapterId, feedback, reflection, preference, status } = parsed.data;
    const snapshot = await readMemory(env.DB, id);
    if (!snapshot.chapters.some(chapter => chapter.id === chapterId && chapter.state === "LIVE")) return respond({ error: "Chapter not found" }, id, 404);
    const signals: Array<PreferenceSignal & { source: PreferenceEvidence["source"] }> = preference ? [{ ...preference, source: "explicit_chip" }] : [];
    if (reflection?.trim()) {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return respond({ error: "Note interpretation is unavailable. Use the preference chips instead." }, id, 503);
      signals.push(...(await interpretPreferenceNote(reflection, key, process.env.OPENAI_MODEL ?? "gpt-4o-mini")).filter(signal => signal.dimension !== preference?.dimension).map(signal => ({ ...signal, source: "free_text" as const })));
    }
    if (!await updateFeedback(env.DB, id, chapterId, feedback, reflection, signals, status ?? (feedback === "not_for_us" ? "skipped" : undefined))) return respond({ error: "Chapter not found" }, id, 404);
    return respond(await readMemory(env.DB, id), id);
  } catch {
    return respond({ error: "Could not save feedback. Please try again." }, id, 503);
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const id = pairId(request);
  try {
    if (!env.DB) throw new Error("Storage unavailable");
    await clearMemory(env.DB, id);
    return respond({ chapters: [], profile: deriveProfile([]), persistence: "D1" }, crypto.randomUUID());
  } catch {
    return respond({ error: "Could not reset your Journey. Please try again." }, id, 503);
  }
}
