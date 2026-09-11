import type { Pool } from "pg";

export async function ensureProfileSafetySchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profile_reports (
      id BIGSERIAL PRIMARY KEY,
      reporter_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_username VARCHAR NOT NULL,
      reported_profile_image_url TEXT,
      reason VARCHAR(40) NOT NULL,
      details TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT user_profile_reports_not_self CHECK (reporter_user_id <> reported_user_id),
      CONSTRAINT user_profile_reports_reason_check CHECK (
        reason IN ('inappropriate_profile', 'harassment', 'impersonation', 'spam', 'other')
      ),
      CONSTRAINT user_profile_reports_status_check CHECK (
        status IN ('open', 'reviewing', 'resolved', 'dismissed')
      )
    );

    CREATE INDEX IF NOT EXISTS user_profile_reports_reported_user_idx
      ON user_profile_reports (reported_user_id, status, created_at DESC);

    CREATE INDEX IF NOT EXISTS user_profile_reports_reporter_idx
      ON user_profile_reports (reporter_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS user_profile_blocks (
      blocker_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (blocker_user_id, blocked_user_id),
      CONSTRAINT user_profile_blocks_not_self CHECK (blocker_user_id <> blocked_user_id)
    );

    CREATE INDEX IF NOT EXISTS user_profile_blocks_blocked_user_idx
      ON user_profile_blocks (blocked_user_id, blocker_user_id);
  `);
}
