import { agentSkillReviews, agentSkills, type AgentSkill as AgentSkillRow } from "@shared/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import type {
  AgentSkillDefinition,
  AgentSkillMatchResult,
  AgentSkillScope,
  AgentSkillStatus,
  AgentSkillStep,
} from "./types";

let agentSkillSchemaEnsured = false;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeExamples(examples: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const example of examples) {
    const candidate = normalizeText(example).toLowerCase();
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    normalized.push(candidate);
  }
  return normalized.slice(0, 12);
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 1);
}

function buildSkillSignature(name: string, toolSequence: AgentSkillStep[]): string {
  const steps = toolSequence.map((step) => `${step.toolCategory}:${step.toolName}`).join(">");
  return `${normalizeText(name).toLowerCase()}::${steps}`;
}

function parseSkillStepSequence(value: unknown): AgentSkillStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: AgentSkillStep[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    const stepType =
      candidate.stepType === "tool_call" ||
      candidate.stepType === "clarify" ||
      candidate.stepType === "decision"
        ? candidate.stepType
        : null;
    const toolCategory =
      candidate.toolCategory === "read" ||
      candidate.toolCategory === "scan" ||
      candidate.toolCategory === "plan" ||
      candidate.toolCategory === "action" ||
      candidate.toolCategory === "memory" ||
      candidate.toolCategory === "research"
        ? candidate.toolCategory
        : null;
    const toolName =
      typeof candidate.toolName === "string" ? normalizeText(candidate.toolName) : "";

    if (!stepType || !toolCategory || !toolName) {
      continue;
    }

    parsed.push({
      stepType,
      toolCategory,
      toolName,
      argumentTemplate:
        candidate.argumentTemplate && typeof candidate.argumentTemplate === "object"
          ? (candidate.argumentTemplate as Record<string, unknown>)
          : {},
      stopIf: typeof candidate.stopIf === "string" ? normalizeText(candidate.stopIf) : null,
      requiresUserInput: Boolean(candidate.requiresUserInput),
    });
  }

  return parsed;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(value, 1));
}

function mapSkillRow(row: AgentSkillRow): AgentSkillDefinition {
  return {
    id: row.id,
    scope: row.scope as AgentSkillScope,
    status: row.status as AgentSkillStatus,
    userId: row.userId || null,
    name: row.name,
    description: row.description,
    triggerExamples: Array.isArray(row.triggerExamples)
      ? row.triggerExamples.filter((entry): entry is string => typeof entry === "string")
      : [],
    toolSequence: parseSkillStepSequence(row.toolSequence),
    clarificationStrategy:
      row.clarificationStrategy && typeof row.clarificationStrategy === "object"
        ? (row.clarificationStrategy as Record<string, unknown>)
        : {},
    constraints:
      row.constraints && typeof row.constraints === "object"
        ? (row.constraints as Record<string, unknown>)
        : {},
    confidence: Number(row.confidence || "0.5"),
    sourceThreadId: row.sourceThreadId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt || null,
  };
}

function scoreSkill(message: string, skill: AgentSkillDefinition): number {
  const messageTerms = new Set(tokenize(message));
  if (messageTerms.size === 0) {
    return 0;
  }

  const haystacks = [
    skill.name,
    skill.description,
    ...skill.triggerExamples,
    ...skill.toolSequence.map((step) => `${step.toolName} ${step.toolCategory}`),
  ].map((entry) => entry.toLowerCase());

  let score = 0;
  for (const term of messageTerms) {
    if (haystacks.some((entry) => entry.includes(term))) {
      score += 1;
    }
  }

  const lexical = score / Math.max(messageTerms.size, 1);
  const confidenceWeight = Math.max(skill.confidence, 0.1);
  return lexical * confidenceWeight;
}

