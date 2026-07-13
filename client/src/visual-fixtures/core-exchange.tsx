import { ChevronDown, ShieldAlert } from "lucide-react";
import React from "react";
import { createRoot } from "react-dom/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import "@/index.css";

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.classList.toggle("dark", prefersDark);
document.documentElement.style.colorScheme = prefersDark ? "dark" : "light";

const markets = [
  { player: "Aaron Judge", team: "NYY · OF", price: "$42.80", move: "+8.4%", direction: "up" },
  { player: "Bobby Witt Jr.", team: "KC · SS", price: "$31.15", move: "+3.1%", direction: "up" },
  { player: "Gerrit Cole", team: "NYY · SP", price: "$18.90", move: "−2.7%", direction: "down" },
] as const;

const tiers = [
  { name: "Standard", className: "bg-tier-standard" },
  { name: "Boosted", className: "bg-tier-boosted" },
  { name: "Elite", className: "bg-tier-elite" },
  { name: "Legendary", className: "bg-tier-legendary" },
  { name: "Mythic", className: "bg-tier-mythic" },
] as const;

function MarketBoard() {
  return (
    <Card data-testid="market-board" className="overflow-hidden shadow-low">
      <CardHeader className="border-b border-border-subtle px-3 py-2.5">
        <div className="terminal-kicker">Live market</div>
        <CardTitle className="terminal-heading text-base">Player pools</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-border-subtle bg-surface-raised px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-content-subtle">
          <span>Player</span>
          <span className="text-right">Price</span>
          <span className="text-right">Move</span>
        </div>
        {markets.map((market) => {
          const positive = market.direction === "up";
          return (
            <div
              key={market.player}
              className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border-subtle px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-content">{market.player}</div>
                <div className="terminal-subtle text-[11px]">{market.team}</div>
              </div>
              <div className="font-mono text-sm font-semibold tabular-nums text-content">
                {market.price}
              </div>
              <div
                className={`inline-flex min-w-14 items-center justify-end gap-1 font-mono text-xs font-semibold tabular-nums ${
                  positive ? "text-market-positive" : "text-market-negative"
                }`}
                aria-label={`${positive ? "Up" : "Down"} ${market.move}`}
              >
                <span aria-hidden="true">{positive ? "▲" : "▼"}</span>
                {market.move}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function PortfolioBoard() {
  return (
    <Card data-testid="portfolio-board" className="shadow-low">
      <CardHeader className="border-b border-border-subtle px-3 py-2.5">
        <div className="terminal-kicker">Holdings</div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <CardTitle className="terminal-heading text-base">Portfolio</CardTitle>
            <div className="terminal-subtle mt-1 text-[11px]">5 positions · MLB</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-lg font-bold tabular-nums text-content">$1,248.60</div>
            <div className="font-mono text-xs font-semibold text-market-positive">▲ +$84.20</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            ["Aaron Judge", "$428.00", "+12.4%"],
            ["Bobby Witt Jr.", "$311.50", "+5.2%"],
            ["Gerrit Cole", "$189.00", "−2.7%"],
          ].map(([name, value, move]) => (
            <div
              key={name}
              className="rounded-control border border-border-subtle bg-surface-raised p-2"
            >
              <div className="truncate text-xs font-semibold text-content">{name}</div>
              <div className="mt-2 font-mono text-base font-bold tabular-nums text-content">
                {value}
              </div>
              <div
                className={`font-mono text-[11px] font-semibold ${
                  move.startsWith("+") ? "text-market-positive" : "text-market-negative"
                }`}
              >
                {move.startsWith("+") ? "▲" : "▼"} {move}
              </div>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-content-subtle">
            Multiplier tiers
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tiers.map((tier) => (
              <Badge
                key={tier.name}
                data-tier={tier.name.toLowerCase()}
                className={`${tier.className} text-content-inverse`}
              >
                {tier.name}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HierarchySection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border-subtle px-3 py-2.5 last:border-b-0">
      <div
        data-hierarchy-label
        className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-content-subtle"
      >
        {label}
      </div>
      {children}
    </section>
  );
}

function GameHierarchy() {
  return (
    <Card data-testid="game-hierarchy" className="overflow-hidden shadow-low">
      <HierarchySection label="Score & state">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div>
            <div className="terminal-heading text-lg">NYY</div>
            <div className="terminal-subtle text-[11px]">Away</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-2xl font-bold tabular-nums text-content">4–3</div>
            <Badge variant="live" className="mt-1">
              Live · 7th
            </Badge>
          </div>
          <div className="text-right">
            <div className="terminal-heading text-lg">BOS</div>
            <div className="terminal-subtle text-[11px]">Home</div>
          </div>
        </div>
      </HierarchySection>
      <HierarchySection label="Your exposure">
        <div className="flex items-center justify-between rounded-control bg-market-positive/10 px-2.5 py-2">
          <div>
            <div className="text-xs font-semibold text-content">2 active positions</div>
            <div className="terminal-subtle text-[11px]">18.4 effective shares</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-base font-bold text-market-positive">$18.25</div>
            <div className="terminal-subtle text-[10px]">estimated</div>
          </div>
        </div>
      </HierarchySection>
      <HierarchySection label="Starting lineups">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-control bg-surface-raised p-2">
            <div className="font-semibold text-content">NYY</div>
            <div className="mt-1 text-content-muted">1. Volpe · SS</div>
            <div className="text-content-muted">2. Soto · RF</div>
          </div>
          <div className="rounded-control bg-surface-raised p-2">
            <div className="font-semibold text-content">BOS</div>
            <div className="mt-1 text-content-muted">1. Duran · CF</div>
            <div className="text-content-muted">2. Devers · 3B</div>
          </div>
        </div>
      </HierarchySection>
      <HierarchySection label="Scoring summary">
        <button
          type="button"
          aria-expanded="false"
          className="flex min-h-11 w-full items-center justify-between rounded-control border border-border-subtle bg-surface-raised px-2.5 text-xs font-semibold text-content-muted"
        >
          <span>3 scoring plays · collapsed</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4" />
        </button>
      </HierarchySection>
      <HierarchySection label="Injuries">
        <div className="flex items-center gap-2 text-xs text-content-muted">
          <ShieldAlert aria-hidden="true" className="h-4 w-4 text-status-warning" />
          <span>1 reported · R. Devers day-to-day</span>
        </div>
      </HierarchySection>
    </Card>
  );
}

function CoreExchangeFixture() {
  return (
    <main
      data-testid="core-exchange-fixture"
      className="min-h-screen bg-canvas px-3 py-4 text-content sm:px-5 sm:py-6"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 border-b border-border-strong pb-3">
          <div className="terminal-strip mb-2">Core exchange command center</div>
          <h1 className="terminal-heading text-xl sm:text-2xl">Market intelligence</h1>
          <p className="terminal-subtle mt-1 text-xs sm:text-sm">
            Prices, exposure, and game context in one compact decision surface.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.05fr]">
          <MarketBoard />
          <PortfolioBoard />
          <GameHierarchy />
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CoreExchangeFixture />
  </React.StrictMode>,
);
