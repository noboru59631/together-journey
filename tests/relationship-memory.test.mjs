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
  for (const migration of ["0000_flat_sue_storm.sql", "0001_dizzy_iron_lad.sql"]) sqlite.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
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

test("no history means no invented Shared, Different or Unexplored profile", () => {
  const profile = memory.deriveProfile([]);
  assert.equal(profile.chapters, 0);
  assert.equal(profile.shared.length, 0);
  assert.equal(profile.different.you.length, 0);
  assert.equal(profile.unexplored.length, 0);
});

test("auditable derivation preserves same-world different-reasons and deduplicates", () => {
  const first = chapter();
  const profile = memory.deriveProfile([first, first]);
  assert.equal(profile.chapters, 1);
  assert.equal(profile.shared[0].tag, "atmosphere");
  assert.equal(profile.shared[0].count, 1);
  assert.equal(profile.different.you.find(signal => signal.tag === "nature").count, 1);
  assert.ok(profile.different.partner.some(signal => signal.tag === "music"));
  assert.ok(profile.unexplored.some(opportunity => opportunity.category === "place"));
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
  const request = (body, origin = "https://together.test") => ({ url: "https://together.test/api/memory", headers: { ...headers, get: () => origin }, cookies: { get: () => ({ value: pairId }) }, json: async () => body });
  try {
    const first = await route.GET(request());
    assert.equal(first.value.profile.chapters, 0);
    assert.equal(first.cookies.cookie.options.httpOnly, true);
    assert.equal(first.cookies.cookie.options.secure, true);
    assert.equal(first.headers["Cache-Control"], "no-store");
    await store.saveMemory(db, chapter());
    assert.equal((await route.PATCH(request({ chapterId, feedback: "not_for_us" }))).value.chapters[0].feedback, "not_for_us");
    assert.equal((await route.GET(request())).value.chapters[0].pairId, undefined);
    assert.equal((await route.PATCH(request({ chapterId, feedback: "invented" }))).status, 400);
    assert.equal((await route.DELETE(request(null, "https://attacker.test"))).status, 403);
    const reset = await route.DELETE(request());
    assert.equal(reset.status, 200);
    assert.notEqual(reset.cookies.cookie.value, pairId);
    assert.equal(reset.value.chapters.length, 0);
  } finally { db.sqlite.close(); }
});
