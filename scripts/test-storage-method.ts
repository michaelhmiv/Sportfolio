import "dotenv/config";
import { storage } from "../server/storage";

async function main() {
    console.log("Testing storage.getScoutRoster...");
    
    const playerId = 'nba_31030';
    const roster = await storage.getScoutRoster(playerId);
    
    console.log(`Roster Result for ${playerId}: ${roster.length} rows`);
    console.log(JSON.stringify(roster, null, 2));
}

main().catch(console.error).finally(() => process.exit());
