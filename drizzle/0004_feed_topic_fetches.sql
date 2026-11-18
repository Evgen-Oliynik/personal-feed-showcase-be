CREATE TABLE `feed_topic_fetches` (
	`feed_date` text NOT NULL,
	`topic` text NOT NULL,
	PRIMARY KEY(`feed_date`, `topic`)
);
