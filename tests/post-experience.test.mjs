import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadTypescript } from "./load-typescript.mjs";

const load = (filename, overrides) => loadTypescript(fileURLToPath(new URL(filename, import.meta.url)), overrides);
const memory = load("../lib/relationship-memory.ts");
const experience = load("../lib/post-experience.ts");
const store = load("../lib/memory-store.ts");
const discovery = load("../lib/discovery.ts");
const pairId = "11111111-1111-4111-8111-111111111111";
const chapterId = "22222222-2222-4222-8222-222222222222";
const otherPair = "33333333-3333-4333-8333-333333333333";
const nextId = "44444444-4444-4444-8444-444444444444";

function chapter() {
  return memory.createChapter({ id: chapterId, pairId, timestamp: "2026-10-11T01:00:00Z", mode: "LIVE", inputs: { you: "Atmosphere", partner: "Music" },
    entities: [{ id: "seed-film", name: "A film", type: "urn:entity:movie", participant: "you" }, { id: "seed-artist", name: "An artist", type: "urn:entity:artist", participant: "partner" }],
    participants: [{ id: "you", label: "You", likes: ["atmosphere", "music"], dislikes: [], emotionalContext: [] }, { id: "partner", label: "Partner", likes: ["atmosphere", "music"], dislikes: [], emotionalContext: [] }],
    recommendation: { id: "grounded-cafe", name: "Grounded café", category: "food", description: "A café", place: "Tokyo", rationale: "Qloo" },
    discovery: { domain: "food", status: "suggested", sourceChapterIds: [], location: "Tokyo", why: { known: "atmosphere", new: "New", fits: "Qloo" } } });
}

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

const inputA = { person: "A", overall: "loved", note: "Loved the atmosphere, but it was too crowded.", chips: [] };
const inputB = { person: "B", overall: "liked", note: "The music was great. I'd prefer somewhere quieter next time.", chips: [] };
const signalsA = { taste: [{ tag: "atmosphere", sentiment: "positive", evidence: "Loved the atmosphere" }], practical: [{ dimension: "crowds", value: -1, evidence: "too crowded" }] };
const signalsB = { taste: [{ tag: "music", sentiment: "positive", evidence: "music was great" }], practical: [{ dimension: "quiet", value: -1, evidence: "prefer somewhere quieter" }] };

function request(body, pair = pairId, origin = "https://together.test") {
  return { url: "https://together.test/api/memory", headers: { get: () => origin }, cookies: { get: () => ({ value: pair }) }, json: async () => body };
}

function reviewRoute(db, fetch, configured = true) {
  return load("../app/api/memory/route.ts", { process: { env: configured ? { OPENAI_API_KEY: "fixture", OPENAI_MODEL: "fixture" } : {} }, fetch,
    require: name => name === "cloudflare:workers" ? { env: { DB: db } } : name === "next/server" ? { NextResponse: { json: (value, init = {}) => ({ value, status: init.status ?? 200, cookies: { set() {} } }) } } : name === "zod" ? { z } : null,
  });
}

async function seed(db) { await store.readMemory(db, pairId); await store.saveMemory(db, chapter()); }

