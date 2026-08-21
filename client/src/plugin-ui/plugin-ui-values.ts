import type { JsonRecord } from "./openai-host";

export function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export type { JsonRecord };
