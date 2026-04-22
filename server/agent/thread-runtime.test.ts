import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgentToolCatalog: vi.fn(() => [
    {
      toolName: "get_balance_state",
      category: "read",
      description: "Read the user balance state.",
      whenToUse: [],
      whenNotToUse: [],
      examplePrompts: ["How much balance do I have?"],
      requiresConfirmation: false,
      riskLevel: "low",
    },
    {
      toolName: "upsert_user_schedule",
      category: "action",
      description: "Create or update a user schedule.",
      whenToUse: [],
      whenNotToUse: [],
      examplePrompts: ["Set up a daily review schedule."],
      requiresConfirmation: false,
      riskLevel: "low",
      exposure: "advanced",
    },
    {
      toolName: "internal_diagnostic",
      category: "read",
      description: "Internal-only diagnostic.",
      whenToUse: [],
      whenNotToUse: [],
      examplePrompts: [],
      requiresConfirmation: false,
      riskLevel: "low",
      exposure: "internal_only",
    },
  ]),
  listAgentScheduleTemplates: vi.fn(() => [
    {
      jobType: "daily_setup_review",
      title: "Daily Setup Review",
      description: "Review the current setup.",
      defaultCron: "0 8 * * *",
      defaultChannels: ["in_app"],
    },
  ]),
  listUserAgentSchedules: vi.fn(),
  getAgentThread: vi.fn(),
  listAgentThreadMessages: vi.fn(),
  listAgentThreadResearchSources: vi.fn(),
  buildAgentContinuityState: vi.fn(),
}));

vi.mock("./hermes-tools", () => ({
  getAgentToolCatalog: mocks.getAgentToolCatalog,
}));

vi.mock("./schedules", () => ({
  listAgentScheduleTemplates: mocks.listAgentScheduleTemplates,
  listUserAgentSchedules: mocks.listUserAgentSchedules,
}));

vi.mock("./thread-service", () => ({
  getAgentThread: mocks.getAgentThread,
  listAgentThreadMessages: mocks.listAgentThreadMessages,
  listAgentThreadResearchSources: mocks.listAgentThreadResearchSources,
}));

vi.mock("./continuity-state", () => ({
  buildAgentContinuityState: mocks.buildAgentContinuityState,
}));

import { getAgentThreadRuntimeDetails } from "./thread-runtime";

