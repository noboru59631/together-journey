import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { loadTypescript } from "./load-typescript.mjs";

const load = (filename, overrides) => loadTypescript(fileURLToPath(new URL(filename, import.meta.url)), overrides);
const layers = load("../lib/preference-memory.ts");
const experience = load("../lib/post-experience.ts");
const memory = load("../lib/relationship-memory.ts");
const practical = load("../lib/practical-preferences.ts");
const store = load("../lib/memory-store.ts");
const now = "2026-10-11T12:00:00.000Z";
const pairId = "11111111-1111-4111-8111-111111111111";
const context = (evidence = "It was too crowded today.", dimension = "crowds", value = -1) => ({ dimension, value, evidence, signalClass: "contextual_reaction", contextMarker: "today", futurePreference: false });
const stable = (dimension = "crowds", value = -1) => ({ dimension, value, evidence: `We usually prefer ${dimension === "crowds" ? "less crowded" : "quieter"} places.`, signalClass: "stable_preference", contextMarker: "usually", futurePreference: false });
function chapter(index, signal, person = "A", at = now) {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const created = memory.createChapter({ id, pairId, timestamp: at, mode: "LIVE", inputs: { you: "", partner: "" },
    entities: [{ id: "film", name: "Film", type: "urn:entity:movie", participant: "you" }, { id: "artist", name: "Music", type: "urn:entity:artist", participant: "partner" }],
    participants: [], recommendation: { id: `qloo-${index}`, name: "A grounded place", category: "place", description: "", rationale: "", place: "Tokyo" } });
  created.experiencedAt = at;
  created.experienceReviews = [{ chapterId: id, entityId: `qloo-${index}`, entityName: "A grounded place", domain: "place", person, overall: "liked", reviewedAt: at, source: "post_experience", weight: 4, taste: [], practical: signal ? [signal] : [] }];
  return created;
}
const derive = chapters => layers.derivePreferenceMemory(chapters, now);
const candidates = [
  { category: "place", entity: { entity_id: "busy", properties: { description: "Lively, loud café" } } },
  { category: "place", entity: { entity_id: "quiet", properties: { description: "Quiet, tranquil café" } } },
];
const winner = value => practical.rerankCandidates(candidates, layers.layeredPracticalProfile(value)).ranked[0].candidate.entity.entity_id;

test("one contextual reaction and one unqualified like do not establish stable preferences", () => {
  assert.equal(derive([chapter(1, context())]).longTerm.length, 0);
  const liked = chapter(1);
  liked.experienceReviews[0].taste = [{ tag: "music", sentiment: "positive", evidence: "I liked the music.", signalClass: "uncertain" }];
  assert.equal(derive([liked]).longTerm.length, 0);
  assert.equal(derive([liked]).stillLearning[0].netWeight, 2);
});

test("explicit habitual phrasing creates stable evidence only for its submitting person", () => {
  const value = derive([chapter(1, stable())]);
  assert.equal(value.longTerm.length, 1);
  assert.equal(value.longTerm[0].person, "A");
  assert.equal(value.longTerm[0].promotionSource, "explicit_stable");
  assert.equal(value.longTerm[0].netWeight, 4);
  assert.equal(value.recentContext.length, 0);
});

test("model cannot promote unsupported, negated or contextual habitual wording", () => {
  for (const evidence of ["I liked quiet music.", "We do not usually prefer quieter places.", "We usually do not prefer quieter places.", "The café is usually crowded.", "We usually prefer quieter places but were tired tonight."]) {
    assert.notEqual(experience.classifyReaction({ ...stable("quiet"), evidence }).signalClass, "stable_preference");
  }
  assert.equal(experience.classifyReaction(stable("quiet")).signalClass, "stable_preference");
  assert.equal(experience.classifyReaction({ ...stable("quiet"), signalClass: "uncertain", contextMarker: null }).signalClass, "stable_preference");
});

