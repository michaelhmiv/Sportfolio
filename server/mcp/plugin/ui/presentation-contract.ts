export const MAX_PRESENTATION_WARNINGS = 20;

export const SPORTFOLIO_VIRTUAL_CURRENCY = Object.freeze({
  unit: "SB",
  name: "Sportfolio Bucks",
  virtual: true,
});

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

export function normalizePresentationWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const warnings = Array.from(
    new Set(
      value.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      ),
    ),
  );
  if (warnings.length <= MAX_PRESENTATION_WARNINGS) return warnings;

  const retained = warnings.slice(0, MAX_PRESENTATION_WARNINGS - 1);
  retained.push(
    "Additional diagnostics omitted: " +
      (warnings.length - retained.length) +
      ". See Sportfolio logs for details.",
  );
  return retained;
}

export function normalizePresentationToolResult<T>(result: T): T {
  const root = record(result);
  const structured = record(root?.structuredContent);
  if (!root || !structured) return result;

  const data = record(structured.data);
  return {
    ...root,
    structuredContent: {
      ...structured,
      warnings: normalizePresentationWarnings(structured.warnings),
      ...(data
        ? {
            data: {
              ...data,
              currency: SPORTFOLIO_VIRTUAL_CURRENCY,
            },
          }
        : {}),
    },
  } as T;
}
