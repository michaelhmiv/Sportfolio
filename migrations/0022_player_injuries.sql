-- Add injury tracking fields to players table
ALTER TABLE players ADD COLUMN IF NOT EXISTS injury_status TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS injury_description TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS injury_return_date TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS injury_updated_at TIMESTAMP;

-- Create index for injury status lookups
CREATE INDEX IF NOT EXISTS injury_status_idx ON players (injury_status);