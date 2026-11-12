CREATE TABLE `feed_entries` (
	`feed_date` text NOT NULL,
	`media_item_id` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_entries_feed_date_media_item_id_unique` ON `feed_entries` (`feed_date`,`media_item_id`);--> statement-breakpoint
CREATE TABLE `feeds` (
	`feed_date` text PRIMARY KEY NOT NULL,
	`built_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`type` text NOT NULL,
	`source` text NOT NULL,
	`topic` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`author` text,
	`image_url` text,
	`published_at` text NOT NULL,
	`duration_sec` integer,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_items_url_unique` ON `media_items` (`url`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_name_unique` ON `topics` (`name`);