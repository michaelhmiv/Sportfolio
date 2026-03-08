import {
  Devvit,
  RichTextBuilder,
  SettingScope,
  type Devvit as DevvitNamespace,
} from "@devvit/public-api";

Devvit.configure({
  http: {
    domains: ["www.sportfolio.market", "sportfolio.market"],
  },
  media: true,
  redditAPI: true,
  redis: true,
});

const JOB_NAME = "sportfolio-daily-market-tick";
const JOB_CRON = "*/15 * * * *";
const DEFAULT_API_BASE_URL = "https://www.sportfolio.market";
const DEFAULT_TITLE_TEMPLATE = "Sportfolio {label} | {date} | {sports}";
const DEFAULT_SPORT_FILTERS = "NBA,NFL,MLB,NASCAR";
const POST_TYPES = ["morning_recap", "pregame_preview"] as const;
const ET_TIMEZONE = "America/New_York";
const BACKOFF_MS = 30 * 60 * 1000;
const DISABLE_TTL_SECONDS = 60 * 60 * 48;
const IMAGE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PREVIEW_TEXT_LIMIT = 4000;

const SETTINGS = {
  apiBaseUrl: "sportfolio-api-base-url",
  botToken: "sportfolio-reddit-bot-token",
  morningEnabled: "morning-enabled",
  pregameEnabled: "pregame-enabled",
  morningTimeEt: "morning-time-et",
  pregameTimeEt: "pregame-time-et",
  sportFilters: "sport-filters",
  titleTemplate: "title-template",
  stickyPosts: "sticky-posts",
  lockPosts: "lock-posts",
  enableImages: "enable-images",
  enableSummons: "enable-summons",
} as const;

type PostType = (typeof POST_TYPES)[number];

type BotSettings = {
  apiBaseUrl: string;
  botToken: string;
  morningEnabled: boolean;
  pregameEnabled: boolean;
  morningTimeEt: string;
  pregameTimeEt: string;
  sports: string[];
  titleTemplate: string;
  stickyPosts: boolean;
  lockPosts: boolean;
  enableImages: boolean;
  enableSummons: boolean;
};

type TickJobData = {
  subredditName: string;
};

