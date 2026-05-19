CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_path_unique_idx` ON `workspace` (`path`);--> statement-breakpoint
CREATE INDEX `workspace_order_key_idx` ON `workspace` (`order_key`);--> statement-breakpoint
ALTER TABLE `agent_session` ADD `workspace_id` text REFERENCES workspace(id);--> statement-breakpoint
ALTER TABLE `agent_session` DROP COLUMN `accessible_paths`;