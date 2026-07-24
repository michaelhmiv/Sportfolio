// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectionCeremonyOverlay } from "./collection-ceremony-overlay";

vi.mock("framer-motion", () => ({
  useReducedMotion: () => true,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p {...props}>{children}</p>
    ),
  },
}));

describe("CollectionCeremonyOverlay", () => {
  afterEach(() => vi.useRealTimers());

  it("offers an explicit path to manage the earned trophy", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <CollectionCeremonyOverlay
        isOpen
        data={{
          title: "2025 Home Run Leaders",
          artKey: "mlb-home-runs",
          sport: "MLB",
          family: "season_leaders",
          kind: "player_slots",
        }}
        showcaseHref="/user/u1"
        onClose={onClose}
      />,
    );

    expect(screen.queryByRole("link", { name: "Manage Trophy Case" })).toBeNull();
    act(() => vi.advanceTimersByTime(0));
    const link = screen.getByRole("link", { name: "Manage Trophy Case" });
    expect(link.getAttribute("href")).toBe("/user/u1");
    act(() => vi.advanceTimersByTime(5000));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the original automatic close without a showcase action", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <CollectionCeremonyOverlay
        isOpen
        data={{
          title: "2025 Home Run Leaders",
          artKey: "mlb-home-runs",
          sport: "MLB",
          family: "season_leaders",
          kind: "player_slots",
        }}
        onClose={onClose}
      />,
    );

    act(() => vi.advanceTimersByTime(4000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the accessible dialog escape behavior", async () => {
    const onClose = vi.fn();
    render(
      <CollectionCeremonyOverlay
        isOpen
        data={{
          title: "2025 Home Run Leaders",
          artKey: "mlb-home-runs",
          sport: "MLB",
          family: "season_leaders",
          kind: "player_slots",
        }}
        showcaseHref="/user/u1"
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
