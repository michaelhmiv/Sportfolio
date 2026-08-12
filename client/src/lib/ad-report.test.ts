import { beforeEach, describe, expect, it } from "vitest";
import {
  buildAdReportMailto,
  LAST_REWARDED_AD_REPORT_CONTEXT_KEY,
  readRewardedAdReportContext,
  rememberRewardedAdReportContext,
} from "./ad-report";

describe("ad reporting helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores and reads the latest rewarded-ad diagnostic context", () => {
    rememberRewardedAdReportContext({
      platform: "ios",
      shownAt: "2026-08-11T12:00:00.000Z",
      adResponseId: "response-123",
      mediationAdapterClassName: "ExampleAdapter",
    });

    expect(readRewardedAdReportContext()).toEqual({
      platform: "ios",
      shownAt: "2026-08-11T12:00:00.000Z",
      adResponseId: "response-123",
      mediationAdapterClassName: "ExampleAdapter",
    });
  });

  it("ignores malformed stored context", () => {
    window.localStorage.setItem(LAST_REWARDED_AD_REPORT_CONTEXT_KEY, "not-json");
    expect(readRewardedAdReportContext()).toBeNull();
  });

  it("builds a report mailto that identifies age-inappropriate ads and includes diagnostic context", () => {
    const mailto = buildAdReportMailto("support@example.com", {
      platform: "ios",
      shownAt: "2026-08-11T12:00:00.000Z",
      adResponseId: "response-123",
      mediationAdapterClassName: "ExampleAdapter",
    });

    expect(mailto).toContain("mailto:support@example.com");
    expect(decodeURIComponent(mailto)).toContain("inappropriate or age-inappropriate ad");
    expect(decodeURIComponent(mailto)).toContain("Ad response ID: response-123");
    expect(decodeURIComponent(mailto)).toContain("Ad network adapter: ExampleAdapter");
  });
});
