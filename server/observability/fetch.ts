import { observeExternalHttpRequest } from "./metrics";

export async function instrumentedFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const start = process.hrtime.bigint();

  let host = "unknown";
  try {
    if (typeof input === "string") {
      host = new URL(input).host;
    } else if (input instanceof URL) {
      host = input.host;
    } else {
      host = new URL(input.url).host;
    }
  } catch {
    // ignore
  }

  try {
    const res = await fetch(input as any, init);
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    observeExternalHttpRequest({ host, status: String(res.status), durationMs });
    return res;
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    observeExternalHttpRequest({ host, status: "error", durationMs });
    throw err;
  }
}
