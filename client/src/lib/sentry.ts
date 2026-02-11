import * as Sentry from "@sentry/react";

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  const tracesSampleRateRaw = import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as
    | string
    | number
    | undefined;
  const tracesSampleRate = tracesSampleRateRaw != null ? Number(tracesSampleRateRaw) : 0.05;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    tracesSampleRate,
  });
}
