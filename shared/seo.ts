export type RouteSeoMeta = {
  title: string;
  description: string;
  canonicalPath: string;
  robots: "index,follow" | "noindex,nofollow";
};

export const DEFAULT_SITE_URL = "https://www.sportfolio.market";

export const DEFAULT_ROUTE_META: RouteSeoMeta = {
  title: "Sportfolio - Fantasy Sports Stock Market",
  description:
    "Trade player shares like stocks. Mine, trade, and compete in fantasy sports contests with real-time pricing and professional-grade trading tools.",
  canonicalPath: "/",
  robots: "index,follow",
};

export function normalizeSiteUrl(rawUrl?: string | null): string {
  const value = (rawUrl || "").trim();
  if (!value) return DEFAULT_SITE_URL;
  return value.replace(/\/+$/, "");
}

export function normalizeRoutePath(rawPath: string): string {
  const withoutQuery = (rawPath || "/").split("?")[0]?.split("#")[0] || "/";
  if (withoutQuery === "") return "/";
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) return withoutQuery.slice(0, -1);
  return withoutQuery;
}

const knownRoutePatterns = [
  /^\/$/,
  /^\/login$/,
  /^\/auth\/callback$/,
  /^\/auth\/error$/,
  /^\/checkout\/success$/,
  /^\/contests$/,
  /^\/contest\/[^/]+\/leaderboard$/,
  /^\/contest\/[^/]+\/entry(?:\/[^/]+)?$/,
  /^\/leaderboards$/,
  /^\/user\/[^/]+$/,
  /^\/pools$/,
  /^\/marketplace$/,
  /^\/blog$/,
  /^\/blog\/[^/]+$/,
  /^\/privacy$/,
  /^\/terms$/,
  /^\/about$/,
  /^\/contact$/,
  /^\/how-it-works$/,
  /^\/wiki$/,
  /^\/wiki\/[^/]+$/,
  /^\/wiki\/[^/]+\/[^/]+$/,
  /^\/sms\/link$/,
  /^\/analytics$/,
  /^\/news$/,
  /^\/power$/,
  /^\/boosts$/,
  /^\/player\/[^/]+$/,
  /^\/player\/nba_[^/]+$/,
  /^\/player\/nfl_[^/]+$/,
  /^\/player\/mlb_[^/]+$/,
  /^\/portfolio$/,
  /^\/admin$/,
  /^\/premium$/,
  /^\/watchlists$/,
  /^\/profile$/,
];

const privateRoutePatterns = [
  /^\/admin(?:\/.*)?$/,
  /^\/auth(?:\/.*)?$/,
  /^\/login$/,
  /^\/sms\/link$/,
  /^\/checkout\/success$/,
  /^\/power$/,
  /^\/boosts$/,
  /^\/player\/.+/,
  /^\/contest\/[^/]+\/entry(?:\/[^/]+)?$/,
  /^\/portfolio$/,
  /^\/premium$/,
  /^\/watchlists$/,
  /^\/profile$/,
];

export function isKnownAppRoute(rawPath: string): boolean {
  const path = normalizeRoutePath(rawPath);
  return knownRoutePatterns.some((pattern) => pattern.test(path));
}

export function isPrivateAppRoute(rawPath: string): boolean {
  const path = normalizeRoutePath(rawPath);
  return privateRoutePatterns.some((pattern) => pattern.test(path));
}

