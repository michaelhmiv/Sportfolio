import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const failMock = vi.fn();
const printJsonMock = vi.fn();
const printListMock = vi.fn();
const loadConfigMock = vi.fn(() => ({
  token: "test-token",
  baseUrl: "https://example.com",
}));
const requestJsonMock = vi.fn();

vi.mock("./output.mjs", () => ({
  fail: failMock,
  printJson: printJsonMock,
  printList: printListMock,
}));

vi.mock("./config.mjs", () => ({
  clearConfig: vi.fn(),
  getConfigPath: vi.fn(() => "/tmp/sportfolio.json"),
  loadConfig: loadConfigMock,
  normalizeBaseUrl: vi.fn((value) => value || "https://example.com"),
  saveConfig: vi.fn(),
}));

vi.mock("./http.mjs", () => ({
  requestJson: requestJsonMock,
}));

describe("sportfolio cli help routing", () => {
  let runCli: (rawArgs: string[]) => Promise<void>;

  beforeAll(async () => {
    ({ runCli } = await import("./index.mjs"));
  });

  beforeEach(() => {
    failMock.mockReset();
    printJsonMock.mockReset();
    printListMock.mockReset();
    loadConfigMock.mockClear();
    requestJsonMock.mockReset();
  });

  it("routes unknown command help through fail", async () => {
    await runCli(["foo", "--help"]);

    expect(failMock).toHaveBeenCalledWith("Unknown command 'foo'. Run `sportfolio --help`.", 1);
    expect(printListMock).not.toHaveBeenCalled();
  });

  it("prints help for supported commands without failing", async () => {
    await runCli(["auth", "--help"]);

    expect(printListMock).toHaveBeenCalledOnce();
    expect(failMock).not.toHaveBeenCalled();
  });

  it("renders portfolio summary with the dedicated human-readable formatter", async () => {
    requestJsonMock.mockResolvedValue({
      summary: "Loaded portfolio summary.",
      operatorOverview: {
        availableBalance: 314.96,
        portfolioPlayerCount: 2,
        topHoldings: [
          {
            name: "Jalen Brunson",
            shares: 4,
            multiplier: 2,
            availableShares: 3,
          },
        ],
      },
      selectionWindow: null,
      recommendedTargets: [],
    });

    await runCli(["portfolio", "summary"]);

    expect(requestJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/cli/tools/get_portfolio_summary",
        method: "POST",
        token: "test-token",
      }),
    );
    expect(printListMock).toHaveBeenCalledWith([
      "Balance: $314.96",
      "Tracked holdings: 2",
      "",
      "Top holdings:",
      "- Jalen Brunson: shares 4, multiplier 2, available 3",
    ]);
    expect(failMock).not.toHaveBeenCalled();
  });
});
