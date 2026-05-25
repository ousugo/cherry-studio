ALTER TABLE `agent_workspace` ADD `type` text DEFAULT 'user' NOT NULL CHECK(`type` IN ('user', 'system'));
