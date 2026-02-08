import { getTodayET, getETDayBoundaries, getGameDay } from "../server/lib/time";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

const ET_TIMEZONE = "America/New_York";

console.log("=== Date Logic Comparison Debug ===");
console.log(`Current Server Time: ${new Date().toISOString()}`);

// 1. Dashboard Logic
const todayET = getTodayET();
console.log(`\n[Dashboard] getTodayET(): ${todayET}`);
const dashboardBoundaries = getETDayBoundaries(todayET);
console.log(`[Dashboard] startOfDay: ${dashboardBoundaries.startOfDay.toISOString()}`);
console.log(`[Dashboard] endOfDay:   ${dashboardBoundaries.endOfDay.toISOString()}`);

// 2. Daily Boosts Logic (Route part)
let dateStr = todayET;
const routeBoundaries = getETDayBoundaries(dateStr);
const targetDate = new Date(routeBoundaries.startOfDay.getTime() + 12 * 60 * 60 * 1000);
console.log(`\n[Boost Route] targetDate (noon): ${targetDate.toISOString()}`);

// 3. Daily Boosts Logic (Storage part)
const calculatedDateStr = getGameDay(targetDate);
console.log(`[Boost Storage] getGameDay(targetDate): ${calculatedDateStr}`);
const storageBoundaries = getETDayBoundaries(calculatedDateStr);
console.log(`[Boost Storage] startOfDay: ${storageBoundaries.startOfDay.toISOString()}`);
console.log(`[Boost Storage] endOfDay:   ${storageBoundaries.endOfDay.toISOString()}`);

// Comparison
const match =
  dashboardBoundaries.startOfDay.getTime() === storageBoundaries.startOfDay.getTime() &&
  dashboardBoundaries.endOfDay.getTime() === storageBoundaries.endOfDay.getTime();

console.log(`\n=== RESULT: Logic Match? ${match ? "YES" : "NO"} ===`);

if (!match) {
  console.log("!!! MISMATCH DETECTED !!!");
}
