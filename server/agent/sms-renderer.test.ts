import { describe, expect, it } from "vitest";
import { renderGuestSmsConciergeReply, renderUnknownSmsOnboardingReply } from "./sms-renderer";

describe("sms-renderer", () => {
  it("renders a conversational guest concierge reply with the matched topic", () => {
    const text = renderGuestSmsConciergeReply({
      linkUrl: "https://www.sportfolio.market/sms/link?token=abc",
      messageText: "How do boosts work?",
      matchedTopicTitle: "Power and Boosts",
      matchedTopicNote: "Daily boosts consume exactly one eligible share per slot.",
    });

    expect(text).toContain("I can talk that through with you.");
    expect(text).toContain("Power and Boosts");
    expect(text).toContain("link your account here");
  });

  it("keeps the default onboarding copy conversational", () => {
    const text = renderUnknownSmsOnboardingReply(
      "https://www.sportfolio.market/sms/link?token=abc",
    );

    expect(text).toContain("You can talk to me like your Sportfolio desk");
    expect(text).toContain("link your account here");
  });
});
