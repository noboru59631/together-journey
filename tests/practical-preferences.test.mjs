import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadTypescript } from "./load-typescript.mjs";

const filename = fileURLToPath(new URL("../lib/practical-preferences.ts", import.meta.url));
const practical = loadTypescript(filename);
const metadata = loadTypescript(fileURLToPath(new URL("../lib/practical-metadata.ts", import.meta.url)));
const evidence = (dimension, value, weight = 1) => ({ dimension, value, weight, chapterId: "chapter", source: "free_text", timestamp: "2026-10-11", entityId: "qloo" });
const candidate = (id, description) => {
  const value = { id, category: "place", entity: { entity_id: id, properties: { description } } };
  return { ...value, practical: metadata.normalizeMetadata(value, "https://hackathon.api.qloo.com/v2/insights") };
};

test("first run has no learned practical profile", () => {
  assert.equal(practical.preferenceProfile([]).length, 0);
  assert.equal(practical.learnedPreferences([]).length, 0);
});

test("one explicit signal learns one dimension and contradictory weighted evidence blends", () => {
  const initial = practical.preferenceProfile([evidence("quiet", -1, 2)]);
  assert.equal(initial.length, 1);
  assert.equal(initial[0].score, -2);
  const blend = practical.preferenceProfile([evidence("quiet", -1, 2), evidence("quiet", 1)]);
  assert.ok(Math.abs(blend[0].score + 2 / 3) < 0.0001);
  assert.equal(blend[0].count, 2);
  const balanced = practical.preferenceProfile([evidence("quiet", -1), evidence("quiet", 1)]);
  assert.equal(practical.learnedPreferences(balanced).length, 0);
});

test("strict Responses interpretation parses crowded to quieter signals without persisting model prose", async () => {
  let sent;
  const interpreted = loadTypescript(filename, { fetch: async (_, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ signals: [{ preference: "less_crowded" }, { preference: "quieter" }] }) }] }] }) };
  } });
  const signals = await interpreted.interpretPreferenceNote("We liked it, but it was too crowded. More quiet places next time.", "mock", "test-model");
  assert.equal(JSON.stringify(signals), JSON.stringify([{ dimension: "crowds", value: -1 }, { dimension: "quiet", value: -1 }]));
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.strict, true);
  assert.equal(sent.text.format.schema.additionalProperties, false);
});

test("malformed, invented dimensions and missing outputs fail closed", async () => {
  for (const output_text of ["broken", JSON.stringify({ signals: [{ dimension: "compatibility", value: 1 }] }), JSON.stringify({ signals: [{ dimension: "quiet", value: -1, guess: true }] })]) {
    const interpreted = loadTypescript(filename, { fetch: async () => ({ ok: true, json: async () => ({ output_text }) }) });
    await assert.rejects(interpreted.interpretPreferenceNote("quiet", "mock", "model"));
  }
});

test("grounded reranking changes order only with pair AND candidate evidence", () => {
  const candidates = [candidate("qloo-busy", "A lively, crowded outdoor market."), candidate("qloo-quiet", "A quiet, uncrowded indoor reading room.")];
  const unchanged = practical.rerankCandidates(candidates, []);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.rationale, "");
  const profile = practical.preferenceProfile([evidence("quiet", -1), evidence("crowds", -1)]);
  const changed = practical.rerankCandidates(candidates, profile);
  assert.equal(changed.changed, true);
  assert.equal(changed.ranked[0].candidate.id, "qloo-quiet");
  assert.match(changed.rationale, /quieter and less crowded/);
  assert.deepEqual(new Set(changed.ranked.map(item => item.candidate)), new Set(candidates));
  const unknown = practical.rerankCandidates([candidate("qloo-one"), candidate("qloo-two")], profile);
  assert.equal(unknown.changed, false);
  assert.equal(unknown.rationale, "");
});

test("negated descriptions and conflicting candidate metadata do not become facts", () => {
  assert.equal(practical.candidateFacts(candidate("qloo", "Not quiet; neither lively nor crowded.")).some(fact => fact.dimension === "quiet"), false);
  assert.equal(practical.candidateFacts(candidate("qloo", "Quiet mornings and lively evenings.")).some(fact => fact.dimension === "quiet"), false);
  assert.equal(practical.candidateFacts(candidate("qloo", "Less crowded.")).find(fact => fact.dimension === "crowds").value, -1);
});