test("strict classification preserves omitted sentence context and does not invent consensus", async () => {
  let sent;
  const interpreted = load("../lib/post-experience.ts", { fetch: async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: JSON.stringify({ taste: [], practical: [{ ...stable("quiet"), evidence: "usually prefer quieter places" }] }) }) };
  } });
  const result = await interpreted.interpretExperience({ person: "A", overall: "liked", note: "We usually prefer quieter places but were tired tonight.", chips: [] }, "fixture", "fixture");
  assert.equal(result.practical[0].signalClass, "contextual_reaction");
  assert.match(result.practical[0].evidence, /tired tonight/);
  assert.equal(sent.text.format.strict, true);
  assert.ok(sent.text.format.schema.properties.practical.items.required.includes("contextMarker"));
  assert.equal(sent.store, false);
});

test("two separate uncertain experiences promote; duplicate chapters and repeated submissions do not", () => {
  const weak = { ...context("I prefer less crowded places."), signalClass: "uncertain", contextMarker: null };
  const first = chapter(1, weak);
  assert.equal(derive([first, first]).longTerm.length, 0);
  const value = derive([first, chapter(2, weak)]);
  assert.equal(value.longTerm[0].chapterCount, 2);
  assert.equal(value.longTerm[0].netWeight, 4);
  assert.equal(value.longTerm[0].promotionSource, "repeated_chapters");
});

test("contextual evidence has lower long-term weight and needs four separate chapters", () => {
  assert.equal(derive([chapter(1, context()), chapter(2, context()), chapter(3, context())]).longTerm.length, 0);
  const value = derive([1, 2, 3, 4].map(index => chapter(index, context())));
  assert.equal(value.longTerm[0].netWeight, 4);
  assert.equal(value.longTerm[0].chapterCount, 4);
});

test("contradiction weakens confidence, can demote, and does not immediately flip", () => {
  const positive = [chapter(1, context()), chapter(2, stable()), chapter(3, context())];
  assert.equal(derive(positive).longTerm[0].confidence, 6 / 8);
  const mixed = derive([...positive, chapter(4, context("Busy was actually fun this time.", "crowds", 1))]);
  assert.equal(mixed.longTerm[0].direction, -1);
  assert.equal(mixed.longTerm[0].confidence, 5 / 9);
  const demoted = derive([...positive, chapter(4, stable("crowds", 1))]);
  assert.equal(demoted.longTerm.length, 0);
  assert.equal(demoted.stillLearning[0].netWeight, 2);
});

test("pair stability requires matching stable directions independently from A and B", () => {
  const first = chapter(1, stable());
  assert.equal(derive([first, chapter(2, context(), "B")]).longTerm.some(item => item.person === "pair"), false);
  assert.equal(derive([first, chapter(2, stable(), "B")]).longTerm.filter(item => item.person === "pair").length, 1);
  assert.equal(derive([first, chapter(2, stable("crowds", 1), "B")]).longTerm.some(item => item.person === "pair"), false);
});

test("recent context changes next discovery temporarily, uses chapter-order decay, and expires", () => {
  const recent = chapter(1, context("Too noisy today.", "quiet"));
  assert.equal(winner(derive([recent])), "quiet");
  const expired = layers.derivePreferenceMemory([recent], "2026-11-11T12:00:00.000Z");
  assert.equal(expired.recentContext.length, 0);
  assert.equal(winner(expired), "busy");
  const old = chapter(1, context("Too noisy today.", "quiet"), "A", "2026-10-07T12:00:00Z");
  const newer = [2, 3, 4].map(index => chapter(index, undefined, "A", `2026-10-${String(index + 7).padStart(2, "0")}T12:00:00Z`));
  assert.equal(derive([old, ...newer]).recentContext.length, 0);
  const decayed = derive([old, ...newer.slice(0, 2)]);
  assert.equal(decayed.recentContext[0].modifierWeight, 0.25);
});

test("a next-time request influences recent discovery more than long-term memory", () => {
  const request = { ...context("More quiet places next time.", "quiet"), contextMarker: "next time", futurePreference: true };
  const value = derive([chapter(1, request)]);
  assert.equal(value.recentContext[0].modifierWeight, 2);
  assert.equal(value.stillLearning[0].netWeight, 1);
  assert.equal(value.longTerm.length, 0);
  assert.equal(winner(value), "quiet");
});

