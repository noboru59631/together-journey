CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`journey_id` text NOT NULL,
	`from_experience` text NOT NULL,
	`to_experience` text NOT NULL,
	`qloo_affinity` text,
	`novelty` text,
	`explanation` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_connections_journey` ON `connections` (`journey_id`);--> statement-breakpoint
CREATE TABLE `experiences` (
	`id` text PRIMARY KEY NOT NULL,
	`journey_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`qloo_entity_id` text,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`reaction` text NOT NULL,
	`reflection` text DEFAULT '' NOT NULL,
	`cultural_signals` text DEFAULT '[]' NOT NULL,
	`emotional_signals` text DEFAULT '[]' NOT NULL,
	`with_whom` text,
	`discovered_from` text,
	`experienced_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_experiences_journey_entity` ON `experiences` (`journey_id`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_experiences_journey_time` ON `experiences` (`journey_id`,`experienced_at`);--> statement-breakpoint
CREATE TABLE `journeys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_ids` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL
);
