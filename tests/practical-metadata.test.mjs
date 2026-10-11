import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadTypescript } from "./load-typescript.mjs";

const filename = fileURLToPath(new URL("../lib/practical-metadata.ts", import.meta.url));
const metadata = loadTypescript(filename);
const preferences = loadTypescript(fileURLToPath(new URL("../lib/practical-preferences.ts", import.meta.url)));
const store = loadTypescript(fileURLToPath(new URL("../lib/memory-store.ts", import.meta.url)));
const source = "https://hackathon.api.qloo.com/v2/insights";
const candidate = (id, price_level, description) => ({ category: "place", entity: { entity_id: id, types: ["urn:entity:place"], properties: { price_level, description } } });
const enriched = value => ({ ...value, practical: metadata.normalizeMetadata(value, source) });
const profile = dimension => [{ dimension, score: -2, count: 1, weight: 1 }];

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle", import.meta.url)).filter(file => file.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  const prepare = sql => ({ bind: (...values) => ({
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
  }) });
  return { sqlite, prepare, async batch(statements) {
    sqlite.exec("BEGIN");
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
}

test("structured price is verified, coarse, auditable and does not infer from prose", () => {
  for (const [level, band] of [[1, "budget"], [2, "mid-range"], [3, "premium"], [4, "premium"]]) {
    const result = metadata.normalizeMetadata(candidate("qloo", level), source);
    assert.equal(result.price.value, band);
    assert.equal(result.price.evidence_type, "verified");
    assert.equal(result.price.evidence_source, source);
    assert.match(result.price.raw_evidence, new RegExp(`=${level}$`));
    assert.ok(Date.parse(result.price.expires_at) > Date.parse(result.price.fetched_at));
  }
  for (const invalid of [undefined, null, 0, 5, "2", 1.5]) assert.equal(metadata.normalizeMetadata(candidate("qloo", invalid, "A luxury affordable restaurant"), source).price.value, "unknown");
});

test("no price preference and unknown price contribute zero; supported preference changes order deterministically", () => {
  const values = [enriched(candidate("premium", 4)), enriched(candidate("budget", 1))];
  assert.equal(preferences.rerankCandidates(values, []).changed, false);
  assert.equal(preferences.rerankCandidates(values, profile("crowds")).changed, false);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ranked = preferences.rerankCandidates(values, profile("budget"));
    assert.equal(ranked.ranked[0].candidate.entity.entity_id, "budget");
    assert.match(ranked.ranked[0].contributors[0].evidence, /Verified Qloo price/);
  }
  const unknown = preferences.rerankCandidates([enriched(candidate("one")), enriched(candidate("two", undefined, "premium"))], profile("budget"));
  assert.equal(unknown.changed, false);
  assert.equal(unknown.rationale, "");
  assert.ok(unknown.ranked.every(item => item.score === 0));
  const middle = preferences.rerankCandidates([enriched(candidate("middle", 2))], profile("budget"));
  assert.equal(middle.ranked[0].score, 0);
});

test("crowd description is a weaker labeled hint; missing, negated and contradictory hints are unknown", () => {
  const values = [enriched(candidate("busy", undefined, "A busy venue")), enriched(candidate("quieter", undefined, "Less crowded"))];
  const ranked = preferences.rerankCandidates(values, profile("crowds"));
  assert.equal(ranked.ranked[0].candidate.entity.entity_id, "quieter");
  assert.equal(ranked.ranked[0].score, 0.35);
  assert.match(ranked.rationale, /not verified busy-time data/);
  assert.match(metadata.practicalChips(values[1].practical)[0].label, /Crowd hint.*description/);
  for (const description of [undefined, "quiet", "Not crowded", "uncrowded mornings, busy evenings", "popular", "not very busy", "neither busy nor crowded"]) {
    const value = enriched(candidate("unknown", undefined, description));
    assert.equal(value.practical.crowd.value, "unknown");
    assert.equal(metadata.practicalChips(value.practical).length, 0);
    assert.equal(preferences.rerankCandidates([value], profile("crowds")).ranked[0].score, 0);
  }
});

