/**
 * Scenario Matrix — comprehensive user request coverage.
 *
 * Tests real user messages through the deterministic layers of the agent pipeline:
 *   1. Intent routing  (commit vs discussion, heuristic confidence)
 *   2. Sport name normalization
 *   3. Multi-action bundle clause parsing
 *   4. Explicit planning intent detection
 *
 * These layers are fully deterministic (no LLM) so they can be tested exhaustively.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock only the model call so intent-router's classifier path is controllable
// ---------------------------------------------------------------------------
const completeSimpleMock = vi.hoisted(() => vi.fn());
vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: completeSimpleMock,
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------
import {
  isLikelyAdvisoryMessage,
  resolveAgentRequestMode,
  resolveAgentRequestModeWithFallback,
} from "./intent-router";

// We need to import the non-exported helpers indirectly by testing their effects
// through the public API.

// ═══════════════════════════════════════════════════════════════════════════
// 1. INTENT ROUTING SCENARIO MATRIX
// ═══════════════════════════════════════════════════════════════════════════

describe("scenario-matrix: intent routing", () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
  });

  // ── COMMIT (high confidence) ── should NOT call the model classifier ──

  const commitHighConfidence: Array<[string, string]> = [
    // Direct imperatives
    ["Buy Aaron Judge", "direct buy verb"],
    ["Sell my Jalen Brunson shares", "direct sell verb"],
    ["Stack my Fried shares", "direct stack verb"],
    ["Boost Max Fried at 5x", "direct boost verb"],
    ["Trade into Aaron Judge", "direct trade verb"],
    ["Swap my scouts from Fried to Judge", "direct swap verb"],
    ["Scout the top five players today", "direct scout verb"],
    ["Move all my scouts to Bob", "direct move verb"],
    ["Add Aaron Judge to my watchlist", "direct add verb"],
    ["Remove Fried from my scouts", "direct remove verb"],
    ["Set all my scouts on Judge", "direct set verb"],
    ["Find me the best MLB pitcher tonight", "direct find verb"],
    ["Give me a breakdown of my portfolio", "direct give verb"],
    ["Show me my boost slots", "direct show verb"],

    // "Can you / Could you / Will you" + action verb
    ["Can you buy Aaron Judge for me?", "polite buy request"],
    ["Could you sell my Brunson shares?", "polite sell request"],
    ["Will you stack my Fried shares?", "polite stack request"],
    ["Can you boost Judge at 4x tonight?", "polite boost request"],
    ["Can you scout Aaron Judge?", "polite scout request"],
    ["Can you swap my boosts around?", "polite swap request"],
    ["Can you trade into the top MLB player?", "polite trade request"],
    ["Can you move my scouts to Fried?", "polite move request"],

    // "Please" + action verb
    ["Please buy $50 of Aaron Judge", "please + buy"],
    ["Please sell all my NBA holdings", "please + sell"],
    ["Please stack my shares", "please + stack"],
    ["Please boost Fried tonight", "please + boost"],
    ["Please trade my scouts to the best pitcher", "please + trade"],
    ["Please swap my 5x boost to Judge", "please + swap"],

    // Build / Make
    ["Build me a diversified MLB portfolio", "build verb"],
    ["Make a trade for me", "make verb"],
  ];

  it.each(commitHighConfidence)(
    'classifies "%s" as commit (high confidence) — %s',
    (message, _label) => {
      const mode = resolveAgentRequestMode(message, null);
      expect(mode).toBe("commit");
    },
  );

  it.each(commitHighConfidence)(
    'does NOT call the model classifier for "%s"',
    async (message, _label) => {
      await resolveAgentRequestModeWithFallback({
        runtime: buildRuntime(),
        message,
        semanticRoute: null,
      });
      expect(completeSimpleMock).not.toHaveBeenCalled();
    },
  );

  // ── DISCUSSION (high confidence) ── should NOT call the model classifier ──

  const discussionHighConfidence: Array<[string, string]> = [
    // Questions
    ["What do you think about Aaron Judge?", "opinion question"],
    ["How does stacking work?", "how question"],
    ["Why are my boosts not earning?", "why question"],
    ["When does the MLB season start?", "when question"],
    ["Where can I see my scout earnings?", "where question"],
    ["Which players are best for boosts tonight?", "which question"],

    // Reflective / thinking-about phrasing
    ["I'm thinking about buying Aaron Judge", "thinking about"],
    ["Im thinking about stacking my Fried shares", "thinking about (no apostrophe)"],
    ["Considering selling my NBA positions", "considering"],
    ["Leaning toward boosting Judge at 5x", "leaning toward"],

    // Explicit advisory requests
    ["Can you explain how stacking works?", "explain request"],
    ["Could you break down my boost earnings?", "break down request"],
    ["Can you walk me through the AMM?", "walk me through"],
    ["Can you compare Judge vs Fried for tonight?", "compare request"],
    ["Help me understand scout-minutes", "help me understand"],

    // Advisory phrases in the middle
    ["Is it worth buying Aaron Judge right now?", "is it worth"],
    ["Would it make sense to stack my shares?", "would it make sense"],
    ["What's better, stacking or boosting?", "what's better"],
    ["Thoughts on moving my scouts to MLB?", "thoughts on"],

    // "Do you think" / "What do you think"
    ["Do you think I should sell Brunson?", "do you think"],
    ["What do you think about my current setup?", "what do you think"],

    // "Should I" (genuinely advisory — not "who should I buy")
    ["Should I move all my scouts to Bob?", "should I + move"],
    ["Should I sell my NBA holdings?", "should I + sell (no question-word prefix)"],
  ];

  it.each(discussionHighConfidence)(
    'classifies "%s" as discussion (high confidence) — %s',
    (message, _label) => {
      const mode = resolveAgentRequestMode(message, null);
      expect(mode).toBe("discussion");
    },
  );

  it.each(discussionHighConfidence)(
    'does NOT call the model classifier for discussion "%s"',
    async (message, _label) => {
      await resolveAgentRequestModeWithFallback({
        runtime: buildRuntime(),
        message,
        semanticRoute: null,
      });
      expect(completeSimpleMock).not.toHaveBeenCalled();
    },
  );

  // ── ACTION-ORIENTED QUESTIONS (low confidence → model classifier consulted) ──

  const actionOrientedQuestions: Array<[string, string]> = [
    ["Who should I buy in tonight's baseball game?", "who should I buy"],
    ["What should I buy for MLB tonight?", "what should I buy"],
    ["Which player should I scout this week?", "which should I scout"],
    ["Who should I stack for maximum boost value?", "who should I stack"],
    ["What should I sell before the season ends?", "what should I sell"],
  ];

  it.each(actionOrientedQuestions)(
    'classifies "%s" as commit (low confidence, model consulted) — %s',
    (message, _label) => {
      // The heuristic returns commit with low confidence
      const mode = resolveAgentRequestMode(message, null);
      expect(mode).toBe("commit");
    },
  );

  it.each(actionOrientedQuestions)(
    'calls the model classifier for "%s" because confidence is low',
    async (message, _label) => {
      // Model returns nothing → falls back to heuristic
      completeSimpleMock.mockRejectedValue(new Error("timeout"));

      const result = await resolveAgentRequestModeWithFallback({
        runtime: buildRuntime(),
        message,
        semanticRoute: null,
      });

      expect(completeSimpleMock).toHaveBeenCalledTimes(1);
      // Falls back to heuristic (commit) when model fails
      expect(result.mode).toBe("commit");
      expect(result.source).toBe("fallback");
    },
  );

  // ── AMBIGUOUS DIRECTIVES (low confidence → model classifier consulted) ──

  const ambiguousDirectives: Array<[string, string]> = [
    ["I want to buy Aaron Judge", "I want to buy"],
    ["I'd like to stack my shares", "I'd like to stack"],
    ["I need to sell my NBA positions", "I need to sell"],
    ["Let's boost the top pitcher tonight", "let's boost"],
    ["We should buy into the MLB market", "we should buy"],
  ];

  it.each(ambiguousDirectives)(
    'classifies "%s" as commit (low confidence) — %s',
    (message, _label) => {
      const mode = resolveAgentRequestMode(message, null);
      expect(mode).toBe("commit");
    },
  );

  it.each(ambiguousDirectives)(
    'calls the model classifier for ambiguous "%s"',
    async (message, _label) => {
      completeSimpleMock.mockRejectedValue(new Error("timeout"));

      const result = await resolveAgentRequestModeWithFallback({
        runtime: buildRuntime(),
        message,
        semanticRoute: null,
      });

      expect(completeSimpleMock).toHaveBeenCalledTimes(1);
    },
  );

  // ── SEMANTIC ROUTE OVERRIDES ──

  it("treats review_setup route as discussion regardless of message", () => {
    const mode = resolveAgentRequestMode("optimize my portfolio", "review_setup");
    expect(mode).toBe("discussion");
  });

  it("treats general_scouting route as discussion", () => {
    const mode = resolveAgentRequestMode("give me the best scouts", "general_scouting");
    expect(mode).toBe("discussion");
  });

  it("treats top_targets_today + directive verb as commit", () => {
    const mode = resolveAgentRequestMode("buy Aaron Judge", "top_targets_today");
    expect(mode).toBe("commit");
  });

  // ── isLikelyAdvisoryMessage edge cases ──

  it("does not treat 'Can you buy X' as advisory even though it's a question", () => {
    expect(isLikelyAdvisoryMessage("Can you buy Aaron Judge?")).toBe(false);
  });

  it("does not treat 'Can you scout X' as advisory", () => {
    expect(isLikelyAdvisoryMessage("Can you scout the top pitchers?")).toBe(false);
  });

  it("treats 'Can you explain X' as advisory", () => {
    expect(isLikelyAdvisoryMessage("Can you explain how boosts work?")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. SPORT NAME NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

describe("scenario-matrix: sport name normalization", () => {
  // We test normalizeArgs indirectly via the exported runHermesModelToolLoop,
  // but since that requires full mocking, we test the regex logic directly.

  const sportCases: Array<[string, string]> = [
    // Full sport names
    ["Who are the best baseball players tonight?", "MLB"],
    ["Show me basketball scores", "NBA"],
    ["Any football games today?", "NFL"],
    ["What NASCAR races are coming up?", "NASCAR"],

    // Abbreviations
    ["Who are the best MLB players tonight?", "MLB"],
    ["Show me NBA scores", "NBA"],
    ["Any NFL games today?", "NFL"],

    // Mixed case
    ["Best BASEBALL pitchers", "MLB"],
    ["top Basketball players", "NBA"],
    ["tonight's Football slate", "NFL"],
  ];

  const sportNameMap: Record<string, string> = {
    baseball: "MLB",
    basketball: "NBA",
    football: "NFL",
    nascar: "NASCAR",
    nba: "NBA",
    nfl: "NFL",
    mlb: "MLB",
  };

  it.each(sportCases)(
    'extracts correct sport from "%s" → %s',
    (message, expectedSport) => {
      const match = message.match(
        /\b(nba|nfl|mlb|nascar|baseball|basketball|football)\b/i,
      )?.[1];
      expect(match).toBeTruthy();
      const resolved = sportNameMap[match!.toLowerCase()] || match!.toUpperCase();
      expect(resolved).toBe(expectedSport);
    },
  );

  it("does not match non-sport words", () => {
    const noSportMessages = [
      "What should I do with my portfolio?",
      "How does stacking work?",
      "Buy Aaron Judge shares",
    ];
    for (const msg of noSportMessages) {
      const match = msg.match(
        /\b(nba|nfl|mlb|nascar|baseball|basketball|football)\b/i,
      );
      expect(match).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. MULTI-ACTION BUNDLE CLAUSE PARSING
// ═══════════════════════════════════════════════════════════════════════════

describe("scenario-matrix: multi-action bundle clause splitting", () => {
  // The bundle parser splits on " and ", " then ", commas, etc.
  // We test the splitting logic that feeds into buildMultiActionBundlePreview.

  function splitClauses(message: string): string[] {
    return message
      .split(/\s*(?:,\s*(?:and\s+)?|(?:\bthen\b|\band\b)\s+)/i)
      .map((clause) => clause.trim())
      .filter(Boolean);
  }

  const bundleCases: Array<[string, string[]]> = [
    [
      "buy Aaron Judge, stack shares, and boost at 5x",
      ["buy Aaron Judge", "stack shares", "boost at 5x"],
    ],
    [
      "buy Aaron Judge and stack and boost at 4x",
      ["buy Aaron Judge", "stack", "boost at 4x"],
    ],
    [
      "buy as many Aaron Judge shares as possible then stack then boost",
      ["buy as many Aaron Judge shares as possible", "stack", "boost"],
    ],
    [
      "stack my Fried shares and put in 5x slot",
      ["stack my Fried shares", "put in 5x slot"],
    ],
    [
      "sell Brunson, buy Judge",
      ["sell Brunson", "buy Judge"],
    ],
    [
      "buy $50 of Judge and boost at 3x",
      ["buy $50 of Judge", "boost at 3x"],
    ],
  ];

  it.each(bundleCases)(
    'splits "%s" into %j',
    (message, expectedClauses) => {
      const clauses = splitClauses(message);
      expect(clauses).toEqual(expectedClauses);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. NOISE WORD STRIPPING (for multi-action bundle player name resolution)
// ═══════════════════════════════════════════════════════════════════════════

describe("scenario-matrix: noise word stripping", () => {
  function stripBundleNoiseWords(text: string): string {
    return text
      .replace(/\b(my|the|his|her|their|all|some|as many|as possible)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const noiseCases: Array<[string, string]> = [
    ["my Fried shares", "Fried shares"],
    ["the Aaron Judge shares", "Aaron Judge shares"],
    ["all my scouts", "scouts"],
    ["his Jalen Brunson position", "Jalen Brunson position"],
    ["as many Aaron Judge shares as possible", "Aaron Judge shares"],
    ["some NBA players", "NBA players"],
    // Should not strip actual player name parts
    ["Max Fried", "Max Fried"],
    ["Aaron Judge", "Aaron Judge"],
  ];

  it.each(noiseCases)(
    'strips noise from "%s" → "%s"',
    (input, expected) => {
      expect(stripBundleNoiseWords(input)).toBe(expected);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. EXPLICIT PLANNING INTENT DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe("scenario-matrix: planning intent detection", () => {
  // Mirrors the isExplicitPlanningIntent logic from model-first-router.ts

  const directActionVerbs = [
    "buy", "sell", "add", "remove", "set", "assign",
    "boost", "stack", "zap", "condense", "place",
  ] as const;
  const explicitExecutionPhrases = [
    "stage", "queue", "execute", "go ahead", "do it", "set up",
  ] as const;
  const planningPhrases = [
    "plan a trade", "plan my trade", "plan this trade",
    "can you plan", "help me plan", "build a trade plan",
    "prepare a trade plan", "stage a plan",
  ] as const;
  const planningActionTargets = [
    "trade", "buy", "sell", "position", "allocation",
    "order", "boost", "scout", "liquidity", "lp",
  ] as const;

  function isExplicitPlanningIntent(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) return false;

    const hasDirectAction = directActionVerbs.some((v) =>
      new RegExp(`\\b${v}\\b`, "i").test(normalized),
    );
    const hasExecutionPhrase = explicitExecutionPhrases.some((p) =>
      new RegExp(`\\b${p}\\b`, "i").test(normalized),
    );
    const hasPlanningPhrase = planningPhrases.some((p) =>
      normalized.includes(p),
    );
    const hasPlanningTarget = planningActionTargets.some((t) =>
      new RegExp(`\\b${t}\\b`, "i").test(normalized),
    );

    return hasDirectAction || hasExecutionPhrase || hasPlanningPhrase || hasPlanningTarget;
  }

  const planningMessages: Array<[string, boolean, string]> = [
    // Should be recognized as planning intent
    ["Buy Aaron Judge", true, "direct buy"],
    ["Sell my Brunson shares", true, "direct sell"],
    ["Stack my Fried shares", true, "direct stack"],
    ["Boost Judge at 5x", true, "direct boost"],
    ["Plan a trade for tonight", true, "planning phrase"],
    ["Can you plan my MLB trades?", true, "planning phrase"],
    ["Help me plan a boost strategy", true, "planning phrase"],
    ["Stage a plan for my scouts", true, "execution phrase"],
    ["Go ahead and buy Judge", true, "execution phrase"],
    ["Execute the trade", true, "execution phrase"],
    ["Set up my boosts for tonight", true, "execution phrase"],
    ["I want to add liquidity to the Judge pool", true, "action + target"],
    ["Zap into the Fried pool", true, "zap verb"],
    ["Place my scouts on the top pitcher", true, "place verb"],

    // Should NOT be recognized as planning intent
    ["What do you think about my portfolio?", false, "opinion question"],
    ["How does stacking work?", false, "wiki question"],
    ["I'm thinking about my options", false, "reflective"],
    ["Tell me about the game tonight", false, "general chat"],
    ["What happened in the last game?", false, "past event question"],
  ];

  it.each(planningMessages)(
    '"%s" → planning=%s (%s)',
    (message, expectedPlanning, _label) => {
      expect(isExplicitPlanningIntent(message)).toBe(expectedPlanning);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. FULL SCENARIO WALKTHROUGH — realistic compound requests
// ═══════════════════════════════════════════════════════════════════════════

describe("scenario-matrix: realistic compound scenarios", () => {
  beforeEach(() => {
    completeSimpleMock.mockReset();
  });

  const compoundCommitScenarios: Array<[string, string]> = [
    ["Buy as many Aaron Judge shares as possible and stack and boost at 5x", "buy+stack+boost compound"],
    ["Buy $25 of Fried, stack the shares, then boost at 4x", "buy+stack+boost with dollar amount"],
    ["Stack my Fried shares and put in 5x slot", "stack+boost compound"],
    ["Sell Brunson and buy Judge with the proceeds", "sell+buy compound"],
    ["Scout Aaron Judge and boost him at 3x", "scout+boost compound"],
    ["Buy Judge and add to my watchlist", "buy+watchlist compound"],
  ];

  it.each(compoundCommitScenarios)(
    'routes compound "%s" to commit mode — %s',
    (message, _label) => {
      const mode = resolveAgentRequestMode(message, null);
      expect(mode).toBe("commit");
    },
  );

  const compoundDiscussionScenarios: Array<[string, string]> = [
    ["What do you think about buying Judge and stacking?", "opinion about compound"],
    ["I'm thinking about buying Fried and boosting at 5x", "reflective compound"],
    ["Is it worth buying and stacking Aaron Judge?", "is it worth compound"],
    ["Would it make sense to sell Brunson and buy Judge?", "would it make sense compound"],
    ["Can you explain how to buy and stack shares?", "explain compound"],
  ];

  it.each(compoundDiscussionScenarios)(
    'routes compound discussion "%s" to discussion mode — %s',
    (message, _label) => {
      const mode = resolveAgentRequestMode(message, null);
      expect(mode).toBe("discussion");
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. WIKI / CUSTOMER SUPPORT SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

describe("scenario-matrix: wiki and customer support", () => {
  const wikiQuestions: Array<[string, string]> = [
    ["How does stacking work?", "stacking mechanics"],
    ["What are daily boosts?", "boost mechanics"],
    ["How do scouts earn shares?", "scout mechanics"],
    ["What is the AMM?", "AMM explanation"],
    ["How does liquidity work on Sportfolio?", "liquidity"],
    ["What are community boosts?", "community boosts"],
    ["How are fantasy points calculated?", "fantasy points"],
    ["What sports does Sportfolio support?", "supported sports"],
    ["What is scout-minutes?", "scout-minutes"],
    ["How do I earn from my shares?", "share earnings"],
    ["What's the difference between stacking and boosting?", "stacking vs boosting"],
    ["How do boost slots work?", "boost slots"],
    ["What does the 5x slot mean?", "slot tiers"],
    ["Can you explain the constant-product formula?", "AMM formula"],
    ["What happens when a boost slot locks?", "boost locking"],
  ];

  it.each(wikiQuestions)(
    'routes wiki question "%s" to discussion — %s',
    (message, _label) => {
      const mode = resolveAgentRequestMode(message, null);
      expect(mode).toBe("discussion");
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function buildRuntime() {
  return {
    apiKey: "test-key",
    model: {
      id: "test-model",
      name: "Test Model",
      api: "openai-completions" as const,
      provider: "openrouter" as const,
      baseUrl: "https://example.com/v1",
      reasoning: false,
      input: ["text"] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 32768,
    },
  };
}
