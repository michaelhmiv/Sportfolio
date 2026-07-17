import { jobLockPool } from "../db";

const TRY_LOCK_SQL = "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired";
const UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked";

interface JobLockClient {
  query(
    statement: string,
    values: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

interface JobLockPool {
  connect(): Promise<JobLockClient>;
}

export type JobLockResult<T> = { acquired: false } | { acquired: true; value: T };

/** Hold a session-level advisory lock on a dedicated client for the complete job execution. */
export async function withJobAdvisoryLock<T>(
  jobName: string,
  callback: () => Promise<T>,
  lockPool: JobLockPool = jobLockPool,
): Promise<JobLockResult<T>> {
  const client = await lockPool.connect();
  let acquired = false;

  try {
    const lockResult = await client.query(TRY_LOCK_SQL, [jobName]);
    acquired = lockResult.rows[0]?.acquired === true;
    if (!acquired) return { acquired: false };

    return { acquired: true, value: await callback() };
  } finally {
    try {
      if (acquired) {
        await client.query(UNLOCK_SQL, [jobName]);
      }
    } finally {
      client.release();
    }
  }
}
