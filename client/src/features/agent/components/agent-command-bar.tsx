import {
  BarChart3,
  Eye,
  Play,
  Rocket,
  Search,
  TrendingUp,
} from "lucide-react";

const QUICK_ACTIONS = [
  {
    label: "Review my setup",
    prompt: "Review my setup for today.",
    icon: Eye,
    color: "from-blue-500/20 to-blue-600/10",
    iconColor: "text-blue-300",
  },
  {
    label: "Stage a trade",
    prompt: "Stage a trade plan for my idle cash.",
    icon: TrendingUp,
    color: "from-emerald-500/20 to-emerald-600/10",
    iconColor: "text-emerald-300",
  },
  {
    label: "Check boosts",
    prompt: "Check my boost slots and recommend assignments.",
    icon: Rocket,
    color: "from-amber-500/20 to-amber-600/10",
    iconColor: "text-amber-300",
  },
  {
    label: "Run strategy",
    prompt: "Run my top strategy now.",
    icon: Play,
    color: "from-purple-500/20 to-purple-600/10",
    iconColor: "text-purple-300",
  },
  {
    label: "Scout players",
    prompt: "What should I be watching right now?",
    icon: Search,
    color: "from-cyan-500/20 to-cyan-600/10",
    iconColor: "text-cyan-300",
  },
  {
    label: "Performance",
    prompt: "Show me my portfolio performance summary.",
    icon: BarChart3,
    color: "from-rose-500/20 to-rose-600/10",
    iconColor: "text-rose-300",
  },
];

export function AgentCommandBar({
  onAction,
}: {
  onAction: (prompt: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6">
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => onAction(action.prompt)}
          className="group flex flex-col items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center transition-all hover:border-white/[0.12] hover:bg-white/[0.04] active:scale-[0.97]"
        >
          <div className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br ${action.color}`}>
            <action.icon className={`h-5 w-5 ${action.iconColor}`} />
          </div>
          <span className="text-xs font-medium text-white/70 group-hover:text-white/90">
            {action.label}
          </span>
        </button>
      ))}
    </div>
  );
}
