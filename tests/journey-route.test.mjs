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
const source = readFileSync(path.join(repository, "app/api/journey/route.ts"), "utf8");
const compiled = typescript.transpileModule(source, { compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 } }).outputText;

async function exercise({ fail = false } = {}) {
  const exports = {};
  let bound = [];
  const responseFactory = (value, init = {}) => ({ status: init.status ?? 200, cookies: { set: () => undefined }, json: async () => value });
  const database = { prepare: () => ({ bind: (...values) => { bound = values; return { run: async () => { if (fail) throw new Error("save failed"); } }; } }) };
  const context = vm.createContext({
    exports, Date, JSON,
    crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
    process: { env: { NODE_ENV: "production" } },
    require: moduleName => {
      if (moduleName === "cloudflare:workers") return { env: { DB: database } };
      if (moduleName === "next/server") return { NextResponse: { json: responseFactory } };
      throw new Error(`Unexpected import: ${moduleName}`);
    },
  });
  vm.runInContext(compiled, context);
  const response = await exports.POST({
    json: async () => ({ entityId: "place-1", qlooEntityId: "place-1", title: "Nezu Museum", type: "place", reaction: "Good", reflection: "The garden was calm.", culturalSignals: ["Princess Mononoke", "Joe Hisaishi"], emotionalSignals: ["wonder", "calm"], withWhom: "Mika", discoveredFrom: "Princess Mononoke" }),
    cookies: { get: () => ({ value: "00000000-0000-4000-8000-000000000000" }) },
  });
  return { response, result: await response.json(), bound };
}

test("Journey stores dynamic cultural and emotional provenance", async () => {
  const { result, bound } = await exercise();
  assert.equal(result.saved, true);
  assert.equal(bound[8], JSON.stringify(["Princess Mononoke", "Joe Hisaishi"]));
  assert.equal(bound[9], JSON.stringify(["wonder", "calm"]));
  assert.equal(bound[10], "Mika");
  assert.equal(bound[11], "Princess Mononoke");
});

test("Journey save failure is explicit and recoverable", async () => {
  const { response, result } = await exercise({ fail: true });
  assert.equal(response.status, 503);
  assert.equal(result.saved, false);
  assert.match(result.error, /temporarily unavailable/);
});