test("stable baseline persists after context expiry and recent contradiction moderates it", () => {
  const enduring = chapter(1, stable("quiet"));
  const baseline = layers.derivePreferenceMemory([enduring], "2026-12-11T12:00:00Z");
  assert.equal(winner(baseline), "quiet");
  const consistent = [enduring, chapter(2, context("Quiet was better tonight.", "quiet"))];
  const before = layers.layeredPracticalProfile(derive(consistent))[0].score;
  const nuanced = derive([...consistent, chapter(3, context("Lively was fun this time.", "quiet", 1))]);
  assert.ok(layers.layeredPracticalProfile(nuanced)[0].score > before);
  assert.equal(winner(nuanced), "quiet");
});

test("crowds and quiet stay distinct, and old one-off taste stops influencing discovery", () => {
  const history = [chapter(1, stable("quiet")), chapter(2, context("Busy was fun this time.", "crowds", 1))];
  assert.equal(derive(history).longTerm[0].confidence, 4 / 6);
  const old = chapter(1, undefined, "A", "2026-01-01T12:00:00Z");
  old.experienceReviews[0].taste = [{ tag: "music", sentiment: "positive", evidence: "Music was good today.", signalClass: "contextual_reaction" }];
  assert.equal(memory.discoveryTasteProfile([old]).different.you.length, 0);
});

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")).entries) sqlite.exec(readFileSync(new URL(`../drizzle/${migration.tag}.sql`, import.meta.url), "utf8"));
  return { sqlite, prepare: sql => ({ bind: (...values) => ({ async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; }, async first() { return sqlite.prepare(sql).get(...values) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; } }) }), async batch(statements) {
    sqlite.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
}

test("D1 persists classification, audits derived layers, rebuilds after edits, scopes and resets both", async () => {
  const db = database();
  try {
    await store.readMemory(db, pairId);
    const first = chapter(1, stable("quiet")); first.experienceReviews = [];
    await store.saveMemory(db, first);
    await store.saveExperienceReview(db, pairId, first.id, { person: "A", overall: "liked" }, { taste: [], practical: [stable("quiet")] }, "first");
    let snapshot = await store.readMemory(db, pairId);
    assert.equal(snapshot.layers.longTerm[0].signal, "quiet");
    assert.equal(db.sqlite.prepare("SELECT signal_class FROM experience_reaction_signals").get().signal_class, "stable_preference");
    const projection = JSON.parse(db.sqlite.prepare("SELECT payload FROM preference_memory_layers").get().payload);
    assert.equal(projection.longTerm[0].chapterCount, 1);
    await store.saveExperienceReview(db, pairId, first.id, { person: "A", overall: "liked" }, { taste: [], practical: [context("Too noisy today.", "quiet")] }, "edit");
    snapshot = await store.readMemory(db, pairId);
    assert.equal(snapshot.layers.longTerm.length, 0);
    assert.equal(snapshot.layers.recentContext.length, 1);
    assert.equal((await store.readMemory(db, "22222222-2222-4222-8222-222222222222")).layers.recentContext.length, 0);
    await store.clearMemory(db, pairId);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM preference_memory_layers WHERE pair_id = ?").get(pairId).count, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM experience_reaction_signals").get().count, 0);
    await assert.rejects(store.readMemory(db, pairId), /ended/);
  } finally { db.sqlite.close(); }
});

test("DEMO, FALLBACK, NEEDS_INPUT, ungrounded and unexperienced history create neither layer", () => {
  for (const state of ["DEMO", "FALLBACK", "NEEDS_INPUT"]) {
    const fake = { ...chapter(1, stable()), state };
    assert.equal(derive([fake]).longTerm.length, 0);
    assert.equal(derive([fake]).recentContext.length, 0);
  }
  const unexperienced = chapter(1, stable()); delete unexperienced.experiencedAt;
  assert.equal(derive([unexperienced]).longTerm.length, 0);
  const ungrounded = { ...chapter(1, stable()), entities: [] };
  assert.equal(derive([ungrounded]).longTerm.length, 0);
});
