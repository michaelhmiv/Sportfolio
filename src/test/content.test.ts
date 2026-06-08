import { describe, expect, it } from 'vitest';
import { GAME_CONTENT, OUTPUT_QUALITY_CURVE } from '../content/gameContent';
import {
  buildLevelCurve,
  calculateDailyXp,
  calculateEffectiveSkill,
  rollOutputQuality,
  simulateLootTable,
} from '../content/simulation';
import { validateGameContent } from '../content/validation';
import { CONTENT_BOUNDARIES, IMPLEMENTATION_BACKLOG } from '../content/runtimeModel';

describe('CyberCache content layer', () => {
  it('validates the seeded content without errors', () => {
    const report = validateGameContent(GAME_CONTENT);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('keeps every quality curve normalized to 100%', () => {
    for (const band of OUTPUT_QUALITY_CURVE) {
      const total = Object.values(band.chances).reduce((sum, chance) => sum + chance, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it('runs deterministic loot simulations for a fixed seed', () => {
    const first = simulateLootTable('boss_dune_tyrant_rewards', 12345);
    const second = simulateLootTable('boss_dune_tyrant_rewards', 12345);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThanOrEqual(1);
  });

  it('applies effective-skill math for recipe quality', () => {
    expect(
      calculateEffectiveSkill({
        professionLevel: 40,
        stationBonus: 5,
        blueprintMastery: 3,
        materialQualityBonus: 8,
        recipeDifficulty: 22,
      })
    ).toBe(34);
  });

  it('rolls output quality deterministically with a fixed seed', () => {
    const first = rollOutputQuality(
      { professionLevel: 80, stationBonus: 5, blueprintMastery: 5, materialQualityBonus: 16, recipeDifficulty: 35 },
      99
    );
    const second = rollOutputQuality(
      { professionLevel: 80, stationBonus: 5, blueprintMastery: 5, materialQualityBonus: 16, recipeDifficulty: 35 },
      99
    );
    expect(second).toEqual(first);
    expect(['Crude', 'Standard', 'Refined', 'Superior', 'Prototype']).toContain(first.quality);
  });

  it('calculates daily XP from the 24/7 stress assumptions', () => {
    const dailyXp = calculateDailyXp();
    expect(dailyXp.totalXp).toBeGreaterThan(0);
    expect(dailyXp.bossAttemptXp).toBeGreaterThan(0);
    expect(dailyXp.enemyDefeatXp).toBeGreaterThan(0);
  });

  it('builds a level curve with cumulative day estimates', () => {
    const curve = buildLevelCurve(10);
    expect(curve).toHaveLength(10);
    expect(curve[0].level).toBe(1);
    expect(curve[9].level).toBe(10);
    expect(curve[8].cumulativeDaysAtStressAssumption).toBeGreaterThan(curve[0].cumulativeDaysAtStressAssumption);
  });

  it('documents the boundary between static content and runtime state', () => {
    expect(CONTENT_BOUNDARIES.some((boundary) => boundary.persistence === 'static_content')).toBe(true);
    expect(CONTENT_BOUNDARIES.some((boundary) => boundary.persistence === 'supabase_runtime')).toBe(true);
  });

  it('keeps the next implementation backlog explicit', () => {
    expect(IMPLEMENTATION_BACKLOG.map((item) => item.id)).toContain('content_pipeline_json_ts');
    expect(IMPLEMENTATION_BACKLOG.map((item) => item.id)).toContain('runtime_supabase_mapping');
    expect(IMPLEMENTATION_BACKLOG.map((item) => item.id)).toContain('loot_xp_simulation');
  });
});
