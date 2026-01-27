
import 'dotenv/config';
import { syncSchedule } from "../server/jobs/sync-schedule";

async function run() {
    console.log("Forcing schedule sync...");
    const result = await syncSchedule((progress) => {
        console.log(`[PROGRESS] ${progress.message}`);
        if (progress.data) console.log(progress.data);
    });
    console.log("Sync result:", result);
    process.exit(0);
}

run().catch(console.error);
