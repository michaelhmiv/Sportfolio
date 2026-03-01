import { z } from "zod";

const scoutActionSchema = z.object({
  actionType: z.literal("scout_set_count"),
  playerId: z.string().min(1),
  targetCount: z.number().int().min(0).max(10),
  reasoning: z.string().trim().min(1).max(500),
  confidence: z.number().min(0).max(1),
  evidence: z
    .object({
      trend: z.string().nullable().optional(),
      injury: z.string().nullable().optional(),
      upcomingGame: z.string().nullable().optional(),
      performanceNote: z.string().nullable().optional(),
    })
    .strict(),
});

export const scoutModelOutputSchema = z
  .object({
    replyText: z.string().trim().min(1).max(1200).optional(),
    summary: z.string().trim().min(1).max(1000),
    observations: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
    actions: z.array(scoutActionSchema).max(10).default([]),
    warnings: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  })
  .strict();

export type ScoutModelOutput = z.infer<typeof scoutModelOutputSchema>;

export function parseScoutPlanPayload(payload: unknown): ScoutModelOutput {
  const result = scoutModelOutputSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      `Structured scout plan did not match the required schema: ${result.error.message}`,
    );
  }

  return result.data;
}
