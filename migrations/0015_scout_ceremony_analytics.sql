-- Migration: Scout Ceremony Analytics Table
-- Tracks user engagement with the scout distribution ceremony

CREATE TABLE IF NOT EXISTS scout_ceremony_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_shares_received DECIMAL(10,2) NOT NULL DEFAULT 0,
  player_count INTEGER NOT NULL DEFAULT 0,
  viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  skipped BOOLEAN DEFAULT FALSE,
  duration_ms INTEGER, -- How long they watched the ceremony
  highlight_player_id UUID REFERENCES players(id) ON DELETE SET NULL,
  highlight_shares DECIMAL(10,2)
);

-- Index for analytics queries
CREATE INDEX idx_ceremony_views_user_date ON scout_ceremony_views(user_id, viewed_at);

-- Index for cleanup job (views older than 90 days can be archived)
CREATE INDEX idx_ceremony_views_date ON scout_ceremony_views(viewed_at);

-- Index for highlight player analysis
CREATE INDEX idx_ceremony_views_highlight ON scout_ceremony_views(highlight_player_id);

-- Add a comment explaining the table
COMMENT ON TABLE scout_ceremony_views IS 'Tracks user engagement with scout distribution ceremonies for analytics';
