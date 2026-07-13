import { BarChart3, Eye, Play, Rocket, Search, TrendingUp } from "lucide-react";

const QUICK_ACTIONS = [
  {
    label: "Review my setup",
    prompt: "Review my setup for today.",
    icon: Eye,
    color: "from-status-info/20 to-status-info/10",
    iconColor: "text-status-info",
  },
  {
    label: "Stage a trade",
    prompt: "Stage a trade plan for my idle cash.",
    icon: TrendingUp,
    color: "from-market-positive/20 to-market-positive/10",
    iconColor: "text-market-positive",
  },
  {
    label: "Check boosts",
    prompt: "Check my boost slots and recommend assignments.",
    icon: Rocket,
    color: "from-brand/20 to-brand/10",
    iconColor: "text-brand",
  },
  {
    label: "Run strategy",
    prompt: "Run my top strategy now.",
    icon: Play,
    color: "from-category-scout/20 to-category-scout/10",
    iconColor: "text-category-scout",
  },
  {
    label: "Scout players",
    prompt: "What should I be watching right now?",
    icon: Search,
    color: "from-status-info/20 to-status-info/10",
    iconColor: "text-status-info",
  },
  {
    label: "Performance",
    prompt: "Show me my portfolio performance summary.",
    icon: BarChart3,
    color: "from-market-negative/20 to-market-negative/10",
    iconColor: "text-market-negative",
  },
];

export function AgentCommandBar({ onAction }: { onAction: (prompt: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6">
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => onAction(action.prompt)}
          className="group flex flex-col items-center gap-2 rounded-panel border border-border/60 bg-surface-raised/40 px-3 py-4 text-center transition-all hover:border-border/60 hover:bg-surface-raised/40 active:scale-[0.97]"
        >
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-pill bg-gradient-to-br ${action.color}`}
          >
            <action.icon className={`h-5 w-5 ${action.iconColor}`} />
          </div>
          <span className="text-xs font-medium text-content group-hover:text-content">
            {action.label}
          </span>
        </button>
      ))}
    </div>
  );
}
