export const profileReportReasons = [
  "inappropriate_profile",
  "harassment",
  "impersonation",
  "spam",
  "other",
] as const;

export type ProfileReportReason = (typeof profileReportReasons)[number];

type ProfileSafetyTarget = {
  id: string;
  username: string;
  profileImageUrl: string | null;
};

async function getPool() {
  const { pool } = await import("../db");
  return pool;
}

async function resolveTargetByUsername(username: string): Promise<ProfileSafetyTarget | null> {
  const pool = await getPool();
  const result = await pool.query<{
    id: string;
    username: string | null;
    profile_image_url: string | null;
  }>(
    `SELECT id, username, profile_image_url
       FROM users
      WHERE deleted_at IS NULL
        AND username IS NOT NULL
        AND LOWER(username) = LOWER($1)
      LIMIT 1`,
    [username.trim()],
  );

  const row = result.rows[0];
  if (!row?.username) return null;
  return {
    id: row.id,
    username: row.username,
    profileImageUrl: row.profile_image_url,
  };
}

function assertNotSelf(actorUserId: string, targetUserId: string): void {
  if (actorUserId === targetUserId) {
    const error = new Error("You cannot report or block your own profile.") as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }
}

function targetNotFound(): Error & { statusCode?: number } {
  const error = new Error("User not found") as Error & { statusCode?: number };
  error.statusCode = 404;
  return error;
}

export async function reportUserProfile(input: {
  reporterUserId: string;
  username: string;
  reason: ProfileReportReason;
  details?: string | null;
}): Promise<{ reportedUserId: string; username: string }> {
  const target = await resolveTargetByUsername(input.username);
  if (!target) throw targetNotFound();
  assertNotSelf(input.reporterUserId, target.id);

  const pool = await getPool();
  await pool.query(
    `INSERT INTO user_profile_reports (
       reporter_user_id,
       reported_user_id,
       reported_username,
       reported_profile_image_url,
       reason,
       details
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.reporterUserId,
      target.id,
      target.username,
      target.profileImageUrl,
      input.reason,
      input.details?.trim() || null,
    ],
  );

  return { reportedUserId: target.id, username: target.username };
}

export async function blockUserProfile(input: {
  blockerUserId: string;
  username: string;
}): Promise<{ blockedUserId: string; username: string }> {
  const target = await resolveTargetByUsername(input.username);
  if (!target) throw targetNotFound();
  assertNotSelf(input.blockerUserId, target.id);

  const pool = await getPool();
  await pool.query(
    `INSERT INTO user_profile_blocks (blocker_user_id, blocked_user_id)
     VALUES ($1, $2)
     ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING`,
    [input.blockerUserId, target.id],
  );

  return { blockedUserId: target.id, username: target.username };
}

export async function unblockUserProfile(input: {
  blockerUserId: string;
  username: string;
}): Promise<{ blockedUserId: string; username: string }> {
  const target = await resolveTargetByUsername(input.username);
  if (!target) throw targetNotFound();
  assertNotSelf(input.blockerUserId, target.id);

  const pool = await getPool();
  await pool.query(
    `DELETE FROM user_profile_blocks
      WHERE blocker_user_id = $1
        AND blocked_user_id = $2`,
    [input.blockerUserId, target.id],
  );

  return { blockedUserId: target.id, username: target.username };
}

export async function getUserProfileBlockStatus(input: {
  blockerUserId: string;
  username: string;
}): Promise<{ blocked: boolean; blockedUserId: string; username: string }> {
  const target = await resolveTargetByUsername(input.username);
  if (!target) throw targetNotFound();

  if (input.blockerUserId === target.id) {
    return { blocked: false, blockedUserId: target.id, username: target.username };
  }

  const pool = await getPool();
  const result = await pool.query<{ blocked: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM user_profile_blocks
        WHERE blocker_user_id = $1
          AND blocked_user_id = $2
     ) AS blocked`,
    [input.blockerUserId, target.id],
  );

  return {
    blocked: result.rows[0]?.blocked === true,
    blockedUserId: target.id,
    username: target.username,
  };
}

export async function isProfileBlockedForViewer(
  viewerUserId: string | null,
  requestedUserId: string,
): Promise<boolean> {
  if (!viewerUserId || viewerUserId === requestedUserId) return false;

  const pool = await getPool();
  const result = await pool.query<{ blocked: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM user_profile_blocks
        WHERE blocker_user_id = $1
          AND blocked_user_id = $2
     ) AS blocked`,
    [viewerUserId, requestedUserId],
  );

  return result.rows[0]?.blocked === true;
}
