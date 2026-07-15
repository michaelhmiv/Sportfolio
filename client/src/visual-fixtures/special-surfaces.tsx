import { createRoot } from "react-dom/client";
import type { AgentUiBlock } from "@shared/agent-ui";
import { AgentUiBlockList } from "@/features/agent/components/agent-ui-blocks";
import "@/index.css";

const semanticCards = [
  {
    eyebrow: "Premium",
    title: "Pro market intelligence",
    copy: "Premium access keeps its own restrained value treatment.",
    className: "border-premium/30 bg-premium/10",
    accent: "text-premium",
  },
  {
    eyebrow: "Scout",
    title: "Lineup signal ready",
    copy: "Scout discovery remains distinct from premium and market movement.",
    className: "border-category-scout/30 bg-category-scout/10",
    accent: "text-category-scout",
  },
  {
    eyebrow: "Whale activity",
    title: "Large position detected",
    copy: "Whale alerts use a dedicated category without becoming an error state.",
    className: "border-category-whale/30 bg-category-whale/10",
    accent: "text-category-whale",
  },
  {
    eyebrow: "Boost ceremony",
    title: "2.0× multiplier awarded",
    copy: "Ceremonial emphasis stays compact and does not replace core navigation.",
    className: "border-category-boost/30 bg-category-boost/10",
    accent: "text-category-boost",
  },
] as const;

function SpecialSurfacesFixture() {
  const requestedTheme = new URLSearchParams(window.location.search).get("theme");
  document.documentElement.classList.toggle("dark", requestedTheme !== "light");

  return (
    <main className="min-h-screen bg-canvas px-4 py-6 text-content sm:px-8 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-5" data-testid="special-surfaces-fixture">
        <header className="flex flex-col gap-3 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
              Sportfolio visual contract
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-content-strong">
              Special surfaces
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-content-muted">
              Hermes, premium, Scout, collections, alerts, and ceremonies retain distinct semantic
              roles in both themes.
            </p>
          </div>
          <span className="w-fit rounded-pill border border-status-live/30 bg-status-live/10 px-3 py-1 text-xs font-medium text-status-live">
            Native ready
          </span>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <section className="space-y-3" aria-labelledby="collection-fixture-heading">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-category-community">
                Progress
              </p>
              <h2
                id="collection-fixture-heading"
                className="text-lg font-semibold text-content-strong"
              >
                Collections and milestones
              </h2>
            </div>
            <div className="space-y-4 rounded-panel border border-border/70 bg-surface p-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-content-strong">Team collection</span>
                  <span className="rounded-pill border border-category-community/30 bg-category-community/10 px-2 py-0.5 text-[10px] font-medium text-category-community">
                    8 remaining
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-compact bg-category-community/20">
                  <div
                    className="h-full rounded-compact bg-category-community"
                    style={{ width: "68%" }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["First trade", "Complete", "text-market-positive"],
                  ["50K value", "Earned", "text-premium"],
                  ["Team set", "68%", "text-category-community"],
                ].map(([label, value, roleClass]) => (
                  <div
                    key={label}
                    className="rounded-compact border border-border/60 bg-surface-raised/50 p-2.5"
                  >
                    <div className={`text-base font-semibold ${roleClass}`}>{value}</div>
                    <div className="mt-0.5 text-[10px] text-content-muted">{label}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-panel border border-category-community/30 bg-category-community/10 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-category-community">
                  Collection ceremony
                </p>
                <p className="mt-1 text-sm font-medium text-content-strong">
                  Dodgers lineup set completed
                </p>
                <p className="mt-1 text-xs text-content-muted">
                  Milestone unlocked without blocking the next action.
                </p>
              </div>
            </div>
          </section>
        </div>

        <section aria-labelledby="roles-fixture-heading">
          <div className="mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-content-muted">
              Product roles
            </p>
            <h2 id="roles-fixture-heading" className="text-lg font-semibold text-content-strong">
              Distinct emphasis without category conflation
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {semanticCards.map((card) => (
              <article key={card.eyebrow} className={`rounded-panel border p-4 ${card.className}`}>
                <p
                  className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${card.accent}`}
                >
                  {card.eyebrow}
                </p>
                <h3 className="mt-2 text-sm font-semibold text-content-strong">{card.title}</h3>
                <p className="mt-1.5 text-xs leading-5 text-content-muted">{card.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="relative overflow-hidden rounded-panel border border-border/70 bg-surface p-4"
          aria-label="Overlay treatment sample"
        >
          <div className="absolute inset-0 bg-scrim/70" aria-hidden="true" />
          <div className="relative mx-auto max-w-md rounded-panel border border-category-scout/30 bg-surface-raised p-4 shadow-overlay">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-category-scout">
              Scout confirmation
            </p>
            <h2 className="mt-1 text-base font-semibold text-content-strong">
              Starting lineup confirmed
            </h2>
            <p className="mt-1 text-xs text-content-muted">
              Overlay surfaces preserve readable content, a clear boundary, and one primary action.
            </p>
            <button
              type="button"
              className="mt-3 min-h-11 w-full rounded-control bg-action-primary px-4 text-sm font-medium text-action-primary-foreground"
            >
              Review signal
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<SpecialSurfacesFixture />);