describe("thread-runtime", () => {
  beforeEach(() => {
    mocks.listUserAgentSchedules.mockReset();
    mocks.getAgentThread.mockReset();
    mocks.listAgentThreadMessages.mockReset();
    mocks.listAgentThreadResearchSources.mockReset();
    mocks.buildAgentContinuityState.mockReset();
    mocks.buildAgentContinuityState.mockResolvedValue({
      headline: "Hermes has operator work waiting on you.",
      summary:
        "Hermes should reason from ongoing operator state: 1 active strategy context, 1 waiting item, 1 scheduled follow-up.",
      recentActions: [],
      openLoops: [],
      activeStrategies: [],
      evidenceUpdates: [],
    });
  });

  it("builds proactive cockpit state from the real thread timeline and safe tool catalog", async () => {
    mocks.getAgentThread.mockResolvedValue({
      id: "thread_1",
      title: "Hermes Desk",
      channel: "in_app",
      domain: "general",
      status: "active",
      lastMessageAt: new Date("2026-03-16T14:45:00.000Z"),
      updatedAt: new Date("2026-03-16T14:45:00.000Z"),
      createdAt: new Date("2026-03-16T14:00:00.000Z"),
      lastMessagePreview: "Plan is ready.",
      pendingActionBundle: {
        id: "bundle_1",
        status: "pending_confirmation",
        domain: "trading",
        summary: "Deploy idle balance into tonight's slate",
        warnings: ["Requires explicit confirmation."],
        actions: [],
        workflowType: "single_action",
        steps: [],
        pendingClarification: null,
        runId: "run_2",
        createdAt: new Date("2026-03-16T14:45:00.000Z"),
        confirmedAt: null,
        appliedAt: null,
      },
    });
    mocks.listAgentThreadMessages.mockResolvedValue([
      {
        id: "msg_user",
        role: "user",
        messageType: "message",
        contentText: "Keep working this balance into tonight's slate while I'm away.",
        createdAt: new Date("2026-03-16T14:00:00.000Z"),
        runId: null,
        actionBundle: null,
      },
      {
        id: "msg_schedule",
        role: "assistant",
        messageType: "message",
        contentText: "I rechecked the setup and your idle balance is still available.",
        createdAt: new Date("2026-03-16T14:30:00.000Z"),
        runId: "run_1",
        actionBundle: null,
        citations: [],
        toolTrace: [
          {
            toolName: "get_balance_state",
            phase: "read",
            status: "ok",
            latencyMs: 32,
            summary: "Loaded idle balance state.",
            details: null,
          },
        ],
        skillsUsed: [],
        memoryInfluences: ["User prefers concise setup reviews."],
        confirmationPreview: null,
        generatedBy: "hermes_schedule",
        scheduleJobType: "daily_setup_review",
      },
      {
        id: "msg_plan",
        role: "assistant",
        messageType: "plan",
        contentText: "I staged a measured deployment into tonight's slate.",
        createdAt: new Date("2026-03-16T14:45:00.000Z"),
        runId: "run_2",
        actionBundle: {
          id: "bundle_1",
          status: "pending_confirmation",
          domain: "trading",
          summary: "Deploy idle balance into tonight's slate",
          warnings: ["Requires explicit confirmation."],
          actions: [],
          workflowType: "single_action",
          steps: [],
          pendingClarification: null,
          runId: "run_2",
          createdAt: new Date("2026-03-16T14:45:00.000Z"),
          confirmedAt: null,
          appliedAt: null,
        },
        citations: [
          {
            id: "citation_1",
            title: "Slate Outlook",
            sourceName: "Internal Research",
            url: "https://example.com/report",
            publishedAt: "2026-03-16T14:20:00.000Z",
            retrievedAt: new Date("2026-03-16T14:21:00.000Z"),
            factSummary: "Tonight's slate remains open.",
            relevanceScore: 0.9,
          },
        ],
        toolTrace: [
          {
            toolName: "preview_direct_operation",
            phase: "plan",
            status: "ok",
            latencyMs: 51,
            summary: "Built a staged trade plan.",
            details: null,
          },
        ],
        skillsUsed: ["idle_balance_review"],
        memoryInfluences: ["User wants proactive check-ins."],
        confirmationPreview: {
          actionSummary: "Buy measured exposure into tonight's slate.",
          beforeState: { availableBalance: 120 },
          afterState: { availableBalance: 80 },
          estimatedImpact: "Deploys part of the idle balance.",
          warnings: ["Requires explicit confirmation."],
          riskClass: "medium",
        },
        generatedBy: "assistant",
        scheduleJobType: null,
      },
    ]);
    mocks.listAgentThreadResearchSources.mockResolvedValue([
      {
        id: "source_1",
        threadId: "thread_1",
        sourceName: "Internal Research",
        title: "Slate Outlook",
        url: "https://example.com/report",
        publishedAt: new Date("2026-03-16T14:20:00.000Z"),
        retrievedAt: new Date("2026-03-16T14:21:00.000Z"),
        factSummary: "Tonight's slate remains open.",
        relevanceScore: 0.9,
      },
    ]);
    mocks.listUserAgentSchedules.mockResolvedValue([
      {
        id: "schedule_1",
        jobType: "daily_setup_review",
        enabled: true,
        scheduleCron: "0 8 * * *",
        channelTargets: ["in_app"],
        nextRunAt: new Date("2026-03-17T12:00:00.000Z"),
        lastRunAt: new Date("2026-03-16T14:30:00.000Z"),
        policy: { source: "user_update" },
        template: {
          jobType: "daily_setup_review",
          title: "Daily Setup Review",
          description: "Review the current setup.",
          defaultCron: "0 8 * * *",
          defaultChannels: ["in_app"],
        },
      },
    ]);

    const details = await getAgentThreadRuntimeDetails("user_1", "thread_1");

    expect(details.activeObjective).toMatchObject({
      title: "Deploy idle balance into tonight's slate",
      status: "waiting_on_you",
      source: "pending_bundle",
    });
    expect(details.sinceLastUserMessage).toMatchObject({
      eventCount: 2,
    });
    expect(details.sinceLastUserMessage?.items.map((item) => item.type)).toEqual([
      "plan_staged",
      "scheduled_advisory",
    ]);
    expect(details.timeline[0]).toMatchObject({
      type: "plan_staged",
      status: "waiting_on_you",
    });
    expect(details.timeline[1]).toMatchObject({
      type: "scheduled_advisory",
      title: "Daily Setup Review",
    });
    expect(details.researchSources).toHaveLength(1);
    expect(details.schedules).toHaveLength(1);
    expect(details.continuity).toMatchObject({
      headline: "Hermes has operator work waiting on you.",
    });
    expect(details.capabilityGroups.map((group) => group.key)).toEqual(["read"]);
    expect(
      details.capabilityGroups.flatMap((group) => group.tools).map((tool) => tool.toolName),
    ).toEqual(["get_balance_state"]);
    expect(details.isolation).toEqual({
      gameplayOnly: true,
      codebaseAccess: false,
      arbitraryDatabaseAccess: false,
      genericFileAccess: false,
      adminAccess: false,
      riskyMutationsRequireConfirmation: true,
    });
  });
});
