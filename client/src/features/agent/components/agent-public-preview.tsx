import { Bot, Layers, Shield, Sparkles, Zap } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const DEMO_MESSAGES = [
  { role: "user" as const, text: "Review my setup for today." },
  {
    role: "assistant" as const,
    text: "You have 2 open daily boost slots and 3 idle scouts. I would lock in the boost slots before the 7 PM window, then redirect the idle scouts to tonight's highest-relevance names.",
  },
  { role: "user" as const, text: "Stage a trade plan for my idle cash." },
  {
    role: "assistant" as const,
    text: "I staged one Sportfolio-native trade plan based on tonight's slate: buy 5 shares of Player A for about $62. Review the staged plan and confirm only if you want it executed.",
  },
];

const FEATURES = [
  {
    icon: Layers,
    title: "Saved Strategies",
    description:
      "Save recurring game-day workflows that Hermes can run inside approved Sportfolio guardrails.",
    color: "from-category-scout/20 to-category-scout/10",
    iconColor: "text-category-scout",
  },
  {
    icon: Sparkles,
    title: "Slate-Aware Reads",
    description:
      "NBA, NFL, MLB, and NASCAR context tied back to your holdings, boosts, scouts, and idle balance.",
    color: "from-brand/20 to-brand/10",
    iconColor: "text-brand",
  },
  {
    icon: Shield,
    title: "Confirmation-Gated Gameplay",
    description:
      "Trades, boosts, scouts, and watchlist moves are staged for review first. Nothing risky executes without approval.",
    color: "from-market-positive/20 to-market-positive/10",
    iconColor: "text-market-positive",
  },
  {
    icon: Zap,
    title: "Optional External Enrichment",
    description:
      "Native Sportfolio tools stay primary. Built-in or user-added MCP sources are used only when extra context is actually needed.",
    color: "from-status-info/20 to-status-info/10",
    iconColor: "text-status-info",
  },
];

export function AgentPublicPreview() {
  return (
    <div className="flex min-h-full flex-col overflow-y-auto bg-canvas text-content">
      <div className="mx-auto w-full max-w-4xl px-4 pt-12 pb-8 sm:px-6 sm:pt-20 sm:pb-12">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-panel bg-gradient-to-br from-brand/20 to-brand/10 ring-1 ring-border/60">
            <Bot className="h-8 w-8 text-brand" />
          </div>
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-content sm:text-4xl">
            Meet Hermes
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-base text-content/50 sm:text-lg">
            Sportfolio&apos;s product operator. Hermes reviews your setup, reads slate context,
            stages supported actions, and carries saved strategies forward inside server-owned
            guardrails.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              asChild
              size="lg"
              className="rounded-panel bg-gradient-to-r from-brand to-brand px-6 text-brand-foreground hover:from-brand hover:to-brand"
            >
              <Link href="/auth">Set up your agent</Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="lg"
              className="rounded-panel text-content/50 hover:bg-surface-raised/40 hover:text-content"
            >
              <Link href="/">Back to dashboard</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 pb-8 sm:px-6">
        <div className="rounded-panel border border-border/60 bg-surface-raised/40 p-4 sm:p-6">
          <p className="mb-4 text-xs font-medium uppercase tracking-wider text-content/30">
            Sample conversation
          </p>
          <div className="space-y-3">
            {DEMO_MESSAGES.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-panel px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-status-info/20 text-status-info"
                      : "bg-surface-raised/40 text-content"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 pb-16 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-panel border border-border/60 bg-surface-raised/40 p-5"
            >
              <div
                className={`mb-3 flex h-10 w-10 items-center justify-center rounded-pill bg-gradient-to-br ${feature.color}`}
              >
                <feature.icon className={`h-5 w-5 ${feature.iconColor}`} />
              </div>
              <h3 className="text-sm font-semibold text-content">{feature.title}</h3>
              <p className="mt-1 text-xs leading-5 text-content/40">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
