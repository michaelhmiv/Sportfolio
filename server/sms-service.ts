import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  smsMessageEvents,
  userPhoneLinks,
  userPhoneLinkTokens,
  type UserPhoneLink,
} from "@shared/schema";
import { normalizeSiteUrl } from "@shared/seo";
import { db } from "./db";
import { findBestAgentKnowledgeArticle, listAgentKnowledgeArticles } from "./docs-service";
import {
  renderSmsHelpReply,
  renderGuestSmsConciergeReply,
  renderSmsThreadTurnResult,
  renderUnknownSmsOnboardingReply,
} from "./agent/sms-renderer";
import { getOrCreateSmsAgentThread, sendAgentThreadMessage } from "./agent/thread-service";
import {
  createSmsLinkTokenHash,
  createSmsLinkTokenMaterial,
  parseTelnyxDeliveryEvent,
  parseTelnyxInboundMessage,
  parseVerifiedTelnyxWebhook,
  sendTelnyxSms,
  type VerifiedTelnyxWebhook,
} from "./services/telnyx-sms";

const PHONE_LINK_TOKEN_TTL_MS = 30 * 60 * 1000;
const STOP_KEYWORDS = new Set(["stop", "unsubscribe", "cancel", "end", "quit"]);
const START_KEYWORDS = new Set(["start", "unstop"]);
const HELP_KEYWORDS = new Set(["help", "info"]);

function getPublicSiteUrl(): string {
  return normalizeSiteUrl(
    process.env.PUBLIC_SITE_URL?.trim() ||
      process.env.SITE_URL?.trim() ||
      process.env.VITE_PUBLIC_SITE_URL?.trim() ||
      "http://localhost:5000",
  );
}

function normalizeSmsKeyword(message: string): string {
  return message.trim().toLowerCase();
}

export function normalizePhoneToE164(rawPhone: string): string {
  const trimmed = rawPhone.trim();
  if (!trimmed) {
    throw new Error("Phone number is required");
  }

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      throw new Error("Phone number must be a valid E.164 number");
    }
    return `+${digits}`;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  throw new Error("Phone number must be a valid US number or full E.164 number");
}

function buildSmsLinkUrl(token: string): string {
  return `${getPublicSiteUrl()}/sms/link?token=${encodeURIComponent(token)}`;
}

function buildAppAgentUrl(): string {
  return `${getPublicSiteUrl()}/agent`;
}

async function createOnboardingTokenLink(phoneE164: string): Promise<{
  linkUrl: string;
  expiresAt: Date;
}> {
  const tokenMaterial = createSmsLinkTokenMaterial();
  const expiresAt = new Date(Date.now() + PHONE_LINK_TOKEN_TTL_MS);

  await db
    .update(userPhoneLinkTokens)
    .set({
      consumedAt: new Date(),
    })
    .where(
      and(eq(userPhoneLinkTokens.phoneE164, phoneE164), isNull(userPhoneLinkTokens.consumedAt)),
    );

  await db.insert(userPhoneLinkTokens).values({
    phoneE164,
    tokenHash: tokenMaterial.tokenHash,
    purpose: "signup_or_link",
    expiresAt,
  });

  return {
    linkUrl: buildSmsLinkUrl(tokenMaterial.plaintextToken),
    expiresAt,
  };
}

