import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadTypescript } from "./load-typescript.mjs";

const load = filename => loadTypescript(fileURLToPath(new URL(filename, import.meta.url)));
const recovery = load("../lib/recovery.ts");
const pairStore = load("../lib/memory-store.ts");
const soloStore = load("../lib/solo-store.ts");
const pairId = "11111111-1111-4111-8111-111111111111";
const soloId = "22222222-2222-4222-8222-222222222222";

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

async function seededDatabase() {
  const db = database();
  await pairStore.readMemory(db, pairId);
  await soloStore.readSolo(db, soloId);
  await soloStore.updateSoloSettings(db, soloId, "opposite");
  return db;
}

test("pair and solo recovery codes are random, normalized and stored only as SHA-256 hashes", async () => {
  const db = await seededDatabase();
  const pairCode = await recovery.createRecoveryCode(db, "pair", pairId);
  const soloCode = await recovery.createRecoveryCode(db, "solo", soloId);
  assert.match(pairCode, /^TG-[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  assert.notEqual(pairCode, soloCode);
  const rows = db.sqlite.prepare("SELECT profile_type, code_hash FROM recovery_codes ORDER BY profile_type").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.code_hash)));
  assert.ok(rows.every(row => !row.code_hash.includes("TG")));
  const variant = pairCode.toLowerCase().replaceAll("-", " ");
  assert.equal(await recovery.hashRecoveryCode("pair", pairCode), await recovery.hashRecoveryCode("pair", variant));
  assert.notEqual(await recovery.hashRecoveryCode("pair", pairCode), await recovery.hashRecoveryCode("solo", pairCode));
  db.sqlite.close();
});

test("valid recovery links the same profile without cloning memory and preserves the solo archetype", async () => {
  const db = await seededDatabase();
  const pairCode = await recovery.createRecoveryCode(db, "pair", pairId);
  const soloCode = await recovery.createRecoveryCode(db, "solo", soloId);
  assert.equal(await recovery.redeemRecoveryCode(db, "pair", pairCode, "pair-client"), pairId);
  assert.equal(await recovery.redeemRecoveryCode(db, "solo", soloCode, "solo-client"), soloId);
  assert.equal((await soloStore.readSolo(db, soloId)).archetype, "opposite");
  assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM pair_sessions").get().count, 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM solo_sessions").get().count, 1);
  assert.equal(await recovery.redeemRecoveryCode(db, "solo", pairCode, "wrong-type-a"), null);
  assert.equal(await recovery.redeemRecoveryCode(db, "pair", soloCode, "wrong-type-b"), null);
  assert.equal(await recovery.redeemRecoveryCode(db, "pair", "TG-0000-0000-0000-0000", "invalid"), null);
  db.sqlite.close();
});

test("rotation, revocation and profile reset invalidate old codes", async () => {
  const db = await seededDatabase();
  const oldPair = await recovery.createRecoveryCode(db, "pair", pairId);
  const newPair = await recovery.createRecoveryCode(db, "pair", pairId);
  assert.equal(await recovery.redeemRecoveryCode(db, "pair", oldPair, "old-pair"), null);
  assert.equal(await recovery.redeemRecoveryCode(db, "pair", newPair, "new-pair"), pairId);
  await recovery.revokeRecoveryCode(db, "pair", pairId);
  assert.equal(await recovery.redeemRecoveryCode(db, "pair", newPair, "revoked-pair"), null);
  const soloCode = await recovery.createRecoveryCode(db, "solo", soloId);
  await soloStore.clearSolo(db, soloId);
  assert.equal(await recovery.redeemRecoveryCode(db, "solo", soloCode, "reset-solo"), null);
  db.sqlite.close();
});

test("failed redemption is limited to ten attempts per client in fifteen minutes", async () => {
  const db = await seededDatabase();
  const code = await recovery.createRecoveryCode(db, "pair", pairId);
  for (let attempt = 0; attempt < recovery.recoveryAttemptLimit; attempt += 1) assert.equal(await recovery.redeemRecoveryCode(db, "pair", "invalid", "limited-client", new Date("2026-10-12T00:00:00Z")), null);
  assert.equal(await recovery.redeemRecoveryCode(db, "pair", code, "limited-client", new Date("2026-10-12T00:01:00Z")), null);
  assert.equal(await recovery.redeemRecoveryCode(db, "pair", code, "limited-client", new Date("2026-10-12T00:31:00Z")), pairId);
  db.sqlite.close();
});

test("recovery route returns one generic failure and updates only the selected profile cookie", async () => {
  const db = await seededDatabase();
  const code = await recovery.createRecoveryCode(db, "solo", soloId);
  const cookieWrites = [];
  const route = loadTypescript(fileURLToPath(new URL("../app/api/recovery/route.ts", import.meta.url)), {
    process: { env: { NODE_ENV: "production" } },
    require: name => name === "cloudflare:workers" ? { env: { DB: db } } : name === "next/server" ? { NextResponse: { json: (value, init = {}) => ({ value, status: init.status ?? 200, cookies: { set: (name, value) => cookieWrites.push([name, value]) } }) } } : name === "zod" ? { z } : null,
  });
  const request = body => ({ url: "https://together.test/api/recovery", headers: { get: name => name === "origin" ? "https://together.test" : name === "user-agent" ? "test" : "127.0.0.1" }, cookies: { get: () => undefined }, json: async () => body });
  const invalid = await route.POST(request({ action: "redeem", type: "solo", code: "wrong", locale: "ja" }));
  assert.equal(invalid.status, 400);
  assert.match(invalid.value.error, /無効か期限切れ/);
  const valid = await route.POST(request({ action: "redeem", type: "solo", code, locale: "en" }));
  assert.equal(valid.status, 200);
  assert.deepEqual(cookieWrites, [["together_solo", soloId]]);
  assert.equal(cookieWrites.some(([name]) => name.includes("locale")), false);
  db.sqlite.close();
});
