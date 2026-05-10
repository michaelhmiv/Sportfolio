import { Octokit } from "@octokit/rest";
import {
  addDiscordMessageReaction,
  getDiscordChannel,
  listDiscordChannelMessages,
} from "./discord-api";
import {
  ensureDiscordSchema,
  getDiscordReportSyncByThreadChannelId,
  upsertDiscordReportSync,
} from "./discord-service";

import type { DiscordChannelObject, DiscordMessageObject } from "./discord-api";
import type { DiscordReportSync } from "@shared/schema";

const GITHUB_BODY_SOFT_LIMIT = 65000;
const DEFAULT_FETCH_LIMIT = 500;

type DiscordReportType = "bug" | "feature";

interface DiscordReportLabelDefinition {
  name: string;
  color: string;
  description: string;
}

const ISSUE_LABELS_BY_REPORT_TYPE: Record<DiscordReportType, DiscordReportLabelDefinition[]> = {
  bug: [
    { name: "type:bug", color: "d73a4a", description: "Closed-testing bug report" },
    { name: "source:discord", color: "5865f2", description: "Reported from Discord" },
    {
      name: "phase:closed-testing",
      color: "fbca04",
      description: "Captured during closed testing",
    },
  ],
  feature: [
    {
      name: "type:feature",
      color: "0e8a16",
      description: "Closed-testing feature request",
    },
    { name: "source:discord", color: "5865f2", description: "Reported from Discord" },
    {
      name: "phase:closed-testing",
      color: "fbca04",
      description: "Captured during closed testing",
    },
  ],
};

export interface SyncDiscordReportThreadInput {
  guildId: string;
  threadChannelId: string;
  submittedByDiscordUserId: string;
  submittedByDisplayName: string;
  bugForumChannelId: string;
  featureForumChannelId: string;
  githubToken: string;
  githubOwner: string;
  githubRepo: string;
}

export interface SyncDiscordReportThreadResult {
  status: "created" | "updated" | "noop";
  reportType: DiscordReportType;
  issueNumber: number;
  issueUrl: string;
  syncedMessageCount: number;
}

interface ParsedThreadContext {
  reportType: DiscordReportType;
  threadChannel: DiscordChannelObject;
}

