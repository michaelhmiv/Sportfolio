// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerAvatar } from "./player-avatar";

describe("Sportfolio player avatar", () => {
  it("uses initials when no image is supplied", () => {
    render(<PlayerAvatar player={{ displayName: "MacKenzie Gore" }} />);

    expect(screen.getByText("MG")).toBeTruthy();
  });

  it("falls back to initials when a remote image cannot load", () => {
    const { container } = render(
      <PlayerAvatar
        player={{ displayName: "MacKenzie Gore", imageUrl: "https://images.example.test/gore.png" }}
      />,
    );

    const image = container.querySelector("img");
    if (!image) throw new Error("Expected a player image.");
    expect(image.getAttribute("loading")).toBe("lazy");
    fireEvent.error(image);

    expect(screen.getByText("MG")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
