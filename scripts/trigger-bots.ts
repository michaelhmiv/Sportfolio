import "dotenv/config";

async function run() {
  console.log("Legacy player order-book bot trigger is archived. Player trading is AMM-only.");
  process.exit(1);
}

run().catch(console.error);
