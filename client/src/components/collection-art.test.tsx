// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CollectionArt } from "./collection-art";

describe("CollectionArt", () => {
  it("renders with artKey and produces a deterministic visual (not raw artKey text)", () => {
    render(<CollectionArt artKey="mlb-all-star-2025" />);

    // Should render something — a visual element, not the raw artKey string
    const el = screen.getByTestId("collection-art");
    expect(el).toBeTruthy();
    // Does NOT render the raw artKey string as text content
    expect(el.textContent).not.toBe("mlb-all-star-2025");
  });

  it("renders sport abbreviation for a standard artKey", () => {
    render(<CollectionArt artKey="mlb-something" />);

    const el = screen.getByTestId("collection-art");
    // Should generate sport abbreviation (first 3 chars uppercase from artKey prefix)
    expect(el.textContent).toContain("MLB");
  });

  it("renders sport abbreviation for NBA artKey", () => {
    render(<CollectionArt artKey="nba-finals-2025" />);

    const el = screen.getByTestId("collection-art");
    expect(el.textContent).toContain("NBA");
  });

  it("renders sport abbreviation for NFL artKey", () => {
    render(<CollectionArt artKey="nfl-superbowl-2025" />);

    const el = screen.getByTestId("collection-art");
    expect(el.textContent).toContain("NFL");
  });

  it("renders sport abbreviation for NHL artKey", () => {
    render(<CollectionArt artKey="nhl-stanley-cup-2025" />);

    const el = screen.getByTestId("collection-art");
    expect(el.textContent).toContain("NHL");
  });

  it("uses custom size prop", () => {
    render(<CollectionArt artKey="mlb-test" size="lg" />);

    const el = screen.getByTestId("collection-art");
    expect(el).toBeTruthy();
  });

  it("supports a sport prop override for direct sport specification", () => {
    render(<CollectionArt artKey="anything" sport="SOCCER" />);

    const el = screen.getByTestId("collection-art");
    // Uses the explicit sport prop
    expect(el.textContent).toContain("SOC");
  });

  it("marks as premium/badge when isBadge is true", () => {
    render(<CollectionArt artKey="mlb-badge" isBadge={true} />);

    const el = screen.getByTestId("collection-art");
    expect(el).toBeTruthy();
  });

  it("renders fallback for empty artKey", () => {
    render(<CollectionArt artKey="" />);

    const el = screen.getByTestId("collection-art");
    expect(el).toBeTruthy();
  });

  it("is hidden from screen readers (decorative)", () => {
    render(<CollectionArt artKey="mlb-test" />);

    const el = screen.getByTestId("collection-art");
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });
});
