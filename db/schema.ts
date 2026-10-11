import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
