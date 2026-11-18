ALTER TABLE `media_items` ADD `first_seen_date` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `media_items` SET `first_seen_date` = date(`fetched_at`, 'localtime');--> statement-breakpoint
CREATE TABLE `topic_fetches` (
	`topic` text NOT NULL,
	`fetch_date` text NOT NULL,
	PRIMARY KEY(`topic`, `fetch_date`)
);--> statement-breakpoint
CREATE TABLE `topic_items` (
	`topic` text NOT NULL,
	`fetch_date` text NOT NULL,
	`media_item_id` integer NOT NULL,
	PRIMARY KEY(`topic`, `fetch_date`, `media_item_id`),
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE TABLE `topic_requests` (
	`topic` text PRIMARY KEY NOT NULL,
	`last_requested_date` text NOT NULL
);
