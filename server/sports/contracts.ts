import { z } from "zod";

export const sportSchema = z.enum(["mlb", "nhl", "nascar"]);
export type Sport = z.infer<typeof sportSchema>;

export const providerMetadataSchema = z.object({
  provider: z.string().min(1),
  fetchedAt: z.string().datetime(),
  sourceUpdatedAt: z.string().datetime().nullable().optional(),
  staleAfterSeconds: z.number().int().nonnegative(),
  isStale: z.boolean(),
  fallbackUsed: z.boolean().optional(),
  fallbackReason: z.string().nullable().optional(),
  conflictCount: z.number().int().nonnegative().optional(),
});
export type ProviderMetadata = z.infer<typeof providerMetadataSchema>;

export const providerReferenceSchema = z.object({
  sport: sportSchema,
  provider: z.string().min(1),
  entityType: z.enum(["athlete", "team", "game", "series"]),
  providerId: z.string().min(1),
});
export type ProviderReference = z.infer<typeof providerReferenceSchema>;

export const athleteSchema = z.object({
  id: z.string().min(1),
  sport: sportSchema,
  name: z.string().min(1),
  teamId: z.string().nullable(),
  position: z.string().nullable(),
  active: z.boolean(),
  provider: providerMetadataSchema,
});
export type Athlete = z.infer<typeof athleteSchema>;

export const teamSchema = z.object({
  id: z.string().min(1),
  sport: sportSchema,
  name: z.string().min(1),
  abbreviation: z.string().nullable(),
  provider: providerMetadataSchema,
});
export type Team = z.infer<typeof teamSchema>;

export const gameStatusSchema = z.enum([
  "scheduled",
  "in_progress",
  "final",
  "postponed",
  "suspended",
  "cancelled",
  "unknown",
]);
export type GameStatus = z.infer<typeof gameStatusSchema>;

export const gameSchema = z.object({
  id: z.string().min(1),
  sport: sportSchema,
  startsAt: z.string().datetime(),
  status: gameStatusSchema,
  homeTeamId: z.string().nullable(),
  awayTeamId: z.string().nullable(),
  seriesId: z.string().nullable().optional(),
  seasonId: z.string().nullable().optional(),
  sourceStatus: z.string().nullable().optional(),
  statusSource: z.enum(["provider", "inferred", "fallback"]).optional(),
  statusConfidence: z.enum(["authoritative", "inferred", "unknown"]).optional(),
  statusReason: z.string().nullable().optional(),
  eventOrderKey: z.string().optional(),
  provider: providerMetadataSchema,
});
export type Game = z.infer<typeof gameSchema>;

export const statValueSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);
export const statLineSchema = z.object({
  athleteId: z.string().min(1),
  gameId: z.string().nullable(),
  values: z.record(z.string(), statValueSchema),
  provider: providerMetadataSchema,
});
export type StatLine = z.infer<typeof statLineSchema>;

export const liveStateSchema = z.object({
  gameId: z.string().min(1),
  status: gameStatusSchema,
  clock: z.string().nullable(),
  period: z.string().nullable(),
  summary: z.string().nullable(),
  sourceStatus: z.string().nullable().optional(),
  statusSource: z.enum(["provider", "inferred", "fallback"]).optional(),
  statusConfidence: z.enum(["authoritative", "inferred", "unknown"]).optional(),
  statusReason: z.string().nullable().optional(),
  phase: z
    .object({
      kind: z.enum(["inning", "period", "stage", "lap", "session"]),
      number: z.number().nullable(),
      label: z.string().nullable(),
    })
    .nullable()
    .optional(),
  progress: z
    .object({
      current: z.number().nullable(),
      total: z.number().nullable(),
      remaining: z.number().nullable(),
      unit: z.enum(["inning", "period", "lap", "stage", "second"]),
    })
    .nullable()
    .optional(),
  provider: providerMetadataSchema,
});
export type LiveState = z.infer<typeof liveStateSchema>;

export const sportsDataErrorSchema = z.object({
  code: z.enum([
    "unsupported_sport",
    "unsupported_capability",
    "invalid_provider_id",
    "provider_unavailable",
    "invalid_payload",
    "not_found",
  ]),
  message: z.string().min(1),
  sport: sportSchema.optional(),
  provider: z.string().optional(),
  retryable: z.boolean(),
});
export type SportsDataError = z.infer<typeof sportsDataErrorSchema>;

export const nascarParticipantResultStatusSchema = z.enum([
  "running",
  "finished",
  "dnf",
  "dns",
  "dnq",
  "disqualified",
  "unknown",
]);
export type NascarParticipantResultStatus = z.infer<typeof nascarParticipantResultStatusSchema>;