function normalizeMultiline(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function toDisplayName(message: DiscordMessageObject): string {
  return (
    message.author.global_name ||
    message.author.username ||
    message.author.id ||
    "Unknown Discord User"
  );
}

function buildDiscordMessageUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function buildDiscordThreadUrl(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

export function inferDiscordReportType(input: {
  parentChannelId: string | null | undefined;
  bugForumChannelId: string;
  featureForumChannelId: string;
}): DiscordReportType | null {
  if (!input.parentChannelId) {
    return null;
  }

  if (input.parentChannelId === input.bugForumChannelId) {
    return "bug";
  }

  if (input.parentChannelId === input.featureForumChannelId) {
    return "feature";
  }

  return null;
}

function compareMessageChronologically(a: DiscordMessageObject, b: DiscordMessageObject): number {
  const aTs = new Date(a.timestamp).getTime();
  const bTs = new Date(b.timestamp).getTime();

  if (aTs !== bTs) {
    return aTs - bTs;
  }

  return a.id.localeCompare(b.id);
}

async function fetchThreadMessagesChronological(
  threadChannelId: string,
  maxMessages = DEFAULT_FETCH_LIMIT,
): Promise<DiscordMessageObject[]> {
  const rows: DiscordMessageObject[] = [];
  let before: string | null = null;

  while (rows.length < maxMessages) {
    const nextLimit = Math.min(100, maxMessages - rows.length);
    const response = await listDiscordChannelMessages(threadChannelId, {
      before,
      limit: nextLimit,
    });

    if (!response.ok || !response.data) {
      throw new Error(response.error?.message || "Could not fetch Discord thread messages");
    }

    if (response.data.length === 0) {
      break;
    }

    rows.push(...response.data);
    before = response.data[response.data.length - 1]?.id || null;

    if (response.data.length < nextLimit) {
      break;
    }
  }

  return rows.sort(compareMessageChronologically);
}

export function sliceMessagesAfterCursor(
  messages: DiscordMessageObject[],
  lastSyncedMessageId: string | null,
): DiscordMessageObject[] {
  if (!lastSyncedMessageId) {
    return messages;
  }

  const cursorIndex = messages.findIndex((message) => message.id === lastSyncedMessageId);
  if (cursorIndex === -1) {
    return messages;
  }

  return messages.slice(cursorIndex + 1);
}

function softLimitMarkdown(input: string, limit = GITHUB_BODY_SOFT_LIMIT): string {
  if (input.length <= limit) {
    return input;
  }

  const truncated = input.slice(0, Math.max(0, limit - 48)).trimEnd();
  return `${truncated}\n\n_(truncated to fit GitHub body limits)_`;
}

function formatAttachmentList(message: DiscordMessageObject): string[] {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length === 0) {
    return [];
  }

  return attachments.map((attachment) => {
    const filename = attachment.filename || attachment.id || "attachment";
    return `- [${filename}](${attachment.url})`;
  });
}

function buildTranscript(messages: DiscordMessageObject[], guildId: string): string {
  const blocks = messages.map((message) => {
    const lines: string[] = [];
    const timestamp = new Date(message.timestamp).toISOString();
    const displayName = toDisplayName(message);
    const messageUrl = buildDiscordMessageUrl(guildId, message.channel_id, message.id);
    const content = normalizeMultiline(message.content);

    lines.push(`### ${timestamp} - ${displayName} (\`${message.author.id}\`)`);
    lines.push(`Message: ${messageUrl}`);
    lines.push(content.length > 0 ? content : "_(no text content)_");

    const attachments = formatAttachmentList(message);
    if (attachments.length > 0) {
      lines.push("Attachments:");
      lines.push(...attachments);
    }

    return lines.join("\n");
  });

  return blocks.join("\n\n");
}

export function buildIssueTitle(
  reportType: DiscordReportType,
  threadName: string | undefined,
): string {
  const normalizedThreadName = normalizeMultiline(threadName) || "Untitled Discord report";
  const cleaned = normalizedThreadName.replace(/\s+/g, " ").slice(0, 180);
  return reportType === "bug" ? `[Bug] ${cleaned}` : `[Feature] ${cleaned}`;
}

function buildIssueBody(input: {
  reportType: DiscordReportType;
  guildId: string;
  threadChannelId: string;
  threadName: string | undefined;
  submittedByDiscordUserId: string;
  submittedByDisplayName: string;
  messages: DiscordMessageObject[];
}): string {
  const summaryMessage =
    input.messages.find(
      (message) =>
        normalizeMultiline(message.content).length > 0 ||
        (Array.isArray(message.attachments) && message.attachments.length > 0),
    ) || input.messages[0];

  const summaryText = summaryMessage ? normalizeMultiline(summaryMessage.content) : "";
  const summaryAttachments = summaryMessage ? formatAttachmentList(summaryMessage) : [];

  const reportHeader = [
    "## Intake Metadata",
    `- Source: Discord closed testing`,
    `- Type: ${input.reportType}`,
    `- Discord thread: ${buildDiscordThreadUrl(input.guildId, input.threadChannelId)}`,
    `- Thread name: ${input.threadName || "(unnamed thread)"}`,
    `- Submitted by: ${input.submittedByDisplayName} (\`${input.submittedByDiscordUserId}\`)`,
    `- Submitted at: ${new Date().toISOString()}`,
    "",
    "## Summary",
    summaryText.length > 0 ? summaryText : "_(no text content provided in the report)_",
  ];

  if (summaryAttachments.length > 0) {
    reportHeader.push("", "Summary attachments:", ...summaryAttachments);
  }

  const transcript = buildTranscript(input.messages, input.guildId);

  return softLimitMarkdown(
    [
      ...reportHeader,
      "",
      "## Full Discord Transcript",
      transcript.length > 0 ? transcript : "_(No transcript messages found.)_",
    ].join("\n"),
  );
}

function buildUpdateCommentBody(input: {
  guildId: string;
  threadChannelId: string;
  messages: DiscordMessageObject[];
  submittedByDisplayName: string;
  submittedByDiscordUserId: string;
}): string {
  const header = [
    "## Discord Follow-up Sync",
    `- Thread: ${buildDiscordThreadUrl(input.guildId, input.threadChannelId)}`,
    `- Synced by: ${input.submittedByDisplayName} (\`${input.submittedByDiscordUserId}\`)`,
    `- Synced at: ${new Date().toISOString()}`,
    `- New messages: ${input.messages.length}`,
    "",
  ];

  const transcript = buildTranscript(input.messages, input.guildId);
  return softLimitMarkdown([...header, transcript].join("\n"));
}

async function ensureIssueLabels(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  reportType: DiscordReportType;
}): Promise<string[]> {
  const definitions = ISSUE_LABELS_BY_REPORT_TYPE[input.reportType];

  for (const definition of definitions) {
    try {
      await input.octokit.rest.issues.getLabel({
        owner: input.owner,
        repo: input.repo,
        name: definition.name,
      });
    } catch (error: any) {
      if (Number(error?.status) !== 404) {
        throw error;
      }

      await input.octokit.rest.issues.createLabel({
        owner: input.owner,
        repo: input.repo,
        name: definition.name,
        color: definition.color,
        description: definition.description,
      });
    }
  }

  return definitions.map((definition) => definition.name);
}

