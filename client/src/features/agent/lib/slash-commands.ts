import {
  BarChart3,
  Eye,
  Play,
  Rocket,
  Search,
  TrendingUp,
  Calendar,
  HelpCircle,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  prompt: string;
  icon: LucideIcon;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: "/mlb",
    label: "MLB",
    description: "Today's MLB slate and players",
    prompt: "Show me today's MLB slate and key players.",
    icon: Calendar,
  },
  {
    command: "/nba",
    label: "NBA",
    description: "Today's NBA slate and players",
    prompt: "Show me today's NBA slate and key players.",
    icon: Calendar,
  },
  {
    command: "/nfl",
    label: "NFL",
    description: "Today's NFL slate and players",
    prompt: "Show me today's NFL slate and key players.",
    icon: Calendar,
  },
  {
    command: "/boost",
    label: "Boosts",
    description: "Check and manage boost slots",
    prompt: "Check my boost slots and recommend assignments.",
    icon: Rocket,
  },
  {
    command: "/scout",
    label: "Scouts",
    description: "Review scout assignments",
    prompt: "What should I be watching right now?",
    icon: Search,
  },
  {
    command: "/trade",
    label: "Trade",
    description: "Stage a trade plan",
    prompt: "Stage a trade plan for my idle cash.",
    icon: TrendingUp,
  },
  {
    command: "/portfolio",
    label: "Portfolio",
    description: "Review portfolio performance",
    prompt: "Show me my portfolio performance summary.",
    icon: BarChart3,
  },
  {
    command: "/slate",
    label: "Slate",
    description: "Full game slate across all sports",
    prompt: "Show me today's full game slate.",
    icon: Calendar,
  },
  {
    command: "/review",
    label: "Review",
    description: "Review my full setup",
    prompt: "Review my setup for today.",
    icon: Eye,
  },
  {
    command: "/strategy",
    label: "Strategy",
    description: "Run or create a strategy",
    prompt: "Run my top strategy now.",
    icon: Play,
  },
  {
    command: "/team",
    label: "Team",
    description: "Look up a team's roster and games",
    prompt: "Show me the roster and upcoming games for ",
    icon: Users,
  },
  {
    command: "/help",
    label: "Help",
    description: "Show available commands",
    prompt: "What can you help me with? List your capabilities.",
    icon: HelpCircle,
  },
];

export function matchSlashCommands(input: string): SlashCommand[] {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed.startsWith("/")) return [];
  return SLASH_COMMANDS.filter((cmd) => cmd.command.startsWith(trimmed));
}
