import { and, desc, eq, isNull } from "drizzle-orm";
import { userAgentMemories } from "@shared/schema";
import { db } from "../db";
import type {
  AgentMemoryKind,
  AgentMemoryRecord,
  AgentMemoryScope,
  ProposedMemoryWrite,
} from "./types";

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

function normalizeSummary(summary: string): string {
  return summary.replace(/\s+/g, " ").trim().slice(0, 240);
}

function normalizeContent(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !LOW_SIGNAL_TERMS.has(term));
}

function inferMemoryKind(message: string): AgentMemoryKind {
  const normalized = message.toLowerCase();

  if (/\b(low risk|safe|conservative|aggressive|higher risk|less risk)\b/.test(normalized)) {
    return "risk_tolerance";
  }

  if (/\b(always|usually|every day|each day|before lock|pre-lock)\b/.test(normalized)) {
    return "habit";
  }

  if (/\bgoal|trying to|want to build|want to focus|i want to\b/.test(normalized)) {
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

function scoreMemory(record: AgentMemoryRecord, query: string): number {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) {
    return 0;
  }

  const haystack = `${record.summary} ${JSON.stringify(record.content)}`.toLowerCase();

  return queryTerms.reduce((score, term) => {
    if (record.summary.toLowerCase().includes(term)) {
      return score + 5;
    }

    return haystack.includes(term) ? score + 1 : score;
  }, 0);
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

  const explicitPreferenceMatch = normalized.match(
    /\b(i (?:prefer|like|care about|want|need|usually|tend to|focus on)\b.+)$/i,
  );
  const favoriteMatch = normalized.match(/\b(i(?:'m| am)? (?:a fan of|into|following)\b.+)$/i);

  const matchedLine = explicitPreferenceMatch?.[1] || favoriteMatch?.[1] || "";
  if (!matchedLine) {
    return [];
  }

  const kind = inferMemoryKind(matchedLine);
  const scope = inferMemoryScope(kind);
  const summary = normalizeSummary(matchedLine);

  return [
    {
      scope,
      kind,
      summary,
      content: {
        statement: summary,
        capturedFrom: "user_message",
      },
      confidence: 0.78,
      reason: "Captured an explicit durable user preference statement.",
    },
  ];
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
      const [updated] = await db
        .update(userAgentMemories)
        .set({
          threadId: input.threadId,
          content: normalizeContent(write.content),
          confidence: write.confidence.toFixed(3),
          updatedAt: new Date(),
        })
        .where(eq(userAgentMemories.id, existing.id))
        .returning();

      if (updated) {
        persisted.push(mapMemoryRow(updated));
      }
      continue;
    }

    const [created] = await db
      .insert(userAgentMemories)
      .values({
        userId: input.userId,
        threadId: input.threadId,
        scope: write.scope,
        kind: write.kind,
        summary,
        content: normalizeContent(write.content),
        confidence: write.confidence.toFixed(3),
        source: "agent_inferred",
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
