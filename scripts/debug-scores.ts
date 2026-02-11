import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";

// Manual .env loading
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const [key, ...valueParts] = line.split("=");
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts
        .join("=")
        .trim()
        .replace(/^"(.*)"$/, "$1");
    }
  });
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkScores() {
  let output = "";
  const log = (msg: string) => {
    console.log(msg);
    output += msg + "\n";
  };

  // Get today's games in ET - today is Jan 21, 2026
  // Midnight ET Jan 21 = 05:00 UTC Jan 21
  // Midnight ET Jan 22 = 05:00 UTC Jan 22
  const todayStart = new Date("2026-01-21T05:00:00.000Z");
  const todayEnd = new Date("2026-01-22T05:00:00.000Z");

  log("=== NBA Games for Today (Jan 21, 2026 ET) ===");
  log(
    `Query: start_time >= ${todayStart.toISOString()} AND start_time < ${todayEnd.toISOString()}`,
  );
  log("");

  // Get all games with scores
  const result = await pool.query(
    `SELECT game_id, home_team, away_team, home_score, away_score, status, start_time, last_fetched_at
         FROM daily_games
         WHERE sport = 'NBA' AND start_time >= $1 AND start_time < $2
         ORDER BY start_time`,
    [todayStart, todayEnd],
  );

  log(`Found ${result.rows.length} NBA games:`);
  log("");

  result.rows.forEach((g) => {
    const st = new Date(g.start_time);
    const etTime = st.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const lf = g.last_fetched_at ? new Date(g.last_fetched_at).toISOString() : "never";
    log(`Game ID: ${g.game_id}`);
    log(`  ${g.away_team} @ ${g.home_team}`);
    log(`  Status: ${g.status}`);
    log(`  Scores: Away ${g.away_score} - Home ${g.home_score}`);
    log(`  Start: ${etTime} ET`);
    log(`  Last fetched: ${lf}`);
    log("");
  });

  fs.writeFileSync("debug_scores.txt", output, "utf8");
  console.log("\nWritten to debug_scores.txt");

  await pool.end();
}

checkScores().catch(console.error);
