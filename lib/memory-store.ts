import { deriveProfile, type Feedback, type MemoryChapter, type MemorySnapshot } from "./relationship-memory";
import { preferenceProfile, type PreferenceEvidence, type PreferenceSignal } from "./practical-preferences";
import { canExperience, experienceWeight, interpretedReviewSchema, supportedReactionSignals, type ExperienceReview, type InterpretedReview, type ReviewInput } from "./post-experience";

export const pairCookie = "together_journey";
export const validPairId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

export async function readMemory(database: D1Database, pairId: string): Promise<MemorySnapshot> {
  await database.prepare("INSERT INTO pair_sessions (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").bind(pairId, new Date().toISOString()).run();
  const session = await database.prepare("SELECT revoked_at FROM pair_sessions WHERE id = ?").bind(pairId).first<{ revoked_at: string | null }>();
  if (!session || session.revoked_at) throw new Error("Pair session ended");
  const result = await database.prepare("SELECT payload, feedback, reflection FROM pair_memories WHERE pair_id = ? ORDER BY created_at DESC, id DESC LIMIT 100").bind(pairId).all<{ payload: string; feedback: Feedback | null; reflection: string }>();
  const chapters = result.results.map(row => ({ ...JSON.parse(row.payload) as MemoryChapter, feedback: row.feedback, reflection: row.reflection }));
  const reviews = await database.prepare("SELECT chapter_id AS chapterId, entity_id AS entityId, entity_name AS entityName, domain, person, overall, reviewed_at AS reviewedAt, source, weight FROM experience_reviews WHERE pair_id = ?").bind(pairId).all<ExperienceReview>();
  const signals = await database.prepare("SELECT chapter_id AS chapterId, person, kind, signal, value, evidence FROM experience_reaction_signals WHERE pair_id = ?").bind(pairId).all<{ chapterId: string; person: string; kind: string; signal: string; value: string; evidence: string }>();
  for (const chapter of chapters) chapter.experienceReviews = reviews.results.filter(review => review.chapterId === chapter.id).map(review => ({ ...review, ...supportedReactionSignals(interpretedReviewSchema.parse({
    taste: signals.results.filter(signal => signal.chapterId === chapter.id && signal.person === review.person && signal.kind === "taste").map(signal => ({ tag: signal.signal, sentiment: signal.value, evidence: signal.evidence })),
    practical: signals.results.filter(signal => signal.chapterId === chapter.id && signal.person === review.person && signal.kind === "practical").map(signal => ({ dimension: signal.signal, value: Number(signal.value), evidence: signal.evidence })),
  })) }));
  const preferences = await database.prepare("SELECT dimension, value, weight, source, timestamp, chapter_id AS chapterId, entity_id AS entityId FROM practical_evidence WHERE pair_id = ?").bind(pairId).all<PreferenceEvidence>();
  const actualPreferences: PreferenceEvidence[] = chapters.filter(chapter => canExperience(chapter) && chapter.experiencedAt).flatMap(chapter => (chapter.experienceReviews ?? []).flatMap(review => review.practical.map(signal => ({ ...signal, chapterId: chapter.id, entityId: review.entityId, person: review.person, timestamp: review.reviewedAt, source: "post_experience" as const, weight: experienceWeight }))));
  return { chapters, profile: deriveProfile(chapters), practical: preferenceProfile([...preferences.results, ...actualPreferences]), asOf: new Date().toISOString(), persistence: "D1" };
}

export async function markExperienced(database: D1Database, pairId: string, chapterId: string) {
  const snapshot = await readMemory(database, pairId);
  const chapter = snapshot.chapters.find(item => item.id === chapterId);
  if (!chapter || !canExperience(chapter)) return false;
  const result = await database.prepare("UPDATE pair_memories SET payload = json_set(payload, '$.experiencedAt', COALESCE(json_extract(payload, '$.experiencedAt'), ?), '$.discovery.status', 'tried') WHERE pair_id = ? AND id = ? AND json_extract(payload, '$.state') = 'LIVE' AND EXISTS (SELECT 1 FROM pair_sessions WHERE id = ? AND revoked_at IS NULL)").bind(new Date().toISOString(), pairId, chapterId, pairId).run();
  return result.meta.changes > 0;
}

export async function reviewHash(database: D1Database, pairId: string, chapterId: string, person: ReviewInput["person"]) {
  return database.prepare("SELECT input_hash AS hash FROM experience_reviews WHERE pair_id = ? AND chapter_id = ? AND person = ?").bind(pairId, chapterId, person).first<{ hash: string }>();
}

