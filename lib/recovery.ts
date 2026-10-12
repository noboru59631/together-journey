export const recoveryTypes = ["pair", "solo"] as const;
export type RecoveryType = typeof recoveryTypes[number];

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const codePattern = /^TG[0-9A-HJKMNP-TV-Z]{16}$/;
export const recoveryAttemptLimit = 10;
export const recoveryAttemptWindowMs = 15 * 60 * 1000;

function bytesToBase32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

export function normalizeRecoveryCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase().replace(/[\s-]/g, "");
  return codePattern.test(normalized) ? normalized : null;
}

export function formatRecoveryCode(normalized: string) {
  return `${normalized.slice(0, 2)}-${normalized.slice(2, 6)}-${normalized.slice(6, 10)}-${normalized.slice(10, 14)}-${normalized.slice(14, 18)}`;
}

export function generateRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return formatRecoveryCode(`TG${bytesToBase32(bytes)}`);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashRecoveryCode(type: RecoveryType, code: unknown) {
  const normalized = normalizeRecoveryCode(code);
  return normalized ? sha256(`${type}:${normalized}`) : null;
}

export async function hashRecoveryClient(value: string) {
  return sha256(`recovery-attempt:${value}`);
}

async function activeTarget(database: D1Database, type: RecoveryType, targetId: string) {
  const table = type === "pair" ? "pair_sessions" : "solo_sessions";
  return Boolean(await database.prepare(`SELECT id FROM ${table} WHERE id = ? AND revoked_at IS NULL`).bind(targetId).first());
}

export async function recoveryStatus(database: D1Database, type: RecoveryType, targetId: string) {
  const row = await database.prepare("SELECT created_at AS createdAt, last_used_at AS lastUsedAt FROM recovery_codes WHERE profile_type = ? AND target_id = ? AND revoked_at IS NULL").bind(type, targetId).first<{ createdAt: string; lastUsedAt: string | null }>();
  return row ? { active: true, ...row } : { active: false, createdAt: null, lastUsedAt: null };
}

export async function createRecoveryCode(database: D1Database, type: RecoveryType, targetId: string, now = new Date().toISOString()) {
  if (!await activeTarget(database, type, targetId)) throw new Error("Recovery target unavailable");
  const code = generateRecoveryCode();
  const codeHash = await hashRecoveryCode(type, code);
  await database.prepare("INSERT INTO recovery_codes (id, profile_type, target_id, code_hash, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL, NULL) ON CONFLICT(profile_type, target_id) DO UPDATE SET id = excluded.id, code_hash = excluded.code_hash, created_at = excluded.created_at, last_used_at = NULL, revoked_at = NULL").bind(crypto.randomUUID(), type, targetId, codeHash, now).run();
  return code;
}

export async function revokeRecoveryCode(database: D1Database, type: RecoveryType, targetId: string, now = new Date().toISOString()) {
  await database.prepare("UPDATE recovery_codes SET revoked_at = ? WHERE profile_type = ? AND target_id = ? AND revoked_at IS NULL").bind(now, type, targetId).run();
}

async function attemptState(database: D1Database, clientHash: string, now: Date) {
  const row = await database.prepare("SELECT window_started_at AS windowStartedAt, failed_attempts AS failedAttempts, blocked_until AS blockedUntil FROM recovery_attempts WHERE client_hash = ?").bind(clientHash).first<{ windowStartedAt: string; failedAttempts: number; blockedUntil: string | null }>();
  if (!row) return { blocked: false, failedAttempts: 0, windowStartedAt: now.toISOString() };
  if (row.blockedUntil && Date.parse(row.blockedUntil) > now.getTime()) return { blocked: true, failedAttempts: row.failedAttempts, windowStartedAt: row.windowStartedAt };
  if (now.getTime() - Date.parse(row.windowStartedAt) >= recoveryAttemptWindowMs) return { blocked: false, failedAttempts: 0, windowStartedAt: now.toISOString() };
  return { blocked: false, failedAttempts: row.failedAttempts, windowStartedAt: row.windowStartedAt };
}

async function recordFailure(database: D1Database, clientHash: string, state: { failedAttempts: number; windowStartedAt: string }, now: Date) {
  const failedAttempts = state.failedAttempts + 1;
  const blockedUntil = failedAttempts >= recoveryAttemptLimit ? new Date(now.getTime() + recoveryAttemptWindowMs).toISOString() : null;
  await database.prepare("INSERT INTO recovery_attempts (client_hash, window_started_at, failed_attempts, blocked_until) VALUES (?, ?, ?, ?) ON CONFLICT(client_hash) DO UPDATE SET window_started_at = excluded.window_started_at, failed_attempts = excluded.failed_attempts, blocked_until = excluded.blocked_until").bind(clientHash, state.windowStartedAt, failedAttempts, blockedUntil).run();
}

export async function redeemRecoveryCode(database: D1Database, type: RecoveryType, code: unknown, clientHash: string, now = new Date()) {
  const state = await attemptState(database, clientHash, now);
  if (state.blocked) return null;
  const codeHash = await hashRecoveryCode(type, code);
  const row = codeHash ? await database.prepare("SELECT target_id AS targetId FROM recovery_codes WHERE profile_type = ? AND code_hash = ? AND revoked_at IS NULL").bind(type, codeHash).first<{ targetId: string }>() : null;
  if (!row || !await activeTarget(database, type, row.targetId)) {
    await recordFailure(database, clientHash, state, now);
    return null;
  }
  await database.batch([
    database.prepare("UPDATE recovery_codes SET last_used_at = ? WHERE profile_type = ? AND target_id = ? AND code_hash = ? AND revoked_at IS NULL").bind(now.toISOString(), type, row.targetId, codeHash),
    database.prepare("DELETE FROM recovery_attempts WHERE client_hash = ?").bind(clientHash),
  ]);
  return row.targetId;
}