test("only saved LIVE grounded chapters can be marked; neither review means no new evidence", async () => {
  const db = database(); const route = reviewRoute(db);
  try {
    await seed(db);
    const before = JSON.stringify((await store.readMemory(db, pairId)).profile);
    assert.equal((await route.POST(request({ action: "experienced", chapterId }))).status, 200);
    const snapshot = await store.readMemory(db, pairId);
    assert.ok(snapshot.chapters[0].experiencedAt); assert.equal(snapshot.chapters[0].discovery.status, "tried");
    assert.equal(snapshot.profile.shared[0].weight, JSON.parse(before).shared[0].weight);
    assert.equal(snapshot.chapters[0].experienceReviews.length, 0);
    assert.equal(experience.whatWeLearned([]).length, 0);
    const timestamp = snapshot.chapters[0].experiencedAt;
    await route.POST(request({ action: "experienced", chapterId }));
    assert.equal((await store.readMemory(db, pairId)).chapters[0].experiencedAt, timestamp);
    for (const state of ["DEMO", "FALLBACK", "NEEDS_INPUT", "LIVE"]) {
      const fake = { ...chapter(), id: nextId, state, ...(state === "LIVE" ? { recommendation: { id: "", name: "" } } : {}) };
      db.sqlite.prepare("INSERT OR REPLACE INTO pair_memories (id, pair_id, created_at, payload) VALUES (?, ?, ?, ?)").run(nextId, pairId, fake.timestamp, JSON.stringify(fake));
      assert.equal((await route.POST(request({ action: "experienced", chapterId: nextId }))).status, 404);
    }
    assert.equal((await route.POST(request({ action: "experienced", chapterId }, otherPair))).status, 404);
    assert.equal((await route.POST(request({ action: "experienced", chapterId }, pairId, "https://evil.test"))).status, 403);
  } finally { db.sqlite.close(); }
});

test("strict note/chip interpretation uses store false, validated enums and exact supported quotes", async () => {
  let body;
  const interpreted = load("../lib/post-experience.ts", { fetch: async (_url, options) => {
    body = JSON.parse(options.body); return { ok: true, json: async () => ({ status: "completed", output_text: JSON.stringify(signalsA) }) };
  } });
  const result = await interpreted.interpretExperience(inputA, "fixture", "fixture");
  assert.equal(result.taste[0].tag, "atmosphere"); assert.equal(result.practical[0].dimension, "crowds");
  assert.equal(body.store, false); assert.equal(body.text.format.strict, true); assert.equal(body.text.format.schema.additionalProperties, false);
  assert.ok(body.input[0].content.includes("do NOT infer outdoors, quiet"));
  const chipModule = load("../lib/post-experience.ts", { fetch: async (_url, options) => {
    assert.match(JSON.parse(options.body).input.at(-1).content, /Less crowded next time/);
    return { ok: true, json: async () => ({ output_text: JSON.stringify({ taste: [], practical: [{ dimension: "crowds", value: -1, evidence: "Less crowded next time" }] }) }) };
  } });
  assert.equal((await chipModule.interpretExperience({ ...inputA, note: "", chips: ["crowds"] }, "fixture", "fixture")).practical.length, 1);
  for (const payload of [
    { ...signalsA, taste: [{ tag: "atmosphere", sentiment: "positive", evidence: "made up quote" }] },
    { ...signalsA, taste: [{ tag: "invented", sentiment: "positive", evidence: "Loved the atmosphere" }] },
    { ...signalsA, mutateProfile: true },
  ]) {
    const bad = load("../lib/post-experience.ts", { fetch: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(payload) }) }) });
    await assert.rejects(bad.interpretExperience(inputA, "fixture", "fixture"));
  }
  const refused = load("../lib/post-experience.ts", { fetch: async () => ({ ok: true, json: async () => ({ status: "incomplete", output_text: JSON.stringify(signalsA) }) }) });
  await assert.rejects(refused.interpretExperience(inputA, "fixture", "fixture"));
});

test("verbatim crowd evidence cannot support an invented outdoor dislike or quiet preference", async () => {
  const interpreted = load("../lib/post-experience.ts", { fetch: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify({
    taste: [...signalsA.taste, { tag: "outdoors", sentiment: "negative", evidence: "it was too crowded" }],
    practical: [...signalsA.practical, { dimension: "quiet", value: -1, evidence: "too crowded" }],
  }) }) }) });
  const result = await interpreted.interpretExperience(inputA, "fixture", "fixture");
  assert.equal(result.taste.length, 1); assert.equal(result.taste[0].tag, "atmosphere");
  assert.equal(result.practical.length, 1); assert.equal(result.practical[0].dimension, "crowds");
  const db = database();
  try {
    await seed(db); await store.markExperienced(db, pairId, chapterId);
    await store.saveExperienceReview(db, pairId, chapterId, inputA, { ...signalsA, taste: [...signalsA.taste, { tag: "outdoors", sentiment: "negative", evidence: "it was too crowded" }] }, "guarded");
    assert.equal((await store.readMemory(db, pairId)).chapters[0].experienceReviews[0].taste.length, 1);
    db.sqlite.prepare("INSERT INTO experience_reaction_signals (pair_id, chapter_id, person, entity_id, kind, signal, value, evidence, source, weight, reviewed_at) VALUES (?, ?, 'A', 'grounded-cafe', 'taste', 'outdoors', 'negative', 'it was too crowded', 'post_experience', 4, '2026-10-11T01:00:00Z')").run(pairId, chapterId);
    assert.equal((await store.readMemory(db, pairId)).chapters[0].experienceReviews[0].taste.length, 1);
  } finally { db.sqlite.close(); }
});