export function getRouteSeoMeta(rawPath: string): RouteSeoMeta {
  const path = normalizeRoutePath(rawPath);

  if (path === "/sms/link") {
    return {
      title: "Link SMS Agent | Sportfolio",
      description: "Complete secure phone linking for the Sportfolio SMS agent.",
      canonicalPath: "/sms/link",
      robots: "noindex,nofollow",
    };
  }

  if (privateRoutePatterns.some((pattern) => pattern.test(path))) {
    return {
      ...DEFAULT_ROUTE_META,
      title: "Sportfolio",
      canonicalPath: path,
      robots: "noindex,nofollow",
    };
  }

  if (path === "/") return DEFAULT_ROUTE_META;
  if (path === "/pools" || path === "/marketplace") {
    return {
      title: "Player Pools | Sportfolio",
      description:
        "Trade and track player pools with real-time pricing and liquidity on Sportfolio.",
      canonicalPath: "/pools",
      robots: "index,follow",
    };
  }
  if (path === "/contests") {
    return {
      title: "Contests | Sportfolio",
      description: "Join fantasy contests and compete on real-time player performance.",
      canonicalPath: "/contests",
      robots: "index,follow",
    };
  }
  if (/^\/contest\/[^/]+\/leaderboard$/.test(path)) {
    return {
      title: "Contest Leaderboard | Sportfolio",
      description: "Track live standings and payout positions for Sportfolio contests.",
      canonicalPath: path,
      robots: "index,follow",
    };
  }
  if (path === "/leaderboards") {
    return {
      title: "Leaderboards | Sportfolio",
      description: "See top traders and portfolio performance on Sportfolio.",
      canonicalPath: "/leaderboards",
      robots: "index,follow",
    };
  }
  if (path === "/blog") {
    return {
      title: "Blog - Fantasy Sports Insights & NBA Trading Strategies | Sportfolio",
      description:
        "Latest insights on fantasy sports, player trading strategies, contest tips, and Sportfolio platform updates.",
      canonicalPath: "/blog",
      robots: "index,follow",
    };
  }
  if (/^\/blog\/[^/]+$/.test(path)) {
    return {
      title: "Sportfolio Blog",
      description: "Fantasy sports analysis, trading insights, and Sportfolio updates.",
      canonicalPath: path,
      robots: "index,follow",
    };
  }
  if (path === "/about") {
    return {
      title: "About | Sportfolio",
      description: "Learn how Sportfolio brings stock-market mechanics to fantasy sports.",
      canonicalPath: "/about",
      robots: "index,follow",
    };
  }
  if (path === "/contact") {
    return {
      title: "Contact | Sportfolio",
      description: "Contact the Sportfolio team.",
      canonicalPath: "/contact",
      robots: "index,follow",
    };
  }
  if (path === "/how-it-works") {
    return {
      title: "How It Works | Sportfolio",
      description: "Understand trading, contests, and scoring mechanics in Sportfolio.",
      canonicalPath: "/how-it-works",
      robots: "index,follow",
    };
  }
  if (path === "/wiki") {
    return {
      title: "Sportfolio Wiki | Sportfolio",
      description: "Browse gameplay mechanics, product guides, FAQs, and changelog updates.",
      canonicalPath: "/wiki",
      robots: "index,follow",
    };
  }
  if (/^\/wiki\/[^/]+$/.test(path)) {
    return {
      title: "Sportfolio Wiki | Sportfolio",
      description: "Browse the Sportfolio knowledge hub by section.",
      canonicalPath: path,
      robots: "index,follow",
    };
  }
  if (/^\/wiki\/[^/]+\/[^/]+$/.test(path)) {
    return {
      title: "Sportfolio Wiki Article | Sportfolio",
      description: "Read a Sportfolio product or gameplay article from the knowledge hub.",
      canonicalPath: path,
      robots: "index,follow",
    };
  }
  if (path === "/privacy") {
    return {
      title: "Privacy Policy | Sportfolio",
      description: "Read Sportfolio's privacy policy.",
      canonicalPath: "/privacy",
      robots: "index,follow",
    };
  }
  if (path === "/terms") {
    return {
      title: "Terms of Service | Sportfolio",
      description: "Read Sportfolio's terms of service.",
      canonicalPath: "/terms",
      robots: "index,follow",
    };
  }
  if (path === "/analytics") {
    return {
      title: "Market Analytics | Sportfolio",
      description: "Track market trends and trading metrics across player pools.",
      canonicalPath: "/analytics",
      robots: "index,follow",
    };
  }
  if (path === "/news") {
    return {
      title: "Sports News | Sportfolio",
      description: "Follow the latest sports news and market-relevant updates.",
      canonicalPath: "/news",
      robots: "index,follow",
    };
  }
  if (/^\/user\/[^/]+$/.test(path)) {
    return {
      title: "User Profile | Sportfolio",
      description: "Explore trader profiles and portfolio snapshots on Sportfolio.",
      canonicalPath: path,
      robots: "index,follow",
    };
  }

  return {
    ...DEFAULT_ROUTE_META,
    canonicalPath: path,
    robots: "noindex,nofollow",
  };
}

export function toCanonicalUrl(siteUrl: string, routePath: string): string {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const normalizedPath = normalizeRoutePath(routePath);
  return normalizedPath === "/" ? normalizedSiteUrl : `${normalizedSiteUrl}${normalizedPath}`;
}

export const HOW_IT_WORKS_FAQS = [
  {
    question: "How does trading player shares work on Sportfolio?",
    answer:
      "Players are tradable shares with AMM pricing. You can buy or sell instantly with transparent quotes and slippage-aware execution.",
  },
  {
    question: "What is the scout system?",
    answer:
      "Scouts are assignable agents that distribute free shares hourly based on time-weighted participation.",
  },
  {
    question: "How do contests settle?",
    answer:
      "Contest outcomes use real game performance. Settlement is status-gated and prizes are distributed automatically after completion.",
  },
  {
    question: "How are boosts handled?",
    answer:
      "Daily boosts lock shares at game start, then settle post-game using configured slot multipliers and community effects.",
  },
];
