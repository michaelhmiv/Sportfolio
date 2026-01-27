import 'dotenv/config';
import { db } from "../server/db";
import { scoutHistory } from "../shared/schema";
import { sql } from "drizzle-orm";

async function cleanup() {
  // Delete history records with zero duration (startedAt = endedAt)
  const result = await db.delete(scoutHistory)
    .where(sql`${scoutHistory.startedAt} = ${scoutHistory.endedAt}`);

  console.log(`Deleted ${result.length} zero-duration history records`);
}

cleanup().catch(console.error);
