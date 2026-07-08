import { describe, expect, it } from "vitest";

import { getMlbSignalTone, getVisibleMlbSignals } from "./mlb-gameplay-signals";
import type { GameInsightMlbSignal } from "@/types/game-insights";

const makeSignal = (index: number, severity: GameInsightMlbSignal["severity"] = "info") => ({
  id: `signal-${index}`,
  gameId: "mlb_1",
  category: "lineup" as const,
  severity,
  label: `Signal ${index}`,
  detail: `Detail ${index}`,
});

describe("mlb gameplay signal presentation helpers", () => {
  it("keeps command center signal lists compact", () => {
    const signals = [makeSignal(1), makeSignal(2), makeSignal(3), makeSignal(4)];

    expect(getVisibleMlbSignals(signals, 3).map((signal) => signal.id)).toEqual([
      "signal-1",
      "signal-2",
      "signal-3",
    ]);
    expect(getVisibleMlbSignals(signals, 0)).toEqual([]);
    expect(getVisibleMlbSignals(null, 3)).toEqual([]);
  });

  it("uses restrained Sportfolio-native tones by severity", () => {
    expect(getMlbSignalTone(makeSignal(1, "high")).chipClassName).toContain("amber");
    expect(getMlbSignalTone(makeSignal(2, "positive")).chipClassName).toContain("emerald");
    expect(getMlbSignalTone(makeSignal(3, "warning")).chipClassName).toContain("border-border");
    expect(getMlbSignalTone(makeSignal(4, "info")).chipClassName).toContain("muted-foreground");
  });
});
