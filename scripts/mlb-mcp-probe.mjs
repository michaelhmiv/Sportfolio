import { spawn } from "node:child_process";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_TEAM_ID = 147;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RAILWAY_SERVICE = "Sportfolio-Replit";
const DEFAULT_RAILWAY_ENVIRONMENT = "production";
const PROBABLE_PITCHER_HYDRATE = "probablePitcher(note)";
const REMOTE_URL_SENTINEL = "env:HERMES_INTERNAL_MLB_MCP_URL";
const WINDOWS_RAILWAY_CLI =
  process.platform === "win32" && process.env.APPDATA
    ? `${process.env.APPDATA}\\npm\\node_modules\\@railway\\cli\\bin\\railway.js`
    : null;

function printUsage() {
  console.log(`Usage:
  node scripts/mlb-mcp-probe.mjs --url http://127.0.0.1:8081/mcp [--date 2026-03-27] [--team-id 147]

Options:
  --url                  Direct MCP URL to probe
  --date                 Schedule date to inspect (YYYY-MM-DD). Defaults to today (UTC date)
  --team-id              Team id to target. Defaults to 147 (Yankees)
  --game-pk              Explicit gamePk to use for the lineup probe
  --timeout-ms           MCP connect/call timeout. Defaults to 20000
  --auth-bearer          Optional bearer token for the MCP endpoint
  --help                 Show this message`);
}

function formatIsoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function parseIntegerFlag(name, value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const config = {
    url: process.env.HERMES_INTERNAL_MLB_MCP_URL || null,
    date: formatIsoDate(),
    teamId: DEFAULT_TEAM_ID,
    gamePk: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    authBearerToken: process.env.HERMES_INTERNAL_MLB_MCP_AUTH_BEARER || null,
    railwayService: null,
    railwayEnvironment: DEFAULT_RAILWAY_ENVIRONMENT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      case "--url":
        if (!next) throw new Error("Missing value for --url");
        config.url = next;
        index += 1;
        break;
      case "--date":
        if (!next) throw new Error("Missing value for --date");
        config.date = next;
        index += 1;
        break;
      case "--team-id":
        if (!next) throw new Error("Missing value for --team-id");
        config.teamId = parseIntegerFlag("--team-id", next);
        index += 1;
        break;
      case "--game-pk":
        if (!next) throw new Error("Missing value for --game-pk");
        config.gamePk = parseIntegerFlag("--game-pk", next);
        index += 1;
        break;
      case "--timeout-ms":
        if (!next) throw new Error("Missing value for --timeout-ms");
        config.timeoutMs = parseIntegerFlag("--timeout-ms", next);
        index += 1;
        break;
      case "--auth-bearer":
        if (!next) throw new Error("Missing value for --auth-bearer");
        config.authBearerToken = next;
        index += 1;
        break;
      case "--railway-service":
        config.railwayService = next || DEFAULT_RAILWAY_SERVICE;
        if (next) {
          index += 1;
        }
        break;
      case "--railway-environment":
        if (!next) throw new Error("Missing value for --railway-environment");
        config.railwayEnvironment = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (config.railwayService && !config.url) {
    config.url = REMOTE_URL_SENTINEL;
  }

  if (!config.railwayService && !config.url) {
    throw new Error("Provide --url for a direct probe or --railway-service for a Railway probe.");
  }

  return config;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeJsonParse(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractTextContent(content) {
  if (!Array.isArray(content)) return null;
  const texts = content
    .filter((chunk) => isRecord(chunk) && chunk.type === "text" && typeof chunk.text === "string")
    .map((chunk) => chunk.text.trim())
    .filter(Boolean);

  if (texts.length === 0) return null;
  return texts.join("\n\n");
}

function extractToolPayload(result) {
  if (isRecord(result) && "structuredContent" in result && result.structuredContent != null) {
    const structured = result.structuredContent;
    if (isRecord(structured) && "result" in structured && structured.result != null) {
      return structured.result;
    }
    return structured;
  }

  const text = extractTextContent(result?.content);
  const parsed = safeJsonParse(text);
  if (parsed != null) {
    return parsed;
  }

  return {
    text,
    content: Array.isArray(result?.content) ? result.content : [],
  };
}

function normalizePlayerId(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildPlayerMap(players) {
  if (!isRecord(players)) return {};
  return players;
}

function summarizeProbablePitcher(probablePitcher) {
  if (!isRecord(probablePitcher)) return null;

  return {
    id: normalizePlayerId(probablePitcher.id),
    fullName:
      probablePitcher.fullName ||
      (isRecord(probablePitcher.person) ? probablePitcher.person.fullName || null : null),
    note: typeof probablePitcher.note === "string" ? probablePitcher.note : null,
  };
}

function pickScheduleGame(payload, teamId, explicitGamePk) {
  const dates = Array.isArray(payload?.dates) ? payload.dates : [];
  const games = dates.flatMap((dateEntry) =>
    Array.isArray(dateEntry?.games) ? dateEntry.games.filter((game) => isRecord(game)) : [],
  );

  if (explicitGamePk != null) {
    return games.find((game) => game.gamePk === explicitGamePk) || null;
  }

  const matchingGame = games.find((game) => {
    const awayId = game?.teams?.away?.team?.id;
    const homeId = game?.teams?.home?.team?.id;
    return awayId === teamId || homeId === teamId;
  });

  return matchingGame || games[0] || null;
}

function summarizeSchedulePayload(payload, teamId, explicitGamePk) {
  const game = pickScheduleGame(payload, teamId, explicitGamePk);
  if (!isRecord(game)) {
    return {
      gamePk: null,
      status: null,
      awayTeam: null,
      homeTeam: null,
      awayProbablePitcher: null,
      homeProbablePitcher: null,
    };
  }

  return {
    gamePk: normalizePlayerId(game.gamePk),
    gameDate: typeof game.gameDate === "string" ? game.gameDate : null,
    status:
      game?.status?.detailedState ||
      game?.status?.abstractGameState ||
      game?.status?.codedGameState ||
      null,
    awayTeam: game?.teams?.away?.team?.name || null,
    homeTeam: game?.teams?.home?.team?.name || null,
    awayProbablePitcher: summarizeProbablePitcher(game?.teams?.away?.probablePitcher),
    homeProbablePitcher: summarizeProbablePitcher(game?.teams?.home?.probablePitcher),
  };
}

function buildLineup(teamBoxscore) {
  const batters = Array.isArray(teamBoxscore?.batters) ? teamBoxscore.batters : [];
  const players = buildPlayerMap(teamBoxscore?.players);

  return batters.map((rawPlayerId, index) => {
    const playerId = normalizePlayerId(rawPlayerId);
    const player = players[`ID${playerId}`] || players[String(playerId)] || null;

    return {
      slot: index + 1,
      playerId,
      fullName: player?.person?.fullName || null,
      jerseyNumber: player?.jerseyNumber || null,
      position: player?.position?.abbreviation || null,
      battingOrder: player?.battingOrder || null,
    };
  });
}

function summarizeGamePayload(payload) {
  const away = payload?.liveData?.boxscore?.teams?.away || null;
  const home = payload?.liveData?.boxscore?.teams?.home || null;

  return {
    gamePk: normalizePlayerId(payload?.gamePk),
    status:
      payload?.gameData?.status?.detailedState ||
      payload?.gameData?.status?.abstractGameState ||
      null,
    awayTeam: payload?.gameData?.teams?.away?.name || null,
    homeTeam: payload?.gameData?.teams?.home?.name || null,
    awayBattersPathPresent: Array.isArray(away?.batters),
    homeBattersPathPresent: Array.isArray(home?.batters),
    awayBattersCount: Array.isArray(away?.batters) ? away.batters.length : 0,
    homeBattersCount: Array.isArray(home?.batters) ? home.batters.length : 0,
    awayLineup: buildLineup(away),
    homeLineup: buildLineup(home),
  };
}

async function withMcpClient(config, operation) {
  const headers = {};
  if (config.authBearerToken) {
    headers.Authorization = `Bearer ${config.authBearerToken}`;
  }

  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: {
      headers,
    },
  });

  const client = new Client(
    {
      name: "sportfolio-mlb-mcp-probe",
      version: "1.0.0",
    },
    { capabilities: {} },
  );

  let cancelTimeout = () => {};
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`MCP probe timed out after ${config.timeoutMs}ms`)),
      config.timeoutMs,
    );
    cancelTimeout = () => clearTimeout(timer);
  });

  try {
    await Promise.race([client.connect(transport), timeout]);
    const result = await Promise.race([operation(client), timeout]);
    return result;
  } finally {
    cancelTimeout();
    await transport.close().catch(() => {});
    await client.close().catch(() => {});
  }
}