test("stale, future and unsupported metadata produce neither chips nor rationale", () => {
  const value = enriched(candidate("stale", 1, "uncrowded"));
  for (const item of [value.practical.price, value.practical.crowd]) item.expires_at = "2020-01-01T00:00:00.000Z";
  assert.equal(metadata.practicalChips(value.practical).length, 0);
  assert.equal(preferences.rerankCandidates([enriched(candidate("other", 4)), value], profile("budget")).ranked.find(item => item.candidate === value).contributors.length, 0);
  value.practical.price.expires_at = "2099-01-01T00:00:00.000Z";
  value.practical.price.fetched_at = "2098-01-01T00:00:00.000Z";
  assert.equal(metadata.practicalChips(value.practical).length, 0);
});

test("changes below the winner do not claim that the recommendation changed", () => {
  const result = preferences.rerankCandidates([enriched(candidate("first", 1)), enriched(candidate("second", 4)), enriched(candidate("third", 1))], profile("budget"));
  assert.equal(result.changed, true);
  assert.equal(result.recommendationChanged, false);
  assert.equal(result.rationale, "");
});

test("ID lookup never adopts another entity and provider failure preserves every grounded candidate", async () => {
  for (const fetch of [async () => { throw new Error("offline"); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ results: [candidate("wrong", 1).entity] }) })]) {
    const implementation = loadTypescript(filename, { fetch });
    const original = [candidate("one"), candidate("two"), { category: "book", entity: { entity_id: "book" } }];
    const result = await implementation.enrichCandidates(original, { base: "https://hackathon.api.qloo.com", key: "mock" });
    assert.equal(JSON.stringify(result.candidates.map(item => item.entity)), JSON.stringify(original.map(item => item.entity)));
    assert.equal(result.candidates[0].practical.price.value, "unknown");
    assert.equal(result.candidates[2].practical, undefined);
  }
});

test("D1 cache survives reload, TTL refreshes stale evidence, failure never reuses stale data, reset preserves shared cache", async () => {
  const db = database();
  let calls = 0;
  let failed = false;
  const implementation = loadTypescript(filename, { fetch: async url => {
    calls += 1;
    assert.equal(url.pathname, "/entities");
    assert.equal(url.searchParams.get("entity_ids"), "one,two");
    if (failed) throw new Error("offline");
    return { ok: true, json: async () => ({ results: [candidate("one", 1, "uncrowded").entity, candidate("two", 4, "busy").entity] }) };
  } });
  const now = Date.now();
  const options = { database: db, base: "https://hackathon.api.qloo.com", key: "mock", now };
  const values = [candidate("one"), candidate("two")];
  try {
    const first = await implementation.enrichCandidates(values, options);
    assert.equal(first.trace.refreshed, 2);
    assert.equal(first.candidates[0].practical.price.value, "budget");
    const reloaded = loadTypescript(filename, { fetch: async () => { throw new Error("must use cache"); } });
    assert.equal((await reloaded.enrichCandidates(values, { ...options, now: now + 1000 })).trace.cacheHits, 2);
    await implementation.enrichCandidates(values, { ...options, now: now + 7 * 60 * 60_000 });
    assert.equal(calls, 2);
    failed = true;
    const stale = await implementation.enrichCandidates(values, { ...options, now: now + 32 * 60 * 60_000 });
    assert.equal(stale.trace.providerStatus, "unavailable");
    assert.equal(stale.candidates[0].practical.price.value, "unknown");
    assert.equal(metadata.practicalChips(stale.candidates[0].practical, now + 32 * 60 * 60_000).length, 0);
    const pairId = "11111111-1111-4111-8111-111111111111";
    db.sqlite.prepare("INSERT INTO practical_evidence (pair_id, chapter_id, entity_id, dimension, value, weight, source, timestamp) VALUES (?, 'chapter', 'one', 'crowds', -1, 1, 'free_text', 'now')").run(pairId);
    await store.clearMemory(db, pairId);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM practical_evidence").get().count, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM candidate_practical_metadata").get().count, 2);
  } finally { db.sqlite.close(); }
});

test("cache failure does not break enrichment and unknown has a short negative TTL", async () => {
  const implementation = loadTypescript(filename, { fetch: async () => ({ ok: true, json: async () => ({ results: [] }) }) });
  const result = await implementation.enrichCandidates([candidate("missing")], { database: { prepare() { throw new Error("cache failed"); } }, base: "https://hackathon.api.qloo.com", key: "mock" });
  assert.equal(result.trace.cacheFailures, 2);
  const price = result.candidates[0].practical.price;
  assert.equal(Date.parse(price.expires_at) - Date.parse(price.fetched_at), 15 * 60_000);
});
