CREATE TABLE `pair_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`pair_id` text NOT NULL,
	`created_at` text NOT NULL,
	`payload` text NOT NULL,
	`feedback` text,
	`reflection` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pair_memories_time` ON `pair_memories` (`pair_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pair_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
