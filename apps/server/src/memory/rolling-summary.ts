import { redactSecrets } from "@virtual-office/shared";
import type {
  ConversationRecord,
  ConversationsRepository,
  MessageRecord,
} from "../db/repositories/conversations-repo.js";

function truncateLine(text: string, maxLen = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 3)}...`;
}

/**
 * Deterministic, bilingual-safe rolling conversation compressor that preserves
 * key founder requests/decisions and employee outcomes while keeping secrets redacted.
 */
export function buildRollingSummary(
  previousSummary: string | null,
  messagesToCompress: MessageRecord[],
): string {
  const sections: string[] = [];

  if (previousSummary && previousSummary.trim()) {
    const cleanPrev = previousSummary
      .split("\n")
      .filter((line) => !line.startsWith("## Rolling Conversation Summary"))
      .slice(0, 6)
      .join("\n")
      .trim();
    if (cleanPrev) {
      sections.push(`Prior Context:\n${cleanPrev}`);
    }
  }

  const userLines: string[] = [];
  const assistantLines: string[] = [];

  for (const msg of messagesToCompress) {
    if (msg.role === "user") {
      userLines.push(`- Founder: ${truncateLine(msg.content, 130)}`);
    } else if (msg.role === "assistant") {
      assistantLines.push(`- Employee: ${truncateLine(msg.content, 150)}`);
    }
  }

  const recentHighlights: string[] = [];
  if (userLines.length > 0) {
    recentHighlights.push(...userLines.slice(-4));
  }
  if (assistantLines.length > 0) {
    recentHighlights.push(...assistantLines.slice(-4));
  }

  if (recentHighlights.length > 0) {
    sections.push(`Recent Rolled Turns (${messagesToCompress.length} msgs):\n${recentHighlights.join("\n")}`);
  }

  const joined = redactSecrets(sections.join("\n\n")).trim();
  return joined.length > 1500 ? `${joined.slice(0, 1497)}...` : joined;
}

/**
 * Refreshes `conversations.rolling_summary` automatically once message count reaches
 * the configured threshold, leaving the newest 4 messages verbatim for immediate context.
 */
export function updateRollingSummaryIfNeeded(
  conversationsRepo: ConversationsRepository,
  conversationId: string,
  threshold = 8,
  force = false,
): ConversationRecord | null {
  const conversation = conversationsRepo.getById(conversationId);
  if (!conversation) return null;

  const messages = conversationsRepo.listMessages(conversationId, 100);
  const triggerThreshold = Math.max(2, threshold);
  if (!force && messages.length < triggerThreshold) {
    return conversation;
  }
  if (messages.length === 0) {
    return conversation;
  }

  const keepVerbatim = messages.length > 4 ? 4 : 0;
  const sliceEnd = keepVerbatim > 0 ? messages.length - keepVerbatim : messages.length;
  const toCompress = messages.slice(0, sliceEnd);
  if (toCompress.length === 0) {
    return conversation;
  }

  const summary = buildRollingSummary(conversation.rollingSummary, toCompress);
  if (!summary) {
    return conversation;
  }

  conversationsRepo.updateRollingSummary(conversationId, summary);
  return conversationsRepo.getById(conversationId);
}
