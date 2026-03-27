import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { userAgentMemories } from "@shared/schema";
import { db } from "../db";
import type {
  AgentMemoryKind,
  AgentMemoryRecord,
  AgentMemoryScope,
  ProposedMemoryWrite,
} from "./types";

// ---------------------------------------------------------------------------
// Memory content security scanning — blocks injection/exfiltration payloads
// before they reach system prompts.  Ported from NousResearch/hermes-agent.
// ---------------------------------------------------------------------------

const MEMORY_THREAT_PATTERNS: Array<[RegExp, string]> = [
  // Prompt injection
  [/ignore\s+(previous|all|above|prior)\s+instructions/i, "prompt_injection"],
  [/you\s+are\s+now\s+/i, "role_hijack"],
  [/do\s+not\s+tell\s+the\s+user/i, "deception_hide"],
  [/system\s+prompt\s+override/i, "sys_prompt_override"],
  [/disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, "disregard_rules"],
  [
    /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i,
    "bypass_restrictions",
  ],
  [/pretend\s+(you\s+are|to\s+be)\s+/i, "role_pretend"],
  [/output\s+(system|initial)\s+prompt/i, "leak_system_prompt"],
  // Exfiltration via curl/wget with secrets
  [/curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, "exfil_curl"],
  [/wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, "exfil_wget"],
  [/cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i, "read_secrets"],
  // Persistence via shell/SSH
  [/authorized_keys/i, "ssh_backdoor"],
  [/\$HOME\/\.ssh|~\/\.ssh/i, "ssh_access"],
];

const INVISIBLE_CHARS = new Set([
  "\u200b",
  "\u200c",
  "\u200d",
  "\u2060",
  "\ufeff",
  "\u202a",
  "\u202b",
  "\u202c",
  "\u202d",
  "\u202e",
]);

export function scanMemoryContent(content: string): string | null {
  for (const char of content) {
    if (INVISIBLE_CHARS.has(char)) {
      return `Blocked: content contains invisible unicode character U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} (possible injection).`;
    }
  }

  for (const [pattern, patternId] of MEMORY_THREAT_PATTERNS) {
    if (pattern.test(content)) {
      return `Blocked: content matches threat pattern '${patternId}'. Memory entries must not contain injection or exfiltration payloads.`;
    }
  }

  return null;
}

const LOW_SIGNAL_TERMS = new Set([
  "a",
  "an",
  "and",
  "for",
  "i",
  "is",
  "it",
  "my",
  "of",
  "or",
  "the",
  "to",
]);
const DEFAULT_MEMORY_CONFIDENCE = 0.5;
const MIN_MEMORY_CONFIDENCE = 0;
const MAX_MEMORY_CONFIDENCE = 1;
const MAX_MEMORY_WRITES_PER_MESSAGE = 3;
const TRANSIENT_ACTION_PATTERN =
  /\b(buy|sell|boost|stack|assign|remove|drop|add|swap|trade|bet|today|tonight|tomorrow|this slate|this game|right now)\b/i;
const QUESTION_PREFIX_PATTERN = /^(?:what|when|where|who|why|how|should|can|could|would|did|do)\b/i;

function normalizeSummary(summary: string): string {
  return summary.replace(/\s+/g, " ").trim().slice(0, 240);
}

function normalizeContent(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function resolveMemorySource(write: ProposedMemoryWrite): AgentMemoryRecord["source"] {
  const capturedFrom =
    typeof write.content?.capturedFrom === "string" ? write.content.capturedFrom : "";
  if (capturedFrom === "user_message") {
    return "user_explicit";
  }

  return "agent_inferred";
}

function normalizeConfidence(value: unknown): string {
  const parsed =
    typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_MEMORY_CONFIDENCE;
  const bounded = Math.max(MIN_MEMORY_CONFIDENCE, Math.min(parsed, MAX_MEMORY_CONFIDENCE));

  return bounded.toFixed(3);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !LOW_SIGNAL_TERMS.has(term));
}