async function insertSmsEvent(input: {
  phoneE164: string;
  direction: "inbound" | "outbound";
  providerEventId?: string | null;
  providerMessageId?: string | null;
  userId?: string | null;
  agentThreadId?: string | null;
  eventType?: string;
  messageText?: string | null;
  structuredPayload?: Record<string, unknown> | null;
  status?: string;
  dedupeOnProviderEventId?: boolean;
}): Promise<{ inserted: boolean }> {
  const values = {
    phoneE164: input.phoneE164,
    direction: input.direction,
    provider: "telnyx",
    providerEventId: input.providerEventId ?? null,
    providerMessageId: input.providerMessageId ?? null,
    userId: input.userId ?? null,
    agentThreadId: input.agentThreadId ?? null,
    eventType: input.eventType ?? "message",
    messageText: input.messageText ?? null,
    structuredPayload: input.structuredPayload ?? null,
    status: input.status ?? "received",
  };

  if (input.dedupeOnProviderEventId && values.providerEventId) {
    const rows = await db
      .insert(smsMessageEvents)
      .values(values)
      .onConflictDoNothing({ target: smsMessageEvents.providerEventId })
      .returning({ id: smsMessageEvents.id });

    return { inserted: rows.length > 0 };
  }

  await db.insert(smsMessageEvents).values(values);
  return { inserted: true };
}

async function sendAndLogSms(input: {
  to: string;
  text: string;
  userId?: string | null;
  agentThreadId?: string | null;
  eventType?: string;
  structuredPayload?: Record<string, unknown> | null;
}): Promise<void> {
  const sendResult = await sendTelnyxSms({
    to: input.to,
    text: input.text,
  });

  await insertSmsEvent({
    phoneE164: input.to,
    direction: "outbound",
    providerMessageId: sendResult.id,
    userId: input.userId,
    agentThreadId: input.agentThreadId,
    eventType: input.eventType ?? "message",
    messageText: input.text,
    structuredPayload: input.structuredPayload,
    status: sendResult.accepted ? "sent" : "queued",
  });

  await db
    .update(userPhoneLinks)
    .set({
      lastOutboundAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userPhoneLinks.normalizedPhone, input.to));
}

async function findPhoneLinkByPhone(phoneE164: string): Promise<UserPhoneLink | undefined> {
  const [link] = await db
    .select()
    .from(userPhoneLinks)
    .where(eq(userPhoneLinks.normalizedPhone, phoneE164));

  return link || undefined;
}

export async function getSmsSettings(userId: string): Promise<UserPhoneLink | null> {
  const [link] = await db.select().from(userPhoneLinks).where(eq(userPhoneLinks.userId, userId));
  return link || null;
}

export async function updateSmsSettings(
  userId: string,
  smsEnabled: boolean,
): Promise<UserPhoneLink | null> {
  const [updated] = await db
    .update(userPhoneLinks)
    .set({
      smsEnabled,
      updatedAt: new Date(),
    })
    .where(eq(userPhoneLinks.userId, userId))
    .returning();

  return updated || null;
}

export async function startSmsPhoneLink(
  userId: string,
  rawPhone: string,
): Promise<{
  phoneE164: string;
  expiresAt: Date;
}> {
  const phoneE164 = normalizePhoneToE164(rawPhone);
  const existingPhoneLink = await findPhoneLinkByPhone(phoneE164);
  if (existingPhoneLink && existingPhoneLink.userId !== userId) {
    throw new Error("That phone number is already linked to another account");
  }

  const tokenMaterial = createSmsLinkTokenMaterial();
  const expiresAt = new Date(Date.now() + PHONE_LINK_TOKEN_TTL_MS);

  await db
    .update(userPhoneLinkTokens)
    .set({
      consumedAt: new Date(),
    })
    .where(
      and(eq(userPhoneLinkTokens.phoneE164, phoneE164), isNull(userPhoneLinkTokens.consumedAt)),
    );

  await db.insert(userPhoneLinkTokens).values({
    phoneE164,
    tokenHash: tokenMaterial.tokenHash,
    purpose: "signup_or_link",
    expiresAt,
    claimedByUserId: userId,
  });

  const linkUrl = buildSmsLinkUrl(tokenMaterial.plaintextToken);
  await sendAndLogSms({
    to: phoneE164,
    text: `Sportfolio SMS verification: finish linking this number here ${linkUrl}`,
    userId,
    eventType: "link_sent",
    structuredPayload: {
      purpose: "signup_or_link",
      expiresAt: expiresAt.toISOString(),
    },
  });

  return {
    phoneE164,
    expiresAt,
  };
}