test("A-only, B later, grounding, retry idempotency, edit replacement and atomic failure", async () => {
  const db = database(); let providerCalls = 0; let fail = false;
  const route = reviewRoute(db, async (_url, options) => {
    providerCalls += 1;
    const content = JSON.parse(options.body).input.at(-1).content;
    return { ok: !fail, json: async () => ({ output_text: JSON.stringify(content.includes("atmosphere") ? signalsA : signalsB) }) };
  });
  try {
    await seed(db);
    assert.equal((await route.POST(request({ action: "review", chapterId, review: inputA }))).status, 409);
    await route.POST(request({ action: "experienced", chapterId }));
    let response = await route.POST(request({ action: "review", chapterId, review: inputA }));
    assert.equal(response.status, 200); assert.equal(response.value.chapters[0].pairId, undefined);
    const review = response.value.chapters[0].experienceReviews[0];
    assert.equal(review.person, "A"); assert.equal(review.entityId, "grounded-cafe"); assert.equal(review.domain, "food");
    assert.equal(review.source, "post_experience"); assert.equal(review.weight, 4);
    assert.equal(experience.whatWeLearned(response.value.chapters[0].experienceReviews).length, 0);
    assert.equal(memory.memoryContext(response.value.chapters).actualExperiences.length, 1);
    await route.POST(request({ action: "review", chapterId, review: inputA }));
    assert.equal(providerCalls, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM experience_reviews").get().count, 1);
    response = await route.POST(request({ action: "review", chapterId, review: inputB }));
    assert.equal(response.value.chapters[0].experienceReviews.length, 2);
    assert.equal(response.value.profile.shared.find(signal => signal.tag === "atmosphere").weight, 1);
    const learned = experience.whatWeLearned(response.value.chapters[0].experienceReviews);
    assert.ok(learned.includes("A enjoyed the atmosphere.")); assert.ok(learned.includes("B enjoyed the music."));
    assert.ok(learned.some(line => line.includes("A reacted toward less crowded"))); assert.ok(learned.some(line => line.includes("B preferred quieter")));
    assert.ok(!learned.some(line => line.includes("both")));
    assert.equal(response.value.practical.find(state => state.dimension === "crowds").score, -2);
    const stored = db.sqlite.prepare("SELECT * FROM experience_reviews WHERE person = 'A'").get();
    assert.equal(stored.note, undefined); assert.equal(stored.pair_id, pairId);
    assert.equal(stored.input_hash.length, 64);
    fail = true;
    assert.equal((await route.POST(request({ action: "review", chapterId, review: { ...inputA, note: "new note" } }))).status, 503);
    assert.equal((await store.readMemory(db, pairId)).chapters[0].experienceReviews.find(item => item.person === "A").overall, "loved");
    response = await route.POST(request({ action: "review", chapterId, review: { person: "A", overall: "okay" } }));
    assert.equal(response.status, 200);
    assert.equal(response.value.chapters[0].experienceReviews.find(item => item.person === "A").taste.length, 0);
    assert.equal(response.value.practical.some(state => state.dimension === "crowds"), false);
    assert.equal(response.value.practical.some(state => state.dimension === "quiet"), true);
  } finally { db.sqlite.close(); }
});

test("actual signals outweigh stated taste, distinguish explicit indifference, and grow Shared", async () => {
  const db = database();
  try {
    await seed(db); await store.markExperienced(db, pairId, chapterId);
    const first = { taste: [{ tag: "music", sentiment: "indifferent", evidence: "Music did not matter" }, { tag: "atmosphere", sentiment: "positive", evidence: "Loved atmosphere" }], practical: [] };
    await store.saveExperienceReview(db, pairId, chapterId, inputA, first, "first");
    await store.saveExperienceReview(db, pairId, chapterId, inputB, { ...signalsB, taste: [...signalsB.taste, { tag: "atmosphere", sentiment: "positive", evidence: "Loved atmosphere" }] }, "second");
    const snapshot = await store.readMemory(db, pairId);
    assert.equal(snapshot.profile.shared.find(signal => signal.tag === "atmosphere").weight, 5);
    assert.equal(snapshot.profile.shared.find(signal => signal.tag === "atmosphere").postExperienceCount, 1);
    assert.ok(!snapshot.profile.shared.some(signal => signal.tag === "music"));
    assert.equal(snapshot.profile.different.partner.find(signal => signal.tag === "music").weight, 5);
    assert.ok(experience.whatWeLearned(snapshot.chapters[0].experienceReviews).includes("You both enjoyed the atmosphere."));
    assert.ok(experience.whatWeLearned(snapshot.chapters[0].experienceReviews).some(line => /B enjoyed the music; A felt indifferent/.test(line)));
    const direction = discovery.domainDirections(snapshot.profile, snapshot.chapters).find(item => item.category === "culture");
    assert.equal(direction.contributors.postExperience, 1);
    assert.ok(!snapshot.profile.unexplored.some(item => item.category === "food"));
    await store.saveExperienceReview(db, pairId, chapterId, inputA, { taste: [{ tag: "atmosphere", sentiment: "negative", evidence: "Disliked atmosphere" }], practical: [] }, "third");
    assert.ok(!(await store.readMemory(db, pairId)).profile.shared.some(signal => signal.tag === "atmosphere"));
  } finally { db.sqlite.close(); }
});

test("crowd/price/pace evidence weighs four, blends with old weak evidence and is person-specific", async () => {
  const db = database();
  try {
    await seed(db);
    await store.updateFeedback(db, pairId, chapterId, "liked", "weak", [{ dimension: "crowds", value: 1, source: "free_text" }]);
    await store.markExperienced(db, pairId, chapterId);
    const actual = { taste: [], practical: ["crowds", "budget", "pace"].map(dimension => ({ dimension, value: -1, evidence: "Too busy, expensive and rushed" })) };
    await store.saveExperienceReview(db, pairId, chapterId, inputA, actual, "first");
    let snapshot = await store.readMemory(db, pairId);
    assert.equal(snapshot.practical.find(item => item.dimension === "crowds").score, -1.2);
    assert.equal(snapshot.practical.find(item => item.dimension === "crowds").weight, 5);
    assert.equal(snapshot.practical.find(item => item.dimension === "budget").score, -2);
    assert.equal(snapshot.practical.find(item => item.dimension === "pace").score, -2);
    await store.saveExperienceReview(db, pairId, chapterId, inputB, { ...actual, practical: [{ dimension: "pace", value: 1, evidence: "More active next time" }] }, "second");
    snapshot = await store.readMemory(db, pairId);
    assert.equal(snapshot.practical.find(item => item.dimension === "pace").score, 0);
    assert.equal(snapshot.chapters[0].experienceReviews.length, 2);
    const candidates = [{ category: "place", entity: { entity_id: "rushed", properties: { description: "Active walking trail" } } }, { category: "place", entity: { entity_id: "relaxed", properties: { description: "Relaxed seated café" } } }];
    assert.equal(discovery.rankDiscoveries(candidates, [], [{ dimension: "pace", score: -2, weight: 4, count: 1 }]).ranked[0].candidate.entity.entity_id, "relaxed");
  } finally { db.sqlite.close(); }
});

test("next discovery uses actual positive seeds, explicit rationale and stronger memory context", async () => {
  const db = database(); const calls = [];
  try {
    await seed(db); await store.markExperienced(db, pairId, chapterId);
    await store.saveExperienceReview(db, pairId, chapterId, inputA, signalsA, "first");
    await store.saveExperienceReview(db, pairId, chapterId, inputB, signalsB, "second");
    const prior = (await store.readMemory(db, pairId)).chapters;
    assert.equal(memory.historicalEntities(prior)[0].id, "grounded-cafe");
    assert.match(memory.memoryExplanation(prior, "culture"), /actual experience/);
    assert.match(memory.memoryExplanation(prior, "culture"), /less crowded/);
    assert.match(memory.memoryExplanation(prior, "culture"), /quieter/);
    const route = load("../app/api/adventure/route.ts", { console, process: { env: { QLOO_API_KEY: "fixture", QLOO_API_BASE_URL: "https://qloo.test" } },
      fetch: async urlValue => {
        const url = new URL(urlValue); calls.push(url);
        const entities = [{ entity_id: "new-museum", name: "A new museum", type: "urn:entity:place", properties: { description: "Quiet museum" } }];
        return { ok: true, status: 200, json: async () => ({ results: url.pathname === "/v2/tags" ? { tags: [] } : { entities } }) };
      }, require: name => name === "cloudflare:workers" ? { env: { DB: db } } : name === "next/server" ? { NextResponse: { json: (value, init = {}) => ({ value, status: init.status ?? 200, cookies: { set() {} } }) } } : name === "zod" ? { z } : null,
    });
    const response = await route.POST(request({ mode: "next_discovery", domain: "culture", requestId: nextId }));
    assert.equal(response.value.mode, "LIVE"); assert.equal(response.value.memory.saved, true);
    assert.match(response.value.discovery.why.known, /actual experience of Grounded café/);
    assert.match(response.value.memory.explanation, /A enjoyed the atmosphere.*B enjoyed the music/);
    assert.ok(calls.some(url => url.pathname === "/v2/insights" && url.search.includes("grounded-cafe")));
    const snapshot = await store.readMemory(db, pairId);
    assert.equal(memory.memoryContext(snapshot.chapters).actualExperiences.length, 2);
    assert.equal(snapshot.chapters.find(item => item.id === nextId).reactions.length, 0);
  } finally { db.sqlite.close(); }
});

test("reset deletes all reviews/signals and late writes cannot revive revoked pair", async () => {
  const db = database();
  try {
    await seed(db); await store.markExperienced(db, pairId, chapterId);
    await store.saveExperienceReview(db, pairId, chapterId, inputA, signalsA, "first");
    await store.readMemory(db, otherPair);
    assert.equal((await store.readMemory(db, otherPair)).chapters.length, 0);
    await store.clearMemory(db, pairId);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM experience_reviews").get().count, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM experience_reaction_signals").get().count, 0);
    await assert.rejects(store.saveExperienceReview(db, pairId, chapterId, inputA, signalsA, "late"), /ended/);
    assert.equal((await store.readMemory(db, otherPair)).profile.chapters, 0);
  } finally { db.sqlite.close(); }
});

test("overall-only remains usable without OpenAI and never invents aspect signals", async () => {
  const db = database(); const route = reviewRoute(db, () => { throw new Error("No provider expected"); }, false);
  try {
    await seed(db); await store.markExperienced(db, pairId, chapterId);
    for (const person of ["A", "B"]) assert.equal((await route.POST(request({ action: "review", chapterId, review: { person, overall: "liked" } }))).status, 200);
    const snapshot = await store.readMemory(db, pairId);
    assert.equal(snapshot.chapters[0].experienceReviews[0].taste.length, 0);
    assert.equal(snapshot.practical.length, 0);
    assert.match(experience.whatWeLearned(snapshot.chapters[0].experienceReviews)[0], /No specific taste/);
    assert.equal((await route.POST(request({ action: "review", chapterId, review: inputA }))).status, 503);
    assert.equal((await route.POST(request({ action: "review", chapterId, review: { person: "C", overall: "liked" } }))).status, 400);
  } finally { db.sqlite.close(); }
});
