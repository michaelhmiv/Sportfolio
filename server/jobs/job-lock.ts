import { jobLockPool } from "../db";

const TRY_LOCK_SQL = "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired";
const UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked";

interface JobLockClient {
  query(
    statement: string,
    values: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(destroy?: boolean): void;
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
    if (!acquired) {
      client.release();
      return { acquired: false };
    }

    let value: T | undefined;
    let callbackError: unknown;
    try {
      value = await callback();
    } catch (error) {
      callbackError = error;
    }

    let unlockError: unknown;
    try {
      const unlockResult = await client.query(UNLOCK_SQL, [jobName]);
      if (unlockResult.rows[0]?.unlocked !== true) {
        unlockError = new Error(`Failed to release advisory lock for job ${jobName}`);
      }
    } catch (error) {
      unlockError = error;
    }

    // A session-level advisory lock survives ordinary connection reuse. If the
    // unlock is uncertain, evict this client so PostgreSQL closes the session
    // and releases every lock it held.
    client.release(Boolean(unlockError));

    if (unlockError) throw unlockError;
    if (callbackError) throw callbackError;
    return { acquired: true, value: value as T };
  } catch (error) {
    if (!acquired) client.release();
    throw error;
  }
}
