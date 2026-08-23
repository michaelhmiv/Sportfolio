const MAX_PRESENTATION_WARNINGS = 20;

/** Keep renderer warnings bounded and useful to the model/widget. */
export function normalizePresentationWarnings(values: unknown[]): string[] {
  const unique = Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  if (unique.length <= MAX_PRESENTATION_WARNINGS) return unique;
  const omitted = unique.length - (MAX_PRESENTATION_WARNINGS - 1);
  return [
    ...unique.slice(0, MAX_PRESENTATION_WARNINGS - 1),
    `${omitted} additional presentation warning(s) omitted.`,
  ];
}
