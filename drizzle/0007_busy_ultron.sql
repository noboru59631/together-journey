CREATE TABLE `solo_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`solo_id` text NOT NULL,
	`created_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_solo_memories_time` ON `solo_memories` (`solo_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `solo_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`archetype` text DEFAULT 'explorer' NOT NULL,
	`seeds` text DEFAULT '[]' NOT NULL,
	`revoked_at` text
);
