async function run() {
  console.log("Starting debug script...");
  try {
    const { storage } = await import("../storage");
    console.log("Storage loaded successfully.");
  } catch (e: any) {
    console.error("Failed to load storage:", e.message);
    if (e.code) console.error("Code:", e.code);
    if (e.stack) console.error("Stack:", e.stack);
  }
}

run();

export {};