function parseThreadContext(input: {
  threadChannel: DiscordChannelObject;
  bugForumChannelId: string;
  featureForumChannelId: string;
}): ParsedThreadContext {
  const threadParentId = input.threadChannel.parent_id;
  const reportType = inferDiscordReportType({
    parentChannelId: threadParentId,
    bugForumChannelId: input.bugForumChannelId,
    featureForumChannelId: input.featureForumChannelId,
  });

  if (!reportType) {
    throw new Error(
      "This command must be run inside a thread under the configured bug/feature forum channels.",
    );
  }

  return {
    reportType,
    threadChannel: input.threadChannel,
  };
}

async function resolveThreadContext(input: {
  threadChannelId: string;
  bugForumChannelId: string;
  featureForumChannelId: string;
}): Promise<ParsedThreadContext> {
  const threadResponse = await getDiscordChannel(input.threadChannelId);
  if (!threadResponse.ok || !threadResponse.data) {
    throw new Error(threadResponse.error?.message || "Could not load Discord thread context");
  }

  return parseThreadContext({
    threadChannel: threadResponse.data,
    bugForumChannelId: input.bugForumChannelId,
    featureForumChannelId: input.featureForumChannelId,
  });
}

function getExistingRepoInfo(
  existing: DiscordReportSync | null,
  input: SyncDiscordReportThreadInput,
) {
  if (!existing) {
    return {
      owner: input.githubOwner,
      repo: input.githubRepo,
    };
  }

  return {
    owner: existing.githubOwner,
    repo: existing.githubRepo,
  };
}

function getThreadStarterMessageId(
  messages: DiscordMessageObject[],
  threadChannelId: string,
): string | null {
  if (messages.length === 0) {
    return null;
  }

  const match = messages.find((message) => message.id === threadChannelId);
  return match?.id || messages[0].id;
}

