import { beforeEach, describe, expect, it } from "vitest";
import type { Game } from "./contracts";
import {
  createProviderMetadata,
  normalizeNascarParticipantResultStatus,
  readSportsSemanticMetrics,
  reconcileAndSortGames,
  resetSportsSemanticMetrics,
  resolveMlbGameStatus,
  resolveNascarLiveStatus,
  resolveNhlGameStatus,
} from "./semantics";

const BEFORE = {
  mlbSuspended: "postponed",
  nhlSuspended: "postponed",
  unknownNhl: "scheduled",
  missingMlbLinescorePhase: "scheduled",
} as const;

const provider = createProviderMetadata({
  provider: "fixture",
  fetchedAt: new Date("2026-08-04T12:00:00.000Z"),
  staleAfterSeconds: 60,
});

function game(
  id: string,
  startsAt: string,
  status: Game["status"],
  fetchedAt = provider.fetchedAt,
): Game {
  return {
    id,
    sport: "mlb",
    startsAt,
    status,
    homeTeamId: "h",
    awayTeamId: "a",
    provider: { ...provider, fetchedAt },
  };
}

describe("unified sports semantic correction fixtures", () => {
  beforeEach(() => resetSportsSemanticMetrics());

  it("documents and corrects suspended and unknown status drift", () => {
    expect(BEFORE).toEqual({
      mlbSuspended: "postponed",
      nhlSuspended: "postponed",
      unknownNhl: "scheduled",
      missingMlbLinescorePhase: "scheduled",
    });
    expect(
      resolveMlbGameStatus({ detailedState: "Suspended", abstractGameState: "Live" }),
    ).toMatchObject({
      status: "suspended",
      sourceStatus: "Suspended",
      statusSource: "provider",
    });
    expect(resolveNhlGameStatus("SUSP")).toMatchObject({ status: "suspended" });
    expect(resolveNhlGameStatus("ALIEN_STATE")).toMatchObject({
      status: "unknown",
      statusSource: "fallback",
      statusConfidence: "unknown",
    });
  });

  it("does not collapse delayed games into postponed", () => {
    expect(
      resolveMlbGameStatus({ detailedState: "Delayed", abstractGameState: "Live" }),
    ).toMatchObject({
      status: "in_progress",
      statusConfidence: "inferred",
    });
    expect(
      resolveMlbGameStatus({ detailedState: "Delayed", abstractGameState: "Preview" }),
    ).toMatchObject({
      status: "scheduled",
      statusConfidence: "inferred",
    });
  });

  it("preserves NASCAR lap semantics and unknown result states", () => {
    expect(resolveNascarLiveStatus({ lapNumber: 0, lapsToGo: 200, flagState: 77 })).toMatchObject({
      status: "unknown",
    });
    expect(normalizeNascarParticipantResultStatus("Did Not Qualify")).toBe("dnq");
    expect(normalizeNascarParticipantResultStatus("Did Not Start")).toBe("dns");
    expect(normalizeNascarParticipantResultStatus("engine")).toBe("dnf");
    expect(normalizeNascarParticipantResultStatus("mystery")).toBe("unknown");
  });

  it("computes freshness from source watermarks without coercion", () => {
    const metadata = createProviderMetadata({
      provider: "fixture",
      fetchedAt: new Date("2026-08-04T12:10:00.000Z"),
      sourceUpdatedAt: new Date("2026-08-04T12:00:00.000Z"),
      now: new Date("2026-08-04T12:10:00.000Z"),
      staleAfterSeconds: 300,
    });
    expect(metadata).toMatchObject({ isStale: true, staleAfterSeconds: 300 });
  });

  it("deduplicates and orders events while exposing conflict counts", () => {
    const values = reconcileAndSortGames([
      game("g2", "2026-08-04T20:00:00.000Z", "scheduled"),
      game("g1", "2026-08-04T19:00:00.000Z", "scheduled", "2026-08-04T12:00:00.000Z"),
      game("g1", "2026-08-04T19:00:00.000Z", "final", "2026-08-04T12:05:00.000Z"),
    ]);
    expect(values.map((value) => value.id)).toEqual(["g1", "g2"]);
    expect(values[0]).toMatchObject({ status: "final", provider: { conflictCount: 1 } });
    expect(readSportsSemanticMetrics()).toMatchObject({ duplicate_event: 1, event_conflict: 1 });
  });
});
