import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { loadTypescript } from "./load-typescript.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const requireRepository = createRequire(path.join(repository, "package.json"));
const typescript = requireRepository("typescript");
const source = readFileSync(path.join(repository, "app/api/adventure/route.ts"), "utf8");
const compiled = typescript.transpileModule(source, { compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

const body = {
  experience: { title: "Princess Mononoke", category: "movie" },
  reflections: [
    { who: "you", label: "You", text: "Princess Mononoke made me want a quiet forest walk near Tokyo." },
    { who: "partner", label: "Mika", text: "Joe Hisaishi's music stayed with me, but I dislike crowds." },
  ],
  location: "Tokyo",
};

const extraction = {
  experience: { title: "Princess Mononoke", category: "movie" },
  participants: [
    { id: "you", label: "You", likes: ["ancient forests"], dislikes: [], emotionalContext: ["wonder"], entities: [{ name: "Princess Mononoke", type: "urn:entity:movie", why: "Explicitly named", confidence: 0.99, provenance: "explicit" }] },
    { id: "partner", label: "Mika", likes: ["orchestral music"], dislikes: ["crowds"], emotionalContext: ["awe"], entities: [{ name: "Joe Hisaishi", type: "urn:entity:artist", why: "Explicitly named", confidence: 0.98, provenance: "explicit" }] },
  ],
  sharedSpark: { title: "Quiet wonder", summary: "Both reflections favor immersive beauty without crowds." },
  location: { query: "Tokyo", provenance: "explicit" },
  confidence: 0.94,
};

const secondBody = {
  experience: { title: "Norwegian Wood and Blue Bottle Coffee", category: "book" },
  reflections: [
    { who: "you", label: "You", text: "Norwegian Wood made me want a slow afternoon with a book." },
    { who: "partner", label: "Ren", text: "I keep choosing Blue Bottle Coffee and small cafés over busy restaurants." },
  ],
  location: "Yokohama",
};

const secondExtraction = {
  experience: { title: "Norwegian Wood and Blue Bottle Coffee", category: "book" },
  participants: [
    { id: "you", label: "You", likes: ["literary afternoons"], dislikes: [], emotionalContext: ["reflection"], entities: [{ name: "Norwegian Wood", type: "urn:entity:book", why: "Explicitly named", confidence: 0.98, provenance: "explicit" }] },
    { id: "partner", label: "Ren", likes: ["small cafés"], dislikes: ["busy restaurants"], emotionalContext: ["calm"], entities: [{ name: "Blue Bottle Coffee", type: "urn:entity:brand", why: "Explicitly named", confidence: 0.96, provenance: "explicit" }] },
  ],
  sharedSpark: { title: "Slow discovery", summary: "Both prefer reflective experiences in intimate settings." },
  location: { query: "Yokohama", provenance: "explicit" },
  confidence: 0.91,
};

const entityFixtures = {
  "Princess Mononoke": { entity_id: "movie-mononoke", name: "Princess Mononoke", types: ["urn:entity:movie"] },
  "Joe Hisaishi": { entity_id: "artist-hisaishi", name: "Joe Hisaishi", types: ["urn:entity:artist"] },
  "Norwegian Wood": { entity_id: "book-norwegian-wood", name: "Norwegian Wood", types: ["urn:entity:book"] },
  "Blue Bottle Coffee": { entity_id: "brand-blue-bottle", name: "Blue Bottle Coffee", types: ["urn:entity:brand"] },
};
const place = { entity_id: "place-garden", name: "Kiyosumi Gardens", types: ["urn:entity:place"], properties: { address: "Koto City, Tokyo" } };
const nextPlace = { entity_id: "place-museum", name: "Nezu Museum", types: ["urn:entity:place"], properties: { address: "Minato City, Tokyo" } };
const book = { entity_id: "book-candidate", name: "The Book of Tea", types: ["urn:entity:book"] };
const destination = { entity_id: "destination-candidate", name: "Kamakura", types: ["urn:entity:destination"] };

async function exercise({
  requestBody = body,
  extractionResult = extraction,
  openAiKey = "openai-test-sentinel",
  qlooKey = "qloo-test-sentinel",
  llmFailure,
  qlooFailure,
  invalidLlmOnce = false,
  searchOverride,
  placeCandidates = [place],
  emptyInsights = false,
  history = [],
  database = true,
  historyFailure = false,
  memoryHistory = [],
  memorySaveFailure = false,
  preferenceHistory = [],
} = {}) {
  const calls = [];
  const exports = {};
  let llmAttempts = 0;
  const stored = [];
  const databaseMock = { batch: async statements => Promise.all(statements.map(statement => statement.run())), prepare: sql => ({ bind: (...values) => ({
    run: async () => {
      if (sql.startsWith("INSERT INTO pair_memories")) {
        if (memorySaveFailure) throw new Error("save failed");
        stored.push(JSON.parse(values[3]));
      }
      return { meta: { changes: 1 } };
    },
    first: async () => ({ revoked_at: null }),
    all: async () => {
    if (historyFailure) throw new Error("history failed");
    return { results: sql.includes("practical_evidence") ? preferenceHistory : sql.includes("pair_memories") ? memoryHistory.map(chapter => ({ payload: JSON.stringify(chapter), feedback: chapter.feedback, reflection: chapter.reflection })) : history };
  } }) }) };
  const context = vm.createContext({
    exports, URL, AbortSignal, Error, JSON, Set, Promise, Date, crypto: webcrypto,
    process: { env: { ...(openAiKey ? { OPENAI_API_KEY: openAiKey } : {}), ...(qlooKey ? { QLOO_API_KEY: qlooKey } : {}), QLOO_API_BASE_URL: "https://qloo.test" } },
    require: moduleName => {
      if (moduleName === "cloudflare:workers") return { env: { DB: database ? databaseMock : undefined } };
      if (moduleName === "next/server") return { NextResponse: { json: (value, init = {}) => ({ status: init.status ?? 200, cookies: { set() {} }, json: async () => value }) } };
      if (moduleName === "zod") return requireRepository("zod");
      if (moduleName.startsWith("../../../lib/")) return loadTypescript(path.resolve(repository, "app/api/adventure", `${moduleName}.ts`));
      throw new Error(`Unexpected test import: ${moduleName}`);
    },
    fetch: async (urlValue, options) => {
      const url = new URL(urlValue);
      calls.push({ url, options });
      if (url.hostname === "api.openai.com") {
        llmAttempts += 1;
        if (llmFailure instanceof Error) throw llmFailure;
        if (typeof llmFailure === "number") return { ok: false, status: llmFailure };
        const text = invalidLlmOnce && llmAttempts === 1 ? "not-json" : JSON.stringify(extractionResult);
        return { ok: true, status: 200, json: async () => ({ output: [{ content: [{ type: "output_text", text }] }] }) };
      }
      if (qlooFailure instanceof Error) throw qlooFailure;
      if (typeof qlooFailure === "number") return { ok: false, status: qlooFailure };
      let entities;
      if (url.pathname === "/search") {
        const query = url.searchParams.get("query");
        entities = searchOverride ? searchOverride(query, url.searchParams.get("types")) : [entityFixtures[query]].filter(Boolean);
      } else if (emptyInsights) {
        entities = [];
      } else {
        const type = url.searchParams.get("filter.type");
        entities = type === "urn:entity:place" ? placeCandidates : type === "urn:entity:book" ? [book] : [destination];
      }
      return { ok: true, status: 200, json: async () => ({ success: true, results: { entities } }) };
    },
  });
  vm.runInContext(compiled, context);
  const response = await exports.POST({ json: async () => requestBody, cookies: { get: () => ({ value: "00000000-0000-4000-8000-000000000000" }) } });
  const result = await response.json();
  assert.equal(JSON.stringify(result).includes("openai-test-sentinel"), false);
  assert.equal(JSON.stringify(result).includes("qloo-test-sentinel"), false);
  return { result, calls, response, llmAttempts, stored };
}

test("missing LLM key is DEMO and does not claim free-form understanding", async () => {
  const { result, calls } = await exercise({ openAiKey: "" });
  assert.equal(result.mode, "DEMO");
  assert.equal(result.trace.extractionMode, "DEMO");
  assert.equal(calls.length, 0);
});

for (const [name, requestBody, extractionResult] of [
  ["movie and artist conversation", body, extraction],
  ["book and coffee conversation", secondBody, secondExtraction],
]) {
  test(`${name} becomes a verified multi-signal LIVE reveal`, async () => {
    const { result, calls } = await exercise({ requestBody, extractionResult });
    assert.equal(result.mode, "LIVE");
    assert.equal(result.trace.resolvedEntities.length, 2);
    assert.equal(new Set(result.trace.resolvedEntities.map(entity => entity.participant)).size, 2);
    const insight = calls.find(call => call.url.pathname === "/v2/insights");
    assert.equal(insight.url.searchParams.get("signal.interests.entities").split(",").length, 2);
    assert.equal(insight.url.searchParams.get("filter.location.query"), extractionResult.location.query);
  });
}

test("strict structured output is retried once after invalid JSON", async () => {
  const { result, llmAttempts } = await exercise({ invalidLlmOnce: true });
  assert.equal(result.mode, "LIVE");
  assert.equal(llmAttempts, 2);
});

test("an explicitly repeated shared experience is verified even when the LLM omits it from participant entities", async () => {
  const omitted = structuredClone(extraction);
  omitted.participants[0].entities = [];
  const { result } = await exercise({ extractionResult: omitted });
  assert.equal(result.mode, "LIVE");
  assert.equal(JSON.stringify(result.trace.resolvedEntities.map(entity => entity.name)), JSON.stringify(["Princess Mononoke", "Joe Hisaishi"]));
});

test("wrong Qloo search match is never adopted", async () => {
  const { result, calls } = await exercise({ searchOverride: query => [{ entity_id: `wrong-${query}`, name: "Different entity", types: ["urn:entity:artist"] }] });
  assert.equal(result.mode, "NEEDS_INPUT");
  assert.equal(result.trace.resolvedEntities.length, 0);
  assert.equal(result.trace.explanation.input, "0 entities verified in Qloo Search.");
  assert.equal(calls.some(call => call.url.pathname === "/v2/insights"), false);
});

test("low-confidence entities are not searched or sent to Insights", async () => {
  const low = structuredClone(extraction);
  low.participants[0].entities[0].confidence = 0.4;
  low.participants[1].entities[0].confidence = 0.2;
  const { result, calls } = await exercise({ extractionResult: low });
  assert.equal(result.mode, "NEEDS_INPUT");
  assert.equal(calls.filter(call => call.url.pathname === "/search").length, 1);
  assert.equal(calls.some(call => call.url.pathname === "/v2/insights"), false);
  assert.equal(result.trace.unresolvedEntities.every(entity => /confidence/.test(entity.reason)), true);
});

test("history removes duplicate candidates before one reveal", async () => {
  const { result } = await exercise({ placeCandidates: [place, nextPlace], history: [{ entity_id: "saved", qloo_entity_id: place.entity_id }] });
  assert.equal(result.mode, "LIVE");
  assert.equal(result.id, nextPlace.entity_id);
  assert.equal(result.trace.knownFilteredCount, 1);
});

for (const status of [401, 403, 429, 500, 503]) {
  test(`Qloo HTTP ${status} is FALLBACK`, async () => {
    const { result } = await exercise({ qlooFailure: status });
    assert.equal(result.mode, "FALLBACK");
  });
}

test("Qloo timeout is FALLBACK", async () => {
  const timeout = new Error("timeout"); timeout.name = "TimeoutError";
  const { result } = await exercise({ qlooFailure: timeout });
  assert.equal(result.mode, "FALLBACK");
  assert.match(result.reason, /timed out/i);
});

for (const status of [401, 403, 429, 500]) {
  test(`LLM HTTP ${status} is FALLBACK and never calls Qloo`, async () => {
    const { result, calls } = await exercise({ llmFailure: status });
    assert.equal(result.mode, "FALLBACK");
    assert.equal(calls.some(call => call.url.hostname === "qloo.test"), false);
  });
}

test("LLM HTTP 429 explains exhausted quota without exposing provider details", async () => {
  const { result } = await exercise({ llmFailure: 429 });
  assert.match(result.reason, /quota is exhausted/i);
  assert.equal(result.reason.includes("platform.openai.com"), false);
});

test("missing Qloo key keeps LLM provenance but is FALLBACK", async () => {
  const { result } = await exercise({ qlooKey: "" });
  assert.equal(result.mode, "FALLBACK");
  assert.equal(result.trace.extractionMode, "LIVE");
});

for (const [name, options] of [
  ["empty Insights", { emptyInsights: true }],
  ["all candidates already known", { placeCandidates: [place], history: [{ entity_id: place.entity_id, qloo_entity_id: null }, { entity_id: book.entity_id, qloo_entity_id: null }, { entity_id: destination.entity_id, qloo_entity_id: null }] }],
  ["missing D1", { database: false }],
  ["failed D1 lookup", { historyFailure: true }],
]) {
  test(`${name} is FALLBACK`, async () => {
    const { result } = await exercise(options);
    assert.equal(result.mode, "FALLBACK");
  });
}

test("malformed input is rejected before external requests", async () => {
  const { response, calls } = await exercise({ requestBody: { reflections: [] } });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("discovery reranks the same Qloo set after crowded-to-quieter evidence with supported rationale", async () => {
  const candidates = [{ ...place, properties: { description: "A lively crowded place." } }, { ...nextPlace, properties: { description: "A quiet uncrowded place." } }];
  const before = await exercise({ placeCandidates: candidates });
  assert.equal(before.result.id, place.entity_id);
  assert.equal(before.result.trace.practicalRanking.changed, false);
  const preferenceHistory = [{ dimension: "quiet", value: -1, weight: 1, source: "free_text" }, { dimension: "crowds", value: -1, weight: 1, source: "free_text" }];
  const after = await exercise({ placeCandidates: candidates, preferenceHistory });
  assert.equal(after.result.id, nextPlace.entity_id);
  assert.equal(after.result.trace.practicalRanking.changed, true);
  assert.match(after.result.memory.explanation, /quieter and less crowded/);
  assert.equal(after.result.trace.candidateCount, before.result.trace.candidateCount);
  assert.deepEqual(new Set(after.result.trace.practicalRanking.candidates.map(item => item.id)), new Set(before.result.trace.practicalRanking.candidates.map(item => item.id)));
  const unknown = await exercise({ preferenceHistory, placeCandidates: [place, nextPlace] });
  assert.equal(unknown.result.id, place.entity_id);
  assert.equal(unknown.result.trace.practicalRanking.changed, false);
  assert.equal(unknown.result.memory.explanation.includes("ranked this higher"), false);
});

test("first grounded reveal records both reflections and separate entity reactions", async () => {
  const { result, stored, calls } = await exercise();
  assert.equal(result.memory.saved, true);
  assert.equal(result.memory.priorChapters, 0);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].inputs.you, body.reflections[0].text);
  assert.equal(stored[0].inputs.partner, body.reflections[1].text);
  assert.equal(stored[0].entities[0].id, "movie-mononoke");
  assert.equal(stored[0].reactions.length, 2);
  const context = JSON.parse(calls[0].options.body).input[1].content;
  assert.equal(JSON.parse(context).relationshipMemory.chapterCount, 0);
});

test("two-run demonstration extends profile, supplies prior context and excludes prior reveal", async () => {
  const first = await exercise();
  const second = await exercise({ requestBody: secondBody, extractionResult: secondExtraction, memoryHistory: first.stored, placeCandidates: [place, nextPlace] });
  assert.equal(second.result.mode, "LIVE");
  assert.equal(second.result.memory.priorChapters, 1);
  assert.equal(second.result.id, "place-museum");
  const context = JSON.parse(JSON.parse(second.calls[0].options.body).input[1].content).relationshipMemory;
  assert.equal(context.chapterCount, 1);
  assert.ok(context.different.you.includes("ancient forests"));
  assert.ok(context.different.partner.includes("orchestral music"));
  assert.match(second.result.memory.explanation, /ancient forests.*orchestral music/);
  const insight = second.calls.find(call => call.url.pathname === "/v2/insights");
  assert.match(insight.url.searchParams.get("signal.interests.entities"), /movie-mononoke/);
  assert.equal(second.result.memory.profile.chapters, 2);
  assert.notEqual(JSON.stringify(first.result.memory.profile), JSON.stringify(second.result.memory.profile));
});

test("NEEDS_INPUT and demo do not write successful memory", async () => {
  for (const options of [{ openAiKey: "" }, { searchOverride: () => [] }, { emptyInsights: true }]) {
    const { stored, result } = await exercise(options);
    assert.equal(stored.length, 0);
    assert.notEqual(result.mode, "LIVE");
  }
});

test("a valid grounded reveal stays honest when its memory write fails", async () => {
  const { result, stored } = await exercise({ memorySaveFailure: true });
  assert.equal(result.mode, "LIVE");
  assert.equal(result.memory.saved, false);
  assert.equal(result.memory.chapterId, null);
  assert.equal(result.memory.profile.chapters, 0);
  assert.equal(stored.length, 0);
});

test("same entity retains both people's edges without relaxing the distinct-ID gate", async () => {
  const same = structuredClone(extraction);
  same.participants[1].entities = structuredClone(same.participants[0].entities);
  const { result, stored } = await exercise({ extractionResult: same });
  assert.equal(result.mode, "NEEDS_INPUT");
  assert.equal(result.trace.resolvedEntities.length, 2);
  assert.equal(stored.length, 0);
});

test("Not for us removes old interests from positive Qloo signals and changes category preference", async () => {
  const first = await exercise();
  first.stored[0].feedback = "not_for_us";
  const second = await exercise({ requestBody: secondBody, extractionResult: secondExtraction, memoryHistory: first.stored, placeCandidates: [nextPlace] });
  const insight = second.calls.find(call => call.url.pathname === "/v2/insights");
  assert.equal(insight.url.searchParams.get("signal.interests.entities").includes("movie-mononoke"), false);
  assert.notEqual(second.result.category, "place");
  assert.match(second.result.memory.explanation, /Not for us/);
});