export async function completeSmsPhoneLink(userId: string, token: string): Promise<UserPhoneLink> {
  const normalizedToken = token.trim();
  if (!/^[a-f0-9]{48}$/i.test(normalizedToken)) {
    throw new Error("That SMS link is invalid");
  }

  const hash = createSmsLinkTokenHash(normalizedToken);
  const [tokenRow] = await db
    .select()
    .from(userPhoneLinkTokens)
    .where(
      and(
        eq(userPhoneLinkTokens.tokenHash, hash),
        isNull(userPhoneLinkTokens.consumedAt),
        gt(userPhoneLinkTokens.expiresAt, new Date()),
      ),
    );

  if (!tokenRow) {
    throw new Error("That SMS link is expired or invalid");
  }

  const existingPhoneLink = await findPhoneLinkByPhone(tokenRow.phoneE164);
  if (existingPhoneLink && existingPhoneLink.userId !== userId) {
    throw new Error("That phone number is already linked to another account");
  }

  const [linked] = await db
    .insert(userPhoneLinks)
    .values({
      userId,
      phoneE164: tokenRow.phoneE164,
      normalizedPhone: tokenRow.phoneE164,
      verifiedAt: new Date(),
      linkedAt: new Date(),
      smsEnabled: true,
      smsOptInStatus: "opted_in",
      smsOptInSource: "web_link",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userPhoneLinks.userId,
      set: {
        phoneE164: tokenRow.phoneE164,
        normalizedPhone: tokenRow.phoneE164,
        verifiedAt: new Date(),
        linkedAt: new Date(),
        smsEnabled: true,
        smsOptInStatus: "opted_in",
        smsOptInSource: "web_link",
        updatedAt: new Date(),
      },
    })
    .returning();

  await db
    .update(userPhoneLinkTokens)
    .set({
      consumedAt: new Date(),
      claimedByUserId: userId,
    })
    .where(eq(userPhoneLinkTokens.id, tokenRow.id));

  return linked;
}

function getDefaultGuestKnowledgeLine(): {
  title: string | null;
  note: string | null;
} {
  const defaultArticle =
    listAgentKnowledgeArticles().find((article) => article.id === "getting-started-overview") ||
    listAgentKnowledgeArticles()[0] ||
    null;

  return {
    title: defaultArticle?.title || null,
    note: defaultArticle?.notes[0] || defaultArticle?.summary || null,
  };
}

async function createUnknownSenderOnboardingReply(
  phoneE164: string,
  messageText: string,
): Promise<{
  text: string;
  expiresAt: Date;
}> {
  const { linkUrl, expiresAt } = await createOnboardingTokenLink(phoneE164);
  const matchedArticle = findBestAgentKnowledgeArticle(messageText);
  const fallbackLine = getDefaultGuestKnowledgeLine();

  const text =
    messageText.trim().length > 0
      ? renderGuestSmsConciergeReply({
          linkUrl,
          messageText,
          matchedTopicTitle: matchedArticle?.title || fallbackLine.title,
          matchedTopicNote:
            matchedArticle?.notes[0] || matchedArticle?.summary || fallbackLine.note || null,
        })
      : renderUnknownSmsOnboardingReply(linkUrl);

  return {
    text,
    expiresAt,
  };
}

async function createUnlinkedHelpReply(phoneE164: string): Promise<{
  text: string;
  expiresAt: Date;
}> {
  const { linkUrl, expiresAt } = await createOnboardingTokenLink(phoneE164);
  const fallbackLine = getDefaultGuestKnowledgeLine();

  return {
    text: renderSmsHelpReply(linkUrl, fallbackLine.note),
    expiresAt,
  };
}

async function markPhoneOptOut(link: UserPhoneLink): Promise<void> {
  await db
    .update(userPhoneLinks)
    .set({
      smsOptInStatus: "opted_out",
      smsOptedOutAt: new Date(),
      smsLastStopAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userPhoneLinks.id, link.id));
}

