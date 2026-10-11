import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadTypescript } from "./load-typescript.mjs";

const memory = loadTypescript(fileURLToPath(new URL("../lib/relationship-memory.ts", import.meta.url)));
const store = loadTypescript(fileURLToPath(new URL("../lib/memory-store.ts", import.meta.url)));
const pairId = "11111111-1111-4111-8111-111111111111";
const otherPair = "22222222-2222-4222-8222-222222222222";
const chapterId = "33333333-3333-4333-8333-333333333333";

function chapter(overrides = {}) {
  return memory.createChapter({ id: chapterId, pairId, timestamp: "2026-10-11T01:00:00Z", mode: "LIVE",
    inputs: { you: "Princess Mononoke: atmosphere, nature, tension", partner: "Joe Hisaishi: atmosphere, music, emotion" },
    entities: [
      { id: "qloo-film", name: "Princess Mononoke", type: "urn:entity:movie", participant: "you", confidence: 1, provenance: "explicit", why: "named" },
      { id: "qloo-artist", name: "Joe Hisaishi", type: "urn:entity:artist", participant: "partner", confidence: 1, provenance: "explicit", why: "named" },
    ],
    participants: [
      { id: "you", label: "You", likes: ["Atmosphere", "nature", "nature", "tension"], dislikes: ["crowds"], emotionalContext: [] },
      { id: "partner", label: "Mika", likes: ["atmosphere", "music", "emotion"], dislikes: [], emotionalContext: [] },
    ],
    recommendation: { id: "qloo-garden", name: "A verified garden", category: "place", description: "Visit together", place: "Tokyo", rationale: "Grounded signals" }, ...overrides });
}

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")).entries) sqlite.exec(readFileSync(new URL(`../drizzle/${migration.tag}.sql`, import.meta.url), "utf8"));
  const prepare = sql => ({ bind: (...values) => ({
    async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
  }) });
  return { sqlite, prepare, async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
}

test("feedback endpoint interprets a note atomically and persists supported practical signals", async () => {
  const db = database();
  const request = body => ({ url: "https://together.test/api/memory", headers: { get: () => "https://together.test" }, cookies: { get: () => ({ value: pairId }) }, json: async () => body });
  let fail = false;
  const route = loadTypescript(fileURLToPath(new URL("../app/api/memory/route.ts", import.meta.url)), {
    process: { env: { OPENAI_API_KEY: "mock", OPENAI_MODEL: "mock-model" } },
    fetch: async () => ({ ok: !fail, json: async () => ({ output_text: JSON.stringify({ signals: [{ preference: "less_crowded" }, { preference: "quieter" }] }) }) }),
    require: name => name === "cloudflare:workers" ? { env: { DB: db } } : name === "next/server" ? { NextResponse: { json: (value, init = {}) => ({ value, status: init.status ?? 200, cookies: { set() {} } }) } } : name === "zod" ? { z } : null,
  });
  try {
    await store.readMemory(db, pairId);
    await store.saveMemory(db, chapter());
    const reflection = "We liked it, but it was too crowded. More quiet places next time.";
    const updated = await route.PATCH(request({ chapterId, feedback: "liked", reflection }));
    assert.equal(updated.status, 200);
    assert.equal(updated.value.practical.length, 2);
    assert.ok(updated.value.practical.every(state => state.score === -2 && state.count === 1));
    assert.equal((await route.GET(request())).value.practical.length, 2);
    fail = true;
    assert.equal((await route.PATCH(request({ chapterId, feedback: "not_for_us", reflection: "quiet" }))).status, 503);
    assert.equal((await store.readMemory(db, pairId)).chapters[0].feedback, "liked");
    const chip = await route.PATCH(request({ chapterId, feedback: "liked", preference: { dimension: "pace", value: -1 } }));
    assert.equal(chip.value.practical.find(state => state.dimension === "pace").score, -2);
    assert.equal(chip.value.chapters[0].reflection, reflection);
    await route.DELETE(request());
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM practical_evidence").get().count, 0);
  } finally { db.sqlite.close(); }
});

test("no history means no invented Shared, Different or Unexplored profile", () => {
  const profile = memory.deriveProfile([]);
  assert.equal(profile.chapters, 0);
  assert.equal(profile.shared.length, 0);
  assert.equal(profile.different.you.length, 0);
  assert.equal(profile.unexplored.length, 0);
});