type PreviewResponse = {
  subreddit: string;
  postType: PostType;
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

type ReportPayload = {
  subreddit: string;
  postType: PostType;
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

type RunPostOptions = {
  subredditName: string;
  postType: PostType;
  force?: boolean;
  includeImage?: boolean;
  source: "scheduled" | "manual";
};

type PreviewFormData = {
  postType: PostType;
  subreddit: string;
  previewTitle: string;
  previewBody: string;
  includeImageDefault: boolean;
};

type RuntimeContext = Pick<
  DevvitNamespace.Context,
  "cache" | "media" | "reddit" | "redis" | "scheduler" | "settings" | "subredditName"
>;
type UiContext = RuntimeContext & Pick<DevvitNamespace.Context, "ui">;

Devvit.addSettings([
  {
    type: "string",
    name: SETTINGS.apiBaseUrl,
    label: "Sportfolio API Base URL",
    helpText: "Public HTTPS origin used for Reddit preview and report calls.",
    defaultValue: DEFAULT_API_BASE_URL,
    scope: SettingScope.App,
    onValidate: ({ value }) =>
      !value || /^https:\/\/[^/\s]+/i.test(value.trim()) ? undefined : "Use a public HTTPS origin.",
  },
  {
    type: "string",
    name: SETTINGS.botToken,
    label: "Sportfolio Reddit Bot Token",
    helpText:
      "Bearer token used by the Devvit app to call Sportfolio Reddit integration endpoints.",
    scope: SettingScope.App,
    isSecret: true,
    onValidate: ({ value }) =>
      value && value.trim().length >= 16 ? undefined : "Token is required.",
  },
  {
    type: "boolean",
    name: SETTINGS.morningEnabled,
    label: "Enable Morning Recap",
    helpText: "Create the morning recap thread for this subreddit.",
    scope: SettingScope.Installation,
    defaultValue: true,
  },
  {
    type: "boolean",
    name: SETTINGS.pregameEnabled,
    label: "Enable Pre-Game Preview",
    helpText: "Create the afternoon pre-game preview thread for this subreddit.",
    scope: SettingScope.Installation,
    defaultValue: true,
  },
  {
    type: "string",
    name: SETTINGS.morningTimeEt,
    label: "Morning Recap Time (ET)",
    helpText: "24-hour ET time, for example 08:00.",
    scope: SettingScope.Installation,
    defaultValue: "08:00",
    onValidate: ({ value }) => (isValidTime(value) ? undefined : "Use HH:MM in 24-hour ET time."),
  },
  {
    type: "string",
    name: SETTINGS.pregameTimeEt,
    label: "Pre-Game Preview Time (ET)",
    helpText: "24-hour ET time, for example 16:00.",
    scope: SettingScope.Installation,
    defaultValue: "16:00",
    onValidate: ({ value }) => (isValidTime(value) ? undefined : "Use HH:MM in 24-hour ET time."),
  },
  {
    type: "string",
    name: SETTINGS.sportFilters,
    label: "Sport Filters",
    helpText: "Comma-separated sports to include, for example NBA,NFL,MLB,NASCAR.",
    scope: SettingScope.Installation,
    defaultValue: DEFAULT_SPORT_FILTERS,
  },
  {
    type: "string",
    name: SETTINGS.titleTemplate,
    label: "Title Template",
    helpText: "Supports {label}, {date}, and {sports}.",
    scope: SettingScope.Installation,
    defaultValue: DEFAULT_TITLE_TEMPLATE,
  },
  {
    type: "boolean",
    name: SETTINGS.stickyPosts,
    label: "Sticky Posted Threads",
    helpText: "Pin Sportfolio bot threads after posting.",
    scope: SettingScope.Installation,
    defaultValue: true,
  },
  {
    type: "boolean",
    name: SETTINGS.lockPosts,
    label: "Lock Posted Threads",
    helpText: "Lock the thread immediately after posting.",
    scope: SettingScope.Installation,
    defaultValue: false,
  },
  {
    type: "boolean",
    name: SETTINGS.enableImages,
    label: "Attach Market Card Image",
    helpText: "Upload the signed preview card image into the thread body when available.",
    scope: SettingScope.Installation,
    defaultValue: true,
  },
  {
    type: "boolean",
    name: SETTINGS.enableSummons,
    label: "Enable Summon Commands",
    helpText: "Reserved for later comment-trigger rollout.",
    scope: SettingScope.Installation,
    defaultValue: false,
  },
]);

const previewForm = Devvit.createForm(
  (data) => {
    const values = data as PreviewFormData;

    return {
      title: "Preview Reddit Thread",
      acceptLabel: "Save",
      cancelLabel: "Close",
      fields: [
        {
          type: "string",
          name: "postType",
          label: "Post Type",
          defaultValue: values.postType,
          helpText: "Leave unchanged unless you want to post a different slot.",
        },
        {
          type: "string",
          name: "subreddit",
          label: "Subreddit",
          defaultValue: values.subreddit,
        },
        {
          type: "paragraph",
          name: "previewTitle",
          label: "Preview Title",
          defaultValue: values.previewTitle,
        },
        {
          type: "paragraph",
          name: "previewBody",
          label: "Preview Body",
          defaultValue: values.previewBody,
        },
        {
          type: "boolean",
          name: "postNow",
          label: "Post this thread now",
          defaultValue: false,
        },
        {
          type: "boolean",
          name: "includeImage",
          label: "Attach market card image",
          defaultValue: values.includeImageDefault,
        },
        {
          type: "boolean",
          name: "force",
          label: "Force past pending lock",
          defaultValue: false,
        },
      ],
    };
  },
  async (event, context) => {
    const postType = parsePostType(event.values.postType);
    const subredditName = normalizeSubredditName(event.values.subreddit);

    if (!postType || !subredditName) {
      context.ui.showToast("Preview form is missing a valid subreddit or post type.");
      return;
    }

    if (!event.values.postNow) {
      context.ui.showToast("Preview closed without posting.");
      return;
    }

    await handleUiAction(context, async () => {
      const result = await runPostFlow(context, {
        subredditName,
        postType,
        force: Boolean(event.values.force),
        includeImage: Boolean(event.values.includeImage),
        source: "manual",
      });

      context.ui.showToast(result.toast);
    });
  },
);

const postNowForm = Devvit.createForm(
  {
    title: "Post Now",
    acceptLabel: "Post",
    fields: [
      {
        type: "boolean",
        name: "morningRecap",
        label: "Morning Recap",
        defaultValue: true,
      },
      {
        type: "boolean",
        name: "pregamePreview",
        label: "Pre-Game Preview",
        defaultValue: false,
      },
      {
        type: "boolean",
        name: "includeImage",
        label: "Attach market card image",
        defaultValue: true,
      },
      {
        type: "boolean",
        name: "force",
        label: "Force past pending lock",
        defaultValue: true,
      },
    ],
  },
  async (event, context) => {
    const postType = resolveSingleSelectedPostType(
      Boolean(event.values.morningRecap),
      Boolean(event.values.pregamePreview),
    );

    if (!postType) {
      context.ui.showToast("Select exactly one post type.");
      return;
    }

    await handleUiAction(context, async () => {
      const result = await runPostFlow(context, {
        subredditName: await resolveSubredditName(context),
        postType,
        force: Boolean(event.values.force),
        includeImage: Boolean(event.values.includeImage),
        source: "manual",
      });

      context.ui.showToast(result.toast);
    });
  },
);

const disableTodayForm = Devvit.createForm(
  {
    title: "Disable Today",
    acceptLabel: "Disable",
    fields: [
      {
        type: "boolean",
        name: "morningRecap",
        label: "Disable Morning Recap",
        defaultValue: true,
      },
      {
        type: "boolean",
        name: "pregamePreview",
        label: "Disable Pre-Game Preview",
        defaultValue: false,
      },
    ],
  },
  async (event, context) => {
    const postTypes = collectSelectedPostTypes(
      Boolean(event.values.morningRecap),
      Boolean(event.values.pregamePreview),
    );

    if (postTypes.length === 0) {
      context.ui.showToast("Select at least one post type to disable.");
      return;
    }

    await handleUiAction(context, async () => {
      const subredditName = await resolveSubredditName(context);
      const marketDay = getEtMarketDay();
      await disablePostTypesForToday(context, subredditName, marketDay, postTypes);
      context.ui.showToast(`Disabled ${postTypes.join(", ")} for ${marketDay}.`);
    });
  },
);

const retryFailedForm = Devvit.createForm(
  {
    title: "Retry Last Failed Post",
    acceptLabel: "Retry",
    fields: [
      {
        type: "boolean",
        name: "morningRecap",
        label: "Retry Morning Recap",
        defaultValue: true,
      },
      {
        type: "boolean",
        name: "pregamePreview",
        label: "Retry Pre-Game Preview",
        defaultValue: false,
      },
      {
        type: "boolean",
        name: "includeImage",
        label: "Attach market card image",
        defaultValue: true,
      },
    ],
  },
  async (event, context) => {
    const postType = resolveSingleSelectedPostType(
      Boolean(event.values.morningRecap),
      Boolean(event.values.pregamePreview),
    );

    if (!postType) {
      context.ui.showToast("Select exactly one post type.");
      return;
    }

    await handleUiAction(context, async () => {
      const result = await runPostFlow(context, {
        subredditName: await resolveSubredditName(context),
        postType,
        force: true,
        includeImage: Boolean(event.values.includeImage),
        source: "manual",
      });

      context.ui.showToast(result.toast);
    });
  },
);

Devvit.addMenuItem({
  label: "Preview Morning Recap",
  location: "subreddit",
  forUserType: "moderator",
  onPress: async (_event, context) => {
    await handleUiAction(context, async () => {
      await openPreviewForm(context, "morning_recap");
    });
  },
});

Devvit.addMenuItem({
  label: "Preview Pre-Game Preview",
  location: "subreddit",
  forUserType: "moderator",
  onPress: async (_event, context) => {
    await handleUiAction(context, async () => {
      await openPreviewForm(context, "pregame_preview");
    });
  },
});

Devvit.addMenuItem({
  label: "Post Now",
  location: "subreddit",
  forUserType: "moderator",
  onPress: (_event, context) => {
    context.ui.showForm(postNowForm);
  },
});

Devvit.addMenuItem({
  label: "Disable Today",
  location: "subreddit",
  forUserType: "moderator",
  onPress: (_event, context) => {
    context.ui.showForm(disableTodayForm);
  },
});

Devvit.addMenuItem({
  label: "Retry Last Failed Post",
  location: "post",
  postFilter: "currentApp",
  forUserType: "moderator",
  onPress: (_event, context) => {
    context.ui.showForm(retryFailedForm);
  },
});

Devvit.addSchedulerJob<TickJobData>({
  name: JOB_NAME,
  onRun: async (event, context) => {
    const subredditName = normalizeSubredditName(
      event.data?.subredditName || context.subredditName || "",
    );
    if (!subredditName) {
      console.error("[sportfoliobot] Scheduler job missing subreddit context.");
      return;
    }

    try {
      const settings = await loadSettings(context);
      const issues = validateSettings(settings);
      if (issues.length > 0) {
        console.error(`[sportfoliobot] ${subredditName} misconfigured: ${issues.join("; ")}`);
        return;
      }

      const nowMinutes = getEtMinutes();
      const duePostTypes: PostType[] = [];

      if (settings.morningEnabled && isDueNow(settings.morningTimeEt, nowMinutes)) {
        duePostTypes.push("morning_recap");
      }

      if (settings.pregameEnabled && isDueNow(settings.pregameTimeEt, nowMinutes)) {
        duePostTypes.push("pregame_preview");
      }

      if (duePostTypes.length === 0) {
        return;
      }

      for (const postType of duePostTypes) {
        const result = await runPostFlow(context, {
          subredditName,
          postType,
          force: false,
          includeImage: settings.enableImages,
          source: "scheduled",
        });

        console.log(`[sportfoliobot] ${subredditName} ${postType}: ${result.toast}`);
      }
    } catch (error: any) {
      console.error("[sportfoliobot] Scheduled tick failed:", error?.message || error);
    }
  },
});

Devvit.addTrigger({
  events: ["AppInstall", "AppUpgrade"],
  onEvent: async (_event, context) => {
    const subredditName = normalizeSubredditName(context.subredditName || "");
    if (!subredditName) {
      console.error("[sportfoliobot] Install/upgrade trigger missing subreddit context.");
      return;
    }

    try {
      await ensureSchedulerJob(context, subredditName);
      const settings = await loadSettings(context);
      const issues = validateSettings(settings);

      await context.redis.hSet(getInstallationRegistryKey(), {
        [subredditName]: JSON.stringify({
          updatedAt: new Date().toISOString(),
          issues,
        }),
      });

      if (issues.length > 0) {
        console.error(
          `[sportfoliobot] ${subredditName} configuration issues: ${issues.join("; ")}`,
        );
        return;
      }

      console.log(`[sportfoliobot] Installation ready for r/${subredditName}.`);
    } catch (error: any) {
      console.error("[sportfoliobot] Install/upgrade trigger failed:", error?.message || error);
    }
  },
});

async function handleUiAction(context: UiContext, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error: any) {
    console.error("[sportfoliobot] UI action failed:", error?.message || error);
    context.ui.showToast(error?.message || "Sportfoliobot action failed.");
  }
}

async function openPreviewForm(context: UiContext, postType: PostType): Promise<void> {
  const settings = await loadSettings(context);
  const issues = validateSettings(settings);
  if (issues.length > 0) {
    throw new Error(issues.join("; "));
  }

  const subredditName = await resolveSubredditName(context);
  const preview = await requestPreview(settings, {
    subreddit: subredditName,
    postType,
    sports: settings.sports,
    reserve: false,
    force: false,
    titleTemplate: settings.titleTemplate,
  });

  context.ui.showForm(previewForm, {
    postType: preview.postType,
    subreddit: preview.subreddit,
    previewTitle: preview.title,
    previewBody: preview.markdown.slice(0, PREVIEW_TEXT_LIMIT),
    includeImageDefault: settings.enableImages,
  });
}

async function runPostFlow(
  context: RuntimeContext,
  options: RunPostOptions,
): Promise<{ preview?: PreviewResponse; toast: string }> {
  const subredditName = normalizeSubredditName(options.subredditName);
  const settings = await loadSettings(context);
  const issues = validateSettings(settings);
  if (issues.length > 0) {
    throw new Error(issues.join("; "));
  }

  const marketDay = getEtMarketDay();
  const disabled = await isPostTypeDisabled(context, subredditName, marketDay, options.postType);
  if (disabled && !options.force) {
    return { toast: `${options.postType} is disabled for ${marketDay}.` };
  }

  const backoffKey = getBackoffKey(subredditName, options.postType);
  if (options.source === "scheduled" && !options.force) {
    const isBackingOff = await context.redis.get(backoffKey);
    if (isBackingOff) {
      return { toast: `${options.postType} is backing off after a recent failure.` };
    }
  }

  const preview = await requestPreview(settings, {
    subreddit: subredditName,
    postType: options.postType,
    sports: settings.sports,
    reserve: true,
    force: Boolean(options.force),
    marketDay,
    titleTemplate: settings.titleTemplate,
  });

  if (!preview.shouldPost) {
    return {
      preview,
      toast: preview.reason
        ? `${preview.summary.label} skipped: ${preview.reason}.`
        : `${preview.summary.label} is not ready to post.`,
    };
  }

  try {
    const imageAsset =
      settings.enableImages && options.includeImage !== false
        ? await uploadPreviewImage(context, preview)
        : null;
    const post = await submitPreviewPost(context, preview, imageAsset?.mediaId || null);

    if (settings.stickyPosts) {
      try {
        await post.sticky();
      } catch (error: any) {
        console.warn("[sportfoliobot] Could not sticky post:", error?.message || error);
      }
    }

    if (settings.lockPosts) {
      try {
        await post.lock();
      } catch (error: any) {
        console.warn("[sportfoliobot] Could not lock post:", error?.message || error);
      }
    }

    await reportPost(settings, {
      subreddit: subredditName,
      postType: options.postType,
      marketDay: preview.marketDay,
      contentHash: preview.contentHash,
      status: "posted",
      title: preview.title,
      markdown: preview.markdown,
      redditPostId: post.id,
      redditPostUrl: post.url,
      imageUrl: imageAsset?.mediaUrl || null,
      metadata: {
        source: options.source,
        sticky: settings.stickyPosts,
        locked: settings.lockPosts,
      },
    });

    await context.redis.del(backoffKey);
    await context.redis.hSet(getLastPostedKey(subredditName), {
      [options.postType]: JSON.stringify({
        postedAt: new Date().toISOString(),
        postId: post.id,
        marketDay: preview.marketDay,
      }),
    });

    return { preview, toast: `${preview.summary.label} posted: ${post.id}` };
  } catch (error: any) {
    const message = error?.message || String(error);

    try {
      await reportPost(settings, {
        subreddit: subredditName,
        postType: options.postType,
        marketDay: preview.marketDay,
        contentHash: preview.contentHash,
        status: "failed",
        title: preview.title,
        markdown: preview.markdown,
        imageUrl: preview.imageUrl,
        errorMessage: message,
        metadata: {
          source: options.source,
        },
      });
    } catch (reportError: any) {
      console.error(
        "[sportfoliobot] Failed to report posting failure:",
        reportError?.message || reportError,
      );
    }

    await context.redis.set(backoffKey, new Date().toISOString(), {
      expiration: new Date(Date.now() + BACKOFF_MS),
    });

    throw error;
  }
}

async function submitPreviewPost(
  context: RuntimeContext,
  preview: PreviewResponse,
  mediaId: string | null,
) {
  if (!mediaId) {
    return context.reddit.submitPost({
      subredditName: preview.subreddit,
      title: preview.title,
      text: preview.markdown,
    });
  }

  return context.reddit.submitPost({
    subredditName: preview.subreddit,
    title: preview.title,
    richtext: buildRichTextPreview(preview, mediaId),
  });
}

async function uploadPreviewImage(
  context: RuntimeContext,
  preview: PreviewResponse,
): Promise<{ mediaId: string; mediaUrl: string }> {
  return context.cache(
    async () => {
      const asset = await context.media.upload({
        url: preview.imageUrl,
        type: "image",
      });

      return {
        mediaId: asset.mediaId,
        mediaUrl: asset.mediaUrl,
      };
    },
    {
      key: `sportfoliobot:image:${preview.subreddit}:${preview.postType}:${preview.marketDay}:${preview.contentHash}`,
      ttl: IMAGE_CACHE_TTL_MS,
    },
  );
}

async function requestPreview(
  settings: BotSettings,
  payload: {
    subreddit: string;
    postType: PostType;
    sports: string[];
    reserve: boolean;
    force: boolean;
    marketDay?: string;
    titleTemplate: string;
  },
): Promise<PreviewResponse> {
  const response = await fetch(
    buildApiUrl(settings.apiBaseUrl, "/api/integrations/reddit/preview"),
    {
      method: "POST",
      headers: buildJsonHeaders(settings.botToken),
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(`Preview request failed (${response.status}).`);
  }

  return (await response.json()) as PreviewResponse;
}

async function reportPost(settings: BotSettings, payload: ReportPayload): Promise<void> {
  const response = await fetch(
    buildApiUrl(settings.apiBaseUrl, "/api/integrations/reddit/report"),
    {
      method: "POST",
      headers: buildJsonHeaders(settings.botToken),
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(`Report request failed (${response.status}).`);
  }
}

function buildRichTextPreview(preview: PreviewResponse, mediaId: string): RichTextBuilder {
  const builder = new RichTextBuilder();
  builder.image({
    mediaId,
    caption: preview.summary.label,
  });

  const blocks = preview.markdown
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 1 && lines[0].startsWith("## ")) {
      builder.heading({ level: 2 }, (heading) => {
        heading.rawText(stripMarkdown(lines[0].slice(3)));
      });
      continue;
    }

    if (lines.every((line) => line.startsWith("- "))) {
      builder.list({ ordered: false }, (list) => {
        lines.forEach((line) => {
          list.item((item) => {
            item.paragraph((paragraph) => {
              paragraph.text({ text: stripMarkdown(line.slice(2)) });
            });
          });
        });
      });
      continue;
    }

    builder.paragraph((paragraph) => {
      paragraph.text({ text: stripMarkdown(lines.join(" ")) });
    });
  }

  return builder;
}

function stripMarkdown(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1: $2")
    .replace(/`/g, "")
    .trim();
}

function buildApiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function buildJsonHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function loadSettings(context: RuntimeContext): Promise<BotSettings> {
  const [
    apiBaseUrl,
    botToken,
    morningEnabled,
    pregameEnabled,
    morningTimeEt,
    pregameTimeEt,
    sportFilters,
    titleTemplate,
    stickyPosts,
    lockPosts,
    enableImages,
    enableSummons,
  ] = await Promise.all([
    context.settings.get<string>(SETTINGS.apiBaseUrl),
    context.settings.get<string>(SETTINGS.botToken),
    context.settings.get<boolean>(SETTINGS.morningEnabled),
    context.settings.get<boolean>(SETTINGS.pregameEnabled),
    context.settings.get<string>(SETTINGS.morningTimeEt),
    context.settings.get<string>(SETTINGS.pregameTimeEt),
    context.settings.get<string>(SETTINGS.sportFilters),
    context.settings.get<string>(SETTINGS.titleTemplate),
    context.settings.get<boolean>(SETTINGS.stickyPosts),
    context.settings.get<boolean>(SETTINGS.lockPosts),
    context.settings.get<boolean>(SETTINGS.enableImages),
    context.settings.get<boolean>(SETTINGS.enableSummons),
  ]);

  return {
    apiBaseUrl: (apiBaseUrl || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, ""),
    botToken: (botToken || "").trim(),
    morningEnabled: morningEnabled ?? true,
    pregameEnabled: pregameEnabled ?? true,
    morningTimeEt: (morningTimeEt || "08:00").trim(),
    pregameTimeEt: (pregameTimeEt || "16:00").trim(),
    sports: parseSportFilters(sportFilters),
    titleTemplate: (titleTemplate || DEFAULT_TITLE_TEMPLATE).trim() || DEFAULT_TITLE_TEMPLATE,
    stickyPosts: stickyPosts ?? true,
    lockPosts: lockPosts ?? false,
    enableImages: enableImages ?? true,
    enableSummons: enableSummons ?? false,
  };
}

function validateSettings(settings: BotSettings): string[] {
  const issues: string[] = [];

  if (!/^https:\/\/[^/\s]+/i.test(settings.apiBaseUrl)) {
    issues.push("SPORTFOLIO_API_BASE_URL must be a public HTTPS origin");
  }

  if (!settings.botToken) {
    issues.push("SPORTFOLIO_REDDIT_BOT_TOKEN is missing");
  }

  if (!isValidTime(settings.morningTimeEt)) {
    issues.push("morning_time_et is invalid");
  }

  if (!isValidTime(settings.pregameTimeEt)) {
    issues.push("pregame_time_et is invalid");
  }

  if (settings.sports.length === 0) {
    issues.push("sport_filters must include at least one sport");
  }

  return issues;
}

function parseSportFilters(value?: string): string[] {
  const source = (value || DEFAULT_SPORT_FILTERS)
    .split(",")
    .map((sport) => sport.trim().toUpperCase())
    .filter(Boolean);

  return source.length > 0 ? Array.from(new Set(source)) : DEFAULT_SPORT_FILTERS.split(",");
}

function isValidTime(value?: string): boolean {
  return Boolean(value && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value.trim()));
}

function isDueNow(timeEt: string, nowMinutes: number): boolean {
  const scheduledMinutes = parseTimeToMinutes(timeEt);
  return nowMinutes >= scheduledMinutes && nowMinutes < scheduledMinutes + 30;
}

function parseTimeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function getEtMinutes(date: Date = new Date()): number {
  const parts = getEtDateParts(date);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function getEtMarketDay(date: Date = new Date()): string {
  const parts = getEtDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getEtDateParts(date: Date): Record<"year" | "month" | "day" | "hour" | "minute", string> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return formatter.formatToParts(date).reduce(
    (accumulator, part) => {
      if (
        part.type === "year" ||
        part.type === "month" ||
        part.type === "day" ||
        part.type === "hour" ||
        part.type === "minute"
      ) {
        accumulator[part.type] = part.value;
      }
      return accumulator;
    },
    {
      year: "0000",
      month: "00",
      day: "00",
      hour: "00",
      minute: "00",
    },
  );
}

async function resolveSubredditName(context: RuntimeContext): Promise<string> {
  return normalizeSubredditName(
    context.subredditName || (await context.reddit.getCurrentSubredditName()),
  );
}

function normalizeSubredditName(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^r\//i, "")
    .toLowerCase();
}

function parsePostType(value?: string): PostType | null {
  return POST_TYPES.includes(value as PostType) ? (value as PostType) : null;
}

function resolveSingleSelectedPostType(
  morningSelected: boolean,
  pregameSelected: boolean,
): PostType | null {
  const selected = collectSelectedPostTypes(morningSelected, pregameSelected);
  return selected.length === 1 ? selected[0] : null;
}

function collectSelectedPostTypes(morningSelected: boolean, pregameSelected: boolean): PostType[] {
  const selected: PostType[] = [];
  if (morningSelected) {
    selected.push("morning_recap");
  }
  if (pregameSelected) {
    selected.push("pregame_preview");
  }
  return selected;
}

async function ensureSchedulerJob(context: RuntimeContext, subredditName: string): Promise<void> {
  const allJobs = await context.scheduler.listJobs();
  const matchingJobs = allJobs.filter((job) => {
    if (job.name !== JOB_NAME) {
      return false;
    }

    const data = job.data as TickJobData | undefined;
    return normalizeSubredditName(data?.subredditName || "") === subredditName;
  });

  if (matchingJobs.length > 1) {
    for (const duplicate of matchingJobs.slice(1)) {
      await context.scheduler.cancelJob(duplicate.id);
    }
  }

  const existing = matchingJobs[0];
  if (existing) {
    await context.redis.hSet(getSchedulerRegistryKey(), {
      [subredditName]: existing.id,
    });
    return;
  }

  const jobId = await context.scheduler.runJob<TickJobData>({
    name: JOB_NAME,
    cron: JOB_CRON,
    data: {
      subredditName,
    },
  });

  await context.redis.hSet(getSchedulerRegistryKey(), {
    [subredditName]: jobId,
  });
}

async function disablePostTypesForToday(
  context: RuntimeContext,
  subredditName: string,
  marketDay: string,
  postTypes: PostType[],
): Promise<void> {
  const key = getDisableKey(subredditName, marketDay);
  const values: Record<string, string> = {};
  postTypes.forEach((postType) => {
    values[postType] = "1";
  });

  await context.redis.hSet(key, values);
  await context.redis.expire(key, DISABLE_TTL_SECONDS);
}

async function isPostTypeDisabled(
  context: RuntimeContext,
  subredditName: string,
  marketDay: string,
  postType: PostType,
): Promise<boolean> {
  const value = await context.redis.hGet(getDisableKey(subredditName, marketDay), postType);
  return value === "1";
}

function getDisableKey(subredditName: string, marketDay: string): string {
  return `sportfoliobot:disable:${subredditName}:${marketDay}`;
}

function getBackoffKey(subredditName: string, postType: PostType): string {
  return `sportfoliobot:backoff:${subredditName}:${postType}`;
}

function getSchedulerRegistryKey(): string {
  return "sportfoliobot:schedulers";
}

function getInstallationRegistryKey(): string {
  return "sportfoliobot:installations";
}

function getLastPostedKey(subredditName: string): string {
  return `sportfoliobot:last-posted:${subredditName}`;
}

export default Devvit;
