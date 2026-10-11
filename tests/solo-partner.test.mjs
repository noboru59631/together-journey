import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadTypescript } from "./load-typescript.mjs";

const load = filename => loadTypescript(fileURLToPath(new URL(filename, import.meta.url)));
const partner = load("../lib/solo-partner.ts");
const soloStore = load("../lib/solo-store.ts");
const pairStore = load("../lib/memory-store.ts");
const i18n = load("../lib/i18n.ts");
const entryMode = load("../lib/entry-mode.ts");
const soloId = "11111111-1111-4111-8111-111111111111";
const pairId = "22222222-2222-4222-8222-222222222222";
const chapterId = "33333333-3333-4333-8333-333333333333";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")).entries) sqlite.exec(readFileSync(new URL(`../drizzle/${migration.tag}.sql`, import.meta.url), "utf8"));
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

const chapter = { id: chapterId, pairId: soloId, scope: "solo", timestamp: "2026-10-12T00:00:00Z", inputs: { you: "Atmospheric films", partner: "" }, entities: [{ id: "qloo-seed", name: "Seed", type: "urn:entity:movie", participant: "you", confidence: 1, provenance: "explicit", why: "User interest" }], reactions: [{ person: "you", label: "You", entityIds: ["qloo-seed"], tags: ["atmosphere"], dislikes: [] }], recommendation: { id: "qloo-candidate", name: "Qloo candidate", category: "movie", description: "", place: "", rationale: "" }, state: "LIVE", feedback: null, reflection: "", discovery: { domain: "movie", status: "suggested", sourceChapterIds: [], location: "", why: { known: "", new: "", fits: "" } } };

test("archetypes change deterministic scoring without adding candidates", () => {
  const seeds = [{ id: "qloo-seed", name: "Seed", type: "urn:entity:movie", reaction: "atmosphere", tags: ["atmosphere"] }];
  const candidates = [
    { entity: { entity_id: "qloo-familiar", name: "Seed companion", properties: { description: "Related to Seed" } }, category: "movie" },
    { entity: { entity_id: "qloo-contrast", name: "Unexpected title", properties: { description: "A different direction" } }, category: "movie" },
  ];
  const ids = Object.fromEntries(partner.archetypes.map(archetype => {
    const profile = { id: soloId, archetype, seeds, chapters: [], exploration: [], layers: { longTerm: [], recentContext: [] }, practical: [] };
    return [archetype, partner.rankSoloCandidates(candidates, profile, "movie").ranked[0].candidate.entity.entity_id];
  }));
  assert.equal(ids.comfort, "qloo-familiar");
  assert.equal(ids.explorer, "qloo-familiar");
  assert.equal(ids.opposite, "qloo-contrast");
  assert.equal(ids.surprise, "qloo-contrast");
  assert.deepEqual(new Set(Object.values(ids)), new Set(candidates.map(candidate => candidate.entity.entity_id)));
});

test("first run does not claim learned preferences in either language", () => {
  const profile = { id: soloId, archetype: "explorer", seeds: [], chapters: [chapter], exploration: [], layers: { longTerm: [], recentContext: [] }, practical: [] };
  assert.match(partner.soloRationale(profile, "movie", "en"), /not a learned preference/);
  assert.match(partner.soloRationale(profile, "movie", "ja"), /学習したとはまだ/);
});

test("entry mode persists only explicit pair or solo choices", () => {
  assert.equal(entryMode.modeStorageKey, "together.entryMode");
  assert.equal(entryMode.resolveEntryMode("pair"), "pair");
  assert.equal(entryMode.resolveEntryMode("solo"), "solo");
  assert.equal(entryMode.resolveEntryMode(null), null);
  assert.equal(entryMode.resolveEntryMode("invalid"), null);
});

test("explicit practical evidence excludes a contradictory grounded candidate", () => {
  const profile = { id: soloId, archetype: "opposite", seeds: [], chapters: [{ ...chapter, soloPreferences: [{ chapterId, entityId: "qloo-candidate", dimension: "quiet", value: -1, source: "explicit_chip", weight: 2, timestamp: chapter.timestamp }] }], exploration: [], layers: { longTerm: [], recentContext: [] }, practical: [] };
  const candidates = [
    { entity: { entity_id: "qloo-lively", name: "Lively place", properties: { description: "A lively place" } }, category: "place" },
    { entity: { entity_id: "qloo-quiet", name: "Quiet place", properties: { description: "A quiet place" } }, category: "place" },
  ];
  const ranked = partner.rankSoloCandidates(candidates, profile, "place");
  assert.equal(ranked.ranked[0].candidate.entity.entity_id, "qloo-quiet");
  assert.equal(ranked.excluded, 1);
});

