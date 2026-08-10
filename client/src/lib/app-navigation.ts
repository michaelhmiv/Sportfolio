import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Crown,
  House,
  Layers,
  Newspaper,
  TrendingUp,
  Zap,
} from "lucide-react";

export type AppNavItemId =
  | "dashboard"
  | "pools"
  | "analytics"
  | "wiki"
  | "boosts"
  | "portfolio"
  | "premium"
  | "news"
  | "collections";

export interface AppNavItem {
  id: AppNavItemId;
  label: string;
  shortLabel?: string;
  href: string;
  icon: LucideIcon;
  requiresAuth?: boolean;
  tone?: "default" | "boost" | "premium";
}

export const APP_NAV_ITEMS: readonly AppNavItem[] = [
  { id: "dashboard", label: "Dashboard", shortLabel: "Home", href: "/", icon: House },
  { id: "pools", label: "Player Pools", shortLabel: "Pools", href: "/pools", icon: TrendingUp },
  { id: "analytics", label: "Analytics", href: "/analytics", icon: BarChart3 },
  { id: "wiki", label: "Wiki", href: "/wiki", icon: BookOpen },
  { id: "boosts", label: "Boosts", href: "/boosts", icon: Zap, tone: "boost" },
  {
    id: "portfolio",
    label: "Portfolio",
    href: "/portfolio",
    icon: BriefcaseBusiness,
    requiresAuth: true,
  },
  {
    id: "premium",
    label: "Premium",
    href: "/premium",
    icon: Crown,
    requiresAuth: true,
    tone: "premium",
  },
  { id: "news", label: "News", href: "/news", icon: Newspaper },
  {
    id: "collections",
    label: "Collections",
    href: "/collections",
    icon: Layers,
    requiresAuth: true,
  },
] as const;

export const MOBILE_NAV_ITEM_IDS = [
  "dashboard",
  "pools",
  "boosts",
  "portfolio",
  "analytics",
] as const satisfies readonly AppNavItemId[];

const navItemById = new Map(APP_NAV_ITEMS.map((item) => [item.id, item]));

export function getAppNavItem(id: AppNavItemId): AppNavItem {
  const item = navItemById.get(id);
  if (!item) throw new Error(`Unknown navigation item: ${id}`);
  return item;
}

export function isAppRouteActive(location: string, href: string): boolean {
  if (href === "/") return location === "/";
  return location === href || location.startsWith(`${href}/`);
}
