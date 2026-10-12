import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const stylesheet = readFileSync(path.join(repository, "app/globals.css"), "utf8");

test("native select menus keep option text readable", () => {
  assert.match(stylesheet, /select\{color-scheme:dark\}/);
  assert.match(stylesheet, /select option\{color:#111;background-color:#fff\}/);
  assert.match(stylesheet, /select option:checked\{color:#fff;background-color:#4f46e5\}/);
});
