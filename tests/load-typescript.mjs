import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const requireRepository = createRequire(new URL("../package.json", import.meta.url));
const typescript = requireRepository("typescript");

export function loadTypescript(filename, overrides = {}, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const source = readFileSync(filename, "utf8");
  const compiled = typescript.transpileModule(source, { compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const context = vm.createContext({ exports, URL, AbortSignal, Error, JSON, Set, Map, Promise, Date, crypto: webcrypto, process: { env: {} }, ...overrides,
    require: moduleName => {
      if (moduleName.startsWith(".")) return loadTypescript(path.resolve(path.dirname(filename), `${moduleName}.ts`), overrides, cache);
      return overrides.require ? overrides.require(moduleName) : requireRepository(moduleName);
    },
  });
  vm.runInContext(compiled, context);
  return exports;
}
