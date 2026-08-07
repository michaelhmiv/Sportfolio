const BLOCKED_KEY =
  /(?:password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|service[_-]?role|provider[_-]?key|session[_-]?id|request[_-]?id|stack|sql)/i;
const DIRECT_PII_KEY = /^(?:email|phone|phoneNumber|firstName|lastName|fullName)$/i;

export type PluginSanitizeOptions = {
  maxDepth?: number;
  maxArrayItems?: number;
  maxStringLength?: number;
};

const DEFAULTS: Required<PluginSanitizeOptions> = {
  maxDepth: 8,
  maxArrayItems: 100,
  maxStringLength: 2000,
};

function sanitizeString(value: string, maxLength: number): string {
  const cleaned = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 || code === 9 || code === 10 || code === 13;
    })
    .join("");
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

export function sanitizePluginValue(
  value: unknown,
  options: PluginSanitizeOptions = {},
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  const resolved = { ...DEFAULTS, ...options };

  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return sanitizeString(value, resolved.maxStringLength);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= resolved.maxDepth) return "[truncated]";

  if (Array.isArray(value)) {
    return value
      .slice(0, resolved.maxArrayItems)
      .map((item) => sanitizePluginValue(item, resolved, depth + 1, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (BLOCKED_KEY.test(key) || DIRECT_PII_KEY.test(key)) continue;
      output[key] = sanitizePluginValue(item, resolved, depth + 1, seen);
    }
    return output;
  }

  return sanitizeString(String(value), resolved.maxStringLength);
}

export function assertNoRestrictedPluginFields(
  value: unknown,
  path = "$",
  seen = new WeakSet<object>(),
): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRestrictedPluginFields(item, `${path}[${index}]`, seen));
    return;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (BLOCKED_KEY.test(key) || DIRECT_PII_KEY.test(key)) {
      throw new Error(`Restricted marketplace output field at ${path}.${key}`);
    }
    assertNoRestrictedPluginFields(item, `${path}.${key}`, seen);
  }
}
