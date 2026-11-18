ALTER TABLE `topic_fetches` RENAME TO `topic_fetches_old`;--> statement-breakpoint
CREATE TABLE `topic_fetches` (
	`topic` text NOT NULL,
	`fetch_date` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`topic`, `fetch_date`, `source`)
);--> statement-breakpoint
INSERT INTO `topic_fetches` (`topic`, `fetch_date`, `source`) SELECT `topic`, `fetch_date`, `s`.`source` FROM `topic_fetches_old` CROSS JOIN (SELECT 'devto' AS `source` UNION ALL SELECT 'medium' UNION ALL SELECT 'youtube' UNION ALL SELECT 'itunes') AS `s`;--> statement-breakpoint
DROP TABLE `topic_fetches_old`;
