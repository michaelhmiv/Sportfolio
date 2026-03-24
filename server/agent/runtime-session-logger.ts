import { agentRuntimeSessions } from "@shared/schema";
import { sql } from "drizzle-orm";
import { db } from "../db";
import type {
  HermesExecutionContext,
  HermesRespondRequest,
  HermesRespondResult,
  HermesRuntimeMetadata,
  HermesTriggerContext,
} from "./types";

let agentRuntimeSessionSchemaEnsured = false;

function sanitizeRequestPayload(input: HermesRespondRequest) {
  return {
    ...input,
    modelRuntime: {
      ...input.modelRuntime,
      apiKey: input.modelRuntime.apiKey ? "[redacted]" : null,
    },
  };
}

export async function ensureAgentRuntimeSessionSchema(): Promise<void> {
  if (agentRuntimeSessionSchemaEnsured) {
    return;
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "agent_runtime_sessions" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE SET NULL,
      "runtime" text NOT NULL,
      "transport" text,
      "endpoint" text,
      "execution_kind" text,
      "trigger_source" text,
      "strategy_id" varchar,
      "correlation_id" text,
      "status" text NOT NULL,
      "request_payload" jsonb,
      "response_payload" jsonb,
      "tool_trace" jsonb,
      "latency_ms" integer,
      "created_at" timestamp NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    ALTER TABLE "agent_runtime_sessions"
      ADD COLUMN IF NOT EXISTS "transport" text;
  `);
  await db.execute(sql`
    ALTER TABLE "agent_runtime_sessions"
      ADD COLUMN IF NOT EXISTS "endpoint" text;
  `);
  await db.execute(sql`
    ALTER TABLE "agent_runtime_sessions"
      ADD COLUMN IF NOT EXISTS "execution_kind" text;
  `);
  await db.execute(sql`
    ALTER TABLE "agent_runtime_sessions"
      ADD COLUMN IF NOT EXISTS "trigger_source" text;
  `);
  await db.execute(sql`
    ALTER TABLE "agent_runtime_sessions"
      ADD COLUMN IF NOT EXISTS "strategy_id" varchar;
  `);
  await db.execute(sql`
    ALTER TABLE "agent_runtime_sessions"
      ADD COLUMN IF NOT EXISTS "correlation_id" text;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_runtime_sessions_user_created_idx"
      ON "agent_runtime_sessions" ("user_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_runtime_sessions_thread_created_idx"
      ON "agent_runtime_sessions" ("thread_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_runtime_sessions_runtime_created_idx"
      ON "agent_runtime_sessions" ("runtime", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_runtime_sessions_transport_created_idx"
      ON "agent_runtime_sessions" ("transport", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "agent_runtime_sessions_strategy_created_idx"
      ON "agent_runtime_sessions" ("strategy_id", "created_at");
  `);

  agentRuntimeSessionSchemaEnsured = true;
}

export async function logHermesRuntimeSession(input: {
  userId: string;
  threadId: string | null;
  status: string;
  requestPayload: HermesRespondRequest;
  responsePayload: HermesRespondResult | Record<string, unknown> | null;
  toolTrace: HermesRespondResult["toolTrace"];
  latencyMs: number;
  transport: HermesRuntimeMetadata["transport"];
  endpoint?: string | null;
  executionKind?: HermesExecutionContext["kind"] | null;
  triggerSource?: HermesTriggerContext["source"] | null;
  strategyId?: string | null;
  correlationId?: string | null;
  providerKey?: HermesRuntimeMetadata["providerKey"];
  model?: string | null;
}): Promise<HermesRuntimeMetadata | null> {
  try {
    await ensureAgentRuntimeSessionSchema();

    const [session] = await db
      .insert(agentRuntimeSessions)
      .values({
        userId: input.userId,
        threadId: input.threadId,
        runtime: "hermes",
        transport: input.transport,
        endpoint: input.endpoint || null,
        executionKind: input.executionKind || null,
        triggerSource: input.triggerSource || null,
        strategyId: input.strategyId || null,
        correlationId: input.correlationId || null,
        status: input.status,
        requestPayload: sanitizeRequestPayload(input.requestPayload),
        responsePayload: input.responsePayload,
        toolTrace: input.toolTrace,
        latencyMs: input.latencyMs,
      })
      .returning({ id: agentRuntimeSessions.id });

    return {
      sessionId: session?.id || null,
      transport: input.transport,
      endpoint: input.endpoint || null,
      executionKind: input.executionKind || null,
      triggerSource: input.triggerSource || null,
      strategyId: input.strategyId || null,
      correlationId: input.correlationId || null,
      providerKey: input.providerKey || null,
      model: input.model || null,
    };
  } catch (error: any) {
    console.warn("[Hermes Runtime] Could not log runtime session:", error?.message || error);
    return null;
  }
}
