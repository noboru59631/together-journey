import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { archetypes } from "../../../lib/solo-partner";
import { clearSolo, markSoloExperienced, readSolo, saveSoloReview, soloCookie, updateSoloFeedback, updateSoloSettings, validSoloId } from "../../../lib/solo-store";
import { interpretExperience, reviewInputSchema } from "../../../lib/post-experience";
import { signalSchema } from "../../../lib/practical-preferences";
import { normalizeLocale, translate } from "../../../lib/i18n";

export const runtime = "edge";
const sessionId = (request: NextRequest) => { const existing = request.cookies.get(soloCookie)?.value; return validSoloId(existing) ? existing : crypto.randomUUID(); };
const sameOrigin = (request: NextRequest) => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin;
function respond(value: unknown, id: string, status = 200) {
  const response = NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
  response.cookies.set(soloCookie, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
  return response;
}

export async function GET(request: NextRequest) {
  const id = sessionId(request);
  try { if (!env.DB) throw new Error("Storage unavailable"); return respond(await readSolo(env.DB, id), id); }
  catch { return respond({ error: "Solo memory unavailable" }, id, 503); }
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("archetype"), archetype: z.enum(archetypes) }).strict(),
  z.object({ action: z.literal("feedback"), chapterId: z.string().uuid(), feedback: z.enum(["liked", "good_surprise", "neutral", "not_for_us"]), reflection: z.string().max(2000).optional(), preference: signalSchema.optional() }).strict(),
]);
export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid solo update" }, { status: 400 });
  const id = sessionId(request);
  try {
    if (!env.DB) throw new Error("Storage unavailable");
    if (parsed.data.action === "archetype") return respond(await updateSoloSettings(env.DB, id, parsed.data.archetype), id);
    const { chapterId, feedback, reflection, preference } = parsed.data;
    if (!await updateSoloFeedback(env.DB, id, chapterId, feedback, reflection, preference)) return respond({ error: "Chapter not found" }, id, 404);
    return respond(await readSolo(env.DB, id), id);
  } catch { return respond({ error: "Could not update solo memory" }, id, 503); }
}

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("experienced"), chapterId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("review"), chapterId: z.string().uuid(), review: reviewInputSchema, locale: z.enum(["en", "ja"]).optional() }).strict(),
]);
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid reaction" }, { status: 400 });
  const id = sessionId(request);
  const locale = normalizeLocale(parsed.data.action === "review" ? parsed.data.locale : undefined);
  try {
    if (!env.DB) throw new Error("Storage unavailable");
    if (parsed.data.action === "experienced") {
      if (!await markSoloExperienced(env.DB, id, parsed.data.chapterId)) return respond({ error: translate(locale, "memory.error.notFound") }, id, 404);
    } else {
      const { chapterId, review } = parsed.data;
      if (review.person !== "A") return respond({ error: "Solo reactions belong to you" }, id, 400);
      const key = process.env.OPENAI_API_KEY;
      if ((review.note || review.chips.length) && !key) return respond({ error: translate(locale, "memory.error.noteUnavailable") }, id, 503);
      const interpreted = review.note || review.chips.length ? await interpretExperience(review, key!, process.env.OPENAI_MODEL ?? "gpt-4o-mini") : { taste: [], practical: [] };
      if (!await saveSoloReview(env.DB, id, chapterId, review, interpreted)) return respond({ error: translate(locale, "memory.error.markTried") }, id, 409);
    }
    return respond(await readSolo(env.DB, id), id);
  } catch { return respond({ error: translate(locale, "memory.error.reactionSave") }, id, 503); }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const id = sessionId(request);
  try { if (!env.DB) throw new Error("Storage unavailable"); await clearSolo(env.DB, id); const nextId = crypto.randomUUID(); return respond(await readSolo(env.DB, nextId), nextId); }
  catch { return respond({ error: "Could not reset solo memory" }, id, 503); }
}