async function markPhoneOptIn(link: UserPhoneLink): Promise<UserPhoneLink> {
  const [updated] = await db
    .update(userPhoneLinks)
    .set({
      smsOptInStatus: "opted_in",
      smsEnabled: true,
      updatedAt: new Date(),
    })
    .where(eq(userPhoneLinks.id, link.id))
    .returning();

  return updated;
}

function isStopMessage(message: string): boolean {
  return STOP_KEYWORDS.has(normalizeSmsKeyword(message));
}

function isStartMessage(message: string): boolean {
  return START_KEYWORDS.has(normalizeSmsKeyword(message));
}

function isHelpMessage(message: string): boolean {
  return HELP_KEYWORDS.has(normalizeSmsKeyword(message));
}

export async function handleVerifiedInboundSmsWebhook(
  webhook: VerifiedTelnyxWebhook,
): Promise<void> {
  const inbound = parseTelnyxInboundMessage(webhook);
  const normalizedFrom = normalizePhoneToE164(inbound.from);
  const inboundInsert = await insertSmsEvent({
    phoneE164: normalizedFrom,
    direction: "inbound",
    providerEventId: inbound.providerEventId,
    providerMessageId: inbound.providerMessageId,
    eventType: webhook.eventType,
    messageText: inbound.text,
    structuredPayload: inbound.raw,
    status: "received",
    dedupeOnProviderEventId: true,
  });

  if (!inboundInsert.inserted) {
    return;
  }

  const existingLink = await findPhoneLinkByPhone(normalizedFrom);
  const messageText = inbound.text || "";

  if (isStopMessage(messageText)) {
    if (existingLink) {
      await markPhoneOptOut(existingLink);
      await sendAndLogSms({
        to: normalizedFrom,
        text: "Sportfolio SMS is paused. Reply START to resume.",
        userId: existingLink.userId,
        eventType: "opt_out",
      });
    }
    return;
  }

  if (isStartMessage(messageText) && existingLink) {
    const updatedLink = await markPhoneOptIn(existingLink);
    await sendAndLogSms({
      to: normalizedFrom,
      text: "Sportfolio SMS is active again. You can text your agent now.",
      userId: updatedLink.userId,
      eventType: "opt_in",
    });
    return;
  }

  if (isHelpMessage(messageText)) {
    const guestHelp = existingLink ? null : await createUnlinkedHelpReply(normalizedFrom);
    const helpLink = existingLink ? buildAppAgentUrl() : null;
    await sendAndLogSms({
      to: normalizedFrom,
      text: guestHelp ? guestHelp.text : renderSmsHelpReply(helpLink || buildAppAgentUrl()),
      userId: existingLink?.userId || null,
      eventType: "help",
      structuredPayload: guestHelp
        ? {
            linked: false,
            expiresAt: guestHelp.expiresAt.toISOString(),
          }
        : {
            linked: true,
          },
    });
    return;
  }

  if (!existingLink) {
    const onboarding = await createUnknownSenderOnboardingReply(normalizedFrom, messageText);
    await sendAndLogSms({
      to: normalizedFrom,
      text: onboarding.text,
      eventType: "onboarding",
      structuredPayload: {
        linked: false,
        expiresAt: onboarding.expiresAt.toISOString(),
      },
    });
    return;
  }

  await db
    .update(userPhoneLinks)
    .set({
      lastInboundAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userPhoneLinks.id, existingLink.id));

  if (existingLink.smsOptInStatus === "opted_out") {
    return;
  }

  if (!existingLink.smsEnabled) {
    await sendAndLogSms({
      to: normalizedFrom,
      text: "Your Sportfolio SMS agent is disabled in account settings. Re-enable it on your profile to continue.",
      userId: existingLink.userId,
      eventType: "disabled",
    });
    return;
  }

  const smsThread = await getOrCreateSmsAgentThread(existingLink.userId, normalizedFrom);
  const turn = await sendAgentThreadMessage(existingLink.userId, smsThread.id, {
    message: messageText,
  });
  const smsText = renderSmsThreadTurnResult(turn);

  await sendAndLogSms({
    to: normalizedFrom,
    text: smsText,
    userId: existingLink.userId,
    agentThreadId: smsThread.id,
    eventType: "agent_reply",
    structuredPayload: {
      threadId: smsThread.id,
      pendingActionBundleId: turn.pendingActionBundle?.id || null,
    },
  });
}

