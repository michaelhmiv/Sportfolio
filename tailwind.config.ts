import type { Config } from "tailwindcss";
import * as typographyModule from "@tailwindcss/typography";
import * as animateModule from "tailwindcss-animate";

type TailwindPlugin = NonNullable<Config["plugins"]>[number];
const unwrapPlugin = (module: unknown): TailwindPlugin =>
  ((module as { default?: TailwindPlugin }).default ?? module) as TailwindPlugin;
const typography = unwrapPlugin(typographyModule);
const animate = unwrapPlugin(animateModule);

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        // Preserve established route-wide utilities; semantic aliases migrate deliberately.
        lg: "0.25rem",
        md: "0.125rem",
        sm: "0rem",
        panel: "var(--radius-card)",
        control: "var(--radius-control)",
        compact: "var(--radius-control-sm)",
        pill: "var(--radius-pill)",
        circle: "var(--radius-circle)",
      },
      colors: {
        // Backward-compatible market aliases. New code should prefer market-positive/negative.
        positive: "hsl(var(--market-positive) / <alpha-value>)",
        negative: "hsl(var(--market-negative) / <alpha-value>)",

        brand: {
          DEFAULT: "hsl(var(--brand) / <alpha-value>)",
          foreground: "hsl(var(--brand-foreground) / <alpha-value>)",
          subtle: "hsl(var(--brand-subtle) / <alpha-value>)",
        },
        canvas: "hsl(var(--canvas) / <alpha-value>)",
        surface: "hsl(var(--surface) / <alpha-value>)",
        "surface-raised": "hsl(var(--surface-raised) / <alpha-value>)",
        content: {
          DEFAULT: "hsl(var(--text) / <alpha-value>)",
          muted: "hsl(var(--text-muted) / <alpha-value>)",
          subtle: "hsl(var(--text-subtle) / <alpha-value>)",
          inverse: "hsl(var(--text-inverse) / <alpha-value>)",
        },
        "border-subtle": "hsl(var(--border-subtle) / <alpha-value>)",
        "border-strong": "hsl(var(--border-strong) / <alpha-value>)",
        focus: "hsl(var(--focus-ring) / <alpha-value>)",
        "action-primary": {
          DEFAULT: "hsl(var(--action-primary) / <alpha-value>)",
          foreground: "hsl(var(--action-primary-foreground) / <alpha-value>)",
        },
        "action-secondary": {
          DEFAULT: "hsl(var(--action-secondary) / <alpha-value>)",
          foreground: "hsl(var(--action-secondary-foreground) / <alpha-value>)",
        },
        "market-positive": {
          DEFAULT: "hsl(var(--market-positive) / <alpha-value>)",
          subtle: "hsl(var(--market-positive-subtle) / <alpha-value>)",
        },
        "market-negative": {
          DEFAULT: "hsl(var(--market-negative) / <alpha-value>)",
          subtle: "hsl(var(--market-negative-subtle) / <alpha-value>)",
        },
        "status-live": {
          DEFAULT: "hsl(var(--status-live) / <alpha-value>)",
          subtle: "hsl(var(--status-live-subtle) / <alpha-value>)",
        },
        "status-upcoming": "hsl(var(--status-upcoming) / <alpha-value>)",
        "status-info": "hsl(var(--status-info) / <alpha-value>)",
        "status-warning": {
          DEFAULT: "hsl(var(--status-warning) / <alpha-value>)",
          subtle: "hsl(var(--status-warning-subtle) / <alpha-value>)",
        },
        boost: {
          DEFAULT: "hsl(var(--boost) / <alpha-value>)",
          subtle: "hsl(var(--boost-subtle) / <alpha-value>)",
          foreground: "hsl(var(--boost-foreground) / <alpha-value>)",
        },
        premium: {
          DEFAULT: "hsl(var(--premium) / <alpha-value>)",
          subtle: "hsl(var(--premium-subtle) / <alpha-value>)",
          foreground: "hsl(var(--premium-foreground) / <alpha-value>)",
        },
        tier: {
          standard: "hsl(var(--tier-standard) / <alpha-value>)",
          boosted: "hsl(var(--tier-boosted) / <alpha-value>)",
          elite: "hsl(var(--tier-elite) / <alpha-value>)",
          legendary: "hsl(var(--tier-legendary) / <alpha-value>)",
          mythic: "hsl(var(--tier-mythic) / <alpha-value>)",
        },
        category: {
          market: "hsl(var(--category-market) / <alpha-value>)",
          liquidity: "hsl(var(--category-liquidity) / <alpha-value>)",
          stacking: "hsl(var(--category-stacking) / <alpha-value>)",
          payout: "hsl(var(--category-payout) / <alpha-value>)",
          scout: "hsl(var(--category-scout) / <alpha-value>)",
          whale: "hsl(var(--category-whale) / <alpha-value>)",
          "thin-pool": "hsl(var(--category-thin-pool) / <alpha-value>)",
          boost: "hsl(var(--category-boost) / <alpha-value>)",
          community: "hsl(var(--category-community) / <alpha-value>)",
          momentum: "hsl(var(--category-momentum) / <alpha-value>)",
          value: "hsl(var(--category-value) / <alpha-value>)",
          pool: "hsl(var(--category-pool) / <alpha-value>)",
        },
        disabled: {
          DEFAULT: "hsl(var(--disabled) / <alpha-value>)",
          foreground: "hsl(var(--disabled-foreground) / <alpha-value>)",
          border: "hsl(var(--disabled-border) / <alpha-value>)",
        },
        "status-offline": "hsl(var(--status-offline) / <alpha-value>)",
        "status-stale": "hsl(var(--status-stale) / <alpha-value>)",
        "status-reconnecting": "hsl(var(--status-reconnecting) / <alpha-value>)",
        "status-connected": "hsl(var(--status-connected) / <alpha-value>)",
        selected: {
          DEFAULT: "hsl(var(--selected) / <alpha-value>)",
          foreground: "hsl(var(--selected-foreground) / <alpha-value>)",
          border: "hsl(var(--selected-border) / <alpha-value>)",
        },
        hover: "hsl(var(--hover) / <alpha-value>)",
        pressed: "hsl(var(--pressed) / <alpha-value>)",
        skeleton: {
          DEFAULT: "hsl(var(--skeleton) / <alpha-value>)",
          highlight: "hsl(var(--skeleton-highlight) / <alpha-value>)",
        },
        scrim: "hsl(var(--scrim) / <alpha-value>)",
        overlay: "hsl(var(--overlay-surface) / <alpha-value>)",

        // Compatibility aliases for the existing shadcn-style primitives.
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          subtle: "hsl(var(--destructive-subtle) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-series-1) / <alpha-value>)",
          "2": "hsl(var(--chart-series-2) / <alpha-value>)",
          "3": "hsl(var(--chart-series-3) / <alpha-value>)",
          "4": "hsl(var(--chart-series-4) / <alpha-value>)",
          "5": "hsl(var(--chart-series-5) / <alpha-value>)",
          "6": "hsl(var(--chart-series-6) / <alpha-value>)",
          "7": "hsl(var(--chart-series-7) / <alpha-value>)",
          "8": "hsl(var(--chart-series-8) / <alpha-value>)",
          grid: "hsl(var(--chart-grid) / <alpha-value>)",
          axis: "hsl(var(--chart-axis) / <alpha-value>)",
          tooltip: "hsl(var(--chart-tooltip) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)",
        },
        status: {
          online: "hsl(var(--status-connected) / <alpha-value>)",
          away: "hsl(var(--status-stale) / <alpha-value>)",
          busy: "hsl(var(--status-live) / <alpha-value>)",
          offline: "hsl(var(--status-offline) / <alpha-value>)",
        },
      },
      boxShadow: {
        none: "var(--shadow-none)",
        low: "var(--shadow-low)",
        medium: "var(--shadow-medium)",
        overlay: "var(--shadow-overlay)",
        celebration: "var(--shadow-celebration)",
      },
      transitionDuration: {
        fast: "var(--motion-fast)",
        standard: "var(--motion-standard)",
        slow: "var(--motion-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        emphasized: "var(--ease-emphasized)",
      },
      zIndex: {
        content: "var(--layer-content)",
        sticky: "var(--layer-sticky)",
        navigation: "var(--layer-navigation)",
        popover: "var(--layer-popover)",
        overlay: "var(--layer-overlay)",
        confirmation: "var(--layer-confirmation)",
        ceremony: "var(--layer-ceremony)",
        toast: "var(--layer-toast)",
      },
      fontFamily: {
        sans: ["Inter", "var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["JetBrains Mono", "var(--font-mono)"],
      },
      fontSize: {
        hero: ["4rem", { lineHeight: "1", fontWeight: "700" }], // 64px for hero prices
        price: ["3rem", { lineHeight: "1.2", fontWeight: "700" }], // 48px for large prices
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "slide-left": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-100%)" },
        },
        ticker: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-33.333%)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "highlight-once": {
          "0%": { backgroundColor: "hsl(var(--primary) / 0.15)" },
          "100%": { backgroundColor: "transparent" },
        },
        "toast-slide-in": {
          "0%": { transform: "translateX(100%)", opacity: "0" },
          "60%": { transform: "translateX(-8px)", opacity: "1" },
          "80%": { transform: "translateX(4px)" },
          "100%": { transform: "translateX(0)" },
        },
        "toast-slide-out": {
          "0%": { transform: "translateX(0)", opacity: "1" },
          "100%": { transform: "translateX(100%)", opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "slide-left": "slide-left 30s linear infinite",
        ticker: "ticker 40s linear infinite",
        "fade-in": "fade-in 0.3s ease-out",
        "highlight-once": "highlight-once 2s ease-out forwards",
        "toast-slide-in": "toast-slide-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
        "toast-slide-out": "toast-slide-out 0.2s ease-in forwards",
      },
    },
  },
  plugins: [animate, typography],
} satisfies Config;