async function probeMcp(config) {
  return withMcpClient(config, async (client) => {
    const listedTools = await client.listTools();
    const toolNames = Array.isArray(listedTools?.tools)
      ? listedTools.tools.map((tool) => tool.name).sort()
      : [];

    const scheduleResult = await client.callTool({
      name: "get_stats",
      arguments: {
        endpoint: "schedule",
        params: {
          sportId: 1,
          date: config.date,
          teamId: config.teamId,
          hydrate: PROBABLE_PITCHER_HYDRATE,
        },
      },
    });
    const schedulePayload = extractToolPayload(scheduleResult);
    const scheduleSummary = summarizeSchedulePayload(schedulePayload, config.teamId, config.gamePk);
    const resolvedGamePk = config.gamePk || scheduleSummary.gamePk;

    let gamePayload = null;
    let lineupSummary = null;

    if (resolvedGamePk != null) {
      const gameResult = await client.callTool({
        name: "get_stats",
        arguments: {
          endpoint: "game",
          params: {
            gamePk: resolvedGamePk,
          },
        },
      });
      gamePayload = extractToolPayload(gameResult);
      lineupSummary = summarizeGamePayload(gamePayload);
    }

    return {
      ok: true,
      mode: "direct",
      url: config.url,
      requestedDate: config.date,
      requestedTeamId: config.teamId,
      requestedGamePk: config.gamePk,
      resolvedGamePk,
      toolCount: toolNames.length,
      hasGetStats: toolNames.includes("get_stats"),
      hasGetSchedule: toolNames.includes("get_schedule"),
      hasGetBoxscore: toolNames.includes("get_boxscore"),
      hasGetAvailableEndpoints: toolNames.includes("get_available_endpoints"),
      scheduleRequest: {
        endpoint: "schedule",
        params: {
          sportId: 1,
          date: config.date,
          teamId: config.teamId,
          hydrate: PROBABLE_PITCHER_HYDRATE,
        },
      },
      scheduleSummary,
      lineupRequest: resolvedGamePk
        ? {
            endpoint: "game",
            params: {
              gamePk: resolvedGamePk,
            },
          }
        : null,
      lineupSummary,
      rawChecks: {
        scheduleHasDatesArray: Array.isArray(schedulePayload?.dates),
        gameHasLiveBoxscoreTeams: Boolean(gamePayload?.liveData?.boxscore?.teams),
      },
    };
  });
}

function buildRemoteProbeScript() {
  return `
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const encodedConfig = process.argv[1];
const rawConfig = Buffer.from(encodedConfig, "base64").toString("utf8");
const config = JSON.parse(rawConfig);
const url =
  config.url === ${JSON.stringify(REMOTE_URL_SENTINEL)}
    ? process.env.HERMES_INTERNAL_MLB_MCP_URL || null
    : config.url;
const authBearerToken =
  config.authBearerToken || process.env.HERMES_INTERNAL_MLB_MCP_AUTH_BEARER || null;

if (!url) {
  throw new Error("HERMES_INTERNAL_MLB_MCP_URL is not configured in the remote environment.");
}

const headers = authBearerToken ? { Authorization: \`Bearer \${authBearerToken}\` } : {};
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: {
    headers,
  },
});
const client = new Client(
  {
    name: "sportfolio-mlb-mcp-remote-probe",
    version: "1.0.0",
  },
  { capabilities: {} },
);

try {
  await client.connect(transport);
  const listedTools = await client.listTools();
  const scheduleResult = await client.callTool({
    name: "get_stats",
    arguments: {
      endpoint: "schedule",
      params: {
        sportId: 1,
        date: config.date,
        teamId: config.teamId,
        hydrate: ${JSON.stringify(PROBABLE_PITCHER_HYDRATE)},
      },
    },
  });

  const schedulePayload =
    scheduleResult?.structuredContent?.result ||
    JSON.parse(scheduleResult?.content?.[0]?.text || "{}");
  const dates = Array.isArray(schedulePayload?.dates) ? schedulePayload.dates : [];
  const games = dates.flatMap((dateEntry) =>
    Array.isArray(dateEntry?.games) ? dateEntry.games : [],
  );
  const matchingGame =
    (config.gamePk != null
      ? games.find((game) => game?.gamePk === config.gamePk)
      : games.find(
          (game) =>
            game?.teams?.away?.team?.id === config.teamId ||
            game?.teams?.home?.team?.id === config.teamId,
        )) ||
    games[0] ||
    null;
  const resolvedGamePk = config.gamePk ?? matchingGame?.gamePk ?? null;

  let gameResult = null;
  if (resolvedGamePk != null) {
    gameResult = await client.callTool({
      name: "get_stats",
      arguments: {
        endpoint: "game",
        params: {
          gamePk: resolvedGamePk,
        },
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        url,
        resolvedGamePk,
        toolNames: Array.isArray(listedTools?.tools)
          ? listedTools.tools.map((tool) => tool.name).sort()
          : [],
        scheduleResult,
        gameResult,
        railwayService: process.env.RAILWAY_SERVICE_NAME || null,
        railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME || null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
} finally {
  await transport.close().catch(() => {});
  await client.close().catch(() => {});
}
`;
}

