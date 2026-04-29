const ROUTE_PRELOADERS: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/dashboard"),
  "/pools": () => import("@/pages/marketplace"),
  "/boosts": () => import("@/pages/boosts"),
  "/portfolio": () => import("@/pages/portfolio"),
  "/analytics": () => import("@/pages/analytics"),
  "/leaderboards": () => import("@/pages/leaderboards"),
  "/premium": () => import("@/pages/premium"),
  "/news": () => import("@/pages/news"),
  "/wiki": () => import("@/pages/wiki"),
};

export function preloadRoute(url: string) {
  const loader = ROUTE_PRELOADERS[url];
  if (loader) {
    void loader();
  }
}
