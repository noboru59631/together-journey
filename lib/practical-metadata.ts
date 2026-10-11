import { z } from "zod";

const evidenceSchema = z.object({
  value: z.string(), evidence_source: z.string().url(), evidence_type: z.enum(["verified", "heuristic", "unknown"]),
  evidence_confidence: z.number().min(0).max(1), source_type: z.enum(["structured_price", "description_phrase", "unavailable"]),
  raw_evidence: z.string().max(240), fetched_at: z.string().datetime(), expires_at: z.string().datetime(),
}).strict();
export const metadataSchema = z.object({
  entity_id: z.string().min(1),
  price: evidenceSchema.extend({ value: z.enum(["budget", "mid-range", "premium", "unknown"]) }),
  crowd: evidenceSchema.extend({ value: z.enum(["quieter", "moderate", "busy", "unknown"]) }),
}).strict();
export type PracticalMetadata = z.infer<typeof metadataSchema>;
export type MetadataCandidate = { category: string; entity: { entity_id?: unknown; id?: unknown; types?: unknown; type?: unknown; properties?: { price_level?: unknown; description?: unknown } }; practical?: PracticalMetadata };
type Evidence = PracticalMetadata["price"] | PracticalMetadata["crowd"];
const minute = 60_000;
const candidateId = (candidate: MetadataCandidate) => String(candidate.entity.entity_id ?? candidate.entity.id ?? "");

export function supportedEvidence(evidence: Evidence | undefined, now = Date.now()): boolean {
  return Boolean(evidence && evidence.value !== "unknown" && evidence.evidence_type !== "unknown" && evidence.evidence_confidence > 0 && Date.parse(evidence.fetched_at) <= now && Date.parse(evidence.expires_at) > now);
}

export function normalizeMetadata(candidate: MetadataCandidate, source: string, now = Date.now()): PracticalMetadata {
  const unavailable = { evidence_source: source, evidence_type: "unknown" as const, evidence_confidence: 0, source_type: "unavailable" as const, raw_evidence: "", fetched_at: new Date(now).toISOString(), expires_at: new Date(now + 15 * minute).toISOString() };
  const metadata: PracticalMetadata = { entity_id: candidateId(candidate), price: { ...unavailable, value: "unknown" }, crowd: { ...unavailable, value: "unknown" } };
  if (candidate.category !== "place") return metadata;
  const level = candidate.entity.properties?.price_level;
  if (typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 4) {
    metadata.price = { ...unavailable, value: level === 1 ? "budget" : level === 2 ? "mid-range" : "premium", evidence_type: "verified", evidence_confidence: 1, source_type: "structured_price", raw_evidence: `properties.price_level=${level}`, expires_at: new Date(now + 24 * 60 * minute).toISOString() };
  }
  const description = candidate.entity.properties?.description;
  if (typeof description === "string") {
    const negative = /\b(uncrowded|less crowded)\b/i;
    const positive = /\b(crowded|busy|bustling)\b/i;
    const lower = negative.test(description), upper = positive.test(description.replace(negative, ""));
    const match = description.match(lower ? negative : positive);
    if (lower !== upper && match && !/\b(not|never|no|without|neither|nor)\s+(?:\w+\s+){0,2}$/i.test(description.slice(0, match.index))) {
      metadata.crowd = { ...unavailable, value: lower ? "quieter" : "busy", evidence_type: "heuristic", evidence_confidence: 0.35, source_type: "description_phrase", raw_evidence: match[0], expires_at: new Date(now + 6 * 60 * minute).toISOString() };
    }
  }
  return metadata;
}

