CREATE TABLE `preference_memory_layers` (
	`pair_id` text PRIMARY KEY NOT NULL,
	`policy_version` integer NOT NULL,
	`payload` text NOT NULL,
	`derived_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `experience_reaction_signals` ADD `signal_class` text DEFAULT 'uncertain' NOT NULL;--> statement-breakpoint
ALTER TABLE `experience_reaction_signals` ADD `context_marker` text;--> statement-breakpoint
ALTER TABLE `experience_reaction_signals` ADD `future_preference` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `experience_reaction_signals` ADD `expires_at` text;