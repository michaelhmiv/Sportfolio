import type { SVGProps } from "react";
import type { Sport } from "@/lib/sport-context";
import { cn } from "@/lib/utils";

export const SPORT_ICON_SPORTS = ["NBA", "NFL", "MLB", "NHL", "NASCAR", "ALL"] as const;

type SportIconSport = (typeof SPORT_ICON_SPORTS)[number];

interface SportIconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  sport: Sport;
  title?: string;
}

function SportGlyph({ sport }: { sport: SportIconSport }) {
  switch (sport) {
    case "NBA":
      return (
        <>
          <circle cx="12" cy="12" r="8.25" />
          <path d="M12 3.75v16.5M3.75 12h16.5M6.4 5.9c2.1 1.25 3.35 3.3 3.35 6.1s-1.25 4.85-3.35 6.1M17.6 5.9c-2.1 1.25-3.35 3.3-3.35 6.1s1.25 4.85 3.35 6.1" />
        </>
      );
    case "NFL":
      return (
        <>
          <path d="M4.2 15.8C1.85 13.45 4 7.65 8.45 4.95c4.45-2.7 9.65-1.85 11.35.25 1.7 2.1-.05 7.8-4.5 10.5-4.45 2.7-8.75 2.45-11.1.1Z" />
          <path d="m8.7 14.7 6.6-5.4M10.2 10.6l3.2 3.9M11.85 9.25l3.2 3.9" />
        </>
      );
    case "MLB":
      return (
        <>
          <circle cx="12" cy="12" r="8.25" />
          <path d="M8.15 4.7c1.55 1.55 2.35 3.95 2.15 7.05-.2 3.1-1.35 5.45-3.15 6.75M15.85 4.7c-1.55 1.55-2.35 3.95-2.15 7.05.2 3.1 1.35 5.45 3.15 6.75" />
          <path d="m8.45 8.05 1.65.5m-2 2.05 1.8.25m5.65-2.8-1.65.5m2 2.05-1.8.25" />
        </>
      );
    case "NHL":
      return (
        <>
          <path d="M5 5.2 9.1 16a2.5 2.5 0 0 0 2.35 1.6h6.8" />
          <path d="m8.05 13.2 7.3-2.75" />
          <ellipse cx="17.7" cy="17.1" rx="3.2" ry="1.45" />
        </>
      );
    case "NASCAR":
      return (
        <>
          <path d="M5 20V4.25M5.4 5h12.8v10H5.4" />
          <path d="M5.5 5h4.2v3.35H5.5m8.45-3.35v3.35h4.25M9.7 8.35h4.25v3.3H9.7m-4.2 0h4.2V15m4.25-3.35h4.25M13.95 15v-3.35" />
        </>
      );
    case "ALL":
      return (
        <>
          <circle cx="12" cy="12" r="2.15" />
          <ellipse cx="12" cy="12" rx="9" ry="4.35" />
          <ellipse cx="12" cy="12" rx="4.35" ry="9" transform="rotate(35 12 12)" />
          <ellipse cx="12" cy="12" rx="4.35" ry="9" transform="rotate(-35 12 12)" />
        </>
      );
  }
}

export function SportIcon({ sport, title, className, ...props }: SportIconProps) {
  const supportedSport = SPORT_ICON_SPORTS.includes(sport as SportIconSport)
    ? (sport as SportIconSport)
    : "ALL";

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      data-sport-icon={supportedSport}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <SportGlyph sport={supportedSport} />
    </svg>
  );
}
