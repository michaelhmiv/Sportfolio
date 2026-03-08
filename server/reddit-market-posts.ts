import { createHash, createHmac } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import {
  dailyBoosts,
  dailyGames,
  newsFeed,
  playerGameStats,
  players,
  redditPostHistory,
  trades,
} from "@shared/schema";

import { db } from "./db";
import { getETDayBoundaries, getGameDay, getTodayET } from "./lib/time";
import { getRedditBotTokenSecret } from "./reddit-bot-auth";
import { storage } from "./storage";

export const REDDIT_POST_TYPES = ["morning_recap", "pregame_preview"] as const;
export type RedditPostType = (typeof REDDIT_POST_TYPES)[number];

const DEFAULT_SITE_URL = "https://www.sportfolio.market";
const DEFAULT_SPORTS = ["NBA", "NFL", "MLB", "NASCAR"] as const;
const MAX_NEWS_ITEMS = 3;
const MAX_GAME_ITEMS = 6;
const MAX_BULLETS = 4;
const IMAGE_ROUTE_PATH = "/api/integrations/reddit/preview-image.svg";

type SimplePlayerStat = {
  id: string;
  name: string;
  team: string;
  sport: string;
  value: number;
  formattedValue: string;
};

type SimpleNewsItem = {
  headline: string;
  briefing: string;
  sport: string;
  sourceUrl: string | null;
  createdAt: Date;
};

type SimpleGameItem = {
  sport: string;
  awayTeam: string;
  homeTeam: string;
  status: string;
  startTime: Date;
};

type BoostSummary = {
  totalActive: number;
  topTier: number | null;
  sports: string[];
};

type MomentumItem = {
  playerId: string;
  name: string;
  team: string;
  sport: string;
  priceChange24h: number;
  buyPressure: number;
};

export type RedditPreviewInput = {
  subreddit: string;
  postType: RedditPostType;
  sports?: string[];
  reserve?: boolean;
  force?: boolean;
  marketDay?: string;
  titleTemplate?: string | null;
};

export type SignedRedditImageInput = {
  subreddit: string;
  postType: RedditPostType;
  sports: string[];
  marketDay: string;
  titleTemplate?: string | null;
};

export type RedditPreview = {
  subreddit: string;
  postType: RedditPostType;
  sports: string[];
  marketDay: string;
  shouldPost: boolean;
  reason?: "already_posted" | "slot_reserved";
  title: string;
  markdown: string;
  contentHash: string;
  imageUrl: string;
  summary: {
    label: string;
    bullets: string[];
    newsCount: number;
    gameCount: number;
    boostCount: number;
  };
  history: {
    status: string;
    redditPostId: string | null;
    redditPostUrl: string | null;
    attemptCount: number;
  } | null;
};

export type RedditReportInput = {
  subreddit: string;
  postType: RedditPostType;
  marketDay: string;
  contentHash: string;
  status: "posted" | "failed" | "skipped";
  title?: string;
  markdown?: string;
  redditPostId?: string | null;
  redditPostUrl?: string | null;
  imageUrl?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
};

function getSiteUrl(): string {
  const source = (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || DEFAULT_SITE_URL).trim();
  return source.replace(/\/+$/, "");
}

function normalizeSports(input?: string[]): string[] {
  const source = input?.length ? input : [...DEFAULT_SPORTS];
  const deduped = new Set<string>();

  source.forEach((sport) => {
    const normalized = String(sport || "")
      .trim()
      .toUpperCase();

    if (normalized) {
      deduped.add(normalized);
    }
  });

  return deduped.size > 0 ? Array.from(deduped) : [...DEFAULT_SPORTS];
}

