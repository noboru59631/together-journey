CREATE TABLE `recovery_attempts` (
	`client_hash` text PRIMARY KEY NOT NULL,
	`window_started_at` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`blocked_until` text
);
--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_type` text NOT NULL,
	`target_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recovery_codes_hash` ON `recovery_codes` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recovery_codes_target` ON `recovery_codes` (`profile_type`,`target_id`);