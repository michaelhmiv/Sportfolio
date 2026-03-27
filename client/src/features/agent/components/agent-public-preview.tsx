import { Bot, Layers, MessageCircle, Shield, Sparkles, Zap } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const DEMO_MESSAGES = [
  { role: "user" as const, text: "Review my setup for today." },
  {
    role: "assistant" as const,
    text: "You have 2 open daily boost slots and 3 idle scouts. Your balance can support one more position. I recommend assigning your boost slots before the 7 PM lock window, then redirecting your idle scouts to the players in tonight's slate.",
  },
  { role: "user" as const, text: "Stage a trade plan for my idle cash." },
  {
    role: "assistant" as const,
    text: "Based on tonight's matchups: buy 5 shares of Player A ($12.40 each, projected +8% payout). This uses $62 of your $180 idle balance. Confirm to execute.",
  },
];

const FEATURES = [
  {
    icon: Layers,
    title: "Autonomous Strategies",
    description:
      "Set recurring game-day workflows that Hermes runs on a schedule without manual intervention.",
    color: "from-purple-500/20 to-purple-600/10",
    iconColor: "text-purple-300",
  },
  {
    icon: Sparkles,
    title: "Multi-Sport Intelligence",
    description:
      "NBA, NFL, MLB, NASCAR analysis. Hermes scans slates, evaluates matchups, and finds opportunities.",
    color: "from-amber-500/20 to-amber-600/10",
    iconColor: "text-amber-300",
  },
  {
    icon: Shield,
    title: "Confirmation-Gated Actions",
    description:
      "Every trade, boost, and scout move is staged for your review before execution. Nothing happens without your approval.",
    color: "from-emerald-500/20 to-emerald-600/10",
    iconColor: "text-emerald-300",
  },
  {
    icon: Zap,
    title: "External Data Sources",
    description:
      "Connect external MCP data sources for richer analysis. Hermes queries them automatically during strategy runs.",
    color: "from-cyan-500/20 to-cyan-600/10",
    iconColor: "text-cyan-300",
  },
];

export function AgentPublicPreview() {
  return (
    <div className="flex min-h-full flex-col overflow-y-auto bg-[#0a0e1a] text-white">
      {/* Hero */}
      <div className="mx-auto w-full max-w-4xl px-4 pt-12 pb-8 sm:px-6 sm:pt-20 sm:pb-12">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/20 to-amber-600/10 ring-1 ring-white/[0.08]">
            <Bot className="h-8 w-8 text-amber-300" />
          </div>
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Meet Hermes
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-base text-white/50 sm:text-lg">
            Your autonomous sports trading operator. Hermes scans slates, stages trades, manages
            boosts, and runs recurring strategies — all with your approval.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              asChild
              size="lg"
              className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-6 text-black hover:from-amber-400 hover:to-amber-500"
            >
              <Link href="/auth">Set up your agent</Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="lg"
              className="rounded-xl text-white/50 hover:bg-white/[0.06] hover:text-white/80"
            >
              <Link href="/">Back to dashboard</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Demo conversation */}
      <div className="mx-auto w-full max-w-2xl px-4 pb-8 sm:px-6">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-6">
          <p className="mb-4 text-xs font-medium uppercase tracking-wider text-white/30">
            Sample conversation
          </p>
          <div className="space-y-3">
            {DEMO_MESSAGES.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-blue-600/20 text-blue-100"
                      : "bg-white/[0.04] text-white/70"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Features grid */}
      <div className="mx-auto w-full max-w-4xl px-4 pb-16 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5"
            >
              <div
                className={`mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br ${feature.color}`}
              >
                <feature.icon className={`h-5 w-5 ${feature.iconColor}`} />
              </div>
              <h3 className="text-sm font-semibold text-white/90">{feature.title}</h3>
              <p className="mt-1 text-xs leading-5 text-white/40">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