function parseMarketDayDate(marketDay: string): Date {
  const [year, month, day] = marketDay.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function shiftMarketDay(marketDay: string, offsetDays: number): string {
  const shifted = parseMarketDayDate(marketDay);
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return getGameDay(shifted);
}

function formatShortDate(marketDay: string): string {
  return parseMarketDayDate(marketDay).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function formatTimeEt(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function buildSportsLabel(sports: string[]): string {
  return sports.length === DEFAULT_SPORTS.length ? "All Sports" : sports.join("/");
}

function applyTitleTemplate(
  postType: RedditPostType,
  marketDay: string,
  sports: string[],
  titleTemplate?: string | null,
): string {
  const defaultLabel = postType === "morning_recap" ? "Morning Recap" : "Pre-Game Preview";
  const template = titleTemplate?.trim() || "Sportfolio {label} | {date} | {sports}";

  return template
    .replace(/\{label\}/gi, defaultLabel)
    .replace(/\{date\}/gi, formatShortDate(marketDay))
    .replace(/\{sports\}/gi, buildSportsLabel(sports));
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serializeSignedImageInput(input: SignedRedditImageInput): string {
  return [
    input.subreddit.trim().replace(/^r\//i, "").toLowerCase(),
    input.postType,
    input.marketDay,
    normalizeSports(input.sports).join(","),
    input.titleTemplate?.trim() || "",
  ].join("|");
}

export function signRedditPreviewImageRequest(input: SignedRedditImageInput): string {
  return createHmac("sha256", getRedditBotTokenSecret())
    .update(serializeSignedImageInput(input))
    .digest("hex");
}

export function verifyRedditPreviewImageSignature(
  input: SignedRedditImageInput,
  signature: string,
): boolean {
  return signRedditPreviewImageRequest(input) === signature;
}

export function buildSignedRedditPreviewImageUrl(input: SignedRedditImageInput): string {
  const signature = signRedditPreviewImageRequest(input);
  const params = new URLSearchParams({
    subreddit: input.subreddit.trim().replace(/^r\//i, "").toLowerCase(),
    postType: input.postType,
    marketDay: input.marketDay,
    sports: normalizeSports(input.sports).join(","),
    sig: signature,
  });

  if (input.titleTemplate?.trim()) {
    params.set("titleTemplate", input.titleTemplate.trim());
  }

  return `${getSiteUrl()}${IMAGE_ROUTE_PATH}?${params.toString()}`;
}

export async function ensureRedditPostHistorySchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS reddit_post_history (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        subreddit text NOT NULL,
        post_type text NOT NULL,
        market_day varchar(10) NOT NULL,
        title text NOT NULL,
        markdown text NOT NULL,
        content_hash varchar(64) NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        reddit_post_id varchar,
        reddit_post_url text,
        image_url text,
        attempt_count integer NOT NULL DEFAULT 0,
        error_message text,
        metadata jsonb,
        posted_at timestamp,
        last_attempt_at timestamp NOT NULL DEFAULT now(),
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS reddit_post_history_subreddit_slot_idx
      ON reddit_post_history (subreddit, post_type, market_day);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS reddit_post_history_status_idx
      ON reddit_post_history (status);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS reddit_post_history_created_at_idx
      ON reddit_post_history (created_at);
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS reddit_post_history_last_attempt_idx
      ON reddit_post_history (last_attempt_at);
    `);
  } catch (error: any) {
    console.warn(
      "[REDDIT_BOT] Could not ensure reddit_post_history schema:",
      error?.message || error,
    );
  }
}

async function getTopRisers(sports: string[], limit: number): Promise<SimplePlayerStat[]> {
  const result = await db
    .select({
      id: players.id,
      firstName: players.firstName,
      lastName: players.lastName,
      team: players.team,
      sport: players.sport,
      priceChange24h: players.priceChange24h,
    })
    .from(players)
    .where(
      and(
        eq(players.isActive, true),
        inArray(players.sport, sports),
        sql`${players.priceChange24h} IS NOT NULL`,
        sql`${players.priceChange24h} > 0`,
      ),
    )
    .orderBy(desc(players.priceChange24h))
    .limit(limit);

  return result.map((player) => {
    const change = Number(player.priceChange24h || 0);

    return {
      id: player.id,
      name: `${player.firstName} ${player.lastName}`,
      team: player.team,
      sport: player.sport,
      value: change,
      formattedValue: `+$${change.toFixed(2)}`,
    };
  });
}

async function getTopDecliners(sports: string[], limit: number): Promise<SimplePlayerStat[]> {
  const result = await db
    .select({
      id: players.id,
      firstName: players.firstName,
      lastName: players.lastName,
      team: players.team,
      sport: players.sport,
      priceChange24h: players.priceChange24h,
    })
    .from(players)
    .where(
      and(
        eq(players.isActive, true),
        inArray(players.sport, sports),
        sql`${players.priceChange24h} IS NOT NULL`,
        sql`${players.priceChange24h} < 0`,
      ),
    )
    .orderBy(asc(players.priceChange24h))
    .limit(limit);

  return result.map((player) => {
    const change = Number(player.priceChange24h || 0);

    return {
      id: player.id,
      name: `${player.firstName} ${player.lastName}`,
      team: player.team,
      sport: player.sport,
      value: change,
      formattedValue: `-$${Math.abs(change).toFixed(2)}`,
    };
  });
}

async function getTopVolume(sports: string[], limit: number): Promise<SimplePlayerStat[]> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await db
    .select({
      id: players.id,
      firstName: players.firstName,
      lastName: players.lastName,
      team: players.team,
      sport: players.sport,
      tradeCount: sql<number>`count(${trades.id})::int`,
    })
    .from(players)
    .leftJoin(trades, and(eq(trades.playerId, players.id), gte(trades.executedAt, oneDayAgo)))
    .where(and(eq(players.isActive, true), inArray(players.sport, sports)))
    .groupBy(players.id, players.firstName, players.lastName, players.team, players.sport)
    .having(sql`count(${trades.id}) > 0`)
    .orderBy(desc(sql`count(${trades.id})`))
    .limit(limit);

  return result.map((player) => ({
    id: player.id,
    name: `${player.firstName} ${player.lastName}`,
    team: player.team,
    sport: player.sport,
    value: Number(player.tradeCount || 0),
    formattedValue: `${Number(player.tradeCount || 0)} trades`,
  }));
}

async function getTopMarketCap(sports: string[], limit: number): Promise<SimplePlayerStat[]> {
  const result = await db
    .select({
      id: players.id,
      firstName: players.firstName,
      lastName: players.lastName,
      team: players.team,
      sport: players.sport,
      marketCap: players.marketCap,
    })
    .from(players)
    .where(
      and(
        eq(players.isActive, true),
        inArray(players.sport, sports),
        sql`${players.marketCap} IS NOT NULL`,
        sql`${players.marketCap} > 0`,
      ),
    )
    .orderBy(desc(players.marketCap))
    .limit(limit);

  return result.map((player) => {
    const marketCap = Number(player.marketCap || 0);

    return {
      id: player.id,
      name: `${player.firstName} ${player.lastName}`,
      team: player.team,
      sport: player.sport,
      value: marketCap,
      formattedValue: `$${(marketCap / 1000).toFixed(1)}K`,
    };
  });
}

async function getTopFantasyPerformer(
  sports: string[],
  marketDay: string,
): Promise<SimplePlayerStat | null> {
  const recapDay = shiftMarketDay(marketDay, -1);
  const { startOfDay, endOfDay } = getETDayBoundaries(recapDay);

  const result = await db
    .select({
      id: players.id,
      firstName: players.firstName,
      lastName: players.lastName,
      team: players.team,
      sport: players.sport,
      fantasyPoints: playerGameStats.fantasyPoints,
    })
    .from(playerGameStats)
    .innerJoin(players, eq(players.id, playerGameStats.playerId))
    .where(
      and(
        gte(playerGameStats.gameDate, startOfDay),
        lt(playerGameStats.gameDate, endOfDay),
        inArray(players.sport, sports),
      ),
    )
    .orderBy(desc(playerGameStats.fantasyPoints))
    .limit(1);

  const leader = result[0];
  if (!leader) {
    return null;
  }

  const fantasyPoints = Number(leader.fantasyPoints || 0);
  return {
    id: leader.id,
    name: `${leader.firstName} ${leader.lastName}`,
    team: leader.team,
    sport: leader.sport,
    value: fantasyPoints,
    formattedValue: `${fantasyPoints.toFixed(1)} FP`,
  };
}

async function getRecentNewsStories(
  sports: string[],
  marketDay: string,
  limit: number,
): Promise<SimpleNewsItem[]> {
  const { startOfDay, endOfDay } = getETDayBoundaries(marketDay);
  const newsStart = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);

  return db
    .select({
      headline: newsFeed.headline,
      briefing: newsFeed.briefing,
      sport: newsFeed.sport,
      sourceUrl: newsFeed.sourceUrl,
      createdAt: newsFeed.createdAt,
    })
    .from(newsFeed)
    .where(
      and(
        inArray(newsFeed.sport, sports),
        gte(newsFeed.createdAt, newsStart),
        lt(newsFeed.createdAt, endOfDay),
      ),
    )
    .orderBy(desc(newsFeed.createdAt))
    .limit(limit);
}

async function getTodayGames(
  sports: string[],
  marketDay: string,
  limit: number,
): Promise<SimpleGameItem[]> {
  const { startOfDay, endOfDay } = getETDayBoundaries(marketDay);

  const games = await db
    .select({
      sport: dailyGames.sport,
      awayTeam: dailyGames.awayTeam,
      homeTeam: dailyGames.homeTeam,
      status: dailyGames.status,
      startTime: dailyGames.startTime,
    })
    .from(dailyGames)
    .where(
      and(
        inArray(dailyGames.sport, sports),
        gte(dailyGames.startTime, startOfDay),
        lt(dailyGames.startTime, endOfDay),
      ),
    )
    .orderBy(asc(dailyGames.startTime))
    .limit(limit);

  return games.map((game) => ({
    sport: game.sport,
    awayTeam: game.awayTeam,
    homeTeam: game.homeTeam,
    status: game.status,
    startTime: new Date(game.startTime),
  }));
}

async function getActiveBoostSummary(sports: string[], marketDay: string): Promise<BoostSummary> {
  const { startOfDay, endOfDay } = getETDayBoundaries(marketDay);
  const rows = await db
    .select({
      sport: dailyBoosts.sport,
      slotTier: dailyBoosts.slotTier,
    })
    .from(dailyBoosts)
    .where(
      and(
        inArray(dailyBoosts.sport, sports),
        gte(dailyBoosts.boostDate, startOfDay),
        lt(dailyBoosts.boostDate, endOfDay),
        inArray(dailyBoosts.status, ["active", "locked"]),
      ),
    );

  const activeSports = Array.from(new Set(rows.map((row) => row.sport)));
  const topTier =
    rows.length > 0 ? rows.reduce((highest, row) => Math.max(highest, row.slotTier), 0) : null;

  return {
    totalActive: rows.length,
    topTier,
    sports: activeSports,
  };
}

async function getMomentumPlayers(sports: string[], limit: number): Promise<MomentumItem[]> {
  const scanners =
    sports.length === DEFAULT_SPORTS.length
      ? [await storage.getFinancialMarketScanners("ALL")]
      : await Promise.all(sports.map((sport) => storage.getFinancialMarketScanners(sport)));

  const deduped = new Map<string, MomentumItem>();
  for (const scanner of scanners) {
    for (const item of scanner.momentum) {
      if (deduped.has(item.player.id)) {
        continue;
      }

      deduped.set(item.player.id, {
        playerId: item.player.id,
        name: `${item.player.firstName} ${item.player.lastName}`,
        team: item.player.team,
        sport: item.player.sport,
        priceChange24h: Number(item.player.priceChange24h || 0),
        buyPressure: Number(item.metrics.sentiment.buyPressure || 0),
      });
    }
  }

  return Array.from(deduped.values())
    .sort((left, right) => right.priceChange24h - left.priceChange24h)
    .slice(0, limit);
}

function buildNewsLines(news: SimpleNewsItem[]): string[] {
  if (news.length === 0) {
    return ["- No fresh market-moving stories in the latest News Hub pull."];
  }

  return news.map((story) => {
    const headline = story.sourceUrl
      ? `[${story.headline}](${story.sourceUrl})`
      : `**${story.headline}**`;
    return `- ${headline} - ${story.briefing}`;
  });
}

function buildMorningRecapMarkdown(params: {
  title: string;
  riser: SimplePlayerStat | null;
  decliner: SimplePlayerStat | null;
  volumeLeader: SimplePlayerStat | null;
  marketCapLeader: SimplePlayerStat | null;
  fantasyLeader: SimplePlayerStat | null;
  news: SimpleNewsItem[];
  sports: string[];
}): { markdown: string; bullets: string[] } {
  const lines = [params.title, ""];
  const bullets: string[] = [];

  lines.push("## Market Pulse");
  if (params.riser) {
    lines.push(
      `- Top riser: **${params.riser.name}** (${params.riser.team}) ${params.riser.formattedValue}`,
    );
    bullets.push(`Top riser: ${params.riser.name} ${params.riser.formattedValue}`);
  }
  if (params.decliner) {
    lines.push(
      `- Biggest drop: **${params.decliner.name}** (${params.decliner.team}) ${params.decliner.formattedValue}`,
    );
    bullets.push(`Biggest drop: ${params.decliner.name} ${params.decliner.formattedValue}`);
  }
  if (params.volumeLeader) {
    lines.push(
      `- Most traded: **${params.volumeLeader.name}** (${params.volumeLeader.team}) ${params.volumeLeader.formattedValue}`,
    );
    bullets.push(`Most traded: ${params.volumeLeader.name} ${params.volumeLeader.formattedValue}`);
  }
  if (params.marketCapLeader) {
    lines.push(
      `- Market cap leader: **${params.marketCapLeader.name}** (${params.marketCapLeader.team}) ${params.marketCapLeader.formattedValue}`,
    );
    bullets.push(
      `Market cap leader: ${params.marketCapLeader.name} ${params.marketCapLeader.formattedValue}`,
    );
  }
  if (params.fantasyLeader) {
    lines.push(
      `- Last-night leader: **${params.fantasyLeader.name}** (${params.fantasyLeader.team}) ${params.fantasyLeader.formattedValue}`,
    );
    bullets.push(
      `Last-night leader: ${params.fantasyLeader.name} ${params.fantasyLeader.formattedValue}`,
    );
  }

  lines.push("");
  lines.push("## News Desk");
  lines.push(...buildNewsLines(params.news));
  lines.push("");
  lines.push(`Coverage: ${buildSportsLabel(params.sports)}`);
  lines.push(`[Open Sportfolio](${getSiteUrl()})`);

  return {
    markdown: lines.join("\n"),
    bullets: bullets.slice(0, MAX_BULLETS),
  };
}

function buildPregamePreviewMarkdown(params: {
  title: string;
  games: SimpleGameItem[];
  boostSummary: BoostSummary;
  momentum: MomentumItem[];
  news: SimpleNewsItem[];
  sports: string[];
}): { markdown: string; bullets: string[] } {
  const lines = [params.title, ""];
  const bullets: string[] = [];

  lines.push("## Today's Slate");
  if (params.games.length === 0) {
    lines.push("- No tracked games scheduled in the selected sports today.");
  } else {
    params.games.forEach((game) => {
      lines.push(
        `- **${game.awayTeam} @ ${game.homeTeam}** (${game.sport}) at ${formatTimeEt(game.startTime)} ET`,
      );
    });

    const firstGame = params.games[0];
    bullets.push(
      `${params.games.length} games on deck, first up ${firstGame.awayTeam} @ ${firstGame.homeTeam}`,
    );
  }

  lines.push("");
  lines.push("## Boost Watch");
  if (params.boostSummary.totalActive === 0) {
    lines.push("- No active public boost inventory is showing for the selected sports yet.");
  } else {
    const sportsLabel = params.boostSummary.sports.join(", ");
    const topTierLabel =
      params.boostSummary.topTier !== null
        ? ` Top tier live: ${params.boostSummary.topTier}x.`
        : "";
    lines.push(
      `- ${params.boostSummary.totalActive} active boosts across ${sportsLabel}.${topTierLabel}`.trim(),
    );
    bullets.push(`${params.boostSummary.totalActive} active boosts live`);
  }

  lines.push("");
  lines.push("## Momentum Watch");
  if (params.momentum.length === 0) {
    lines.push("- No standout momentum names in the latest 24h move scan.");
  } else {
    params.momentum.slice(0, 4).forEach((player) => {
      lines.push(
        `- **${player.name}** (${player.team}, ${player.sport}) +$${player.priceChange24h.toFixed(2)} with ${player.buyPressure.toFixed(0)}% buy pressure`,
      );
    });
    bullets.push(
      `Momentum: ${params.momentum[0].name} +$${params.momentum[0].priceChange24h.toFixed(2)}`,
    );
  }

  lines.push("");
  lines.push("## News Desk");
  lines.push(...buildNewsLines(params.news));
  if (params.news.length > 0) {
    bullets.push(`${params.news.length} fresh News Hub items`);
  }

  lines.push("");
  lines.push(`Coverage: ${buildSportsLabel(params.sports)}`);
  lines.push(`[Open Sportfolio](${getSiteUrl()})`);

  return {
    markdown: lines.join("\n"),
    bullets: bullets.slice(0, MAX_BULLETS),
  };
}

async function getHistorySlot(subreddit: string, postType: RedditPostType, marketDay: string) {
  const [existing] = await db
    .select()
    .from(redditPostHistory)
    .where(
      and(
        eq(redditPostHistory.subreddit, subreddit),
        eq(redditPostHistory.postType, postType),
        eq(redditPostHistory.marketDay, marketDay),
      ),
    )
    .limit(1);

  return existing || null;
}

async function reserveHistorySlot(preview: RedditPreview): Promise<void> {
  const now = new Date();

  await db
    .insert(redditPostHistory)
    .values({
      subreddit: preview.subreddit,
      postType: preview.postType,
      marketDay: preview.marketDay,
      title: preview.title,
      markdown: preview.markdown,
      contentHash: preview.contentHash,
      imageUrl: preview.imageUrl,
      status: "pending",
      attemptCount: 1,
      metadata: preview.summary,
      lastAttemptAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        redditPostHistory.subreddit,
        redditPostHistory.postType,
        redditPostHistory.marketDay,
      ],
      set: {
        title: preview.title,
        markdown: preview.markdown,
        contentHash: preview.contentHash,
        imageUrl: preview.imageUrl,
        status: "pending",
        metadata: preview.summary,
        lastAttemptAt: now,
        updatedAt: now,
        attemptCount: sql`${redditPostHistory.attemptCount} + 1`,
      },
    });
}

export async function buildRedditPostPreview(input: RedditPreviewInput): Promise<RedditPreview> {
  await ensureRedditPostHistorySchema();

  const subreddit = input.subreddit.trim().replace(/^r\//i, "").toLowerCase();
  const sports = normalizeSports(input.sports);
  const marketDay = input.marketDay || getTodayET();
  const existing = await getHistorySlot(subreddit, input.postType, marketDay);
  const title = applyTitleTemplate(input.postType, marketDay, sports, input.titleTemplate);

  let markdown = "";
  let bullets: string[] = [];
  let newsCount = 0;
  let gameCount = 0;
  let boostCount = 0;

  if (input.postType === "morning_recap") {
    const [risers, decliners, volume, marketCap, fantasyLeader, news] = await Promise.all([
      getTopRisers(sports, 3),
      getTopDecliners(sports, 3),
      getTopVolume(sports, 3),
      getTopMarketCap(sports, 1),
      getTopFantasyPerformer(sports, marketDay),
      getRecentNewsStories(sports, marketDay, MAX_NEWS_ITEMS),
    ]);

    const built = buildMorningRecapMarkdown({
      title,
      riser: risers[0] || null,
      decliner: decliners[0] || null,
      volumeLeader: volume[0] || null,
      marketCapLeader: marketCap[0] || null,
      fantasyLeader,
      news,
      sports,
    });

    markdown = built.markdown;
    bullets = built.bullets;
    newsCount = news.length;
  } else {
    const [games, boostSummary, momentum, news] = await Promise.all([
      getTodayGames(sports, marketDay, MAX_GAME_ITEMS),
      getActiveBoostSummary(sports, marketDay),
      getMomentumPlayers(sports, 6),
      getRecentNewsStories(sports, marketDay, MAX_NEWS_ITEMS),
    ]);

    const built = buildPregamePreviewMarkdown({
      title,
      games,
      boostSummary,
      momentum,
      news,
      sports,
    });

    markdown = built.markdown;
    bullets = built.bullets;
    newsCount = news.length;
    gameCount = games.length;
    boostCount = boostSummary.totalActive;
  }

  const contentHash = hashContent(`${title}\n${markdown}`);
  const shouldBlockAsPosted = existing?.status === "posted" && !input.force;
  const shouldBlockAsReserved = existing?.status === "pending" && !input.force;
  const imageUrl = buildSignedRedditPreviewImageUrl({
    subreddit,
    postType: input.postType,
    sports,
    marketDay,
    titleTemplate: input.titleTemplate,
  });

  const preview: RedditPreview = {
    subreddit,
    postType: input.postType,
    sports,
    marketDay,
    shouldPost: !shouldBlockAsPosted && !shouldBlockAsReserved,
    reason: shouldBlockAsPosted
      ? "already_posted"
      : shouldBlockAsReserved
        ? "slot_reserved"
        : undefined,
    title,
    markdown,
    contentHash,
    imageUrl,
    summary: {
      label: input.postType === "morning_recap" ? "Morning Recap" : "Pre-Game Preview",
      bullets,
      newsCount,
      gameCount,
      boostCount,
    },
    history: existing
      ? {
          status: existing.status,
          redditPostId: existing.redditPostId || null,
          redditPostUrl: existing.redditPostUrl || null,
          attemptCount: existing.attemptCount,
        }
      : null,
  };

  if (preview.shouldPost && input.reserve) {
    await reserveHistorySlot(preview);
  }

  return preview;
}

export async function reportRedditPost(input: RedditReportInput) {
  await ensureRedditPostHistorySchema();

  const now = new Date();
  const subreddit = input.subreddit.trim().replace(/^r\//i, "").toLowerCase();
  const existing = await getHistorySlot(subreddit, input.postType, input.marketDay);
  const nextTitle = input.title ?? existing?.title ?? input.postType;
  const nextMarkdown = input.markdown ?? existing?.markdown ?? "";
  const nextImageUrl = input.imageUrl ?? existing?.imageUrl ?? null;
  const nextMetadata = input.metadata ?? existing?.metadata ?? null;
  const nextPostedAt =
    input.status === "posted" ? now : existing?.postedAt ? existing.postedAt : null;

  const [row] = await db
    .insert(redditPostHistory)
    .values({
      subreddit,
      postType: input.postType,
      marketDay: input.marketDay,
      title: nextTitle,
      markdown: nextMarkdown,
      contentHash: input.contentHash,
      status: input.status,
      redditPostId: input.redditPostId || null,
      redditPostUrl: input.redditPostUrl || null,
      imageUrl: nextImageUrl,
      attemptCount: 1,
      errorMessage: input.errorMessage || null,
      metadata: nextMetadata,
      postedAt: nextPostedAt,
      lastAttemptAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        redditPostHistory.subreddit,
        redditPostHistory.postType,
        redditPostHistory.marketDay,
      ],
      set: {
        title: nextTitle,
        markdown: nextMarkdown,
        contentHash: input.contentHash,
        status: input.status,
        redditPostId: input.redditPostId || existing?.redditPostId || null,
        redditPostUrl: input.redditPostUrl || existing?.redditPostUrl || null,
        imageUrl: nextImageUrl,
        errorMessage: input.errorMessage || null,
        metadata: nextMetadata,
        postedAt: nextPostedAt,
        lastAttemptAt: now,
        updatedAt: now,
        attemptCount: sql`${redditPostHistory.attemptCount} + 1`,
      },
    })
    .returning();

  return row;
}

export function buildRedditPreviewImageSvg(preview: RedditPreview): string {
  const title = escapeSvgText(preview.title);
  const subtitle = escapeSvgText(`${preview.summary.label} | ${buildSportsLabel(preview.sports)}`);
  const bullets = preview.summary.bullets.length
    ? preview.summary.bullets
    : ["No headline bullets available for this preview."];
  const safeBullets = bullets.slice(0, MAX_BULLETS).map((bullet) => escapeSvgText(bullet));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#081018" />
      <stop offset="100%" stop-color="#11202a" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect x="48" y="48" width="1104" height="534" rx="20" fill="#0f1720" stroke="#34d399" stroke-width="2" />
  <text x="80" y="110" fill="#7dd3fc" font-size="24" font-family="'IBM Plex Mono', monospace">SPORTFOLIO / REDDIT</text>
  <text x="80" y="170" fill="#f8fafc" font-size="44" font-weight="700" font-family="'IBM Plex Sans', sans-serif">${title}</text>
  <text x="80" y="214" fill="#94a3b8" font-size="24" font-family="'IBM Plex Mono', monospace">${subtitle}</text>
  ${safeBullets
    .map(
      (bullet, index) =>
        `<text x="100" y="${300 + index * 70}" fill="#e2e8f0" font-size="30" font-family="'IBM Plex Sans', sans-serif">- ${bullet}</text>`,
    )
    .join("\n  ")}
  <text x="80" y="548" fill="#34d399" font-size="26" font-family="'IBM Plex Mono', monospace">sportfolio.market</text>
</svg>`;
}