export async function recordVerifiedSmsStatusWebhook(
  webhook: VerifiedTelnyxWebhook,
): Promise<void> {
  const deliveryEvent = parseTelnyxDeliveryEvent(webhook);
  const phone = deliveryEvent.to || deliveryEvent.from;
  if (!phone) {
    return;
  }

  await insertSmsEvent({
    phoneE164: normalizePhoneToE164(phone),
    direction: "outbound",
    providerEventId: deliveryEvent.providerEventId,
    providerMessageId: deliveryEvent.providerMessageId,
    eventType: webhook.eventType,
    structuredPayload: deliveryEvent.raw,
    status: deliveryEvent.status,
    dedupeOnProviderEventId: true,
  });
}

export function parseTelnyxWebhookPayload(payload: unknown): VerifiedTelnyxWebhook {
  return parseVerifiedTelnyxWebhook(payload);
}

export async function ensureSmsSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "user_phone_links" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "phone_e164" varchar(20) NOT NULL,
        "normalized_phone" varchar(20) NOT NULL,
        "verified_at" timestamp,
        "linked_at" timestamp NOT NULL DEFAULT now(),
        "last_inbound_at" timestamp,
        "last_outbound_at" timestamp,
        "sms_enabled" boolean NOT NULL DEFAULT true,
        "sms_opt_in_status" text NOT NULL DEFAULT 'pending',
        "sms_opt_in_source" text,
        "sms_opted_out_at" timestamp,
        "sms_last_stop_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "user_phone_links_user_idx" ON "user_phone_links" ("user_id");
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "user_phone_links_phone_idx" ON "user_phone_links" ("normalized_phone");
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "user_phone_links_status_idx" ON "user_phone_links" ("sms_opt_in_status", "sms_enabled");
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "user_phone_link_tokens" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "phone_e164" varchar(20) NOT NULL,
        "token_hash" text NOT NULL,
        "purpose" text NOT NULL DEFAULT 'signup_or_link',
        "expires_at" timestamp NOT NULL,
        "claimed_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
        "consumed_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "user_phone_link_tokens_hash_idx" ON "user_phone_link_tokens" ("token_hash");
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "user_phone_link_tokens_phone_idx" ON "user_phone_link_tokens" ("phone_e164");
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "user_phone_link_tokens_expiry_idx" ON "user_phone_link_tokens" ("expires_at");
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "sms_message_events" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "phone_e164" varchar(20) NOT NULL,
        "direction" text NOT NULL,
        "provider" text NOT NULL DEFAULT 'telnyx',
        "provider_event_id" text,
        "provider_message_id" text,
        "user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
        "agent_thread_id" varchar REFERENCES "user_agent_threads"("id") ON DELETE SET NULL,
        "event_type" text NOT NULL DEFAULT 'message',
        "message_text" text,
        "structured_payload" jsonb,
        "status" text NOT NULL DEFAULT 'received',
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "sms_message_events_provider_event_idx" ON "sms_message_events" ("provider_event_id");
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "sms_message_events_phone_created_idx" ON "sms_message_events" ("phone_e164", "created_at");
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "sms_message_events_user_created_idx" ON "sms_message_events" ("user_id", "created_at");
    `);
  } catch (error: any) {
    console.warn("[SMS] Could not ensure SMS schema:", error?.message || error);
  }
}