test("solo storage, feedback, archetype and reset stay isolated from pair memory", async () => {
  const db = database();
  await pairStore.readMemory(db, pairId);
  await pairStore.saveMemory(db, { ...chapter, scope: undefined, pairId, id: "44444444-4444-4444-8444-444444444444", entities: [...chapter.entities, { ...chapter.entities[0], id: "qloo-pair", participant: "partner" }] });
  await soloStore.readSolo(db, soloId);
  await soloStore.updateSoloSettings(db, soloId, "explorer", [{ id: "qloo-seed", name: "Seed", type: "urn:entity:movie", reaction: "atmosphere", tags: ["atmosphere"] }]);
  await soloStore.saveSoloChapter(db, soloId, { ...chapter });
  assert.equal((await soloStore.readSolo(db, soloId)).chapters.length, 1);
  await soloStore.markSoloExperienced(db, soloId, chapterId);
  await soloStore.saveSoloReview(db, soloId, chapterId, { person: "A", overall: "loved", note: "", chips: [] }, { taste: [{ tag: "atmosphere", sentiment: "positive", evidence: "I usually love atmosphere", signalClass: "stable_preference", contextMarker: "usually", futurePreference: false }, { tag: "nature", sentiment: "positive", evidence: "Today I liked nature", signalClass: "contextual_reaction", contextMarker: "Today", futurePreference: false }], practical: [] });
  const learned = await soloStore.readSolo(db, soloId);
  assert.equal(learned.chapters[0].experienceReviews[0].overall, "loved");
  assert.equal(learned.layers.longTerm[0].signal, "atmosphere");
  assert.equal(learned.layers.recentContext[0].signal, "nature");
  assert.equal(learned.exploration.find(item => item.domain === "movie").tried, 1);
  await soloStore.updateSoloSettings(db, soloId, "opposite");
  assert.equal((await soloStore.readSolo(db, soloId)).chapters.length, 1);
  assert.equal((await soloStore.readSolo(db, soloId)).archetype, "opposite");
  await soloStore.clearSolo(db, soloId);
  assert.equal((await pairStore.readMemory(db, pairId)).chapters.length, 1);
  assert.equal((await soloStore.readSolo(db, "55555555-5555-4555-8555-555555555555")).chapters.length, 0);
});

test("new solo labels are available in English and Japanese", () => {
  for (const key of ["solo.mode.title", "solo.mode.pair", "solo.mode.solo", "solo.mode.warning", "solo.archetype.label", ...partner.archetypes.map(archetype => `solo.archetype.${archetype}`), "solo.interest.title", "solo.interest.hint", "solo.memory.reset", "solo.rationale.first", "solo.rationale.learned"]) {
    assert.notEqual(i18n.translate("en", key), key);
    assert.notEqual(i18n.translate("ja", key), key);
    assert.notEqual(i18n.translate("en", key), i18n.translate("ja", key));
  }
});

test("solo LIVE discoveries stay inside Qloo results and reuse experienced memory", async () => {
  const db = database();
  const calls = [];
  const seed = { entity_id: "qloo-seed", name: "Seed Film", types: ["urn:entity:movie"] };
  const candidates = ["First Film", "Second Film", "Third Film"].map((name, index) => ({ entity_id: `qloo-${index + 1}`, name, types: ["urn:entity:movie"] }));
  const route = loadTypescript(fileURLToPath(new URL("../app/api/adventure/route.ts", import.meta.url)), {
    console,
    process: { env: { QLOO_API_KEY: "test-only", QLOO_API_BASE_URL: "https://qloo.test" } },
    fetch: async urlValue => {
      const url = new URL(urlValue); calls.push(url);
      if (url.pathname === "/search") return { ok: true, status: 200, json: async () => ({ results: { entities: [seed] } }) };
      if (url.pathname === "/v2/tags") return { ok: true, status: 200, json: async () => ({ results: { tags: [] } }) };
      return { ok: true, status: 200, json: async () => ({ results: { entities: url.searchParams.get("filter.type") === "urn:entity:movie" ? candidates : [] } }) };
    },
    require: name => name === "cloudflare:workers" ? { env: { DB: db } } : name === "next/server" ? { NextResponse: { json: (value, init = {}) => ({ value, status: init.status ?? 200, cookies: { set() {} } }) } } : name === "zod" ? { z } : null,
  });
  const request = (id, locale = "en", interests) => ({ url: "https://together.test/api/adventure", headers: { get: () => "https://together.test" }, cookies: { get: () => ({ value: soloId }) }, json: async () => ({ mode: "solo_discovery", requestId: id, locale, ...(interests ? { interests } : {}) }) });
  try {
    const first = await route.POST(request("66666666-6666-4666-8666-666666666666", "en", [{ name: "Seed Film", type: "urn:entity:movie", reaction: "I love the atmosphere" }]));
    assert.equal(first.status, 200, JSON.stringify(first.value));
    assert.equal(first.value.id, "qloo-1");
    assert.equal(first.value.mode, "LIVE");
    assert.ok(calls.some(url => url.pathname === "/v2/insights" && url.searchParams.get("signal.interests.entities") === "qloo-seed"));
    const firstChapterId = first.value.memory.chapterId;
    await soloStore.markSoloExperienced(db, soloId, firstChapterId);
    await soloStore.saveSoloReview(db, soloId, firstChapterId, { person: "A", overall: "loved", note: "", chips: [] }, { taste: [{ tag: "atmosphere", sentiment: "positive", evidence: "I usually love atmosphere", signalClass: "stable_preference", contextMarker: "usually", futurePreference: false }], practical: [] });
    const second = await route.POST(request("77777777-7777-4777-8777-777777777777", "ja"));
    assert.equal(second.status, 200, JSON.stringify(second.value));
    assert.equal(second.value.id, "qloo-2");
    assert.ok(calls.some(url => url.pathname === "/v2/insights" && url.searchParams.get("signal.interests.entities")?.includes("qloo-1")));
    assert.match(second.value.memory.explanation, /体験後/);
    assert.equal((await soloStore.readSolo(db, soloId)).chapters.length, 2);
    await soloStore.updateSoloSettings(db, soloId, "opposite");
    assert.equal((await soloStore.readSolo(db, soloId)).archetype, "opposite");
    assert.equal((await soloStore.readSolo(db, soloId)).chapters[0].recommendation.id, "qloo-2");
  } finally { db.sqlite.close(); }
});
