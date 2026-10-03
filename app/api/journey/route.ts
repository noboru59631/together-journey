import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const cookieName = "together_journey";

function journeyId(request: NextRequest) {
  const value = request.cookies.get(cookieName)?.value;
  return value && /^[a-f0-9-]{36}$/i.test(value) ? value : crypto.randomUUID();
}

function withJourneyCookie(response: NextResponse, id: string) {
  response.cookies.set(cookieName, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
  return response;
}

export async function GET(request: NextRequest) {
  const id = journeyId(request);
  try {
    if (!env.DB) throw new Error("D1 unavailable");
    const result = await env.DB.prepare("SELECT entity_id, qloo_entity_id, title, reaction, reflection, experienced_at FROM experiences WHERE journey_id = ? ORDER BY experienced_at DESC LIMIT 50").bind(id).all();
    return withJourneyCookie(NextResponse.json({ experiences: result.results, persistence: "D1" }), id);
  } catch {
    return NextResponse.json({ experiences: [], persistence: "unavailable" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const required = ["entityId", "title", "type", "reaction"];
  if (required.some(field => typeof body[field] !== "string" || !(body[field] as string).trim())) return NextResponse.json({ error: "Missing journey fields" }, { status: 400 });
  if ((body.title as string).length > 160 || (typeof body.reflection === "string" && body.reflection.length > 2000)) return NextResponse.json({ error: "Journey entry too long" }, { status: 400 });
  const id = journeyId(request);
  try {
    if (!env.DB) throw new Error("D1 unavailable");
    await env.DB.prepare("INSERT INTO experiences (id, journey_id, entity_id, qloo_entity_id, title, type, reaction, reflection, cultural_signals, emotional_signals, with_whom, discovered_from, experienced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(journey_id, entity_id) DO UPDATE SET reaction=excluded.reaction, reflection=excluded.reflection, experienced_at=excluded.experienced_at").bind(
      crypto.randomUUID(), id, body.entityId, typeof body.qlooEntityId === "string" ? body.qlooEntityId : null, body.title, body.type, body.reaction,
      typeof body.reflection === "string" ? body.reflection : "", JSON.stringify(body.culturalSignals ?? []), "[]", "Mika", "Lost in Translation", new Date().toISOString()
    ).run();
    return withJourneyCookie(NextResponse.json({ saved: true, persistence: "D1" }), id);
  } catch {
    return NextResponse.json({ saved: false, error: "Journey storage is temporarily unavailable" }, { status: 503 });
  }
}
