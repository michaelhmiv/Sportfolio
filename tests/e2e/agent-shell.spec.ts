import { test, expect, type Page, type Route, devices } from "@playwright/test";

async function mockAgentShell(page: Page) {
  const now = "2026-03-07T12:00:00.000Z";
  const threads = [
    {
      id: "thread_existing",
      title: "Existing Thread",
      channel: "in_app",
      domain: "portfolio",
      status: "ready",
      lastMessageAt: now,
      updatedAt: now,
      createdAt: now,
      lastMessagePreview: "Review my setup for today.",
      pendingActionBundle: null,
    },
  ];
  const messagesByThread: Record<string, unknown[]> = {
    thread_existing: [
      {
        id: "msg_existing",
        role: "assistant",
        messageType: "chat",
        contentText: "Your setup is balanced, but you still have idle cash.",
        createdAt: now,
        runId: null,
        actionBundle: null,
        citations: null,
        pendingClarification: null,
      },
    ],
  };
  let createdCount = 0;

  const fulfillAuthUser = async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user_agent_shell",
        email: "agent-shell@example.com",
        username: "agent-shell",
        hasSeenOnboarding: true,
        isPremium: false,
      }),
    });
  };

  await page.route("**/api/auth/user?sync=true", fulfillAuthUser);
  await page.route("**/api/auth/user", fulfillAuthUser);
  await page.route("**/api/auth/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "http://127.0.0.1:5000/mock-supabase",
        anonKey: "agent-shell-e2e",
        configVersion: "agent-shell-e2e",
      }),
    });
  });
  await page.route("**/mock-supabase/auth/v1/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: null,
        session: null,
      }),
    });
  });

  await page.route("**/api/agent/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: {
          enabled: true,
          providerMode: "managed",
          userPromptTemplate: "",
          defaultSport: "ALL",
          baseUrl: null,
          model: "gpt-test",
        },
        capabilities: {
          canAnalyze: true,
          canUseWebResearch: true,
          webResearchProvider: "brave",
        },
      }),
    });
  });

  await page.route("**/api/agent/threads", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(threads),
      });
      return;
    }

    createdCount += 1;
    const newThread = {
      id: `thread_new_${createdCount}`,
      title: null,
      channel: "in_app",
      domain: "portfolio",
      status: "ready",
      lastMessageAt: null,
      updatedAt: "2026-03-07T13:00:00.000Z",
      createdAt: "2026-03-07T13:00:00.000Z",
      lastMessagePreview: null,
      pendingActionBundle: null,
    };
    threads.unshift(newThread);
    messagesByThread[newThread.id] = [];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(newThread),
    });
  });

  await page.route(/.*\/api\/agent\/threads\/[^/]+\/messages$/, async (route) => {
    const match = route
      .request()
      .url()
      .match(/\/api\/agent\/threads\/([^/]+)\/messages$/);
    const threadId = match?.[1];

    if (!threadId) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(messagesByThread[threadId] || []),
    });
  });
}

test("desktop shows the persistent conversation rail", async ({ page }) => {
  await mockAgentShell(page);

  await page.goto("/agent", { waitUntil: "domcontentloaded" });

  await expect(
    page.locator("aside").getByText("Conversation History", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^new chat$/i })).toBeVisible();
});

test("starting a fresh chat from history closes the drawer and keeps the new chat selected on mobile", async ({
  browser,
}) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: "http://127.0.0.1:5000",
  });
  const page = await context.newPage();

  await mockAgentShell(page);

  await page.goto("/agent", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: /open conversation history/i }).click();
  const historyDialog = page.getByRole("dialog");
  await expect(historyDialog.getByText("Conversation History", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /start fresh chat/i }).click();

  await expect(historyDialog).not.toBeVisible();
  await expect(page.getByTestId("agent-thread-title")).toHaveText("New Chat");

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("agent-thread-title")).toHaveText("New Chat");
  await context.close();
});
