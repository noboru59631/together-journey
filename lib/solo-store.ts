import { explorationHistory } from "./discovery";
import { derivePreferenceMemory, layeredPracticalProfile } from "./preference-memory";
import { preferenceProfile, type PreferenceEvidence, type PreferenceSignal } from "./practical-preferences";
import { canExperience, experienceWeight, supportedReactionSignals, type ExperienceReview, type InterpretedReview, type ReviewInput } from "./post-experience";
import type { Feedback, MemoryChapter } from "./relationship-memory";
import { archetypes, type Archetype, type SoloProfile, type SoloSeed } from "./solo-partner";

export const soloCookie = "together_solo";
export const validSoloId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

export async function readSolo(database: D1Database, id: string): Promise<SoloProfile> {
  await database.prepare("INSERT INTO solo_sessions (id, created_at, archetype, seeds) VALUES (?, ?, 'explorer', '[]') ON CONFLICT(id) DO NOTHING").bind(id, new Date().toISOString()).run();
  const session = await database.prepare("SELECT archetype, seeds, revoked_at FROM solo_sessions WHERE id = ?").bind(id).first<{ archetype: string; seeds: string; revoked_at: string | null }>();
  if (!session || session.revoked_at) throw new Error("Solo session ended");
  const rows = await database.prepare("SELECT payload FROM solo_memories WHERE solo_id = ? ORDER BY created_at DESC, id DESC LIMIT 100").bind(id).all<{ payload: string }>();
  const chapters = rows.results.map(row => JSON.parse(row.payload) as MemoryChapter);
  const layers = derivePreferenceMemory(chapters);
  const explicit = chapters.flatMap(chapter => (chapter.soloPreferences ?? []) as PreferenceEvidence[]);
  const actual = chapters.filter(chapter => canExperience(chapter) && chapter.experiencedAt).flatMap(chapter => (chapter.experienceReviews ?? []).flatMap(review => review.practical.map(signal => ({ dimension: signal.dimension, value: signal.value, chapterId: chapter.id, entityId: review.entityId, source: "post_experience" as const, weight: experienceWeight, timestamp: review.reviewedAt }))));
  return { id, archetype: archetypes.includes(session.archetype as Archetype) ? session.archetype as Archetype : "explorer", seeds: JSON.parse(session.seeds) as SoloSeed[], chapters, exploration: explorationHistory(chapters), layers, practical: layeredPracticalProfile(layers, preferenceProfile([...explicit, ...actual])) };
}

export async function updateSoloSettings(database: D1Database, id: string, archetype?: Archetype, seeds?: SoloSeed[]) {
  await readSolo(database, id);
  await database.prepare("UPDATE solo_sessions SET archetype = COALESCE(?, archetype), seeds = COALESCE(?, seeds) WHERE id = ? AND revoked_at IS NULL").bind(archetype ?? null, seeds ? JSON.stringify(seeds) : null, id).run();
  return readSolo(database, id);
}

export async function saveSoloChapter(database: D1Database, id: string, chapter: MemoryChapter) {
  const result = await database.prepare("INSERT INTO solo_memories (id, solo_id, created_at, payload) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM solo_sessions WHERE id = ? AND revoked_at IS NULL)").bind(chapter.id, id, chapter.timestamp, JSON.stringify(chapter), id).run();
  if (!result.meta.changes) throw new Error("Solo session ended");
}

async function updateChapter(database: D1Database, id: string, chapter: MemoryChapter) {
  const result = await database.prepare("UPDATE solo_memories SET payload = ? WHERE solo_id = ? AND id = ? AND EXISTS (SELECT 1 FROM solo_sessions WHERE id = ? AND revoked_at IS NULL)").bind(JSON.stringify(chapter), id, chapter.id, id).run();
  return result.meta.changes > 0;
}

export async function updateSoloFeedback(database: D1Database, id: string, chapterId: string, feedback: Feedback, reflection?: string, preference?: PreferenceSignal) {
  const profile = await readSolo(database, id);
  const chapter = profile.chapters.find(item => item.id === chapterId);
  if (!chapter) return false;
  chapter.feedback = feedback;
  chapter.reflection = reflection ?? chapter.reflection;
  if (chapter.discovery) chapter.discovery.status = feedback === "not_for_us" ? "skipped" : chapter.discovery.status;
  if (preference) chapter.soloPreferences = [{ ...preference, chapterId, entityId: chapter.recommendation.id, source: "explicit_chip", weight: 2, timestamp: new Date().toISOString() }];
  return updateChapter(database, id, chapter);
}

export async function markSoloExperienced(database: D1Database, id: string, chapterId: string) {
  const profile = await readSolo(database, id);
  const chapter = profile.chapters.find(item => item.id === chapterId);
  if (!chapter || !canExperience(chapter)) return false;
  chapter.experiencedAt ??= new Date().toISOString();
  if (chapter.discovery) chapter.discovery.status = "tried";
  return updateChapter(database, id, chapter);
}

export async function saveSoloReview(database: D1Database, id: string, chapterId: string, input: ReviewInput, interpreted: InterpretedReview) {
  const profile = await readSolo(database, id);
  const chapter = profile.chapters.find(item => item.id === chapterId);
  if (!chapter?.experiencedAt || !canExperience(chapter) || input.person !== "A") return false;
  const review: ExperienceReview = { ...supportedReactionSignals(interpreted), chapterId, entityId: chapter.recommendation.id, entityName: chapter.recommendation.name,
    domain: chapter.discovery?.domain ?? chapter.recommendation.category, person: "A", overall: input.overall, reviewedAt: new Date().toISOString(), source: "post_experience", weight: experienceWeight };
  chapter.experienceReviews = [review];
  return updateChapter(database, id, chapter);
}

export async function clearSolo(database: D1Database, id: string) {
  await database.batch([
    database.prepare("INSERT INTO solo_sessions (id, created_at, archetype, seeds, revoked_at) VALUES (?, ?, 'explorer', '[]', ?) ON CONFLICT(id) DO UPDATE SET revoked_at = excluded.revoked_at").bind(id, new Date().toISOString(), new Date().toISOString()),
    database.prepare("DELETE FROM solo_memories WHERE solo_id = ?").bind(id),
    database.prepare("UPDATE recovery_codes SET revoked_at = ? WHERE profile_type = 'solo' AND target_id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), id),
  ]);
}