function getSkillUpdatedAt(skill: Pick<AgentSkillDefinition, "updatedAt">): number {
  if (skill.updatedAt instanceof Date) {
    return skill.updatedAt.getTime();
  }

  if (typeof skill.updatedAt === "string") {
    const parsed = new Date(skill.updatedAt);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  return 0;
}

export async function ensureAgentSkillSchema(): Promise<void> {
  if (agentSkillSchemaEnsured) {
    return;
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "agent_skills" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "scope" text NOT NULL,
      "user_id" varchar REFERENCES "users"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "description" text NOT NULL,
      "trigger_examples" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "tool_sequence" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "clarification_strategy" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "constraints" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "confidence" numeric(4, 3) NOT NULL DEFAULT 0.500,
      "status" text NOT NULL,
      "source_thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now(),
      "archived_at" timestamp
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_skills_user_status_updated_idx"
      ON "agent_skills" ("user_id", "status", "updated_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_skills_scope_status_updated_idx"
      ON "agent_skills" ("scope", "status", "updated_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_skills_status_updated_idx"
      ON "agent_skills" ("status", "updated_at");
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "agent_skill_reviews" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "skill_id" varchar NOT NULL REFERENCES "agent_skills"("id") ON DELETE CASCADE,
      "reviewed_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "decision" text NOT NULL,
      "notes" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_skill_reviews_skill_idx"
      ON "agent_skill_reviews" ("skill_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_skill_reviews_reviewer_idx"
      ON "agent_skill_reviews" ("reviewed_by", "created_at");
  `);

  agentSkillSchemaEnsured = true;
}

export async function listAvailableAgentSkills(userId: string): Promise<AgentSkillDefinition[]> {
  await ensureAgentSkillSchema();

  const rows = await db
    .select()
    .from(agentSkills)
    .where(
      and(
        isNull(agentSkills.archivedAt),
        eq(agentSkills.status, "active"),
        and(eq(agentSkills.scope, "user"), eq(agentSkills.userId, userId)),
      ),
    )
    .orderBy(desc(agentSkills.updatedAt));

  const approvedGlobalRows = await db
    .select()
    .from(agentSkills)
    .where(
      and(
        isNull(agentSkills.archivedAt),
        eq(agentSkills.scope, "global_approved"),
        eq(agentSkills.status, "approved"),
      ),
    )
    .orderBy(desc(agentSkills.updatedAt));

  return [...rows, ...approvedGlobalRows].map(mapSkillRow);
}

export async function listAgentSkillCandidates(): Promise<AgentSkillDefinition[]> {
  await ensureAgentSkillSchema();

  const rows = await db
    .select()
    .from(agentSkills)
    .where(and(isNull(agentSkills.archivedAt), eq(agentSkills.scope, "global_candidate")))
    .orderBy(desc(agentSkills.updatedAt));

  return rows.map(mapSkillRow);
}

export async function listAdminAgentSkills(input?: {
  scope?: AgentSkillScope;
  status?: AgentSkillStatus;
}): Promise<AgentSkillDefinition[]> {
  await ensureAgentSkillSchema();

  const filters = [isNull(agentSkills.archivedAt)];
  if (input?.scope) {
    filters.push(eq(agentSkills.scope, input.scope));
  }
  if (input?.status) {
    filters.push(eq(agentSkills.status, input.status));
  }

  const rows = await db
    .select()
    .from(agentSkills)
    .where(and(...filters))
    .orderBy(desc(agentSkills.updatedAt));

  return rows.map(mapSkillRow);
}

export function matchAgentSkill(
  message: string,
  availableSkills: AgentSkillDefinition[],
): AgentSkillMatchResult | null {
  const normalizedMessage = normalizeText(message);
  if (!normalizedMessage || availableSkills.length === 0) {
    return null;
  }

  const ranked = availableSkills
    .map((skill) => ({
      skill,
      score: scoreSkill(normalizedMessage, skill),
    }))
    .filter((entry) => entry.score >= 0.35)
    .sort(
      (left, right) =>
        right.score - left.score || getSkillUpdatedAt(right.skill) - getSkillUpdatedAt(left.skill),
    );

  if (ranked.length === 0) {
    return null;
  }

  const best = ranked[0];
  return {
    matched: true,
    skillId: best.skill.id,
    confidence: Number(best.score.toFixed(3)),
    reason: `Matched ${best.skill.name} from prior successful tool sequencing.`,
  };
}

export async function createOrUpdateUserSkill(input: {
  userId: string;
  threadId: string | null;
  name: string;
  description: string;
  triggerExamples: string[];
  toolSequence: AgentSkillStep[];
  confidence: number;
}): Promise<AgentSkillDefinition | null> {
  await ensureAgentSkillSchema();

  const name = normalizeText(input.name);
  const description = normalizeText(input.description);
  const toolSequence = input.toolSequence.filter((step) => step.toolName && step.toolCategory);
  if (!name || !description || toolSequence.length === 0) {
    return null;
  }

  const triggerExamples = normalizeExamples(input.triggerExamples);
  const signature = buildSkillSignature(name, toolSequence);

  const [existing] = await db
    .select()
    .from(agentSkills)
    .where(
      and(
        eq(agentSkills.scope, "user"),
        eq(agentSkills.userId, input.userId),
        isNull(agentSkills.archivedAt),
        sql`${agentSkills.constraints} ->> 'signature' = ${signature}`,
      ),
    )
    .limit(1);

  const values = {
    scope: "user" as const,
    userId: input.userId,
    name,
    description,
    triggerExamples,
    toolSequence,
    clarificationStrategy: {},
    constraints: {
      signature,
    },
    confidence: clampConfidence(input.confidence).toFixed(3),
    status: "active" as const,
    sourceThreadId: input.threadId,
  };

  if (existing) {
    const mergedExamples = normalizeExamples([
      ...((Array.isArray(existing.triggerExamples)
        ? existing.triggerExamples.filter((entry): entry is string => typeof entry === "string")
        : []) as string[]),
      ...triggerExamples,
    ]);
    const [updated] = await db
      .update(agentSkills)
      .set({
        ...values,
        triggerExamples: mergedExamples,
        updatedAt: new Date(),
        archivedAt: null,
      })
      .where(eq(agentSkills.id, existing.id))
      .returning();

    return updated ? mapSkillRow(updated) : null;
  }

  const [created] = await db.insert(agentSkills).values(values).returning();

  return created ? mapSkillRow(created) : null;
}

export async function proposeGlobalSkillCandidate(input: {
  sourceSkill: AgentSkillDefinition;
}): Promise<AgentSkillDefinition | null> {
  await ensureAgentSkillSchema();

  const signature = String(input.sourceSkill.constraints.signature || "");
  if (!signature) {
    return null;
  }

  const [existing] = await db
    .select()
    .from(agentSkills)
    .where(
      and(
        eq(agentSkills.scope, "global_candidate"),
        isNull(agentSkills.archivedAt),
        sql`${agentSkills.constraints} ->> 'signature' = ${signature}`,
      ),
    )
    .limit(1);

  if (existing) {
    const mergedExamples = normalizeExamples([
      ...(Array.isArray(existing.triggerExamples)
        ? existing.triggerExamples.filter((entry): entry is string => typeof entry === "string")
        : []),
      ...input.sourceSkill.triggerExamples,
    ]);
    const [updated] = await db
      .update(agentSkills)
      .set({
        triggerExamples: mergedExamples,
        confidence: clampConfidence(
          Math.max(Number(existing.confidence || "0.5"), input.sourceSkill.confidence),
        ).toFixed(3),
        updatedAt: new Date(),
        status: "candidate",
      })
      .where(eq(agentSkills.id, existing.id))
      .returning();

    return updated ? mapSkillRow(updated) : null;
  }

  const [created] = await db
    .insert(agentSkills)
    .values({
      scope: "global_candidate",
      userId: null,
      name: input.sourceSkill.name,
      description: input.sourceSkill.description,
      triggerExamples: input.sourceSkill.triggerExamples,
      toolSequence: input.sourceSkill.toolSequence,
      clarificationStrategy: input.sourceSkill.clarificationStrategy,
      constraints: input.sourceSkill.constraints,
      confidence: clampConfidence(input.sourceSkill.confidence).toFixed(3),
      status: "candidate",
      sourceThreadId: input.sourceSkill.sourceThreadId,
    })
    .returning();

  return created ? mapSkillRow(created) : null;
}

async function reviewAgentSkillCandidate(input: {
  skillId: string;
  reviewedBy: string;
  decision: "approved" | "rejected";
  notes?: string | null;
  promotedScope?: AgentSkillScope;
  promotedStatus?: AgentSkillStatus;
}): Promise<AgentSkillDefinition | null> {
  await ensureAgentSkillSchema();

  const [reviewed] = await db
    .update(agentSkills)
    .set({
      scope: input.promotedScope || "global_candidate",
      status: input.promotedStatus || (input.decision === "approved" ? "approved" : "rejected"),
      updatedAt: new Date(),
    })
    .where(eq(agentSkills.id, input.skillId))
    .returning();

  if (!reviewed) {
    return null;
  }

  await db.insert(agentSkillReviews).values({
    skillId: input.skillId,
    reviewedBy: input.reviewedBy,
    decision: input.decision,
    notes: input.notes || null,
  });

  return mapSkillRow(reviewed);
}

export async function approveAgentSkillCandidate(input: {
  skillId: string;
  reviewedBy: string;
  notes?: string | null;
}): Promise<AgentSkillDefinition | null> {
  return reviewAgentSkillCandidate({
    skillId: input.skillId,
    reviewedBy: input.reviewedBy,
    notes: input.notes,
    decision: "approved",
    promotedScope: "global_approved",
    promotedStatus: "approved",
  });
}

export async function rejectAgentSkillCandidate(input: {
  skillId: string;
  reviewedBy: string;
  notes?: string | null;
}): Promise<AgentSkillDefinition | null> {
  return reviewAgentSkillCandidate({
    skillId: input.skillId,
    reviewedBy: input.reviewedBy,
    notes: input.notes,
    decision: "rejected",
    promotedScope: "global_candidate",
    promotedStatus: "rejected",
  });
}

export async function archiveAgentSkill(input: {
  skillId: string;
  userId?: string | null;
}): Promise<AgentSkillDefinition | null> {
  await ensureAgentSkillSchema();

  const filters = [eq(agentSkills.id, input.skillId)];
  if (input.userId) {
    filters.push(eq(agentSkills.userId, input.userId));
  }

  const [updated] = await db
    .update(agentSkills)
    .set({
      archivedAt: new Date(),
      updatedAt: new Date(),
      status: "archived",
    })
    .where(and(...filters))
    .returning();

  return updated ? mapSkillRow(updated) : null;
}
