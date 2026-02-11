import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const enabled = process.env.OTEL_ENABLED === "true";
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (enabled && endpoint) {
  try {
    const traceExporter = new OTLPTraceExporter({
      url: endpoint,
    });

    const sdk = new NodeSDK({
      traceExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
        }),
      ],
    });

    sdk.start();
    console.log(`[OTEL] Tracing initialized with endpoint: ${endpoint}`);

    process.on("SIGTERM", async () => {
      try {
        await sdk.shutdown();
      } finally {
        process.exit(0);
      }
    });
  } catch (error) {
    console.error("[OTEL] Failed to initialize tracing:", error);
  }
} else if (enabled && !endpoint) {
  console.warn("[OTEL] OTEL_ENABLED is true but OTEL_EXPORTER_OTLP_ENDPOINT is not set. Skipping tracing initialization.");
}
