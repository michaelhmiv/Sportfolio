export interface DiscordRuntimeConfig {
  enabled: boolean;
  appId: string | null;
  botToken: string | null;
  publicKey: string | null;
  guildId: string | null;
  newsChannelId: string | null;
  hourlyChannelId: string | null;
  mutationRoleId: string | null;
  reportModRoleId: string | null;
  bugForumChannelId: string | null;
  featureForumChannelId: string | null;
  linkStateSecret: string | null;
  githubIssueToken: string | null;
  githubIssueOwner: string;
  githubIssueRepo: string;
  reportingEnabled: boolean;
  publicSiteUrl: string;
}

function normalizeOptional(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolvePublicSiteUrl(): string {
  const explicit =
    process.env.PUBLIC_SITE_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    process.env.VITE_PUBLIC_SITE_URL?.trim();

  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  return "http://localhost:5000";
}

export function getDiscordRuntimeConfig(): DiscordRuntimeConfig {
  const appId = normalizeOptional(process.env.DISCORD_APP_ID);
  const botToken = normalizeOptional(process.env.DISCORD_BOT_TOKEN);
  const publicKey = normalizeOptional(process.env.DISCORD_PUBLIC_KEY);
  const guildId = normalizeOptional(process.env.DISCORD_GUILD_ID);
  const linkStateSecret = normalizeOptional(process.env.DISCORD_LINK_STATE_SECRET);
  const bugForumChannelId = normalizeOptional(process.env.DISCORD_BUG_FORUM_CHANNEL_ID);
  const featureForumChannelId = normalizeOptional(process.env.DISCORD_FEATURE_FORUM_CHANNEL_ID);
  const reportModRoleId = normalizeOptional(process.env.DISCORD_REPORT_MOD_ROLE_ID);
  const githubIssueToken = normalizeOptional(process.env.GITHUB_ISSUE_SYNC_TOKEN);
  const githubIssueOwner = normalizeOptional(process.env.GITHUB_ISSUE_OWNER) || "michaelhmiv";
  const githubIssueRepo = normalizeOptional(process.env.GITHUB_ISSUE_REPO) || "Sportfolio";

  const enabled = Boolean(appId && botToken && publicKey && guildId && linkStateSecret);
  const reportingEnabled = Boolean(
    botToken &&
    guildId &&
    reportModRoleId &&
    bugForumChannelId &&
    featureForumChannelId &&
    githubIssueToken,
  );

  return {
    enabled,
    appId,
    botToken,
    publicKey,
    guildId,
    newsChannelId: normalizeOptional(process.env.DISCORD_NEWS_CHANNEL_ID),
    hourlyChannelId: normalizeOptional(process.env.DISCORD_HOURLY_CHANNEL_ID),
    mutationRoleId: normalizeOptional(process.env.DISCORD_MUTATION_ROLE_ID),
    reportModRoleId,
    bugForumChannelId,
    featureForumChannelId,
    linkStateSecret,
    githubIssueToken,
    githubIssueOwner,
    githubIssueRepo,
    reportingEnabled,
    publicSiteUrl: resolvePublicSiteUrl(),
  };
}
