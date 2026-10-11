CREATE TABLE `practical_evidence` (
	`pair_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`dimension` text NOT NULL,
	`value` integer NOT NULL,
	`weight` integer NOT NULL,
	`source` text NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_practical_evidence_unique` ON `practical_evidence` (`pair_id`,`chapter_id`,`dimension`,`source`);