import { getDiscordRuntimeConfig } from "./discord-config";

const DISCORD_API_BASE = "https://discord.com/api/v10";

interface DiscordApiError {
  message: string;
  code?: number;
}

export interface DiscordApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: DiscordApiError;
}

export interface DiscordChannelObject {
  id: string;
  type: number;
  guild_id?: string;
  parent_id?: string | null;
  name?: string;
}

export interface DiscordMessageAuthor {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DiscordMessageAttachment {
  id: string;
  filename: string;
  url: string;
  content_type?: string | null;
  size?: number;
}

export interface DiscordMessageObject {
  id: string;
  channel_id: string;
  type: number;
  content: string;
  timestamp: string;
  author: DiscordMessageAuthor;
  attachments: DiscordMessageAttachment[];
}

export interface DiscordChannelMessagePayload {
  content?: string;
  embeds?: Array<Record<string, unknown>>;
  components?: Array<Record<string, unknown>>;
  flags?: number;
  allowed_mentions?: {
    parse?: string[];
  };
}

function buildDiscordRequestHeaders(botToken: string, includeJsonContentType: boolean) {
  return {
    Authorization: `Bot ${botToken}`,
    ...(includeJsonContentType ? { "Content-Type": "application/json" } : {}),
  };
}

async function parseDiscordApiError(response: Response): Promise<DiscordApiError> {
  try {
    return (await response.json()) as DiscordApiError;
  } catch {
    return { message: `Discord API request failed with status ${response.status}` };
  }
}

async function requestDiscordApi<T>(
  path: string,
  input: {
    method?: "GET" | "POST" | "PUT";
    body?: unknown;
  } = {},
): Promise<DiscordApiResponse<T>> {
  const config = getDiscordRuntimeConfig();
  if (!config.botToken) {
    return {
      ok: false,
      status: 503,
      error: { message: "DISCORD_BOT_TOKEN is not configured" },
    };
  }

  const hasBody = input.body !== undefined;
  const response = await fetch(`${DISCORD_API_BASE}${path}`, {
    method: input.method || "GET",
    headers: buildDiscordRequestHeaders(config.botToken, hasBody),
    ...(hasBody ? { body: JSON.stringify(input.body) } : {}),
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: await parseDiscordApiError(response),
    };
  }

  if (response.status === 204) {
    return {
      ok: true,
      status: response.status,
      data: undefined,
    };
  }

  const data = (await response.json()) as T;

  return {
    ok: true,
    status: response.status,
    data,
  };
}

export async function postDiscordChannelMessage(
  channelId: string,
  payload: DiscordChannelMessagePayload,
): Promise<DiscordApiResponse<{ id: string }>> {
  return requestDiscordApi<{ id: string }>(`/channels/${channelId}/messages`, {
    method: "POST",
    body: payload,
  });
}

export async function getDiscordChannel(
  channelId: string,
): Promise<DiscordApiResponse<DiscordChannelObject>> {
  return requestDiscordApi<DiscordChannelObject>(`/channels/${channelId}`);
}

export async function listDiscordChannelMessages(
  channelId: string,
  input: {
    before?: string | null;
    limit?: number;
  } = {},
): Promise<DiscordApiResponse<DiscordMessageObject[]>> {
  const params = new URLSearchParams();
  const requestedLimit = input.limit ?? 100;
  const boundedLimit = Math.max(1, Math.min(requestedLimit, 100));
  params.set("limit", String(boundedLimit));
  if (input.before) {
    params.set("before", input.before);
  }

  return requestDiscordApi<DiscordMessageObject[]>(
    `/channels/${channelId}/messages?${params.toString()}`,
  );
}

export async function addDiscordMessageReaction(
  channelId: string,
  messageId: string,
  emoji = "%E2%9C%85",
): Promise<DiscordApiResponse<null>> {
  return requestDiscordApi<null>(
    `/channels/${channelId}/messages/${messageId}/reactions/${emoji}/@me`,
    { method: "PUT" },
  );
}

export function buildDiscordSlashCommandDefinitions() {
  return [
    {
      name: "start",
      description: "Start Sportfolio onboarding in Discord",
      type: 1,
    },
    {
      name: "help",
      description: "Show Sportfolio Discord commands",
      type: 1,
    },
    {
      name: "link",
      description: "Link your Discord user to your Sportfolio account",
      type: 1,
    },
    {
      name: "portfolio",
      description: "View your Sportfolio account summary",
      type: 1,
      options: [
        {
          type: 3,
          name: "sport",
          description: "Optional sport filter",
          required: false,
          choices: [
            { name: "ALL", value: "ALL" },
            { name: "NBA", value: "NBA" },
            { name: "NFL", value: "NFL" },
            { name: "MLB", value: "MLB" },
            { name: "NASCAR", value: "NASCAR" },
          ],
        },
        {
          type: 3,
          name: "view",
          description: "Holding type view",
          required: false,
          choices: [
            { name: "all", value: "all" },
            { name: "stacked", value: "stacked" },
            { name: "regular", value: "regular" },
          ],
        },
        {
          type: 4,
          name: "limit",
          description: "Rows to show",
          required: false,
          min_value: 1,
          max_value: 20,
        },
      ],
    },
    {
      name: "player",
      description: "Look up a player market summary",
      type: 1,
      options: [
        {
          type: 3,
          name: "player",
          description: "Player name or id",
          required: true,
          autocomplete: true,
        },
      ],
    },
    {
      name: "buy",
      description: "Preview and confirm a market buy",
      type: 1,
      options: [
        {
          type: 3,
          name: "player",
          description: "Player name or id",
          required: true,
          autocomplete: true,
        },
        {
          type: 3,
          name: "amount",
          description: "Spend amount (e.g. 25, 50%, max)",
          required: true,
        },
        {
          type: 10,
          name: "max_slippage",
          description: "Max slippage as decimal (default 0.05)",
          required: false,
          min_value: 0.001,
          max_value: 0.5,
        },
      ],
    },
    {
      name: "sell",
      description: "Preview and confirm a market sell",
      type: 1,
      options: [
        {
          type: 3,
          name: "player",
          description: "Player name or id",
          required: true,
          autocomplete: true,
        },
        {
          type: 3,
          name: "amount",
          description: "Shares to sell (e.g. 10, 50%, max)",
          required: true,
        },
        {
          type: 10,
          name: "max_slippage",
          description: "Max slippage as decimal (default 0.05)",
          required: false,
          min_value: 0.001,
          max_value: 0.5,
        },
      ],
    },
    {
      name: "stack",
      description: "Stack (condense) shares using existing stack rules",
      type: 1,
      options: [
        {
          type: 3,
          name: "player",
          description: "Player name or id",
          required: true,
          autocomplete: true,
        },
        {
          type: 3,
          name: "amount",
          description: "Shares to stack (e.g. 4, 50%, max)",
          required: true,
        },
      ],
    },
    {
      name: "market",
      description: "View current market movers and indicators",
      type: 1,
      options: [
        {
          type: 3,
          name: "sport",
          description: "Optional sport filter",
          required: false,
          choices: [
            { name: "ALL", value: "ALL" },
            { name: "NBA", value: "NBA" },
            { name: "NFL", value: "NFL" },
            { name: "MLB", value: "MLB" },
            { name: "NASCAR", value: "NASCAR" },
          ],
        },
      ],
    },
    {
      name: "news",
      description: "View latest Sportfolio news feed items",
      type: 1,
      options: [
        {
          type: 4,
          name: "limit",
          description: "Number of stories",
          required: false,
          min_value: 1,
          max_value: 10,
        },
      ],
    },
    {
      name: "boost",
      description: "Daily boost actions",
      type: 1,
      options: [
        {
          type: 1,
          name: "eligible",
          description: "List eligible boost players",
          options: [
            {
              type: 3,
              name: "sport",
              description: "Sport",
              required: false,
              choices: [
                { name: "NBA", value: "NBA" },
                { name: "NFL", value: "NFL" },
                { name: "MLB", value: "MLB" },
                { name: "NASCAR", value: "NASCAR" },
              ],
            },
            {
              type: 3,
              name: "date",
              description: "Date in YYYY-MM-DD (ET)",
              required: false,
            },
          ],
        },
        {
          type: 1,
          name: "assign",
          description: "Assign a boost slot",
          options: [
            {
              type: 3,
              name: "player",
              description: "Player name or id",
              required: true,
              autocomplete: true,
            },
            {
              type: 4,
              name: "slot",
              description: "Slot multiplier",
              required: true,
              choices: [
                { name: "2x", value: 2 },
                { name: "3x", value: 3 },
                { name: "4x", value: 4 },
                { name: "5x", value: 5 },
              ],
            },
            {
              type: 3,
              name: "date",
              description: "Date in YYYY-MM-DD (ET)",
              required: false,
            },
          ],
        },
        {
          type: 1,
          name: "live",
          description: "View live boosts for a sport",
          options: [
            {
              type: 3,
              name: "sport",
              description: "Sport",
              required: false,
              choices: [
                { name: "NBA", value: "NBA" },
                { name: "NFL", value: "NFL" },
                { name: "MLB", value: "MLB" },
                { name: "NASCAR", value: "NASCAR" },
              ],
            },
          ],
        },
        {
          type: 1,
          name: "remove",
          description: "Remove an active boost by id",
          options: [
            {
              type: 3,
              name: "boost_id",
              description: "Boost id",
              required: true,
            },
          ],
        },
      ],
    },
    {
      name: "scout",
      description: "Scout assignment actions",
      type: 1,
      options: [
        {
          type: 1,
          name: "status",
          description: "View your scout status",
        },
        {
          type: 1,
          name: "assign",
          description: "Assign scouts to a player",
          options: [
            {
              type: 3,
              name: "player",
              description: "Player name or id",
              required: true,
              autocomplete: true,
            },
            {
              type: 4,
              name: "count",
              description: "Number of scouts",
              required: true,
              min_value: 0,
            },
          ],
        },
        {
          type: 1,
          name: "roster",
          description: "View scout roster for a player",
          options: [
            {
              type: 3,
              name: "player",
              description: "Player name or id",
              required: true,
              autocomplete: true,
            },
          ],
        },
      ],
    },
    {
      name: "report",
      description: "Closed-testing report actions",
      type: 1,
      options: [
        {
          type: 1,
          name: "submit",
          description: "Submit this report thread to GitHub issues",
        },
      ],
    },
  ];
}

export async function syncDiscordGuildCommands(): Promise<DiscordApiResponse<unknown>> {
  const config = getDiscordRuntimeConfig();
  if (!config.appId || !config.botToken || !config.guildId) {
    return {
      ok: false,
      status: 503,
      error: { message: "Discord command sync config is incomplete" },
    };
  }

  return requestDiscordApi<unknown>(
    `/applications/${config.appId}/guilds/${config.guildId}/commands`,
    {
      method: "PUT",
      body: buildDiscordSlashCommandDefinitions(),
    },
  );
}
