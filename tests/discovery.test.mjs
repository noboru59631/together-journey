import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadTypescript } from "./load-typescript.mjs";

const load = (filename, overrides) => loadTypescript(fileURLToPath(new URL(filename, import.meta.url)), overrides);
const discovery = load("../lib/discovery.ts");
const memory = load("../lib/relationship-memory.ts");
const store = load("../lib/memory-store.ts");
const pairId = "11111111-1111-4111-8111-111111111111";
const firstId = "22222222-2222-4222-8222-222222222222";
const foodId = "33333333-3333-4333-8333-333333333333";
const outdoorId = "44444444-4444-4444-8444-444444444444";

function chapter(domain = "movie", id = firstId, timestamp = "2026-10-11T01:00:00Z") {
  return memory.createChapter({ id, pairId, timestamp, mode: "LIVE", inputs: { you: "Film and nature", partner: "Music and atmosphere" },
    entities: [{ id: "seed-film", name: "A film", type: "urn:entity:movie", participant: "you" }, { id: "seed-artist", name: "An artist", type: "urn:entity:artist", participant: "partner" }],
    participants: [{ id: "you", label: "You", likes: ["atmosphere", "nature"], dislikes: [], emotionalContext: [] }, { id: "partner", label: "Partner", likes: ["atmosphere", "music"], dislikes: [], emotionalContext: [] }],
    recommendation: { id: `candidate-${domain}`, name: `A ${domain} discovery`, category: domain, description: "Together", place: "Anywhere", rationale: "Qloo fixture" },
    discovery: { domain, status: "suggested", sourceChapterIds: [], location: "Tokyo", why: { known: "atmosphere", new: "New chapter", fits: "Qloo fixture" } } });
}

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["0000_flat_sue_storm", "0001_dizzy_iron_lad", "0002_crazy_fenris", "0003_thankful_odin", "0004_discovery_history"]) sqlite.exec(readFileSync(new URL(`../drizzle/${migration}.sql`, import.meta.url), "utf8"));
  return { sqlite, prepare: sql => ({ bind: (...values) => ({
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
  }) }), async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
}

function route(database, candidates, calls = []) {
  return load("../app/api/adventure/route.ts", {
    console,
    process: { env: { QLOO_API_KEY: "fixture-only", QLOO_API_BASE_URL: "https://qloo.test" } },
    fetch: async urlValue => {
      const url = new URL(urlValue); calls.push(url);
      if (url.pathname === "/v2/insights") return { ok: true, status: 200, json: async () => ({ results: { entities: candidates } }) };
      return { ok: true, status: 200, json: async () => ({ results: { entities: candidates } }) };
    },
    require: name => name === "cloudflare:workers" ? { env: { DB: database } } : name === "next/server" ? { NextResponse: { json: (value, init = {}) => ({ value, status: init.status ?? 200, cookies: { set() {} } }) } } : name === "zod" ? { z } : null,
  });
}

function request(domain, requestId = foodId) {
  return { url: "https://together.test/api/adventure", headers: { get: () => "https://together.test" }, cookies: { get: () => ({ value: pairId }) }, json: async () => ({ mode: "next_discovery", domain, requestId }) };
}

test("empty pair has no directions or fake Next Discovery; NEEDS_INPUT never writes", async () => {
  assert.equal(discovery.domainDirections(memory.deriveProfile([]), []).length, 0);
  const db = database(); const calls = [];
  try {
    const result = await route(db, [], calls).POST(request());
    assert.equal(result.value.mode, "NEEDS_INPUT"); assert.equal(calls.length, 0);
    assert.equal((await store.readMemory(db, pairId)).profile.exploration.length, 0);
  } finally { db.sqlite.close(); }
});

test("supported unexplored directions require real prior tags and grounded IDs from both people", () => {
  const first = chapter(); const profile = memory.deriveProfile([first]);
  const directions = discovery.domainDirections(profile, [first]);
  const food = directions.find(item => item.category === "food");
  assert.ok(food.evidence.includes("atmosphere")); assert.equal(food.sourceChapterIds[0], firstId); assert.equal(food.explored, false);
  assert.ok(directions.some(item => item.category === "outdoor"));
  first.reactions.forEach(reaction => { reaction.tags = ["unmapped personal detail"]; });
  assert.equal(discovery.domainDirections(memory.deriveProfile([first]), [first]).length, 0);
});

test("unexplored novelty, repeated domain and same-domain streak have auditable weights", () => {
  const first = chapter("food"); const second = chapter("food", foodId, "2026-10-11T02:00:00Z");
  const directions = discovery.domainDirections(memory.deriveProfile([second, first]), [second, first]);
  const food = directions.find(item => item.category === "food");
  assert.equal(food.contributors.repetition, -4); assert.equal(food.contributors.streak, -8);
  assert.equal(directions.find(item => item.category === "culture").contributors.unexplored, 3);
  assert.equal(discovery.domainDirections(memory.deriveProfile([first]), [first], [], true).find(item => item.category === "culture").contributors.unexplored, 5);
});

test("candidate repetition excludes exact IDs, normalized names and near duplicates", () => {
  const first = chapter(); first.recommendation = { ...first.recommendation, id: "old", name: "The Quiet Garden Café Tokyo" };
  const candidate = (id, name, description = "") => ({ category: "food", entity: { entity_id: id, name, properties: { description } } });
  const ranking = discovery.rankDiscoveries([candidate("old", "Different name"), candidate("alias", "The quiet garden cafe Tokyo!"), candidate("near", "The Quiet Garden Café Tokyo Central"), candidate("fresh", "Another café")], [first], []);
  assert.equal(ranking.excluded, 3); assert.equal(ranking.ranked.length, 1); assert.equal(ranking.ranked[0].novelty, 2);
});

