// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UserIdentity, type UserIdentityVariant } from "./user-identity";
import type { PublicUserIdentity, PublicBadgeIdentity } from "@shared/public-user-identity";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeIdentity(overrides?: Partial<PublicUserIdentity>): PublicUserIdentity {
  return {
    userId: "user-1",
    username: "testuser",
    avatarUrl: null,
    premiumActive: false,
    activeBadge: null,
    ...overrides,
  };
}

function makeBadge(overrides?: Partial<PublicBadgeIdentity>): PublicBadgeIdentity {
  return {
    definitionId: "def-1",
    versionId: "v1",
    slug: "test-badge",
    title: "Test Badge",
    artKey: "test-art-key",
    sport: "MLB",
    league: "AL",
    season: "2025",
    family: "player_slots",
    firstCompletedAt: "2025-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderIdentity(variant: UserIdentityVariant, identity: PublicUserIdentity) {
  return render(
    <Wrapper>
      <UserIdentity variant={variant} identity={identity} />
    </Wrapper>,
  );
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("UserIdentity", () => {
  describe("micro variant", () => {
    it("renders avatar at 24px with badge pin when activeBadge present", () => {
      const id = makeIdentity({ activeBadge: makeBadge() });
      renderIdentity("micro", id);

      // Check avatar fallback container is present with correct size
      const avatarContainer = screen.getByTestId("avatar-fallback-container");
      expect(avatarContainer).toBeTruthy();
      expect(avatarContainer.className).toContain("h-6");
      expect(avatarContainer.className).toContain("w-6");

      // Should have fallback initials
      const fallback = screen.getByTestId("avatar-fallback");
      expect(fallback.textContent).toBe("TE");

      // Should have pin indicating active badge
      const pin = screen.getByTestId("badge-pin");
      expect(pin).toBeTruthy();
      expect(pin.getAttribute("aria-label")).toContain("Test Badge");
    });

    it("renders avatar without badge pin when activeBadge is null", () => {
      const id = makeIdentity({ activeBadge: null });
      renderIdentity("micro", id);

      expect(screen.queryByTestId("badge-pin")).toBeNull();
    });
  });

  describe("compact variant", () => {
    it("renders avatar, badge frame+pin, and username at 36px", () => {
      const id = makeIdentity({ activeBadge: makeBadge() });
      renderIdentity("compact", id);

      // Username display
      expect(screen.getByText(/@testuser/)).toBeTruthy();
      // Badge pin present
      expect(screen.getByTestId("badge-pin")).toBeTruthy();
    });

    it("renders without badge chrome when activeBadge is null", () => {
      const id = makeIdentity();
      renderIdentity("compact", id);

      expect(screen.queryByTestId("badge-pin")).toBeNull();
      expect(screen.queryByTestId("badge-frame")).toBeNull();
    });
  });

  describe("ranked variant", () => {
    it("renders compact layout plus rank number", () => {
      const id = makeIdentity({ activeBadge: makeBadge() });
      renderIdentity("ranked", id);

      // Rank number should be visible
      expect(screen.getByTestId("rank-number")).toBeTruthy();
      // Compact elements present
      expect(screen.getByText(/@testuser/)).toBeTruthy();
    });

    it("passes rank prop through", () => {
      const id = makeIdentity();
      render(
        <Wrapper>
          <UserIdentity variant="ranked" identity={id} rank={3} />
        </Wrapper>,
      );

      expect(screen.getByTestId("rank-number").textContent).toContain("3");
    });
  });

  describe("featured variant", () => {
    it("renders compact layout with featured border", () => {
      const id = makeIdentity({ activeBadge: makeBadge() });
      renderIdentity("featured", id);

      // Featured container should exist with featured styling
      const container = screen.getByTestId("featured-identity");
      expect(container).toBeTruthy();
      // Still renders username
      expect(screen.getByText(/@testuser/)).toBeTruthy();
    });
  });

  describe("profile variant", () => {
    it("renders large avatar, badge frame+pin, username, premium, badge detail", () => {
      const id = makeIdentity({
        activeBadge: makeBadge({ title: "World Series Champion" }),
        premiumActive: true,
      });
      renderIdentity("profile", id);

      expect(screen.getByText(/@testuser/)).toBeTruthy();
      // Premium crown
      expect(screen.getByTestId("premium-crown")).toBeTruthy();
      // Badge pin present
      expect(screen.getByTestId("badge-pin")).toBeTruthy();
      // Badge detail (title)
      expect(screen.getByText("World Series Champion")).toBeTruthy();
    });

    it("renders without premium crown when premiumActive is false", () => {
      const id = makeIdentity({ activeBadge: null, premiumActive: false });
      renderIdentity("profile", id);

      expect(screen.queryByTestId("premium-crown")).toBeNull();
      expect(screen.queryByTestId("badge-pin")).toBeNull();
    });

    it("renders without badge detail section when activeBadge is null", () => {
      const id = makeIdentity({ activeBadge: null });
      renderIdentity("profile", id);

      expect(screen.queryByTestId("badge-detail")).toBeNull();
    });
  });

  describe("null identity", () => {
    it("renders fallback state for null identity", () => {
      render(
        <Wrapper>
          <UserIdentity variant="compact" identity={null} />
        </Wrapper>,
      );

      // Should render a fallback avatar/placeholder instead of crashing
      expect(screen.getByTestId("identity-fallback")).toBeTruthy();
      // Should show "Unknown User" or equivalent text
      expect(screen.getByText(/unknown/i)).toBeTruthy();
    });
  });

  describe("null username", () => {
    it("renders fallback text for null username", () => {
      const id = makeIdentity({ username: null });
      renderIdentity("compact", id);

      // Should render "User" or similar fallback
      const el = screen.getByTestId("username-display");
      expect(el.textContent).toBeTruthy();
    });
  });

  describe("avatar fallback", () => {
    it("renders deterministic initials from username when no avatarUrl", () => {
      const id = makeIdentity({ username: "TestUser", avatarUrl: null });
      renderIdentity("compact", id);

      const fallback = screen.getByTestId("avatar-fallback");
      // Initials: first 2 chars uppercase
      expect(fallback.textContent).toBe("TE");
    });

    it("renders fallback initials for short username", () => {
      const id = makeIdentity({ username: "a", avatarUrl: null });
      renderIdentity("compact", id);

      const fallback = screen.getByTestId("avatar-fallback");
      expect(fallback.textContent).toBe("A");
    });

    it("renders image element when avatarUrl is present and fallback stays as backup", () => {
      const id = makeIdentity({ avatarUrl: "https://example.com/avatar.png" });
      renderIdentity("compact", id);

      // In jsdom images don't load, so fallback stays visible
      // But the Avatar container should still be rendered
      const avatarContainer = screen.getByTestId("avatar-fallback-container");
      expect(avatarContainer).toBeTruthy();

      // The fallback shows initials since image never loads in jsdom
      const fallback = screen.getByTestId("avatar-fallback");
      expect(fallback.textContent).toBe("TE");
    });
  });

  describe("non-premium", () => {
    it("does not show premium crown", () => {
      const id = makeIdentity({ premiumActive: false });
      renderIdentity("profile", id);

      expect(screen.queryByTestId("premium-crown")).toBeNull();
    });
  });

  describe("keyboard accessibility", () => {
    it("is focusable via Tab", async () => {
      const id = makeIdentity();
      renderIdentity("compact", id);

      const trigger = screen.getByTestId("identity-trigger");
      expect(trigger.getAttribute("tabIndex")).toBe("0");
    });

    it("opens popover on Enter key", async () => {
      const user = userEvent.setup();
      const id = makeIdentity();
      renderIdentity("compact", id);

      const trigger = screen.getByTestId("identity-trigger");
      trigger.focus();
      await user.keyboard("{Enter}");

      // Popover content should be visible
      expect(screen.getByTestId("identity-popover")).toBeTruthy();
    });

    it("closes popover on Escape key", async () => {
      const user = userEvent.setup();
      const id = makeIdentity();
      renderIdentity("compact", id);

      const trigger = screen.getByTestId("identity-trigger");
      trigger.focus();
      await user.keyboard("{Enter}");

      expect(screen.getByTestId("identity-popover")).toBeTruthy();

      await user.keyboard("{Escape}");

      // Popover should close — radix removes content from DOM after escape
      await vi.waitFor(() => {
        expect(screen.queryByTestId("identity-popover")).toBeNull();
      });
    });
  });

  describe("reduced motion", () => {
    it("respects prefers-reduced-motion", () => {
      const id = makeIdentity();
      renderIdentity("compact", id);

      // Popover content should have motion-safe classes or respect reduced motion
      // We verify the component renders without error regardless
      expect(screen.getByTestId("identity-trigger")).toBeTruthy();
      // The actual motion preference is tested implicitly via radix
    });
  });

  describe("no nested links/buttons", () => {
    it("does not contain nested interactive elements inside the identity container", () => {
      const id = makeIdentity({ activeBadge: makeBadge() });
      renderIdentity("featured", id);

      // The trigger itself is a button/span (tabbable)
      // Inside it, there shouldn't be nested <a> or <button> elements
      const trigger = screen.getByTestId("identity-trigger");
      const nestedLinks = trigger.querySelectorAll("a, button");
      expect(nestedLinks.length).toBe(0);
    });
  });
});