function splitIntoCandidateClauses(message: string): string[] {
  return message
    .split(/[\n.;!?]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isDurableClause(clause: string): boolean {
  const normalized = clause.trim();
  if (!normalized || normalized.length < 14) {
    return false;
  }
  if (QUESTION_PREFIX_PATTERN.test(normalized.toLowerCase())) {
    return false;
  }
  if (
    /\$\d+/.test(normalized) ||
    /\b\d+\s+(?:share|shares|scout|scouts|slot|slots)\b/i.test(normalized)
  ) {
    return false;
  }
  if (
    TRANSIENT_ACTION_PATTERN.test(normalized) &&
    /\b(today|tonight|tomorrow|this|current)\b/i.test(normalized)
  ) {
    return false;
  }

  return (
    /\b(i (?:prefer|like|care about|need|usually|tend to|focus on|want to build|want to focus|am trying to|keep|follow)\b)/i.test(
      normalized,
    ) ||
    /\b(i(?:'m| am)? (?:a fan of|into|following)\b)/i.test(normalized) ||
    /\b(?:keep it|make it|be)\s+(?:brief|short|concise|detailed|step by step)\b/i.test(normalized)
  );
}

function normalizeDurableClause(clause: string): string {
  let normalized = clause.replace(/\s+/g, " ").trim();

  if (/^(?:keep it|make it|be)\s+/i.test(normalized)) {
    normalized = `I prefer responses that are ${normalized.replace(/^(?:keep it|make it|be)\s+/i, "")}`;
  }

  return normalized;
}

function inferMemoryKind(message: string): AgentMemoryKind {
  const normalized = message.toLowerCase();

  if (
    /\b(low risk|lower risk|lower-risk|safe|conservative|aggressive|higher risk|higher-risk|less risk)\b/.test(
      normalized,
    )
  ) {
    return "risk_tolerance";
  }

  if (/\b(always|usually|every day|each day|before lock|pre-lock)\b/.test(normalized)) {
    return "habit";
  }

  if (/\bgoal|trying to|want to build|want to focus|build|focus\b/.test(normalized)) {
    return "goal";
  }

  if (/\b(team|player|players|favorite|fan of|follow)\b/.test(normalized)) {
    return "favorite_entities";
  }

  if (/\bbrief|short|concise|detailed|walk me through|step by step\b/.test(normalized)) {
    return "interaction_style";
  }

  return "preference";
}

function inferMemoryScope(kind: AgentMemoryKind): AgentMemoryScope {
  if (kind === "habit") {
    return "episodic";
  }

  return "profile";
}

function shouldSupersedeExistingMemories(write: ProposedMemoryWrite): boolean {
  if (write.scope !== "profile") {
    return false;
  }

  return write.kind !== "favorite_entities";
}

function getKindQueryBonus(record: AgentMemoryRecord, query: string): number {
  const normalizedQuery = query.toLowerCase();

  switch (record.kind) {
    case "risk_tolerance":
      return /\b(risk|safe|aggressive|conservative)\b/.test(normalizedQuery) ? 4 : 0;
    case "interaction_style":
      return /\b(brief|short|concise|detailed|walk me through|step by step)\b/.test(normalizedQuery)
        ? 4
        : 0;
    case "goal":
      return /\b(goal|focus|build|strategy|optimize)\b/.test(normalizedQuery) ? 3 : 0;
    case "favorite_entities":
      return /\b(team|player|favorite|fan|follow)\b/.test(normalizedQuery) ? 3 : 0;
    default:
      return 0;
  }
}

function scoreMemory(record: AgentMemoryRecord, query: string): number {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) {
    return 0;
  }

  const haystack = `${record.summary} ${JSON.stringify(record.content)}`.toLowerCase();
  const lexicalScore = queryTerms.reduce((score, term) => {
    if (record.summary.toLowerCase().includes(term)) {
      return score + 5;
    }

    return haystack.includes(term) ? score + 2 : score;
  }, 0);
  const ageHours = Math.max(0, (Date.now() - record.updatedAt.getTime()) / (1000 * 60 * 60));
  const recencyBonus = Math.max(0, 6 - ageHours / 24);
  const confidenceBonus = Math.max(0, Math.min(record.confidence, 1)) * 4;

  return lexicalScore + recencyBonus + confidenceBonus + getKindQueryBonus(record, query);
}

function mapMemoryRow(row: typeof userAgentMemories.$inferSelect): AgentMemoryRecord {
  const rawEmbedding = Array.isArray(row.embedding) ? row.embedding : null;

  return {
    id: row.id,
    userId: row.userId,
    threadId: row.threadId || null,
    scope: row.scope as AgentMemoryScope,
    kind: row.kind as AgentMemoryKind,
    summary: row.summary,
    content: (row.content as Record<string, unknown>) || {},
    confidence: Number(row.confidence || "0"),
    source: row.source as AgentMemoryRecord["source"],
    embedding: rawEmbedding
      ? rawEmbedding.filter((entry): entry is number => typeof entry === "number")
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt || null,
  };
}

export function inferMemoryWritesFromMessage(message: string): ProposedMemoryWrite[] {
  const normalized = message.trim();
  if (!normalized) {
    return [];
  }
  const seen = new Set<string>();

  return splitIntoCandidateClauses(normalized)
    .filter(isDurableClause)
    .map(normalizeDurableClause)
    .map((clause) => {
      const kind = inferMemoryKind(clause);
      const scope = inferMemoryScope(kind);
      const summary = normalizeSummary(clause);

      return {
        scope,
        kind,
        summary,
        content: {
          statement: summary,
          capturedFrom: "user_message",
        },
        confidence: kind === "interaction_style" || kind === "risk_tolerance" ? 0.82 : 0.78,
        reason: "Captured an explicit durable user preference statement.",
      } satisfies ProposedMemoryWrite;
    })
    .filter((write) => {
      if (!write.summary || seen.has(write.summary.toLowerCase())) {
        return false;
      }
      if (scanMemoryContent(`${write.summary} ${JSON.stringify(write.content)}`)) {
        return false;
      }
      seen.add(write.summary.toLowerCase());
      return true;
    })
    .slice(0, MAX_MEMORY_WRITES_PER_MESSAGE);
}

export async function listActiveUserAgentMemories(
  userId: string,
  scope?: AgentMemoryScope,
): Promise<AgentMemoryRecord[]> {
  const filters = [eq(userAgentMemories.userId, userId), isNull(userAgentMemories.archivedAt)];
  if (scope) {
    filters.push(eq(userAgentMemories.scope, scope));
  }

  const rows = await db
    .select()
    .from(userAgentMemories)
    .where(and(...filters))
    .orderBy(desc(userAgentMemories.updatedAt))
    .limit(scope ? 20 : 60);

  return rows.map(mapMemoryRow);
}

export async function searchActiveUserAgentMemories(
  userId: string,
  query: string,
): Promise<AgentMemoryRecord[]> {
  const all = await listActiveUserAgentMemories(userId);

  return all
    .map((record) => ({
      record,
      score: scoreMemory(record, query),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.record.updatedAt.getTime() - left.record.updatedAt.getTime(),
    )
    .slice(0, 8)
    .map((entry) => entry.record);
}

export async function buildHermesMemoryContext(input: { userId: string; query: string }): Promise<{
  profile: AgentMemoryRecord[];
  episodic: AgentMemoryRecord[];
  semantic: AgentMemoryRecord[];
}> {
  const [profile, episodic, semantic] = await Promise.all([
    listActiveUserAgentMemories(input.userId, "profile"),
    listActiveUserAgentMemories(input.userId, "episodic"),
    searchActiveUserAgentMemories(input.userId, input.query),
  ]);

  return {
    profile: profile.slice(0, 6),
    episodic: episodic.slice(0, 6),
    semantic,
  };
}

export async function persistProposedMemoryWrites(input: {
  userId: string;
  threadId: string | null;
  writes: ProposedMemoryWrite[];
}): Promise<AgentMemoryRecord[]> {
  const persisted: AgentMemoryRecord[] = [];

  for (const write of input.writes) {
    const summary = normalizeSummary(write.summary);
    if (!summary) {
      continue;
    }

    const scanResult = scanMemoryContent(`${summary} ${JSON.stringify(write.content)}`);
    if (scanResult) {
      continue;
    }

    if (shouldSupersedeExistingMemories(write)) {
      await db
        .update(userAgentMemories)
        .set({
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userAgentMemories.userId, input.userId),
            eq(userAgentMemories.scope, write.scope),
            eq(userAgentMemories.kind, write.kind),
            isNull(userAgentMemories.archivedAt),
            sql`${userAgentMemories.summary} <> ${summary}`,
          ),
        );
    }

    const [existing] = await db
      .select()
      .from(userAgentMemories)
      .where(
        and(
          eq(userAgentMemories.userId, input.userId),
          eq(userAgentMemories.scope, write.scope),
          eq(userAgentMemories.kind, write.kind),
          eq(userAgentMemories.summary, summary),
          isNull(userAgentMemories.archivedAt),
        ),
      )
      .limit(1);

    if (existing) {
      const normalizedConfidence = normalizeConfidence(write.confidence);
      const [updated] = await db
        .update(userAgentMemories)
        .set({
          threadId: input.threadId,
          content: normalizeContent(write.content),
          confidence: normalizedConfidence,
          source: resolveMemorySource(write),
          updatedAt: new Date(),
        })
        .where(eq(userAgentMemories.id, existing.id))
        .returning();

      if (updated) {
        persisted.push(mapMemoryRow(updated));
      }
      continue;
    }

    const normalizedConfidence = normalizeConfidence(write.confidence);
    const [created] = await db
      .insert(userAgentMemories)
      .values({
        userId: input.userId,
        threadId: input.threadId,
        scope: write.scope,
        kind: write.kind,
        summary,
        content: normalizeContent(write.content),
        confidence: normalizedConfidence,
        source: resolveMemorySource(write),
      })
      .returning();

    if (created) {
      persisted.push(mapMemoryRow(created));
    }
  }

  return persisted;
}

export async function archiveUserAgentMemory(
  userId: string,
  memoryId: string,
): Promise<AgentMemoryRecord | null> {
  const [updated] = await db
    .update(userAgentMemories)
    .set({
      archivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(userAgentMemories.userId, userId), eq(userAgentMemories.id, memoryId)))
    .returning();

  return updated ? mapMemoryRow(updated) : null;
}
