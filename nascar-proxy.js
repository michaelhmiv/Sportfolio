/**
 * Simple proxy server for NASCAR API
 * Run this locally and expose via exe.dev to bypass IP blocking
 */

import http from "node:http";
import https from "node:https";

const PORT = globalThis.process?.env?.PORT || 3001;
const NASCAR_API_HOST = "cf.nascar.com";

const proxyServer = http.createServer((req, res) => {
  globalThis.console.log(`[PROXY] ${req.method} ${req.url}`);

  const options = {
    hostname: NASCAR_API_HOST,
    port: 443,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: NASCAR_API_HOST,
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  req.pipe(proxyReq);

  proxyReq.on("error", (error) => {
    globalThis.console.error("[PROXY] Error:", error.message);
    res.writeHead(500);
    res.end("Proxy error");
  });
});

proxyServer.listen(PORT, () => {
  globalThis.console.log(`NASCAR Proxy running on http://localhost:${PORT}`);
  globalThis.console.log(`Expose via: ssh exe.dev share port <your-vm> ${PORT}`);
});
