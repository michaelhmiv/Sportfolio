export const LAST_REWARDED_AD_REPORT_CONTEXT_KEY = "sportfolio_last_rewarded_ad_report_context_v1";

export interface RewardedAdReportContext {
  platform: "ios" | "android";
  shownAt: string;
  adResponseId?: string | null;
  mediationAdapterClassName?: string | null;
}

export function rememberRewardedAdReportContext(context: RewardedAdReportContext): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(LAST_REWARDED_AD_REPORT_CONTEXT_KEY, JSON.stringify(context));
  } catch {
    // Reporting remains available without stored diagnostic context.
  }
}

export function readRewardedAdReportContext(): RewardedAdReportContext | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(LAST_REWARDED_AD_REPORT_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RewardedAdReportContext;
    if (parsed.platform !== "ios" && parsed.platform !== "android") return null;
    if (!parsed.shownAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildAdReportMailto(
  supportEmail: string,
  context: RewardedAdReportContext | null = readRewardedAdReportContext(),
): string {
  const subject = "Report an inappropriate or age-inappropriate ad";
  const contextLines = context
    ? [
        `Platform: ${context.platform}`,
        `Ad shown at: ${context.shownAt}`,
        context.adResponseId ? `Ad response ID: ${context.adResponseId}` : null,
        context.mediationAdapterClassName
          ? `Ad network adapter: ${context.mediationAdapterClassName}`
          : null,
      ].filter(Boolean)
    : ["Platform/device: ", "Approximate date and time the ad appeared: "];

  const body = [
    "Please describe why this ad was inappropriate or age-inappropriate.",
    "",
    ...contextLines,
    "",
    "If possible, include a screenshot and the page where you started the rewarded ad. Do not include passwords, sign-in links, access tokens, or payment credentials.",
  ].join("\n");

  return `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