test("practical evidence persists, is idempotent, scoped to LIVE chapters, blends and resets", async () => {
  const db = database();
  try {
    assert.equal((await store.readMemory(db, pairId)).practical.length, 0);
    await store.saveMemory(db, chapter());
    const chips = [{ dimension: "crowds", value: -1, source: "explicit_chip" }];
    await store.updateFeedback(db, pairId, chapterId, "liked", undefined, chips);
    await store.updateFeedback(db, pairId, chapterId, "liked", undefined, chips);
    let snapshot = await store.readMemory(db, pairId);
    assert.equal(snapshot.practical[0].dimension, "crowds");
    assert.equal(snapshot.practical[0].count, 1);
    assert.equal(snapshot.practical[0].score, -2);
    assert.equal((await store.readMemory(db, otherPair)).practical.length, 0);
    await store.updateFeedback(db, pairId, chapterId, "liked", "We liked it, but it was too crowded. More quiet places next time.", [{ dimension: "quiet", value: -1, source: "free_text" }]);
    snapshot = await store.readMemory(db, pairId);
    assert.equal(snapshot.practical.length, 2);
    await store.saveMemory(db, chapter({ id: otherPair }));
    await store.updateFeedback(db, pairId, otherPair, "liked", undefined, [{ dimension: "crowds", value: 1, source: "explicit_chip" }]);
    assert.equal((await store.readMemory(db, pairId)).practical.find(state => state.dimension === "crowds").score, 0);
    await store.updateFeedback(db, pairId, chapterId, "liked", "No preference", []);
    assert.equal((await store.readMemory(db, pairId)).practical.some(state => state.dimension === "quiet"), false);
    assert.equal(await store.updateFeedback(db, pairId, "missing", "liked", undefined, chips), false);
    for (const state of ["DEMO", "NEEDS_INPUT"]) {
      const fake = { ...chapter(), id: `fake-${state}`, state };
      db.sqlite.prepare("INSERT INTO pair_memories (id, pair_id, created_at, payload) VALUES (?, ?, ?, ?)").run(fake.id, pairId, fake.timestamp, JSON.stringify(fake));
      assert.equal(await store.updateFeedback(db, pairId, fake.id, "liked", undefined, chips), false);
    }
    await store.clearMemory(db, pairId);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM practical_evidence").get().count, 0);
    await assert.rejects(store.saveMemory(db, chapter()), /ended/);
  } finally { db.sqlite.close(); }
});

test("auditable derivation preserves same-world different-reasons and deduplicates", () => {
  const first = chapter();
  const profile = memory.deriveProfile([first, first]);
  assert.equal(profile.chapters, 1);
  assert.equal(profile.shared[0].tag, "atmosphere");
  assert.equal(profile.shared[0].count, 1);
  assert.equal(profile.different.you.find(signal => signal.tag === "nature").count, 1);
  assert.ok(profile.different.partner.some(signal => signal.tag === "music"));
  assert.equal(profile.unexplored.some(opportunity => opportunity.category === "place"), false);
  assert.ok(profile.unexplored.some(opportunity => opportunity.category === "food"));
  assert.equal(profile.unexplored.some(opportunity => opportunity.category === "movie"), false);
  assert.ok(profile.avoided.includes("you: crowds"));
  assert.match(memory.memoryExplanation([first], "place"), /both responded to atmosphere.*nature.*emotion/);
});

test("repeat observations grow evidence and feedback confirms domains without inventing tags", () => {
  const first = chapter();
  const second = chapter({ id: otherPair });
  second.feedback = "liked";
  const profile = memory.deriveProfile([second, first]);
  assert.equal(profile.shared[0].count, 2);
  assert.equal(profile.unexplored.some(opportunity => opportunity.category === "place"), false);
  first.feedback = "not_for_us";
  assert.ok(memory.deriveProfile([first]).avoided.includes("qloo-garden"));
  assert.equal(memory.historicalEntities([first]).length, 0);
  second.feedback = "neutral";
  assert.ok(memory.memoryContext([second]).previousRecommendations.some(item => item.feedback === "neutral"));
});

test("unsuccessful, demo and fallback interactions cannot become valid chapters", () => {
  for (const mode of ["DEMO", "NEEDS_INPUT", "FALLBACK"]) assert.equal(chapter({ mode }), null);
  assert.equal(chapter({ entities: [] }), null);
});