export async function syncDiscordReportThreadToGitHub(
  input: SyncDiscordReportThreadInput,
): Promise<SyncDiscordReportThreadResult> {
  await ensureDiscordSchema();

  const parsedContext = await resolveThreadContext({
    threadChannelId: input.threadChannelId,
    bugForumChannelId: input.bugForumChannelId,
    featureForumChannelId: input.featureForumChannelId,
  });

  const existing = await getDiscordReportSyncByThreadChannelId(input.threadChannelId);
  const messages = await fetchThreadMessagesChronological(input.threadChannelId);

  if (messages.length === 0) {
    throw new Error("No Discord messages were found in this thread.");
  }

  const octokit = new Octokit({ auth: input.githubToken });
  const targetRepo = getExistingRepoInfo(existing, input);

  if (!existing) {
    const labelNames = await ensureIssueLabels({
      octokit,
      owner: targetRepo.owner,
      repo: targetRepo.repo,
      reportType: parsedContext.reportType,
    });

    const issueBody = buildIssueBody({
      reportType: parsedContext.reportType,
      guildId: input.guildId,
      threadChannelId: input.threadChannelId,
      threadName: parsedContext.threadChannel.name,
      submittedByDiscordUserId: input.submittedByDiscordUserId,
      submittedByDisplayName: input.submittedByDisplayName,
      messages,
    });

    const issue = await octokit.rest.issues.create({
      owner: targetRepo.owner,
      repo: targetRepo.repo,
      title: buildIssueTitle(parsedContext.reportType, parsedContext.threadChannel.name),
      body: issueBody,
      labels: labelNames,
    });

    const newestMessageId = messages[messages.length - 1]?.id || null;

    await upsertDiscordReportSync({
      threadChannelId: input.threadChannelId,
      parentChannelId: parsedContext.threadChannel.parent_id || "",
      reportType: parsedContext.reportType,
      threadName: parsedContext.threadChannel.name || null,
      githubOwner: targetRepo.owner,
      githubRepo: targetRepo.repo,
      githubIssueNumber: issue.data.number,
      githubIssueUrl: issue.data.html_url,
      createdByDiscordUserId: input.submittedByDiscordUserId,
      lastSyncedMessageId: newestMessageId,
      lastSyncedAt: new Date(),
    });

    const starterMessageId = getThreadStarterMessageId(messages, input.threadChannelId);
    if (starterMessageId) {
      await addDiscordMessageReaction(input.threadChannelId, starterMessageId).catch(
        () => undefined,
      );
    }

    return {
      status: "created",
      reportType: parsedContext.reportType,
      issueNumber: issue.data.number,
      issueUrl: issue.data.html_url,
      syncedMessageCount: messages.length,
    };
  }

  const newMessages = sliceMessagesAfterCursor(messages, existing.lastSyncedMessageId || null);
  if (newMessages.length === 0) {
    return {
      status: "noop",
      reportType: existing.reportType as DiscordReportType,
      issueNumber: existing.githubIssueNumber,
      issueUrl: existing.githubIssueUrl,
      syncedMessageCount: 0,
    };
  }

  const commentBody = buildUpdateCommentBody({
    guildId: input.guildId,
    threadChannelId: input.threadChannelId,
    messages: newMessages,
    submittedByDisplayName: input.submittedByDisplayName,
    submittedByDiscordUserId: input.submittedByDiscordUserId,
  });

  await octokit.rest.issues.createComment({
    owner: existing.githubOwner,
    repo: existing.githubRepo,
    issue_number: existing.githubIssueNumber,
    body: commentBody,
  });

  const newestMessageId = newMessages[newMessages.length - 1]?.id || existing.lastSyncedMessageId;

  await upsertDiscordReportSync({
    threadChannelId: existing.threadChannelId,
    parentChannelId: existing.parentChannelId,
    reportType: existing.reportType as DiscordReportType,
    threadName: parsedContext.threadChannel.name || existing.threadName,
    githubOwner: existing.githubOwner,
    githubRepo: existing.githubRepo,
    githubIssueNumber: existing.githubIssueNumber,
    githubIssueUrl: existing.githubIssueUrl,
    createdByDiscordUserId: existing.createdByDiscordUserId,
    lastSyncedMessageId: newestMessageId,
    lastSyncedAt: new Date(),
  });

  return {
    status: "updated",
    reportType: existing.reportType as DiscordReportType,
    issueNumber: existing.githubIssueNumber,
    issueUrl: existing.githubIssueUrl,
    syncedMessageCount: newMessages.length,
  };
}
