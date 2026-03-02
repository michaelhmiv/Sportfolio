import { userAgentMessageEmbeddings, userAgentMessages } from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import type {
  AgentMessageRole,
  AgentMessageType,
  AgentQuestionSemanticCluster,
  AgentQuestionRouteAggregate,
  AgentSemanticRoute,
  AgentSemanticRouteMatch,
} from "./types";

export const AGENT_EMBEDDING_DIMENSIONS = 384;
const LOCAL_EMBEDDING_PROVIDER = "local_hash";
const LOCAL_EMBEDDING_MODEL = "sportfolio-hash-384";
const LOCAL_EMBEDDING_VERSION = "2026-03-01";
const PERPLEXITY_EMBEDDING_PROVIDER = "perplexity";
const DEFAULT_PERPLEXITY_EMBEDDING_MODEL = "pplx-embed-v1-4b";
const DEFAULT_PERPLEXITY_EMBEDDING_URL = "https://api.perplexity.ai/v1/embeddings";
const PERPLEXITY_EMBEDDING_TIMEOUT_MS = 3000;
const ROUTE_MATCH_THRESHOLD = 0.66;
const CLUSTER_MATCH_THRESHOLD = 0.9;

type EmbeddingRecord = {
  embedding: number[];
  route: AgentSemanticRoute | null;
  normalizedText: string;
  provider: string;
  model: string;
  version: string;
};

type ClusterSeed = {
  normalizedText: string;
  message: string;
  createdAt: Date;
  route: AgentSemanticRoute | null;
  embedding: number[];
};

const ROUTE_PROTOTYPES: Record<AgentSemanticRoute, string[]> = {
  top_targets_today: [
    "scout the top five players today",
    "who are the best players on today's slate",
    "give me the strongest current slate scout targets",
    "top players playing tonight",
  ],
  single_adjustment: [
    "review my scout setup and suggest one adjustment",
    "what is the strongest reallocation option available right now",
    "what one change should i make to my scouts",
    "give me one scout move",
  ],
  review_setup: [
    "what should i know about my current scout setup before i make any changes",
    "explain the tradeoffs in my current scout setup",
    "where am i overexposed in my current scouts",
    "what is my biggest missed opportunity in scouting right now",
  ],
  general_scouting: [
    "help me understand my scouting setup",
    "walk me through my scouting options",
    "what should i scout next",
    "give me scouting guidance",
  ],
};

const prototypeCache = new Map<
  AgentSemanticRoute,
  Array<{
    prompt: string;
    embedding: number[];
  }>
>();

function getPerplexityEmbeddingModel() {
  return process.env.AGENT_EMBEDDING_MODEL?.trim() || DEFAULT_PERPLEXITY_EMBEDDING_MODEL;
}

function getPerplexityEmbeddingUrl() {
  return process.env.AGENT_EMBEDDING_URL?.trim() || DEFAULT_PERPLEXITY_EMBEDDING_URL;
}

function getPerplexityApiKey() {
  return process.env.PERPLEXITY_API_KEY?.trim() || null;
}

function fnv1aHash(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function normalizeVector(values: number[]) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return values.map(() => 0);
  }

  return values.map((value) => value / magnitude);
}

function projectVector(values: number[], dimensions = AGENT_EMBEDDING_DIMENSIONS) {
  const projected = Array.from({ length: dimensions }, () => 0);
  if (!Array.isArray(values) || values.length === 0) {
    return projected;
  }

  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    if (!Number.isFinite(value)) {
      continue;
    }

    projected[index % dimensions] += value;
  }

  return normalizeVector(projected);
}

