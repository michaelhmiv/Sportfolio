import http from "node:http";
import process from "node:process";
import { createServer as createViteServer } from "vite";

const host = process.env.PLAYWRIGHT_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PLAYWRIGHT_PORT || "5000", 10);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PLAYWRIGHT_PORT: ${process.env.PLAYWRIGHT_PORT}`);
}

const vite = await createViteServer({
  appType: "spa",
  server: {
    middlewareMode: true,
  },
});

const server = http.createServer((request, response) => {
  const pathname = request.url?.split("?", 1)[0];

  if (pathname === "/api/health") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ status: "ready", mode: "playwright-fixture" }));
    return;
  }

  vite.middlewares(request, response, (error) => {
    if (!error) return;

    console.error("[playwright-web-server] Vite middleware failed", error);
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end("Playwright fixture server error");
  });
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[playwright-web-server] ${signal}; shutting down`);
  await vite.close();
  server.close(() => process.exit(0));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

server.on("error", async (error) => {
  console.error("[playwright-web-server] Server failed", error);
  await vite.close();
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`[playwright-web-server] ready at http://${host}:${port}`);
});
