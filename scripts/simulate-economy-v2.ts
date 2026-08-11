import {
  BOOST_SLOT_MULTIPLIERS,
  POSTSEASON_TARGET_SB,
  REGULAR_SEASON_TARGET_SB,
} from "../server/economy/config";

function numberArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const users = numberArg("users", 100_000);
const startingSbPerUser = numberArg("starting-sb", 10_000);
const scoutedPlayers = numberArg("scouted-players", 500);
const boostBurnRate = numberArg("boost-burn-rate", 0.1);
const avgBoostMultiplier = numberArg(
  "avg-boost-multiplier",
  BOOST_SLOT_MULTIPLIERS.reduce((sum, value) => sum + value, 0) / BOOST_SLOT_MULTIPLIERS.length,
);
const avgBaseEpsOnBurnedShare = numberArg("avg-base-eps", 0.5);
const regularBenchmarkPlayerEquivalents = numberArg("regular-benchmark-player-equivalents", 500);
const postseasonBenchmarkPlayerEquivalents = numberArg("postseason-benchmark-player-equivalents", 100);
const ammSbBurnRate = numberArg("amm-sb-burn-rate", 0.05);

const scoutSinglesPerPlayerYear = 60 * 24 * 365;
const scoutSinglesIssued = scoutedPlayers * scoutSinglesPerPlayerYear;
const boostSharesBurned = scoutSinglesIssued * boostBurnRate;
const boostBonusSb = boostSharesBurned * avgBaseEpsOnBurnedShare * Math.max(0, avgBoostMultiplier - 1);
const regularBaseSb = regularBenchmarkPlayerEquivalents * REGULAR_SEASON_TARGET_SB;
const postseasonBaseSb = postseasonBenchmarkPlayerEquivalents * POSTSEASON_TARGET_SB;
const openingSbSupply = users * startingSbPerUser;
const grossIssued = regularBaseSb + postseasonBaseSb + boostBonusSb;
const estimatedSbBurned = openingSbSupply * ammSbBurnRate;
const netIssued = grossIssued - estimatedSbBurned;
const netInflation = openingSbSupply > 0 ? netIssued / openingSbSupply : 0;

console.log(
  JSON.stringify(
    {
      assumptions: {
        users,
        startingSbPerUser,
        scoutedPlayers,
        boostBurnRate,
        avgBoostMultiplier,
        avgBaseEpsOnBurnedShare,
        regularBenchmarkPlayerEquivalents,
        postseasonBenchmarkPlayerEquivalents,
        ammSbBurnRate,
      },
      results: {
        openingSbSupply,
        scoutSinglesIssued,
        boostSharesBurned,
        regularBaseSb,
        postseasonBaseSb,
        boostBonusSb,
        grossIssued,
        estimatedSbBurned,
        netIssued,
        annualNetInflationPct: netInflation * 100,
        endingSbSupply: openingSbSupply + netIssued,
        shareBurnToScoutIssuancePct:
          scoutSinglesIssued > 0 ? (boostSharesBurned / scoutSinglesIssued) * 100 : 0,
      },
      policy: {
        warningAnnualInflationPct: 20,
        interventionAnnualInflationPct: 30,
      },
    },
    null,
    2,
  ),
);