function computeCosineSimilarity(left: number[], right: number[]) {
  const size = Math.min(left.length, right.length);
  if (size === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < size; index += 1) {
    const leftValue = Number(left[index]) || 0;
    const rightValue = Number(right[index]) || 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function extractWordFeatures(text: string) {
  const words = text.split(" ").filter(Boolean);
  const features: Array<{ value: string; weight: number }> = [];

  for (let index = 0; index < words.length; index += 1) {
    features.push({
      value: `w:${words[index]}`,
      weight: 3,
    });

    if (index < words.length - 1) {
      features.push({
        value: `b:${words[index]}_${words[index + 1]}`,
        weight: 4,
      });
    }
  }

  return features;
}

function extractCharacterFeatures(text: string) {
  const joined = text.replace(/\s+/g, "_");
  const features: Array<{ value: string; weight: number }> = [];

  for (let index = 0; index < joined.length - 2; index += 1) {
    features.push({
      value: `c:${joined.slice(index, index + 3)}`,
      weight: 1,
    });
  }

  return features;
}

export function normalizeAgentQuestionText(message: string) {
  return message
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createLocalQuestionEmbedding(
  message: string,
  dimensions = AGENT_EMBEDDING_DIMENSIONS,
) {
  const normalized = normalizeAgentQuestionText(message);
  const vector = Array.from({ length: dimensions }, () => 0);

  if (!normalized) {
    return vector;
  }

  const features = [...extractWordFeatures(normalized), ...extractCharacterFeatures(normalized)];
  for (const feature of features) {
    const hash = fnv1aHash(feature.value);
    const slot = hash % dimensions;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[slot] += sign * feature.weight;
  }

  return normalizeVector(vector);
}

function getRoutePrototypeEmbeddings(route: AgentSemanticRoute) {
  const cached = prototypeCache.get(route);
  if (cached) {
    return cached;
  }

  const embeddings = ROUTE_PROTOTYPES[route].map((prompt) => ({
    prompt,
    embedding: createLocalQuestionEmbedding(prompt),
  }));
  prototypeCache.set(route, embeddings);
  return embeddings;
}

export function inferSemanticRouteMatch(input: {
  messageText: string;
  embedding?: number[];
}): AgentSemanticRouteMatch {
  const embedding = input.embedding || createLocalQuestionEmbedding(input.messageText);
  let bestMatch: AgentSemanticRouteMatch = {
    route: null,
    confidence: 0,
    matchedPrototype: null,
    provider: LOCAL_EMBEDDING_PROVIDER,
    model: LOCAL_EMBEDDING_MODEL,
  };

  const routes = Object.keys(ROUTE_PROTOTYPES) as AgentSemanticRoute[];
  for (const route of routes) {
    for (const prototype of getRoutePrototypeEmbeddings(route)) {
      const similarity = computeCosineSimilarity(embedding, prototype.embedding);
      if (similarity <= bestMatch.confidence) {
        continue;
      }

      bestMatch = {
        route,
        confidence: similarity,
        matchedPrototype: prototype.prompt,
        provider: LOCAL_EMBEDDING_PROVIDER,
        model: LOCAL_EMBEDDING_MODEL,
      };
    }
  }

  if (bestMatch.confidence < ROUTE_MATCH_THRESHOLD) {
    return {
      ...bestMatch,
      route: null,
    };
  }

  return bestMatch;
}

async function fetchPerplexityEmbedding(normalizedText: string): Promise<number[] | null> {
  const apiKey = getPerplexityApiKey();
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PERPLEXITY_EMBEDDING_TIMEOUT_MS);

  try {
    const response = await fetch(getPerplexityEmbeddingUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getPerplexityEmbeddingModel(),
        input: normalizedText,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Perplexity embedding request failed with ${response.status}`);
    }

    const payload = await response.json();
    const rawEmbedding =
      (Array.isArray(payload?.data) ? payload.data[0]?.embedding : null) || payload?.embedding;

    if (!Array.isArray(rawEmbedding) || rawEmbedding.length === 0) {
      throw new Error("Perplexity embedding response did not include an embedding vector");
    }

    return projectVector(rawEmbedding.map((entry: unknown) => Number(entry) || 0));
  } finally {
    clearTimeout(timeout);
  }
}

async function upgradeStoredEmbedding(messageId: string, normalizedText: string) {
  const remoteEmbedding = await fetchPerplexityEmbedding(normalizedText);
  if (!remoteEmbedding) {
    return;
  }

  await db
    .update(userAgentMessageEmbeddings)
    .set({
      embeddingProvider: PERPLEXITY_EMBEDDING_PROVIDER,
      embeddingModel: getPerplexityEmbeddingModel(),
      embeddingVersion: LOCAL_EMBEDDING_VERSION,
      embedding: remoteEmbedding,
    })
    .where(eq(userAgentMessageEmbeddings.messageId, messageId));
}

function queueEmbeddingUpgrade(messageId: string, normalizedText: string) {
  if (!getPerplexityApiKey()) {
    return;
  }

  void upgradeStoredEmbedding(messageId, normalizedText).catch((error: any) => {
    console.warn(
      "[Agent Embeddings] Perplexity embedding upgrade failed:",
      error?.message || error,
    );
  });
}

export async function ensureAgentSemanticSchema() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_agent_message_embeddings" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "message_id" varchar NOT NULL REFERENCES "user_agent_messages"("id") ON DELETE CASCADE,
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "thread_id" varchar NOT NULL REFERENCES "user_agent_threads"("id") ON DELETE CASCADE,
      "role" text NOT NULL DEFAULT 'user',
      "message_type" text NOT NULL DEFAULT 'chat',
      "normalized_text" text NOT NULL,
      "semantic_route_hint" text,
      "embedding_provider" text NOT NULL DEFAULT 'local_hash',
      "embedding_model" text NOT NULL DEFAULT 'sportfolio-hash-384',
      "embedding_version" text NOT NULL DEFAULT '2026-03-01',
      "embedding" jsonb NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "user_agent_message_embeddings_message_idx"
      ON "user_agent_message_embeddings" ("message_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_message_embeddings_user_created_idx"
      ON "user_agent_message_embeddings" ("user_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_message_embeddings_thread_created_idx"
      ON "user_agent_message_embeddings" ("thread_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "user_agent_message_embeddings_route_created_idx"
      ON "user_agent_message_embeddings" ("semantic_route_hint", "created_at");
  `);
}

export async function recordAgentMessageEmbedding(input: {
  messageId: string;
  userId: string;
  threadId: string;
  role: AgentMessageRole;
  messageType: AgentMessageType;
  contentText: string;
}): Promise<AgentSemanticRouteMatch | null> {
  if (!input.contentText.trim()) {
    return null;
  }

  const normalizedText = normalizeAgentQuestionText(input.contentText);
  if (!normalizedText) {
    return null;
  }

  const embedding = createLocalQuestionEmbedding(normalizedText);
  const routeMatch = inferSemanticRouteMatch({
    messageText: normalizedText,
    embedding,
  });

  await db
    .insert(userAgentMessageEmbeddings)
    .values({
      messageId: input.messageId,
      userId: input.userId,
      threadId: input.threadId,
      role: input.role,
      messageType: input.messageType,
      normalizedText,
      semanticRouteHint: routeMatch.route,
      embeddingProvider: LOCAL_EMBEDDING_PROVIDER,
      embeddingModel: LOCAL_EMBEDDING_MODEL,
      embeddingVersion: LOCAL_EMBEDDING_VERSION,
      embedding,
    })
    .onConflictDoNothing({
      target: userAgentMessageEmbeddings.messageId,
    });

  queueEmbeddingUpgrade(input.messageId, normalizedText);
  return routeMatch;
}

export async function backfillRecentAgentMessageEmbeddings(limit = 500) {
  const rows = await db
    .select({
      id: userAgentMessages.id,
      userId: userAgentMessages.userId,
      threadId: userAgentMessages.threadId,
      role: userAgentMessages.role,
      messageType: userAgentMessages.messageType,
      contentText: userAgentMessages.contentText,
    })
    .from(userAgentMessages)
    .leftJoin(
      userAgentMessageEmbeddings,
      eq(userAgentMessageEmbeddings.messageId, userAgentMessages.id),
    )
    .where(
      and(
        eq(userAgentMessages.role, "user"),
        eq(userAgentMessages.messageType, "chat"),
        sql`${userAgentMessageEmbeddings.messageId} IS NULL`,
      ),
    )
    .orderBy(desc(userAgentMessages.createdAt))
    .limit(limit);

  for (const row of rows) {
    await recordAgentMessageEmbedding({
      messageId: row.id,
      userId: row.userId,
      threadId: row.threadId,
      role: row.role as AgentMessageRole,
      messageType: row.messageType as AgentMessageType,
      contentText: row.contentText,
    });
  }
}

export function buildAgentQuestionRouteCounts(
  rows: Array<{
    message: string;
    createdAt: Date;
    semanticRouteHint: AgentSemanticRoute | null;
  }>,
): AgentQuestionRouteAggregate[] {
  const routeMap = new Map<
    AgentSemanticRoute,
    {
      route: AgentSemanticRoute;
      count: number;
      lastAskedAt: Date;
      samplePrompt: string;
    }
  >();

  for (const row of rows) {
    if (!row.semanticRouteHint) {
      continue;
    }

    const existing = routeMap.get(row.semanticRouteHint);
    if (!existing) {
      routeMap.set(row.semanticRouteHint, {
        route: row.semanticRouteHint,
        count: 1,
        lastAskedAt: row.createdAt,
        samplePrompt: row.message,
      });
      continue;
    }

    existing.count += 1;
    if (row.createdAt > existing.lastAskedAt) {
      existing.lastAskedAt = row.createdAt;
      existing.samplePrompt = row.message;
    }
  }

  return [...routeMap.values()].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return right.lastAskedAt.getTime() - left.lastAskedAt.getTime();
  });
}

export function buildAgentQuestionSemanticClusters(
  rows: ClusterSeed[],
): AgentQuestionSemanticCluster[] {
  const clusters: AgentQuestionSemanticCluster[] = [];
  const assigned = new Set<number>();

  for (let index = 0; index < rows.length; index += 1) {
    if (assigned.has(index)) {
      continue;
    }

    const seed = rows[index];
    const samplePrompts = [seed.message];
    let count = 1;
    let lastAskedAt = seed.createdAt;

    for (let candidateIndex = index + 1; candidateIndex < rows.length; candidateIndex += 1) {
      if (assigned.has(candidateIndex)) {
        continue;
      }

      const candidate = rows[candidateIndex];
      const similarity = computeCosineSimilarity(seed.embedding, candidate.embedding);
      const sameRoute = seed.route && candidate.route && seed.route === candidate.route;
      const sameText = seed.normalizedText === candidate.normalizedText;

      if (!sameText && !sameRoute && similarity < CLUSTER_MATCH_THRESHOLD) {
        continue;
      }

      assigned.add(candidateIndex);
      count += 1;
      if (samplePrompts.length < 3) {
        samplePrompts.push(candidate.message);
      }
      if (candidate.createdAt > lastAskedAt) {
        lastAskedAt = candidate.createdAt;
      }
    }

    if (count < 2) {
      continue;
    }

    clusters.push({
      label: seed.route
        ? `${seed.route.replace(/_/g, " ")} cluster`
        : seed.message.slice(0, 80).trim(),
      route: seed.route,
      count,
      samplePrompts,
      lastAskedAt,
    });
  }

  return clusters
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return right.lastAskedAt.getTime() - left.lastAskedAt.getTime();
    })
    .slice(0, 20);
}

export function buildLocalEmbeddingRecord(messageText: string): EmbeddingRecord {
  const normalizedText = normalizeAgentQuestionText(messageText);
  const embedding = createLocalQuestionEmbedding(normalizedText);
  const match = inferSemanticRouteMatch({
    messageText: normalizedText,
    embedding,
  });

  return {
    embedding,
    route: match.route,
    normalizedText,
    provider: LOCAL_EMBEDDING_PROVIDER,
    model: LOCAL_EMBEDDING_MODEL,
    version: LOCAL_EMBEDDING_VERSION,
  };
}
