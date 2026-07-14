import { Crown, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { createRoot } from "react-dom/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StateSurface } from "@/components/ui/state-surface";
import "@/index.css";

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.classList.toggle("dark", prefersDark);
document.documentElement.style.colorScheme = prefersDark ? "dark" : "light";

function FixtureSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="space-y-3"
      aria-labelledby={`section-${title.toLowerCase().replaceAll(" ", "-")}`}
    >
      <div className="flex items-center gap-3">
        <h2
          id={`section-${title.toLowerCase().replaceAll(" ", "-")}`}
          className="text-lg font-semibold tracking-tight text-content"
        >
          {title}
        </h2>
        <div className="h-px flex-1 bg-border-subtle" />
      </div>
      {children}
    </section>
  );
}

function FoundationFixture() {
  return (
    <main className="min-h-screen bg-canvas px-4 py-8 text-content sm:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="space-y-2">
          <Badge variant="neutral">PR 1 fixture</Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Sportfolio visual system
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-content-muted sm:text-base">
            Deterministic semantic-token and primitive coverage. No account, network, or production
            data is used.
          </p>
        </header>

        <FixtureSection title="Actions">
          <div className="flex flex-wrap items-center gap-3">
            <Button data-testid="button-primary">Primary action</Button>
            <Button variant="secondary" data-testid="button-secondary">
              Secondary
            </Button>
            <Button variant="marketBuy" data-testid="button-buy">
              <TrendingUp aria-hidden="true" /> Buy shares
            </Button>
            <Button variant="marketSell" data-testid="button-sell">
              <TrendingDown aria-hidden="true" /> Sell shares
            </Button>
            <Button variant="premium" data-testid="button-premium">
              <Crown aria-hidden="true" /> Premium
            </Button>
            <Button disabled data-testid="button-disabled">
              Disabled
            </Button>
          </div>
        </FixtureSection>

        <FixtureSection title="Market and status badges">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">Neutral</Badge>
            <Badge variant="live" data-testid="badge-live">
              Live
            </Badge>
            <Badge variant="positive">
              <TrendingUp aria-hidden="true" /> 8.4%
            </Badge>
            <Badge variant="negative">
              <TrendingDown aria-hidden="true" /> 3.1%
            </Badge>
            <Badge variant="status">Upcoming</Badge>
            <Badge variant="warning">Delayed</Badge>
            <Badge variant="boost" data-testid="badge-boost">
              Boost ×2
            </Badge>
            <Badge variant="premium" data-testid="badge-premium">
              Premium
            </Badge>
            <Badge variant="count">12</Badge>
            <Badge variant="notification">3 unread</Badge>
          </div>
        </FixtureSection>

        <FixtureSection title="Cards">
          <div className="grid gap-4 md:grid-cols-3">
            <Card variant="interactive" data-testid="card-interactive">
              <CardHeader>
                <CardTitle>Interactive market</CardTitle>
                <CardDescription>
                  Quiet elevation with an explicit hover and focus hierarchy.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-baseline justify-between gap-4">
                <span className="font-mono text-2xl font-semibold tabular-nums">$14.25</span>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-market-positive">
                  <TrendingUp className="h-4 w-4" aria-hidden="true" /> 7.4%
                </span>
              </CardContent>
            </Card>

            <Card variant="live" data-testid="card-live">
              <CardHeader>
                <CardTitle>Live game</CardTitle>
                <CardDescription>
                  Live status remains separate from negative market movement.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <Badge variant="live">Q3 · 04:18</Badge>
                <span className="font-mono text-xl font-semibold tabular-nums">NYK 82–79 BOS</span>
              </CardContent>
            </Card>

            <Card variant="premium" data-testid="card-premium">
              <CardHeader>
                <CardTitle>Premium insight</CardTitle>
                <CardDescription>
                  Gold is reserved for entitlement and premium content.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="premium" className="w-full">
                  <Crown aria-hidden="true" /> View insight
                </Button>
              </CardContent>
            </Card>
          </div>
        </FixtureSection>

        <FixtureSection title="Forms and overlays">
          <Card>
            <CardHeader>
              <CardTitle>Market order controls</CardTitle>
              <CardDescription>
                Mobile-sized controls collapse to compact desktop density without losing focus
                visibility.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="grid gap-2 text-sm font-medium text-content">
                Quantity
                <Input
                  inputMode="numeric"
                  defaultValue="12"
                  aria-label="Order quantity"
                  data-testid="order-quantity"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-content">
                Sport
                <Select defaultValue="nba">
                  <SelectTrigger aria-label="Sport" data-testid="sport-select">
                    <SelectValue placeholder="Choose a sport" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nba">NBA</SelectItem>
                    <SelectItem value="mlb">MLB</SelectItem>
                    <SelectItem value="nhl">NHL</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <Dialog>
                <DialogTrigger asChild>
                  <Button>Open order ticket</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirm market order</DialogTitle>
                    <DialogDescription>
                      Buy 12 shares at the current market price of $14.25 per share.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-3 rounded-md border border-border-subtle bg-surface p-4 text-sm">
                    <span className="text-content-subtle">Estimated total</span>
                    <strong className="text-right font-mono tabular-nums">$171.00</strong>
                    <span className="text-content-subtle">Available balance</span>
                    <strong className="text-right font-mono tabular-nums">$820.40</strong>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button variant="marketBuy">Place order</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </FixtureSection>

        <FixtureSection title="System states">
          <div className="grid gap-4 md:grid-cols-2">
            <StateSurface
              kind="loading"
              title="Loading market"
              description="Prices and liquidity are being refreshed."
              data-testid="state-loading"
            />
            <StateSurface
              kind="empty"
              title="No players found"
              description="Clear the active filters to return to the full market."
              actionLabel="Clear filters"
              onAction={() => undefined}
              data-testid="state-empty"
            />
            <StateSurface
              kind="error"
              title="Market unavailable"
              description="The request failed. Existing holdings and balances were not changed."
              actionLabel="Try again"
              onAction={() => undefined}
              data-testid="state-error"
            />
            <StateSurface
              kind="offline"
              title="You are offline"
              description="Cached information remains visible while live updates are paused."
              data-testid="state-offline"
            />
            <StateSurface
              kind="stale"
              title="Prices may be stale"
              description="Last successful refresh was more than five minutes ago."
              data-testid="state-stale"
            />
            <StateSurface
              kind="reconnecting"
              title="Reconnecting"
              description="Live updates will resume automatically."
              data-testid="state-reconnecting"
            />
            <StateSurface
              kind="success"
              title="Order submitted"
              description="Your order was accepted and is visible in activity."
              data-testid="state-success"
            />
            <Card variant="empty" className="flex min-h-40 items-center justify-center p-6">
              <div className="space-y-2 text-center text-content-muted">
                <Minus className="mx-auto h-6 w-6" aria-hidden="true" />
                <p className="text-sm font-medium">No secondary data</p>
              </div>
            </Card>
          </div>
        </FixtureSection>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Visual fixture root was not found");
createRoot(root).render(<FoundationFixture />);
