// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/notification-settings-card", () => ({
  NotificationSettingsCard: () => <section>Notification settings</section>,
}));
vi.mock("@/components/mobile-push-card", () => ({
  MobilePushCard: () => <section>Mobile push settings</section>,
}));
vi.mock("@/components/cli-access-card", () => ({
  CliAccessCard: () => <section>CLI access settings</section>,
}));

import AccountSettings from "./account-settings";

describe("AccountSettings", () => {
  it("preserves all owner account-management surfaces", () => {
    render(<AccountSettings />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeDefined();
    expect(screen.getByText("Notification settings")).toBeDefined();
    expect(screen.getByText("Mobile push settings")).toBeDefined();
    expect(screen.getByText("CLI access settings")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Connected applications" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Delete account" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Review deletion" }).getAttribute("href")).toBe(
      "/account-deletion",
    );
  });
});
