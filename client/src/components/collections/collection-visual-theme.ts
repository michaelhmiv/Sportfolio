export type CollectionSilhouette =
  | "scoreboard"
  | "patch"
  | "medallion"
  | "pennant"
  | "ticket"
  | "crest"
  | "poster";

export interface CollectionVisualTheme {
  id: string;
  silhouette: CollectionSilhouette;
  frameClass: string;
  artClass: string;
}

const THEMES: Record<string, CollectionVisualTheme> = {
  "season-leaders": {
    id: "season-leaders",
    silhouette: "scoreboard",
    frameClass: "[clip-path:polygon(5%_0,95%_0,100%_12%,100%_100%,0_100%,0_12%)]",
    artClass: "border-status-info/40 bg-status-info/10",
  },
  "threshold-clubs": {
    id: "threshold-clubs",
    silhouette: "patch",
    frameClass: "rounded-[22%] border-dashed",
    artClass: "border-status-warning/40 bg-status-warning/10",
  },
  "official-awards": {
    id: "official-awards",
    silhouette: "medallion",
    frameClass: "rounded-circle",
    artClass: "border-boost/40 bg-boost-subtle/30",
  },
  "official-teams": {
    id: "official-teams",
    silhouette: "pennant",
    frameClass: "[clip-path:polygon(0_0,100%_8%,82%_100%,0_88%)]",
    artClass: "border-category-community/40 bg-category-community/10",
  },
  postseason: {
    id: "postseason",
    silhouette: "ticket",
    frameClass: "[clip-path:polygon(0_0,100%_0,96%_45%,100%_55%,100%_100%,0_100%,4%_55%,0_45%)]",
    artClass: "border-category-stacking/40 bg-category-stacking/10",
  },
};

const FALLBACK: CollectionVisualTheme = {
  id: "fallback",
  silhouette: "poster",
  frameClass: "rounded-panel",
  artClass: "border-border-strong bg-surface-raised",
};

const MASTER: CollectionVisualTheme = {
  id: "master",
  silhouette: "crest",
  frameClass: "[clip-path:polygon(50%_0,96%_18%,88%_72%,50%_100%,12%_72%,4%_18%)]",
  artClass: "border-brand/50 bg-brand-subtle/30",
};

const ALIASES: Record<string, string> = {
  leaders: "season-leaders",
  "season-leader": "season-leaders",
  "threshold-club": "threshold-clubs",
  awards: "official-awards",
  teams: "official-teams",
  "post-season": "postseason",
};

export function normalizeCollectionFamily(family: string): string {
  const normalized = family
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-");
  return ALIASES[normalized] ?? normalized;
}

export function resolveCollectionVisualTheme(input: {
  family: string;
  kind: "player_slots" | "master";
}): CollectionVisualTheme {
  if (input.kind === "master") return MASTER;
  return THEMES[normalizeCollectionFamily(input.family)] ?? FALLBACK;
}