export function practicalChips(metadata: PracticalMetadata | undefined, now = Date.now()) {
  if (!metadata) return [];
  const chips: Array<{ label: string; source: string; detail: string }> = [];
  if (supportedEvidence(metadata.price, now) && metadata.price.evidence_type === "verified") chips.push({ label: metadata.price.value === "mid-range" ? "Mid-range" : metadata.price.value === "budget" ? "Budget" : "Premium", source: metadata.price.evidence_source, detail: `${metadata.price.raw_evidence} · checked ${metadata.price.fetched_at}` });
  if (supportedEvidence(metadata.crowd, now)) chips.push({ label: metadata.crowd.evidence_type === "verified" ? `Crowd evidence: ${metadata.crowd.value}` : `Crowd hint: ${metadata.crowd.value} (description)`, source: metadata.crowd.evidence_source, detail: `${metadata.crowd.evidence_type} · ${metadata.crowd.raw_evidence} · not live occupancy · checked ${metadata.crowd.fetched_at}` });
  return chips;
}

export async function enrichCandidates<Candidate extends MetadataCandidate>(candidates: Candidate[], options: { database?: D1Database; base: string; key: string; now?: number }) {
  const now = options.now ?? Date.now();
  const source = new URL("/v2/insights", options.base).toString();
  const trace = { attempted: 0, cacheHits: 0, refreshed: 0, provider: "Qloo", providerStatus: "not_needed", cacheFailures: 0 };
  const metadata = new Map<string, PracticalMetadata>();
  const missing: Candidate[] = [];
  for (const candidate of candidates.filter(candidate => candidate.category === "place")) {
    const id = candidateId(candidate);
    trace.attempted += 1;
    try {
      const row = await options.database?.prepare("SELECT payload FROM candidate_practical_metadata WHERE entity_id = ?").bind(id).first<{ payload: string }>();
      const parsed = row ? metadataSchema.safeParse(JSON.parse(row.payload)) : null;
      if (parsed?.success && parsed.data.entity_id === id && [parsed.data.price, parsed.data.crowd].every(item => Date.parse(item.fetched_at) <= now && Date.parse(item.expires_at) > now)) {
        metadata.set(id, parsed.data); trace.cacheHits += 1; continue;
      }
    } catch { trace.cacheFailures += 1; }
    missing.push(candidate);
  }
  if (missing.length) {
    const url = new URL("/entities", options.base);
    url.searchParams.set("entity_ids", [...new Set(missing.map(candidateId))].join(","));
    let entities: MetadataCandidate["entity"][] = [];
    try {
      const response = await fetch(url, { headers: { "X-Api-Key": options.key, Accept: "application/json" }, signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error("Enrichment unavailable");
      const payload = await response.json() as { results?: { entities?: unknown } | unknown[]; entities?: unknown };
      const result = payload.results;
      const values = Array.isArray(result) ? result : result && typeof result === "object" ? result.entities : payload.entities;
      if (!Array.isArray(values)) throw new Error("Enrichment response invalid");
      entities = values.filter(item => item && typeof item === "object");
      trace.providerStatus = "ok";
    } catch { trace.providerStatus = "unavailable"; }
    for (const candidate of missing) {
      const id = candidateId(candidate);
      const matched = entities.find(entity => (entity.entity_id ?? entity.id) === id && (entity.type === "urn:entity:place" || Array.isArray(entity.types) && entity.types.includes("urn:entity:place")));
      const original = normalizeMetadata(candidate, source, now);
      const fetched = matched ? normalizeMetadata({ ...candidate, entity: matched }, url.toString(), now) : null;
      const practical = { ...original, price: fetched && supportedEvidence(fetched.price, now) ? fetched.price : original.price, crowd: fetched && supportedEvidence(fetched.crowd, now) ? fetched.crowd : original.crowd };
      if (trace.providerStatus === "unavailable") for (const item of [practical.price, practical.crowd]) if (item.value === "unknown") item.expires_at = new Date(now + minute).toISOString();
      metadata.set(id, practical); trace.refreshed += 1;
      try {
        await options.database?.prepare("INSERT INTO candidate_practical_metadata (entity_id, payload) VALUES (?, ?) ON CONFLICT(entity_id) DO UPDATE SET payload = excluded.payload").bind(id, JSON.stringify(practical)).run();
      } catch { trace.cacheFailures += 1; }
    }
  }
  return { candidates: candidates.map(candidate => ({ ...candidate, practical: metadata.get(candidateId(candidate)) })), trace };
}
