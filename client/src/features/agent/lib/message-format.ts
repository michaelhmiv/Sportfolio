import type { AgentUiBlock } from "@shared/agent-ui";

const STRUCTURED_TABLE_BLOCK_TYPES = new Set([
  "leaderboard_table",
  "entity_table",
  "schedule_board",
]);

const TABLE_START_PATTERNS = [
  /\|\s*#\s*\|/i,
  /\|\s*player\s*\|/i,
  /\|\s*name\s*\|/i,
  /\|\s*team\s*\|/i,
  /\|\s*date\s*\|/i,
  /\|\s*rank\s*\|/i,
];

const TAIL_CUE_PATTERN =
  /\b(?:Want me|Would you like|If you want|Tell me if|I can also|I can pull|I can check|I can stage|Need me to|Should I)\b[\s\S]*$/i;

export type AssistantMessageDisplay = {
  beforeText: string | null;
  afterText: string | null;
};

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function hasStructuredTableBlock(uiBlocks: AgentUiBlock[] | null | undefined) {
  return Boolean(uiBlocks?.some((block) => STRUCTURED_TABLE_BLOCK_TYPES.has(block.type)));
}

function findTableStartIndex(text: string) {
  const indexes = TABLE_START_PATTERNS.map((pattern) => text.search(pattern)).filter(
    (idx) => idx >= 0,
  );
  if (indexes.length === 0) {
    return -1;
  }
  return Math.min(...indexes);
}

function extractTail(text: string) {
  const match = text.match(TAIL_CUE_PATTERN);
  if (!match || match.index == null) {
    return { head: text.trim(), tail: null as string | null };
  }

  return {
    head: text.slice(0, match.index).trim(),
    tail: trimOrNull(match[0]),
  };
}

function stripStructuredTableText(text: string): AssistantMessageDisplay {
  const tableStart = findTableStartIndex(text);
  if (tableStart < 0) {
    return {
      beforeText: trimOrNull(text),
      afterText: null,
    };
  }

  const prefix = trimOrNull(text.slice(0, tableStart));
  const { tail } = extractTail(text.slice(tableStart));

  return {
    beforeText: prefix,
    afterText: tail,
  };
}

function normalizeCompactMarkdownTable(text: string) {
  const tableStart = findTableStartIndex(text);
  if (tableStart < 0 || !text.slice(tableStart).includes("|---")) {
    return trimOrNull(text);
  }

  const prefix = trimOrNull(text.slice(0, tableStart));
  const { head, tail } = extractTail(text.slice(tableStart));
  const normalizedTable = head.replace(/\|\s+\|/g, "|\n|").trim();

  return [prefix, normalizedTable, tail].filter(Boolean).join("\n\n").trim();
}

export function prepareAssistantMessageDisplay(input: {
  contentText: string;
  uiBlocks?: AgentUiBlock[] | null;
}): AssistantMessageDisplay {
  const contentText = input.contentText.trim();
  if (!contentText) {
    return {
      beforeText: null,
      afterText: null,
    };
  }

  if (hasStructuredTableBlock(input.uiBlocks)) {
    return stripStructuredTableText(contentText);
  }

  return {
    beforeText: normalizeCompactMarkdownTable(contentText),
    afterText: null,
  };
}
