import { desc, gte, sql } from "drizzle-orm";

import { newsFeed, trades } from "@shared/schema";
import { postDiscordChannelMessage } from "../discord-api";
import { getDiscordRuntimeConfig } from "../discord-config";
import { ensureDiscordSchema, hasDiscordPost, recordDiscordPost } from "../discord-service";
import { db } from "../db";
import { buildMobileMarketOverview } from "../market-mobile-overview";

import type { JobResult } from "./scheduler";
import type { MobileMarketSignal } from "../market-mobile-overview";

const MAX_NEWS_POSTS_PER_RUN = 5;
const DISCORD_MESSAGE_LINK_FALLBACK = "/news";

function buildNoopJobResult(): JobResult {
  return {
    requestCount: 0,
    recordsProcessed: 0,
    errorCount: 0,
  };
}

function isDiscordPostingRuntimeAllowed(): boolean {
  if (process.env.DISCORD_FORCE_ENABLE_POSTING?.trim().toLowerCase() === "true") {
    return true;
  }

  if (process.env.NODE_ENV !== "production") {
    return false;
  }

  const railwayEnvironmentName = (
    process.env.RAILWAY_ENVIRONMENT_NAME ||
    process.env.RAILWAY_ENVIRONMENT ||
    ""
  )
    .trim()
    .toLowerCase();

  if (!railwayEnvironmentName) {
    return false;
  }

  return railwayEnvironmentName === "production";
}

type EtHourSnapshot = {
  key: string;
  label: string;
};

function formatCurrency(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatSignedPercent(value: number): string {
  const rounded = Number.isFinite(value) ? value.toFixed(2) : "0.00";
  return `${value >= 0 ? "+" : ""}${rounded}%`;
}

function getEtHourSnapshot(now: Date): EtHourSnapshot {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));

  const year = partMap.get("year") || "0000";
  const month = partMap.get("month") || "00";
  const day = partMap.get("day") || "00";
  const hour = partMap.get("hour") || "00";

  return {
    key: `${year}-${month}-${day}-${hour}`,
    label: `${year}-${month}-${day} ${hour}:00 ET`,
  };
}

function buildTopMoverLines(movers: MobileMarketSignal[]): string[] {
  if (movers.length === 0) {
    return ["- No positive movers in the latest 24h window"];
  }

  return movers.slice(0, 3).map((mover) => {
    const name = `${mover.firstName} ${mover.lastName}`.trim();
    return `- ${name} (${mover.team}): ${formatSignedPercent(mover.priceChange24h)}`;
  });
}

export async function postDiscordNewsUpdates(): Promise<JobResult> {
  if (!isDiscordPostingRuntimeAllowed()) {
    return buildNoopJobResult();
  }

  const config = getDiscordRuntimeConfig();
  const channelId = config.newsChannelId;

  if (!config.botToken || !channelId) {
    return buildNoopJobResult();
  }

  await ensureDiscordSchema();

  const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: newsFeed.id,
      headline: newsFeed.headline,
      briefing: newsFeed.briefing,
      sourceUrl: newsFeed.sourceUrl,
      sport: newsFeed.sport,
      createdAt: newsFeed.createdAt,
    })
    .from(newsFeed)
    .where(gte(newsFeed.createdAt, recentCutoff))
    .orderBy(desc(newsFeed.createdAt))
    .limit(20);

  const stories = [...rows].reverse();
  let requestCount = 0;
  let recordsProcessed = 0;
  let errorCount = 0;

  for (const story of stories) {
    if (recordsProcessed >= MAX_NEWS_POSTS_PER_RUN) {
      break;
    }

    const alreadyPosted = await hasDiscordPost({
      channelId,
      sourceType: "news",
      sourceKey: story.id,
    });

    if (alreadyPosted) {
      continue;
    }

    const fallbackUrl = `${config.publicSiteUrl}${DISCORD_MESSAGE_LINK_FALLBACK}`;
    const sourceUrl = story.sourceUrl || fallbackUrl;
    const createdAtIso = story.createdAt.toISOString();

    requestCount += 1;
    const postResult = await postDiscordChannelMessage(channelId, {
      content: [
        `**[${story.sport}] ${story.headline}**`,
        story.briefing,
        `Source: ${sourceUrl}`,
        `Published: ${createdAtIso}`,
      ].join("\n"),
      allowed_mentions: { parse: [] },
    });

    if (!postResult.ok || !postResult.data?.id) {
      console.warn(
        `[discord_news_post] Failed to post story ${story.id}: status=${postResult.status} error=${postResult.error?.message || "unknown"}`,
      );
      errorCount += 1;
      continue;
    }

    await recordDiscordPost({
      channelId,
      sourceType: "news",
      sourceKey: story.id,
      discordMessageId: postResult.data.id,
    });

    recordsProcessed += 1;
  }

  return {
    requestCount,
    recordsProcessed,
    errorCount,
  };
}

