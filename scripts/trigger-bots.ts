
import { runBotEngineTick } from "../server/bot/bot-engine";
import "dotenv/config";

async function run() {
    console.log("Triggering manual bot engine tick...");
    const result = await runBotEngineTick();
    console.log("Tick result:", JSON.stringify(result, null, 2));
}

run().catch(console.error);
