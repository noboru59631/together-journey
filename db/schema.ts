import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
export const preferenceMemoryLayers = sqliteTable("preference_memory_layers", {
  pairId: text("pair_id").primaryKey(), policyVersion: integer("policy_version").notNull(),
  payload: text("payload").notNull(), derivedAt: text("derived_at").notNull(),
});
export const experienceReviews = sqliteTable("experience_reviews", {
  pairId: text("pair_id").notNull(), chapterId: text("chapter_id").notNull(), person: text("person").notNull(),
  entityId: text("entity_id").notNull(), entityName: text("entity_name").notNull(), domain: text("domain").notNull(),
  overall: text("overall").notNull(), inputHash: text("input_hash").notNull(), reviewedAt: text("reviewed_at").notNull(),
  source: text("source").notNull().default("post_experience"), weight: integer("weight").notNull().default(4),
}, table => [uniqueIndex("idx_experience_reviews_person").on(table.pairId, table.chapterId, table.person)]);
export const experienceReactionSignals = sqliteTable("experience_reaction_signals", {
  pairId: text("pair_id").notNull(), chapterId: text("chapter_id").notNull(), person: text("person").notNull(),
  entityId: text("entity_id").notNull(), kind: text("kind").notNull(), signal: text("signal").notNull(),
  value: text("value").notNull(), evidence: text("evidence").notNull(),
  signalClass: text("signal_class").notNull().default("uncertain"), contextMarker: text("context_marker"),
  futurePreference: integer("future_preference").notNull().default(0), expiresAt: text("expires_at"),
  source: text("source").notNull().default("post_experience"), weight: integer("weight").notNull().default(4), reviewedAt: text("reviewed_at").notNull(),
}, table => [uniqueIndex("idx_experience_signals_person").on(table.pairId, table.chapterId, table.person, table.kind, table.signal)]);
export const candidatePracticalMetadata = sqliteTable("candidate_practical_metadata", {
  entityId: text("entity_id").primaryKey(), payload: text("payload").notNull(),
});
export const practicalEvidence = sqliteTable("practical_evidence", {
  pairId: text("pair_id").notNull(), chapterId: text("chapter_id").notNull(), entityId: text("entity_id").notNull(),
  dimension: text("dimension").notNull(), value: integer("value").notNull(), weight: integer("weight").notNull(),
  source: text("source").notNull(), timestamp: text("timestamp").notNull(),
}, table => [uniqueIndex("idx_practical_evidence_unique").on(table.pairId, table.chapterId, table.dimension, table.source)]);
export const pairSessions = sqliteTable("pair_sessions", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
});
export const soloSessions = sqliteTable("solo_sessions", {
  id: text("id").primaryKey(), createdAt: text("created_at").notNull(),
  archetype: text("archetype").notNull().default("explorer"), seeds: text("seeds").notNull().default("[]"),
  revokedAt: text("revoked_at"),
});
export const soloMemories = sqliteTable("solo_memories", {
  id: text("id").primaryKey(), soloId: text("solo_id").notNull(),
  createdAt: text("created_at").notNull(), payload: text("payload").notNull(),
}, table => [index("idx_solo_memories_time").on(table.soloId, table.createdAt)]);
export const recoveryCodes = sqliteTable("recovery_codes", {
  id: text("id").primaryKey(), profileType: text("profile_type").notNull(), targetId: text("target_id").notNull(),
  codeHash: text("code_hash").notNull(), createdAt: text("created_at").notNull(), lastUsedAt: text("last_used_at"), revokedAt: text("revoked_at"),
}, table => [uniqueIndex("idx_recovery_codes_hash").on(table.codeHash), uniqueIndex("idx_recovery_codes_target").on(table.profileType, table.targetId)]);
export const recoveryAttempts = sqliteTable("recovery_attempts", {
  clientHash: text("client_hash").primaryKey(), windowStartedAt: text("window_started_at").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0), blockedUntil: text("blocked_until"),
});
export const pairMemories = sqliteTable("pair_memories", {
  id: text("id").primaryKey(),
  pairId: text("pair_id").notNull(),
  createdAt: text("created_at").notNull(),
  payload: text("payload").notNull(),
  feedback: text("feedback"),
  reflection: text("reflection").notNull().default(""),
}, table => [index("idx_pair_memories_time").on(table.pairId, table.createdAt)]);
export const users=sqliteTable("users",{id:text("id").primaryKey(),displayName:text("display_name").notNull()});
export const journeys=sqliteTable("journeys",{id:text("id").primaryKey(),userIds:text("user_ids").notNull(),createdAt:text("created_at").notNull()});
export const experiences=sqliteTable("experiences",{id:text("id").primaryKey(),journeyId:text("journey_id").notNull(),entityId:text("entity_id").notNull(),qlooEntityId:text("qloo_entity_id"),title:text("title").notNull(),type:text("type").notNull(),reaction:text("reaction").notNull(),reflection:text("reflection").notNull().default(""),culturalSignals:text("cultural_signals").notNull().default("[]"),emotionalSignals:text("emotional_signals").notNull().default("[]"),withWhom:text("with_whom"),discoveredFrom:text("discovered_from"),experiencedAt:text("experienced_at").notNull()},table=>[uniqueIndex("idx_experiences_journey_entity").on(table.journeyId,table.entityId),index("idx_experiences_journey_time").on(table.journeyId,table.experiencedAt)]);
export const connections=sqliteTable("connections",{id:text("id").primaryKey(),journeyId:text("journey_id").notNull(),fromExperience:text("from_experience").notNull(),toExperience:text("to_experience").notNull(),qlooAffinity:text("qloo_affinity"),novelty:text("novelty"),explanation:text("explanation").notNull()},table=>[index("idx_connections_journey").on(table.journeyId)]);