export async function postDiscordHourlyMarketDigest(): Promise<JobResult> {
  if (!isDiscordPostingRuntimeAllowed()) {
    return buildNoopJobResult();
  }

  const config = getDiscordRuntimeConfig();
  const channelId = config.hourlyChannelId;

  if (!config.botToken || !channelId) {
    return buildNoopJobResult();
  }

  await ensureDiscordSchema();

  const now = new Date();
  const hourSnapshot = getEtHourSnapshot(now);
  const sourceKey = `hour:${hourSnapshot.key}`;

  const alreadyPosted = await hasDiscordPost({
    channelId,
    sourceType: "hourly_digest",
    sourceKey,
  });

  if (alreadyPosted) {
    return {
      requestCount: 0,
      recordsProcessed: 0,
      errorCount: 0,
    };
  }

  const overview = await buildMobileMarketOverview({ sport: "ALL" });
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [tradeStats1h] = await db
    .select({
      tradeCount: sql<number>`COUNT(*)`,
      volume: sql<number>`COALESCE(SUM(${trades.price} * ${trades.quantity}), 0)`,
    })
    .from(trades)
    .where(gte(trades.executedAt, oneHourAgo));

  const [tradeStats24h] = await db
    .select({
      tradeCount: sql<number>`COUNT(*)`,
    })
    .from(trades)
    .where(gte(trades.executedAt, oneDayAgo));

  const movers = overview.leaderboards.risers.slice(0, 3);
  const moverLines = buildTopMoverLines(movers);

  const digestLines = [
    `**Sportfolio Hourly Market Update (${hourSnapshot.label})**`,
    "",
    "**Top Movers (24h)**",
    ...moverLines,
    "",
    `24h Volume: ${formatCurrency(overview.marketIndicators.totalVolume24h)}`,
    `Trades (1h): ${Number(tradeStats1h?.tradeCount || 0).toLocaleString("en-US")}`,
    `Trades (24h): ${Number(tradeStats24h?.tradeCount || 0).toLocaleString("en-US")}`,
    `Volume (1h): ${formatCurrency(Number(tradeStats1h?.volume || 0))}`,
    `Market Health: ${overview.marketIndicators.healthLabel} (${overview.marketIndicators.healthScore}/100)`,
    `Volatility Index: ${overview.marketIndicators.volatilityIndex.toFixed(2)}`,
    `Liquidity Health: ${overview.marketIndicators.liquidityHealth.toFixed(2)}`,
    `Breadth: +${overview.marketIndicators.breadth.risers} / -${overview.marketIndicators.breadth.fallers} / =${overview.marketIndicators.breadth.flat}`,
    `Total Pool Shares: ${overview.marketIndicators.totalPoolShares.toLocaleString("en-US")}`,
    `Market TVL: ${formatCurrency(overview.marketIndicators.totalMarketTvl)}`,
    `Open Market: ${config.publicSiteUrl}/pools`,
  ];

  const postResult = await postDiscordChannelMessage(channelId, {
    content: digestLines.join("\n"),
    allowed_mentions: { parse: [] },
  });

  if (!postResult.ok || !postResult.data?.id) {
    console.warn(
      `[discord_hourly_market_digest] Failed to post digest ${sourceKey}: status=${postResult.status} error=${postResult.error?.message || "unknown"}`,
    );
    return {
      requestCount: 1,
      recordsProcessed: 0,
      errorCount: 1,
    };
  }

  await recordDiscordPost({
    channelId,
    sourceType: "hourly_digest",
    sourceKey,
    discordMessageId: postResult.data.id,
  });

  return {
    requestCount: 1,
    recordsProcessed: 1,
    errorCount: 0,
  };
}
