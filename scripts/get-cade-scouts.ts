import "dotenv/config";
import { db } from "../server/db";
import { scoutAssignments, users, players } from "@shared/schema";
import { eq, and } from "drizzle-orm";

async function main() {
    const cadeId = 'nba_31030';
    
    console.log(`Cade Cunningham (${cadeId}) Scouts:`);
    const roster = await db
        .select({
            userId: scoutAssignments.userId,
            username: users.username,
            scoutCount: scoutAssignments.scoutCount
        })
        .from(scoutAssignments)
        .innerJoin(users, eq(scoutAssignments.userId, users.id))
        .where(eq(scoutAssignments.playerId, cadeId))
        .orderBy(scoutAssignments.scoutCount);

    roster.forEach((r, i) => {
        console.log(`${i + 1}. ${r.username || r.userId} - ${r.scoutCount} scouts`);
    });
}

main().catch(console.error).finally(() => process.exit());
