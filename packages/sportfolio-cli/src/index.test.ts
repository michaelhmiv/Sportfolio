import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const failMock = vi.fn();
const printJsonMock = vi.fn();
const printListMock = vi.fn();

vi.mock("./output.mjs", () => ({
  fail: failMock,
  printJson: printJsonMock,
  printList: printListMock,
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
});
