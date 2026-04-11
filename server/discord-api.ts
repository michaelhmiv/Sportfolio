import { getDiscordRuntimeConfig } from "./discord-config";

const DISCORD_API_BASE = "https://discord.com/api/v10";

interface DiscordApiError {
  message: string;
  code?: number;
}

interface DiscordApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: DiscordApiError;
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

export async function postDiscordChannelMessage(
  channelId: string,
  payload: DiscordChannelMessagePayload,
): Promise<DiscordApiResponse<{ id: string }>> {
  const config = getDiscordRuntimeConfig();
  if (!config.botToken) {
    return {
      ok: false,
      status: 503,
      error: { message: "DISCORD_BOT_TOKEN is not configured" },
    };
  }

  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${config.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorPayload: DiscordApiError | undefined;
    try {
      errorPayload = (await response.json()) as DiscordApiError;
    } catch {
      errorPayload = { message: `Discord API request failed with status ${response.status}` };
    }

    return {
      ok: false,
      status: response.status,
      error: errorPayload,
    };
  }

  const data = (await response.json()) as { id: string };

  return {
    ok: true,
    status: response.status,
    data,
  };
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
          type: 10,
          name: "sb_amount",
          description: "Sportfolio Bucks to spend",
          required: true,
          min_value: 0.01,
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
          type: 4,
          name: "shares",
          description: "Whole shares to sell",
          required: true,
          min_value: 1,
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
          type: 4,
          name: "shares",
          description: "Even share count (minimum 4)",
          required: true,
          min_value: 4,
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
              name: "sport",
              description: "Sport",
              required: true,
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
          name: "live",
          description: "View live boosts for a sport",
          options: [
            {
              type: 3,
              name: "sport",
              description: "Sport",
              required: true,
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

  const response = await fetch(
    `${DISCORD_API_BASE}/applications/${config.appId}/guilds/${config.guildId}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${config.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildDiscordSlashCommandDefinitions()),
    },
  );

  if (!response.ok) {
    let errorPayload: DiscordApiError | undefined;
    try {
      errorPayload = (await response.json()) as DiscordApiError;
    } catch {
      errorPayload = { message: `Discord API request failed with status ${response.status}` };
    }

    return {
      ok: false,
      status: response.status,
      error: errorPayload,
    };
  }

  const data = (await response.json()) as unknown;

  return {
    ok: true,
    status: response.status,
    data,
  };
}