export async function saveExperienceReview(database: D1Database, pairId: string, chapterId: string, input: ReviewInput, interpreted: InterpretedReview, hash: string) {
  const snapshot = await readMemory(database, pairId);
  const chapter = snapshot.chapters.find(item => item.id === chapterId);
  if (!chapter || !canExperience(chapter) || !chapter.experiencedAt) return false;
  const parsed = supportedReactionSignals(interpretedReviewSchema.parse(interpreted));
  const timestamp = new Date().toISOString();
  const guard = "FROM pair_memories WHERE pair_id = ? AND id = ? AND json_extract(payload, '$.state') = 'LIVE' AND json_extract(payload, '$.experiencedAt') IS NOT NULL AND EXISTS (SELECT 1 FROM pair_sessions WHERE id = ? AND revoked_at IS NULL)";
  const statements = [database.prepare(`INSERT INTO experience_reviews (pair_id, chapter_id, person, entity_id, entity_name, domain, overall, input_hash, reviewed_at, source, weight) SELECT ?, ?, ?, json_extract(payload, '$.recommendation.id'), json_extract(payload, '$.recommendation.name'), COALESCE(json_extract(payload, '$.discovery.domain'), json_extract(payload, '$.recommendation.category')), ?, ?, ?, 'post_experience', ? ${guard} ON CONFLICT(pair_id, chapter_id, person) DO UPDATE SET overall = excluded.overall, input_hash = excluded.input_hash, reviewed_at = excluded.reviewed_at`).bind(pairId, chapterId, input.person, input.overall, hash, timestamp, experienceWeight, pairId, chapterId, pairId),
    database.prepare("DELETE FROM experience_reaction_signals WHERE pair_id = ? AND chapter_id = ? AND person = ?").bind(pairId, chapterId, input.person),
  ];
  const signalRows = [
    ...parsed.taste.map(signal => ({ kind: "taste", signal: signal.tag, value: signal.sentiment, evidence: signal.evidence })),
    ...parsed.practical.map(signal => ({ kind: "practical", signal: signal.dimension, value: String(signal.value), evidence: signal.evidence })),
  ];
  for (const signal of signalRows) statements.push(database.prepare(`INSERT INTO experience_reaction_signals (pair_id, chapter_id, person, entity_id, kind, signal, value, evidence, source, weight, reviewed_at) SELECT ?, ?, ?, json_extract(payload, '$.recommendation.id'), ?, ?, ?, ?, 'post_experience', ?, ? ${guard}`).bind(pairId, chapterId, input.person, signal.kind, signal.signal, signal.value, signal.evidence, experienceWeight, timestamp, pairId, chapterId, pairId));
  const [result] = await database.batch(statements);
  return result.meta.changes > 0;
}

export async function saveMemory(database: D1Database, chapter: MemoryChapter) {
  const [result] = await database.batch([
    database.prepare("INSERT INTO pair_memories (id, pair_id, created_at, payload) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM pair_sessions WHERE id = ? AND revoked_at IS NULL)").bind(chapter.id, chapter.pairId, chapter.timestamp, JSON.stringify(chapter), chapter.pairId),
    database.prepare("DELETE FROM pair_memories WHERE pair_id = ? AND id NOT IN (SELECT id FROM pair_memories WHERE pair_id = ? ORDER BY created_at DESC, id DESC LIMIT 100)").bind(chapter.pairId, chapter.pairId),
  ]);
  if (!result.meta.changes) throw new Error("Pair session ended");
}

export async function updateFeedback(database: D1Database, pairId: string, chapterId: string, feedback: Feedback, reflection?: string, signals: Array<PreferenceSignal & { source: PreferenceEvidence["source"] }> = [], status?: "suggested" | "tried" | "skipped") {
  const statements = [database.prepare("UPDATE pair_memories SET feedback = ?, reflection = COALESCE(?, reflection) WHERE pair_id = ? AND id = ? AND json_extract(payload, '$.state') = 'LIVE' AND EXISTS (SELECT 1 FROM pair_sessions WHERE id = ? AND revoked_at IS NULL)").bind(feedback, reflection ?? null, pairId, chapterId, pairId)];
  if (status) statements.push(database.prepare("UPDATE pair_memories SET payload = json_set(payload, '$.discovery.status', ?) WHERE pair_id = ? AND id = ? AND json_extract(payload, '$.discovery.domain') IS NOT NULL AND EXISTS (SELECT 1 FROM pair_sessions WHERE id = ? AND revoked_at IS NULL)").bind(status, pairId, chapterId, pairId));
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
    database.prepare("DELETE FROM experience_reaction_signals WHERE pair_id = ?").bind(pairId),
    database.prepare("DELETE FROM experience_reviews WHERE pair_id = ?").bind(pairId),
    database.prepare("DELETE FROM experiences WHERE journey_id = ?").bind(pairId),
    database.prepare("DELETE FROM connections WHERE journey_id = ?").bind(pairId),
  ]);
}
