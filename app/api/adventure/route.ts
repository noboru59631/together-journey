import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

type QlooEntity = {
  entity_id?: string;
  id?: string;
  name?: string;
  type?: string;
  subtype?: string;
  types?: string[];
  properties?: {
    description?: string;
    address?: string;
    geocode?: { city?: string };
  };
};

const demo = {
  id: "demo-tokyo-listening-bar",
  title: "A midnight listening bar",
  eyebrow: "YOUR NEXT ADVENTURE",
  description: "Follow a quiet Tokyo side street into a room built for vinyl, low light, and conversation.",
  place: "Shibuya, Tokyo",
  detail: "A prepared story · together",
  mode: "DEMO" as const,
  reason: "A prepared example inspired by the two reflections. No Qloo entity or recommendation is represented here.",
  trace: { reflections: ["Tokyo at night · lonely but beautiful", "soundtrack · indie music"], resolvedEntities: [], candidateCount: 0, knownFilteredCount: 0 },
};

function entitiesFrom(payload: unknown): QlooEntity[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const results = record.results as Record<string, unknown> | undefined;
  const values = [results?.entities, record.entities, record.results].find(Array.isArray);
  return Array.isArray(values) ? values.filter((value): value is QlooEntity => Boolean(value) && typeof value === "object") : [];
}

function entityId(entity: QlooEntity): string | undefined {
  const id = entity.entity_id ?? entity.id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

function hasType(entity: QlooEntity, type: string): boolean {
  return entity.subtype === type || entity.type === type || entity.types?.includes(type) === true;
}

async function qlooGet(url: URL, key: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "X-Api-Key": key, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("HTTP_" + response.status);
  const payload: unknown = await response.json();
  if (payload && typeof payload === "object" && (payload as { success?: boolean }).success === false) throw new Error("QLOO_UNSUCCESSFUL");
  return payload;
}

async function resolveEntity(base: string, key: string, name: string, type: string) {
  const url = new URL("/search", base);
  url.searchParams.set("query", name);
  url.searchParams.set("types", type);
  url.searchParams.set("take", "20");
  const entity = entitiesFrom(await qlooGet(url, key)).find(item => typeof item.name === "string" && item.name.toLocaleLowerCase() === name.toLocaleLowerCase() && hasType(item, type) && entityId(item));
  if (!entity) throw new Error("RESOLVE_FAILED");
  return { id: entityId(entity)!, name: entity.name!, type };
}

function fallback(reason: string) {
  return NextResponse.json({ ...demo, mode: "FALLBACK", reason: "Qloo is unavailable (" + reason + "). This is a prepared story, not a live recommendation." });
}

export async function POST(request: NextRequest) {
  const key = process.env.QLOO_API_KEY;
  if (!key) return NextResponse.json(demo);

  const body: unknown = await request.json().catch(() => null);
  const reflections = body && typeof body === "object" && "reflections" in body && Array.isArray(body.reflections) ? body.reflections : [];
  const reflection = (who: string): string => {
    const item = reflections.find(value => value && typeof value === "object" && value.who === who);
    return item && typeof item.text === "string" ? item.text : "";
  };
  const you = reflection("you");
  const mika = reflection("mika");
  if (!/tokyo/i.test(you) || !/night/i.test(you) || !/soundtrack|indie/i.test(mika)) return fallback("unsupported conversation signals");

  try {
    if (!env.DB) return fallback("Journey history unavailable");
    const journeyId = request.cookies.get("together_journey")?.value;
    const history = journeyId && /^[a-f0-9-]{36}$/i.test(journeyId)
      ? await env.DB.prepare("SELECT entity_id, qloo_entity_id FROM experiences WHERE journey_id = ?").bind(journeyId).all<{ entity_id: string; qloo_entity_id: string | null }>()
      : { results: [] as Array<{ entity_id: string; qloo_entity_id: string | null }> };
    const known = new Set(history.results.flatMap(row => [row.entity_id, row.qloo_entity_id].filter((id): id is string => Boolean(id))));
    const base = process.env.QLOO_API_BASE_URL ?? "https://hackathon.api.qloo.com";
    const resolved = await Promise.all([
      resolveEntity(base, key, "Lost in Translation", "urn:entity:movie"),
      resolveEntity(base, key, "Phoenix", "urn:entity:artist"),
    ]);
    const url = new URL("/v2/insights", base);
    url.searchParams.set("filter.type", "urn:entity:place");
    url.searchParams.set("filter.location.query", "Tokyo");
    url.searchParams.set("signal.interests.entities", resolved.map(entity => entity.id).join(","));
    url.searchParams.set("feature.explainability", "true");
    url.searchParams.set("take", "20");
    const candidates = entitiesFrom(await qlooGet(url, key)).filter(entity => entityId(entity) && typeof entity.name === "string" && entity.name.trim() && hasType(entity, "urn:entity:place"));
    const selected = candidates.find(entity => !known.has(entityId(entity)!));
    if (!selected) return fallback(candidates.length ? "no new Qloo place" : "empty Qloo result");
    const id = entityId(selected)!;
    const knownFilteredCount = candidates.filter(entity => entityId(entity) && known.has(entityId(entity)!)).length;
    return NextResponse.json({
      id,
      qlooEntityId: id,
      title: selected.name,
      eyebrow: "YOUR NEXT ADVENTURE",
      description: selected.properties?.description?.slice(0, 260) ?? "A place returned by Qloo for these film and music signals.",
      place: selected.properties?.address ?? selected.properties?.geocode?.city ?? "Tokyo",
      detail: "Qloo place · explore together",
      mode: "LIVE",
      reason: "Qloo returned this place for the combined film and music entities in Tokyo. Together chose Phoenix as a curated soundtrack bridge; the emotional descriptions were not sent as Qloo taste signals. Together excluded IDs already saved in this Journey and reveals the first remaining Qloo result. No app affinity score is assigned.",
      trace: { reflections: [you.slice(0, 200), mika.slice(0, 200)], resolvedEntities: resolved, candidateCount: candidates.length, knownFilteredCount },
    });
  } catch (error) {
    const code = error instanceof Error ? error.name === "TimeoutError" ? "TimeoutError" : error.message : "UNKNOWN";
    const reason = code === "RESOLVE_FAILED" ? "entity resolution failed" : code === "HTTP_401" || code === "HTTP_403" ? "authentication failed" : code === "HTTP_429" ? "rate limit reached" : code.startsWith("HTTP_5") ? "Qloo server error" : code === "TimeoutError" ? "Qloo timed out" : "request failed";
    return fallback(reason);
  }
}
