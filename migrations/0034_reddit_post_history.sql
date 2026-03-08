CREATE TABLE IF NOT EXISTS reddit_post_history (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  subreddit text NOT NULL,
  post_type text NOT NULL,
  market_day varchar(10) NOT NULL,
  title text NOT NULL,
  markdown text NOT NULL,
  content_hash varchar(64) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reddit_post_id varchar,
  reddit_post_url text,
  image_url text,
  attempt_count integer NOT NULL DEFAULT 0,
  error_message text,
  metadata jsonb,
  posted_at timestamp,
  last_attempt_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reddit_post_history_subreddit_slot_idx
ON reddit_post_history (subreddit, post_type, market_day);

CREATE INDEX IF NOT EXISTS reddit_post_history_status_idx
ON reddit_post_history (status);

CREATE INDEX IF NOT EXISTS reddit_post_history_created_at_idx
ON reddit_post_history (created_at);

CREATE INDEX IF NOT EXISTS reddit_post_history_last_attempt_idx
ON reddit_post_history (last_attempt_at);
