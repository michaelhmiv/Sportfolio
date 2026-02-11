import * as Sentry from "@sentry/node";

export function setSentryRequestContext(requestId: string) {
  if (!process.env.SENTRY_DSN) return;
  Sentry.getIsolationScope().setTag("request_id", requestId);
}

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const env = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV;
  const tracesSampleRateRaw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  const tracesSampleRate = tracesSampleRateRaw
    ? Number(tracesSampleRateRaw)
    : env === "production"
      ? 0.05
      : 1;

  Sentry.init({
    dsn,
    environment: env,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate,
    integrations: [Sentry.expressIntegration()],
  });
}

export function setupSentryExpressErrorHandler(app: import("express").Express) {
  if (!process.env.SENTRY_DSN) return;

  // Must be registered after routes, but before any other error-handling middleware.
  Sentry.setupExpressErrorHandler(app);
}

export function captureException(err: unknown) {
  Sentry.captureException(err);
}
