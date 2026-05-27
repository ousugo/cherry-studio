DROP INDEX `topic_group_id_order_key_idx`;--> statement-breakpoint
CREATE INDEX `topic_order_key_idx` ON `topic` (`order_key`);--> statement-breakpoint
-- MANUAL PATCH: workaround for drizzle-orm/drizzle-kit #3653
-- (rebuild-table path drops the leading ALTER TABLE ADD COLUMN statement,
-- so the INSERT ... SELECT below references `type` which doesn't yet exist
-- on the old `agent_workspace` table. Add it by hand per yume-chan's patch.)
-- https://github.com/drizzle-team/drizzle-orm/issues/3653
ALTER TABLE `agent_workspace` ADD COLUMN `type` text NOT NULL DEFAULT 'user';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`type` text DEFAULT 'user' NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "agent_workspace_type_check" CHECK("__new_agent_workspace"."type" IN ('user', 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_workspace`("id", "name", "path", "type", "order_key", "created_at", "updated_at") SELECT "id", "name", "path", "type", "order_key", "created_at", "updated_at" FROM `agent_workspace`;--> statement-breakpoint
DROP TABLE `agent_workspace`;--> statement-breakpoint
ALTER TABLE `__new_agent_workspace` RENAME TO `agent_workspace`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_workspace_path_unique_idx` ON `agent_workspace` (`path`);--> statement-breakpoint
CREATE INDEX `agent_workspace_order_key_idx` ON `agent_workspace` (`order_key`);