import { deriveProfile, type Feedback, type MemoryChapter, type MemorySnapshot } from "./relationship-memory";
import { preferenceProfile, type PreferenceEvidence, type PreferenceSignal } from "./practical-preferences";

export const pairCookie = "together_journey";
export const validPairId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

export async function readMemory(database: D1Database, pairId: string): Promise<MemorySnapshot> {
  await database.prepare("INSERT INTO pair_sessions (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").bind(pairId, new Date().toISOString()).run();
  const session = await database.prepare("SELECT revoked_at FROM pair_sessions WHERE id = ?").bind(pairId).first<{ revoked_at: string | null }>();
  if (!session || session.revoked_at) throw new Error("Pair session ended");
  const result = await database.prepare("SELECT payload, feedback, reflection FROM pair_memories WHERE pair_id = ? ORDER BY created_at DESC, id DESC LIMIT 100").bind(pairId).all<{ payload: string; feedback: Feedback | null; reflection: string }>();
  const chapters = result.results.map(row => ({ ...JSON.parse(row.payload) as MemoryChapter, feedback: row.feedback, reflection: row.reflection }));
  const preferences = await database.prepare("SELECT dimension, value, weight, source, timestamp, chapter_id AS chapterId, entity_id AS entityId FROM practical_evidence WHERE pair_id = ?").bind(pairId).all<PreferenceEvidence>();
  return { chapters, profile: deriveProfile(chapters), practical: preferenceProfile(preferences.results), persistence: "D1" };
}

export async function saveMemory(database: D1Database, chapter: MemoryChapter) {
  const [result] = await database.batch([
    database.prepare("INSERT INTO pair_memories (id, pair_id, created_at, payload) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM pair_sessions WHERE id = ? AND revoked_at IS NULL)").bind(chapter.id, chapter.pairId, chapter.timestamp, JSON.stringify(chapter), chapter.pairId),
    database.prepare("DELETE FROM pair_memories WHERE pair_id = ? AND id NOT IN (SELECT id FROM pair_memories WHERE pair_id = ? ORDER BY created_at DESC, id DESC LIMIT 100)").bind(chapter.pairId, chapter.pairId),
  ]);
  if (!result.meta.changes) throw new Error("Pair session ended");
}

export async function updateFeedback(database: D1Database, pairId: string, chapterId: string, feedback: Feedback, reflection?: string, signals: Array<PreferenceSignal & { source: PreferenceEvidence["source"] }> = []) {
  const statements = [database.prepare("UPDATE pair_memories SET feedback = ?, reflection = COALESCE(?, reflection) WHERE pair_id = ? AND id = ? AND json_extract(payload, '$.state') = 'LIVE' AND EXISTS (SELECT 1 FROM pair_sessions WHERE id = ? AND revoked_at IS NULL)").bind(feedback, reflection ?? null, pairId, chapterId, pairId)];
  if (reflection !== undefined) statements.push(database.prepare("DELETE FROM practical_evidence WHERE pair_id = ? AND chapter_id = ? AND source = 'free_text'").bind(pairId, chapterId));
  for (const signal of signals) statements.push(database.prepare("INSERT INTO practical_evidence (pair_id, chapter_id, entity_id, dimension, value, weight, source, timestamp) SELECT ?, ?, json_extract(payload, '$.recommendation.id'), ?, ?, ?, ?, ? FROM pair_memories WHERE pair_id = ? AND id = ? AND json_extract(payload, '$.state') = 'LIVE' AND EXISTS (SELECT 1 FROM pair_sessions WHERE id = ? AND revoked_at IS NULL) ON CONFLICT(pair_id, chapter_id, dimension, source) DO UPDATE SET value = excluded.value, weight = excluded.weight, timestamp = excluded.timestamp").bind(pairId, chapterId, signal.dimension, signal.value, signal.source === "explicit_chip" ? 2 : 1, signal.source, new Date().toISOString(), pairId, chapterId, pairId));
  const [result] = await database.batch(statements);
  return result.meta.changes > 0;
}

export async function clearMemory(database: D1Database, pairId: string) {
  await database.batch([
    database.prepare("INSERT INTO pair_sessions (id, created_at, revoked_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revoked_at = excluded.revoked_at").bind(pairId, new Date().toISOString(), new Date().toISOString()),
    database.prepare("DELETE FROM pair_memories WHERE pair_id = ?").bind(pairId),
    database.prepare("DELETE FROM practical_evidence WHERE pair_id = ?").bind(pairId),
    database.prepare("DELETE FROM experiences WHERE journey_id = ?").bind(pairId),
    database.prepare("DELETE FROM connections WHERE journey_id = ?").bind(pairId),
  ]);
}
