CREATE TABLE `experience_reaction_signals` (
	`pair_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`person` text NOT NULL,
	`entity_id` text NOT NULL,
	`kind` text NOT NULL,
	`signal` text NOT NULL,
	`value` text NOT NULL,
	`evidence` text NOT NULL,
	`source` text DEFAULT 'post_experience' NOT NULL,
	`weight` integer DEFAULT 4 NOT NULL,
	`reviewed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_experience_signals_person` ON `experience_reaction_signals` (`pair_id`,`chapter_id`,`person`,`kind`,`signal`);--> statement-breakpoint
CREATE TABLE `experience_reviews` (
	`pair_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`person` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_name` text NOT NULL,
	`domain` text NOT NULL,
	`overall` text NOT NULL,
	`input_hash` text NOT NULL,
	`reviewed_at` text NOT NULL,
	`source` text DEFAULT 'post_experience' NOT NULL,
	`weight` integer DEFAULT 4 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_experience_reviews_person` ON `experience_reviews` (`pair_id`,`chapter_id`,`person`);