test("a common interest becomes Shared even when discovered in different chapters", () => {
  const first = chapter();
  const second = chapter({ id: otherPair });
  second.reactions[0].tags.push("emotion");
  second.reactions[1].tags = ["architecture"];
  const profile = memory.deriveProfile([second, first]);
  const sharedEmotion = profile.shared.find(signal => signal.tag === "emotion");
  assert.equal(sharedEmotion.count, 2);
  assert.equal(sharedEmotion.chapterIds.length, 2);
  assert.equal(profile.different.you.some(signal => signal.tag === "emotion"), false);
  assert.equal(profile.different.partner.some(signal => signal.tag === "emotion"), false);
});

test("real SQLite migrations support durable roundtrip, pair isolation, feedback and reset", async () => {
  const db = database();
  try {
    assert.equal((await store.readMemory(db, pairId)).chapters.length, 0);
    await store.saveMemory(db, chapter());
    assert.equal((await store.readMemory(db, pairId)).profile.chapters, 1);
    assert.equal((await store.readMemory(db, otherPair)).chapters.length, 0);
    assert.equal(await store.updateFeedback(db, otherPair, chapterId, "not_for_us", ""), false);
    assert.equal(await store.updateFeedback(db, pairId, chapterId, "liked", "We went"), true);
    const updated = await store.readMemory(db, pairId);
    assert.equal(updated.chapters[0].feedback, "liked");
    assert.equal(updated.chapters[0].reflection, "We went");
    await store.updateFeedback(db, pairId, chapterId, "neutral");
    assert.equal((await store.readMemory(db, pairId)).chapters[0].reflection, "We went");
    await store.clearMemory(db, pairId);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM pair_memories").get().count, 0);
    await assert.rejects(store.saveMemory(db, chapter()), /ended/);
    await assert.rejects(store.readMemory(db, pairId), /ended/);
    assert.equal((await store.readMemory(db, otherPair)).profile.chapters, 0);
  } finally { db.sqlite.close(); }
});

test("memory endpoints set private cookie, validate feedback, reject cross-origin writes and rotate reset cookie", async () => {
  const db = database();
  const headers = { get: () => "https://together.test" };
  const responseFactory = (value, init = {}) => ({ ...init, status: init.status ?? 200, value, cookie: null, cookies: { set(name, value, options) { this.cookie = { name, value, options }; } } });
  const route = loadTypescript(fileURLToPath(new URL("../app/api/memory/route.ts", import.meta.url)), { process: { env: { NODE_ENV: "production" } }, require: name => name === "cloudflare:workers" ? { env: { DB: db } } : name === "next/server" ? { NextResponse: { json: responseFactory } } : name === "zod" ? loadZod() : null });
  function loadZod() { return { z }; }
  const request = (body, origin = "https://together.test", locale = "en") => ({ url: `https://together.test/api/memory?locale=${locale}`, headers: { ...headers, get: () => origin }, cookies: { get: () => ({ value: pairId }) }, json: async () => body });
  try {
    const first = await route.GET(request());
    assert.equal(first.value.profile.chapters, 0);
    assert.equal(first.cookies.cookie.options.httpOnly, true);
    assert.equal(first.cookies.cookie.options.secure, true);
    assert.equal(first.headers["Cache-Control"], "no-store");
    await store.saveMemory(db, chapter());
    assert.equal((await route.PATCH(request({ chapterId, feedback: "not_for_us" }))).value.chapters[0].feedback, "not_for_us");
    const englishMemory = (await route.GET(request(undefined, "https://together.test", "en"))).value;
    const japaneseMemory = (await route.GET(request(undefined, "https://together.test", "ja"))).value;
    assert.equal(englishMemory.chapters[0].pairId, undefined);
    assert.equal(japaneseMemory.chapters[0].id, englishMemory.chapters[0].id);
    assert.deepEqual(japaneseMemory.profile, englishMemory.profile);
    assert.equal((await route.PATCH(request({ chapterId, feedback: "invented" }))).status, 400);
    assert.equal((await route.DELETE(request(null, "https://attacker.test"))).status, 403);
    const reset = await route.DELETE(request());
    assert.equal(reset.status, 200);
    assert.notEqual(reset.cookies.cookie.value, pairId);
    assert.equal(reset.value.chapters.length, 0);
  } finally { db.sqlite.close(); }
});