async function runRailwayProbe(config) {
  const railwayService = config.railwayService || DEFAULT_RAILWAY_SERVICE;
  const railwayEnvironment = config.railwayEnvironment || DEFAULT_RAILWAY_ENVIRONMENT;
  const remoteConfig = {
    ...config,
    url: config.url || REMOTE_URL_SENTINEL,
  };
  const encodedConfig = Buffer.from(JSON.stringify(remoteConfig), "utf8").toString("base64");
  const inlineScript = buildRemoteProbeScript();
  const encodedScript = Buffer.from(inlineScript, "utf8").toString("base64");
  const remoteCommand = `echo ${encodedScript} | base64 -d > /tmp/sportfolio-mlb-mcp-probe.mjs && node /tmp/sportfolio-mlb-mcp-probe.mjs ${encodedConfig}`;

  const args = [
    "ssh",
    "-s",
    railwayService,
    "-e",
    railwayEnvironment,
    "/bin/sh",
    "-lc",
    remoteCommand,
  ];
  const spawnCommand = WINDOWS_RAILWAY_CLI ? process.execPath : "railway";
  const spawnArgs = WINDOWS_RAILWAY_CLI ? [WINDOWS_RAILWAY_CLI, ...args] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (stderr.trim()) {
        process.stderr.write(stderr.trimEnd() + "\n");
      }

      if (code !== 0) {
        reject(new Error(`Railway probe exited with code ${code}.`));
        return;
      }

      let remoteResult;
      try {
        remoteResult = JSON.parse(stdout);
      } catch (error) {
        reject(
          new Error(
            `Railway probe returned non-JSON output: ${
              error instanceof Error ? error.message : String(error)
            }\nSTDOUT:\n${stdout.trim() || "[empty]"}\nSTDERR:\n${stderr.trim() || "[empty]"}`,
          ),
        );
        return;
      }

      const schedulePayload = extractToolPayload(remoteResult.scheduleResult);
      const gamePayload = remoteResult.gameResult
        ? extractToolPayload(remoteResult.gameResult)
        : null;
      const summarized = {
        ok: true,
        mode: "railway",
        url: remoteResult.url,
        requestedDate: config.date,
        requestedTeamId: config.teamId,
        requestedGamePk: config.gamePk,
        resolvedGamePk: remoteResult.resolvedGamePk,
        railwayService: remoteResult.railwayService,
        railwayEnvironment: remoteResult.railwayEnvironment,
        toolCount: Array.isArray(remoteResult.toolNames) ? remoteResult.toolNames.length : 0,
        hasGetStats: Array.isArray(remoteResult.toolNames)
          ? remoteResult.toolNames.includes("get_stats")
          : false,
        hasGetSchedule: Array.isArray(remoteResult.toolNames)
          ? remoteResult.toolNames.includes("get_schedule")
          : false,
        hasGetBoxscore: Array.isArray(remoteResult.toolNames)
          ? remoteResult.toolNames.includes("get_boxscore")
          : false,
        hasGetAvailableEndpoints: Array.isArray(remoteResult.toolNames)
          ? remoteResult.toolNames.includes("get_available_endpoints")
          : false,
        scheduleRequest: {
          endpoint: "schedule",
          params: {
            sportId: 1,
            date: config.date,
            teamId: config.teamId,
            hydrate: PROBABLE_PITCHER_HYDRATE,
          },
        },
        scheduleSummary: summarizeSchedulePayload(schedulePayload, config.teamId, config.gamePk),
        lineupRequest: remoteResult.resolvedGamePk
          ? {
              endpoint: "game",
              params: {
                gamePk: remoteResult.resolvedGamePk,
              },
            }
          : null,
        lineupSummary: gamePayload ? summarizeGamePayload(gamePayload) : null,
        rawChecks: {
          scheduleHasDatesArray: Array.isArray(schedulePayload?.dates),
          gameHasLiveBoxscoreTeams: Boolean(gamePayload?.liveData?.boxscore?.teams),
        },
      };

      console.log(JSON.stringify(summarized, null, 2));
      resolve();
    });
  });
}

async function main() {
  const config = parseArgs(process.argv.slice(2));

  if (config.railwayService) {
    await runRailwayProbe(config);
    return;
  }

  const result = await probeMcp(config);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
