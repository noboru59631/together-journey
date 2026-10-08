import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repository = fileURLToPath(new URL("../", import.meta.url));
const requireRepository = createRequire(path.join(repository, "package.json"));
const typescript = requireRepository("typescript");
const source = readFileSync(path.join(repository, "app/api/adventure/route.ts"), "utf8");
const compiled = typescript.transpileModule(source, {
  compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
}).outputText;
const reflections = [
  { who: "you", text: "Tokyo at night. It felt lonely, but somehow beautiful." },
  { who: "mika", text: "The soundtrack. I want more of that dreamy indie sound." },
];
const film = { entity_id: "fixture-film", name: "Lost in Translation", types: ["urn:entity:movie"] };
const artist = { entity_id: "fixture-artist", name: "Phoenix", types: ["urn:entity:artist"] };
const place = { entity_id: "fixture-place", name: "Synthetic test venue", types: ["urn:entity:place"], properties: { address: "Synthetic address" } };
const destination = { entity_id: "fixture-destination", name: "Synthetic destination", types: ["urn:entity:destination"] };
const book = { entity_id: "fixture-book", name: "Synthetic book", types: ["urn:entity:book"] };

async function exercise({ key = "test-only-secret-sentinel", failure, candidates = [place], history = [], body = { reflections }, database = true, historyFailure = false, searchEmpty = false } = {}) {
  const calls = [];
  const exports = {};
  const databaseMock = { prepare: () => ({ bind: () => ({ all: async () => {
    if (historyFailure) throw new Error("history failed");
    return { results: history };
  } }) }) };
  const context = vm.createContext({
    exports, URL, AbortSignal, Error,
    process: { env: key ? { QLOO_API_KEY: key } : {} },
    require: moduleName => {
      if (moduleName === "cloudflare:workers") return { env: { DB: database ? databaseMock : undefined } };
      if (moduleName === "next/server") return { NextResponse: { json: value => ({ json: async () => value }) } };
      throw new Error("Unexpected test import");
    },
    fetch: async (url, options) => {
      calls.push({ url: new URL(url), options });
      if (failure instanceof Error || failure?.name === "TimeoutError") throw failure;
      if (typeof failure === "number") return { ok: false, status: failure };
      const entities = url.pathname === "/search" ? searchEmpty ? [] : url.searchParams.get("query") === film.name ? [film] : [artist] : url.searchParams.get("filter.type") === "urn:entity:destination" ? [destination] : url.searchParams.get("filter.type") === "urn:entity:book" ? [book] : candidates;
      return { ok: true, status: 200, json: async () => ({ success: true, results: { entities } }) };
    },
  });
  vm.runInContext(compiled, context);
  const response = await exports.POST({ json: async () => body, cookies: { get: () => ({ value: "00000000-0000-4000-8000-000000000000" }) } });
  const result = await response.json();
  assert.equal(JSON.stringify(result).includes("test-only-secret-sentinel"), false);
  return { result, calls };
}

test("missing key is DEMO with no external request", async () => {
  const { result, calls } = await exercise({ key: "" });
  assert.equal(result.mode, "DEMO");
  assert.equal(calls.length, 0);
});

test("synthetic success passes both resolved IDs and filters known history", async () => {
  const nextPlace = { ...place, entity_id: "fixture-new-place", name: "Second synthetic test venue" };
  const { result, calls } = await exercise({ candidates: [place, nextPlace], history: [{ entity_id: "saved", qloo_entity_id: place.entity_id }] });
  assert.equal(result.mode, "LIVE");
  assert.equal(result.id, nextPlace.entity_id);
  assert.equal(result.trace.candidateCount, 4);
  assert.equal(result.trace.knownFilteredCount, 1);
  assert.equal(JSON.stringify(result.trace.candidateCategories.map(category => [category.category, category.count])), JSON.stringify([["place", 2], ["destination", 1], ["book", 1]]));
  assert.equal(JSON.stringify(result.trace.qlooApiCalls.map(call => [call.stage, call.category, call.status, call.resultCount])), JSON.stringify([["search", "movie", 200, 1], ["search", "artist", 200, 1], ["insights", "place", 200, 2], ["insights", "destination", 200, 1], ["insights", "book", 200, 1]]));
  const insight = calls.find(call => call.url.pathname === "/v2/insights");
  assert.equal(insight.url.searchParams.get("signal.interests.entities"), "fixture-film,fixture-artist");
  assert.equal(insight.url.searchParams.get("filter.type"), "urn:entity:place");
  assert.equal(insight.url.searchParams.get("filter.location.query"), "Tokyo");
  assert.equal(insight.url.searchParams.get("feature.explainability"), "true");
});

for (const status of [401, 403, 429, 500, 503]) {
  test(`HTTP ${status} is FALLBACK and contains no credentials`, async () => {
    const { result } = await exercise({ failure: status });
    assert.equal(result.mode, "FALLBACK");
    assert.match(result.reason, status === 429 ? /rate limit/ : status >= 500 ? /server error/ : /authentication failed/);
  });
}

test("timeout is FALLBACK", async () => {
  const timeout = new Error("synthetic timeout");
  timeout.name = "TimeoutError";
  const { result } = await exercise({ failure: timeout });
  assert.equal(result.mode, "FALLBACK");
  assert.match(result.reason, /timed out/);
});

for (const [name, options] of [
  ["empty Insights", { candidates: [] }],
  ["unresolved entity", { searchEmpty: true }],
  ["all candidates already known", { history: [{ entity_id: place.entity_id, qloo_entity_id: null }] }],
  ["missing D1", { database: false }],
  ["failed D1 lookup", { historyFailure: true }],
]) {
  test(`${name} is FALLBACK`, async () => {
    const { result } = await exercise(options);
    assert.equal(result.mode, "FALLBACK");
  });
}

test("wrong-domain Insights entity cannot become a LIVE place", async () => {
  const { result } = await exercise({ candidates: [artist] });
  assert.equal(result.mode, "FALLBACK");
});

test("empty or non-string entity IDs cannot become LIVE", async () => {
  for (const entity_id of ["", 123, {}]) {
    const { result } = await exercise({ candidates: [{ ...place, entity_id }] });
    assert.equal(result.mode, "FALLBACK");
  }
});

test("malformed reflections are FALLBACK instead of throwing", async () => {
  for (const body of [null, { reflections: {} }, { reflections: [null] }, { reflections: [{ who: "you", text: {} }] }]) {
    const { result } = await exercise({ body });
    assert.equal(result.mode, "FALLBACK");
  }
});
