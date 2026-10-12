import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadTypescript } from "./load-typescript.mjs";

const i18n = loadTypescript(fileURLToPath(new URL("../lib/i18n.ts", import.meta.url)));

test("English is the default unless saved preference or browser locale clearly indicates Japanese", () => {
  assert.equal(i18n.resolveInitialLocale(null, "en-US"), "en");
  assert.equal(i18n.resolveInitialLocale(null, "fr-FR"), "en");
  assert.equal(i18n.resolveInitialLocale(null, "ja-JP"), "ja");
});

test("saved language preference wins across reload", () => {
  assert.equal(i18n.localeStorageKey, "together.locale");
  assert.equal(i18n.resolveInitialLocale("ja", "en-US"), "ja");
  assert.equal(i18n.resolveInitialLocale("en", "ja-JP"), "en");
});

test("missing localized key falls back to English explicitly", () => {
  const dictionaries = { en: { headline: "English headline" }, ja: {} };
  assert.equal(i18n.translateFromDictionaries(dictionaries, "ja", "headline"), "English headline");
  assert.equal(i18n.translateFromDictionaries(dictionaries, "ja", "unknown"), "unknown");
});

test("Japanese UI copy is natural while status tokens stay unchanged", () => {
  assert.equal(i18n.translate("ja", "taste.shared"), "共通");
  assert.equal(i18n.translate("ja", "taste.different"), "それぞれの違い");
  assert.equal(i18n.translate("ja", "next.title"), "次は何を一緒に見つける？");
  for (const token of ["LIVE", "DEMO", "FALLBACK", "NEEDS_INPUT"]) assert.equal(i18n.statusToken(token), token);
});

test("Japanese API instruction localizes presentation but protects structured grounding", () => {
  const instruction = i18n.languageInstruction("ja");
  assert.match(instruction, /natural Japanese/);
  assert.match(instruction, /IDs, Qloo types/);
  assert.match(instruction, /proper nouns/);
});
