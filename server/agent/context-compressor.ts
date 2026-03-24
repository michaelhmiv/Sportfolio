/**
 * Context compression for long agent conversations.
 *
 * Ported from NousResearch/hermes-agent's context_compressor.py.
 * When a thread's conversation history exceeds a threshold, middle turns are
 * summarized into a structured compaction message while head (system context)
 * and tail (recent exchanges) are preserved intact.
 */

const COMPRESSION_THRESHOLD = 20;
const PROTECT_HEAD_COUNT = 2;
const PROTECT_TAIL_COUNT = 6;

const SUMMARY_PREFIX =
  "[CONTEXT COMPACTION] Earlier turns in this conversation were compacted " +
  "to save context space. The summary below describes work that was " +
  "already completed. Use the summary and the current state to continue " +
  "from where things left off, and avoid repeating work:";

interface ConversationTurn {
  role: "user" | "assistant";
  contentText: string;
}

interface CompressionResult {
  compressed: boolean;
  history: ConversationTurn[];
}

function serializeTurnsForSummary(turns: ConversationTurn[]): string {
  return turns
    .map((turn) => {
      const label = turn.role === "user" ? "[USER]" : "[ASSISTANT]";
      const text =
        turn.contentText.length > 3000
          ? `${turn.contentText.slice(0, 2000)}\n...[truncated]...\n${turn.contentText.slice(-800)}`
          : turn.contentText;
      return `${label}: ${text}`;
    })
    .join("\n\n");
}

function buildStructuredSummary(turns: ConversationTurn[]): string {
  const userMessages: string[] = [];
  const assistantMessages: string[] = [];

  for (const turn of turns) {
    if (turn.role === "user") {
      userMessages.push(turn.contentText.slice(0, 500));
    } else {
      assistantMessages.push(turn.contentText.slice(0, 500));
    }
  }

  const goalLines = userMessages.slice(0, 3).map((msg) => `- ${msg}`);
  const progressLines = assistantMessages.slice(-3).map((msg) => {
    const first = msg.split(/[.!?\n]/)[0]?.trim();
    return `- ${first || msg.slice(0, 120)}`;
  });

  const sections = [
    `**Goal**: What the user was working on:\n${goalLines.join("\n")}`,
    `**Progress**: Key actions/responses so far:\n${progressLines.join("\n")}`,
    `**Turns compressed**: ${turns.length} conversation turns were summarized.`,
  ];

  return sections.join("\n\n");
}

export function compressThreadContext(
  history: ConversationTurn[],
): CompressionResult {
  if (history.length <= COMPRESSION_THRESHOLD) {
    return { compressed: false, history };
  }

  const head = history.slice(0, PROTECT_HEAD_COUNT);
  const tail = history.slice(-PROTECT_TAIL_COUNT);
  const middle = history.slice(PROTECT_HEAD_COUNT, -PROTECT_TAIL_COUNT);

  if (middle.length === 0) {
    return { compressed: false, history };
  }

  const summary = buildStructuredSummary(middle);
  const compactionMessage: ConversationTurn = {
    role: "assistant",
    contentText: `${SUMMARY_PREFIX}\n\n${summary}`,
  };

  return {
    compressed: true,
    history: [...head, compactionMessage, ...tail],
  };
}

export function shouldCompressContext(history: ConversationTurn[]): boolean {
  return history.length > COMPRESSION_THRESHOLD;
}
