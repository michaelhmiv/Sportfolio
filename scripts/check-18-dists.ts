import 'dotenv/config';
import { db } from "../server/db";
import { scoutDistributions } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function check() {
  console.log('=== Distributions at 18:00 (17:00-18:00 window) ===\n');

  const dists = await db.select().from(scoutDistributions)
    .where(eq(scoutDistributions.hourTimestamp, new Date('2026-01-20T18:00:00Z')))
    .orderBy(desc(scoutDistributions.playerId));

  console.log(`Found ${dists.length} distributions for 18:00 window\n`);

  // Show dev-user's distributions
  const devDists = dists.filter(d => d.userId === 'dev-user-12345678');
  console.log('dev-user-12345678 distributions:');
  devDists.forEach(d => {
    console.log(`  ${d.playerId}: ${d.sharesEarned} shares`);
  });

  // Show all Cade distributions
  console.log('\nAll Cade (nba_31030) distributions:');
  const cadeDists = dists.filter(d => d.playerId === 'nba_31030');
  cadeDists.forEach(d => {
    console.log(`  ${d.hourTimestamp}: ${d.sharesEarned} shares (${d.userScoutMinutes} user min / ${d.globalScoutMinutes} global min)`);
  });
}

check().catch(console.error);