test("feedback and practical evidence change future domains and candidates deterministically", () => {
  const first = chapter("food");
  const score = () => discovery.domainDirections(memory.deriveProfile([first]), [first]).find(item => item.category === "food").score;
  first.feedback = "good_surprise"; const good = score(); first.feedback = "not_for_us";
  assert.equal(discovery.domainDirections(memory.deriveProfile([first]), [first]).length, 0);
  const second = chapter("movie", foodId); const both = [second, first];
  const rejected = discovery.domainDirections(memory.deriveProfile(both), both).find(item => item.category === "food").score;
  first.feedback = "good_surprise";
  assert.ok(discovery.domainDirections(memory.deriveProfile(both), both).find(item => item.category === "food").score > rejected);
  assert.ok(Number.isFinite(good));
  const candidates = [{ category: "place", entity: { entity_id: "busy", name: "Busy", properties: { description: "lively indoors" } } }, { category: "place", entity: { entity_id: "calm", name: "Calm", properties: { description: "quiet indoors" } } }];
  assert.equal(discovery.rankDiscoveries(candidates, [], []).ranked[0].candidate.entity.name, "Busy");
  assert.equal(discovery.rankDiscoveries(candidates, [], [{ dimension: "quiet", score: -2, count: 1, weight: 2 }]).ranked[0].candidate.entity.name, "Calm");
});

test("unsupported categories cannot be grounded; subdomains require Qloo metadata", async () => {
  const first = chapter(); const dirs = discovery.domainDirections(memory.deriveProfile([first]), [first]);
  for (const domain of ["camping", "fishing", "videogame", "events"]) assert.equal(dirs.some(item => item.category === domain), false);
  assert.equal(discovery.fitsDomain({ name: "Jazz café" }, "food"), false);
  assert.equal(discovery.fitsDomain({ properties: { description: "Not a restaurant" } }, "food"), false);
  assert.equal(discovery.fitsDomain({ properties: { description: "Quiet restaurant and café" } }, "food"), true);
  const db = database();
  try { await store.readMemory(db, pairId); await store.saveMemory(db, first); assert.equal((await route(db, []).POST(request("camping"))).status, 400); }
  finally { db.sqlite.close(); }
});

test("three synthetic-provider chapters vary movie → food → outdoor, survive reload, deduplicate retries and reset", async () => {
  const db = database(); const calls = [];
  try {
    await store.readMemory(db, pairId); await store.saveMemory(db, chapter());
    await store.updateFeedback(db, pairId, firstId, "liked", undefined, [{ dimension: "quiet", value: -1, source: "explicit_chip" }]);
    const entities = [
      { entity_id: "cafe-loud", name: "Fixture loud café", types: ["urn:entity:place"], properties: { description: "A lively café" } },
      { entity_id: "cafe-quiet", name: "Fixture quiet café", types: ["urn:entity:place"], properties: { description: "A quiet café with music" } },
      { entity_id: "park", name: "Fixture garden", types: ["urn:entity:place"], properties: { description: "A quiet outdoor garden" } },
    ];
    const api = route(db, entities, calls);
    const food = await api.POST(request("food"));
    assert.equal(food.value.mode, "LIVE", JSON.stringify({ reason: food.value.reason, calls: calls.map(url => url.href) })); assert.equal(food.value.id, "cafe-quiet");
    assert.ok(food.value.discovery.sourceChapterIds.includes(firstId));
    assert.match(food.value.discovery.why.new, /not received/);
    assert.equal(calls[0].searchParams.get("filter.type"), "urn:entity:place");
    assert.equal(calls[0].searchParams.get("signal.interests.entities"), "seed-film,seed-artist");
    const count = calls.length;
    const retry = await api.POST(request("food"));
    assert.equal(retry.value.id, food.value.id); assert.equal(calls.length, count);
    await store.updateFeedback(db, pairId, foodId, "good_surprise", undefined, [], "tried");
    await store.updateFeedback(db, pairId, foodId, "good_surprise", undefined, [], "tried");
    const outdoor = await api.POST(request("outdoor", outdoorId));
    assert.equal(outdoor.value.mode, "LIVE"); assert.equal(outdoor.value.id, "park");
    const reloaded = await store.readMemory(db, pairId);
    assert.equal(reloaded.chapters.length, 3); assert.equal(reloaded.profile.shared[0].count, 1);
    assert.deepEqual(Array.from(reloaded.profile.exploration, item => item.domain).sort(), ["food", "movie", "outdoor"]);
    assert.equal(reloaded.profile.exploration.find(item => item.domain === "food").tried, 1);
    assert.equal(reloaded.profile.exploration.find(item => item.domain === "food").feedback, 2);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM practical_evidence").get().count, 1);
    await store.clearMemory(db, pairId);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM pair_memories").get().count, 0);
    assert.equal((await store.readMemory(db, "55555555-5555-4555-8555-555555555555")).profile.exploration.length, 0);
    await assert.rejects(store.saveMemory(db, chapter()), /ended/);
  } finally { db.sqlite.close(); }
});

test("no fresh metadata-backed candidate stays FALLBACK without exploration learning", async () => {
  const db = database();
  try {
    await store.readMemory(db, pairId); await store.saveMemory(db, chapter());
    const result = await route(db, [{ entity_id: "unclassified", name: "Possible Café", types: ["urn:entity:place"] }]).POST(request("food"));
    assert.equal(result.value.mode, "FALLBACK"); assert.equal((await store.readMemory(db, pairId)).chapters.length, 1);
  } finally { db.sqlite.close(); }
});
