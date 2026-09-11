import { useState } from "react";
import { Bug, Flag, Lightbulb, Mail, MessageCircle, ShieldAlert, UserX } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { Link } from "wouter";
import { EditorialSection, PageHero, SurfaceLayout } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { buildAdReportMailto } from "@/lib/ad-report";
import { SPORTFOLIO_DISCORD_INVITE, SPORTFOLIO_SUPPORT_EMAIL } from "@/lib/community-links";
import { apiRequest } from "@/lib/queryClient";

const baseChannels = [
  {
    icon: SiDiscord,
    title: "Community and quick questions",
    description:
      "Use Discord for gameplay questions, feature discussion, and the fastest community response.",
    action: "Open Discord",
    href: SPORTFOLIO_DISCORD_INVITE,
    external: true,
  },
  {
    icon: Mail,
    title: "Account and private support",
    description:
      "Use email for account-specific issues, privacy requests, or details that should not be posted publicly.",
    action: "Email support",
    href: `mailto:${SPORTFOLIO_SUPPORT_EMAIL}`,
    external: true,
  },
  {
    icon: ShieldAlert,
    title: "Account deletion",
    description:
      "Use the dedicated deletion workflow for identity verification, timing, and retention information.",
    action: "Delete account information",
    href: "/account-deletion",
    external: false,
  },
] as const;

const reportReasons = [
  ["inappropriate_profile", "Inappropriate profile"],
  ["harassment", "Harassment"],
  ["impersonation", "Impersonation"],
  ["spam", "Spam"],
  ["other", "Other"],
] as const;

export default function Contact() {
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const [profileUsername, setProfileUsername] = useState("");
  const [profileReportReason, setProfileReportReason] =
    useState<(typeof reportReasons)[number][0]>("inappropriate_profile");
  const [profileReportDetails, setProfileReportDetails] = useState("");
  const [profileSafetyBusy, setProfileSafetyBusy] = useState<"report" | "block" | "unblock" | null>(
    null,
  );

  const channels = [
    ...baseChannels,
    {
      icon: Flag,
      title: "Report an ad",
      description:
        "Report any inappropriate or age-inappropriate rewarded ad. Sportfolio includes the latest available ad diagnostic context in the email when possible.",
      action: "Report an ad",
      href: buildAdReportMailto(SPORTFOLIO_SUPPORT_EMAIL),
      external: true,
    },
  ] as const;

  const requireProfileUsername = () => {
    const username = profileUsername.trim();
    if (!username) {
      toast({
        title: "Enter a username",
        description: "Enter the Sportfolio username for the profile you want to report or block.",
        variant: "destructive",
      });
      return null;
    }
    return username;
  };

  const handleProfileReport = async () => {
    if (!isAuthenticated) return;
    const username = requireProfileUsername();
    if (!username) return;

    setProfileSafetyBusy("report");
    try {
      await apiRequest("POST", "/api/profile-safety/report", {
        username,
        reason: profileReportReason,
        details: profileReportDetails.trim() || undefined,
      });
      setProfileReportDetails("");
      toast({
        title: "Profile reported",
        description: `The report for @${username} was submitted for moderation review.`,
      });
    } catch (error) {
      toast({
        title: "Could not submit report",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setProfileSafetyBusy(null);
    }
  };

  const handleProfileBlock = async (blocked: boolean) => {
    if (!isAuthenticated) return;
    const username = requireProfileUsername();
    if (!username) return;

    setProfileSafetyBusy(blocked ? "block" : "unblock");
    try {
      await apiRequest(blocked ? "POST" : "DELETE", "/api/profile-safety/block", { username });
      toast({
        title: blocked ? "Profile blocked" : "Profile unblocked",
        description: blocked
          ? `@${username}'s public profile content will be hidden from your account.`
          : `@${username}'s public profile can be viewed by your account again.`,
      });
    } catch (error) {
      toast({
        title: blocked ? "Could not block profile" : "Could not unblock profile",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setProfileSafetyBusy(null);
    }
  };

  return (
    <SurfaceLayout kind="public">
      <PageHero
        eyebrow="Sportfolio support"
        title="Get the issue to the right place."
        description="Choose the channel that matches your request so account problems, ad concerns, profile safety issues, bug reports, and gameplay questions can be handled with the right context."
        icon={<MessageCircle className="h-4 w-4" aria-hidden="true" />}
      />

      <EditorialSection
        title="Support channels"
        description="Do not post passwords, sign-in links, OAuth codes, access tokens, or payment credentials in Discord or email."
      >
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {channels.map(({ icon: Icon, title, description, action, href, external }) => (
            <article
              key={title}
              className="flex flex-col rounded-panel border border-border-subtle bg-surface p-6 shadow-low"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-panel bg-brand-subtle text-brand">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-5 text-lg font-bold text-content-strong">{title}</h2>
              <p className="mt-2 flex-1 leading-6 text-content-muted">{description}</p>
              {external ? (
                <Button asChild className="mt-6 w-full">
                  <a
                    href={href}
                    target={href.startsWith("http") ? "_blank" : undefined}
                    rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                  >
                    {action}
                  </a>
                </Button>
              ) : (
                <Button asChild className="mt-6 w-full">
                  <Link href={href}>{action}</Link>
                </Button>
              )}
            </article>
          ))}
        </div>
      </EditorialSection>

      <EditorialSection
        title="Profile safety"
        description="Public Sportfolio profiles can contain user-selected usernames and profile images. Signed-in users can report objectionable profile content and block a profile from their own account."
        className="bg-surface"
      >
        {isAuthenticated ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="rounded-panel border border-border-subtle bg-background p-5">
              <div className="flex items-center gap-3">
                <UserX className="h-5 w-5 text-brand" aria-hidden="true" />
                <div>
                  <h3 className="font-bold text-content-strong">Choose a profile</h3>
                  <p className="text-sm text-content-muted">
                    Enter the public Sportfolio username.
                  </p>
                </div>
              </div>
              <label
                className="mt-5 block text-sm font-medium text-content-strong"
                htmlFor="safety-username"
              >
                Username
              </label>
              <input
                id="safety-username"
                value={profileUsername}
                onChange={(event) => setProfileUsername(event.target.value)}
                placeholder="username"
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                className="mt-2 h-11 w-full rounded-control border border-border bg-surface px-3 text-content-strong outline-none transition focus:border-brand"
              />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={profileSafetyBusy !== null}
                  onClick={() => void handleProfileBlock(true)}
                >
                  {profileSafetyBusy === "block" ? "Blocking…" : "Block profile"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={profileSafetyBusy !== null}
                  onClick={() => void handleProfileBlock(false)}
                >
                  {profileSafetyBusy === "unblock" ? "Unblocking…" : "Unblock"}
                </Button>
              </div>
              <p className="mt-3 text-xs leading-5 text-content-muted">
                Blocking hides that user's public profile content from your signed-in account. You
                can reverse the block here at any time.
              </p>
            </div>

            <div className="rounded-panel border border-border-subtle bg-background p-5">
              <div className="flex items-center gap-3">
                <Flag className="h-5 w-5 text-brand" aria-hidden="true" />
                <div>
                  <h3 className="font-bold text-content-strong">Report profile content</h3>
                  <p className="text-sm text-content-muted">
                    Reports are recorded for moderation review with a snapshot of the reported
                    username and profile image reference.
                  </p>
                </div>
              </div>

              <label
                className="mt-5 block text-sm font-medium text-content-strong"
                htmlFor="safety-reason"
              >
                Reason
              </label>
              <select
                id="safety-reason"
                value={profileReportReason}
                onChange={(event) =>
                  setProfileReportReason(event.target.value as (typeof reportReasons)[number][0])
                }
                className="mt-2 h-11 w-full rounded-control border border-border bg-surface px-3 text-content-strong outline-none transition focus:border-brand"
              >
                {reportReasons.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>

              <label
                className="mt-4 block text-sm font-medium text-content-strong"
                htmlFor="safety-details"
              >
                Details (optional)
              </label>
              <textarea
                id="safety-details"
                value={profileReportDetails}
                onChange={(event) => setProfileReportDetails(event.target.value)}
                maxLength={1500}
                rows={4}
                placeholder="Describe the objectionable content or behavior."
                className="mt-2 w-full resize-y rounded-control border border-border bg-surface p-3 text-content-strong outline-none transition focus:border-brand"
              />
              <Button
                type="button"
                className="mt-4 w-full sm:w-auto"
                disabled={profileSafetyBusy !== null}
                onClick={() => void handleProfileReport()}
              >
                {profileSafetyBusy === "report" ? "Submitting…" : "Submit profile report"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-panel border border-border-subtle bg-background p-6">
            <p className="leading-7 text-content-muted">
              Sign in to report or block a public profile. This ties safety actions to an account
              and helps prevent abuse of the reporting system.
            </p>
            <Button asChild className="mt-4">
              <Link href="/login?redirect=/contact">Sign in for profile safety controls</Link>
            </Button>
          </div>
        )}
      </EditorialSection>

      <EditorialSection title="What to include">
        <div className="grid gap-8 md:grid-cols-3">
          <div className="flex gap-4">
            <Bug className="mt-1 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
            <div>
              <h3 className="font-bold text-content-strong">For a bug report</h3>
              <p className="mt-2 leading-7 text-content-muted">
                Include the page, approximate time, device or browser, what you expected, and what
                happened. Screenshots are useful when they do not expose private account
                information.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <Flag className="mt-1 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
            <div>
              <h3 className="font-bold text-content-strong">For an ad report</h3>
              <p className="mt-2 leading-7 text-content-muted">
                Explain why the ad was inappropriate or age-inappropriate and include a screenshot
                if available. The report link adds recent rewarded-ad diagnostic identifiers when
                the app has them so the ad can be traced with the provider.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <Lightbulb className="mt-1 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
            <div>
              <h3 className="font-bold text-content-strong">For a feature request</h3>
              <p className="mt-2 leading-7 text-content-muted">
                Describe the decision or task you are trying to complete, not only the interface
                element you want added. That makes the underlying UX problem easier to evaluate.
              </p>
            </div>
          </div>
        </div>
      </EditorialSection>

      <EditorialSection title="Response expectations">
        <p className="max-w-3xl leading-7 text-content-muted">
          Sportfolio aims to respond to direct support requests within 24 to 48 hours. Reports of
          inappropriate or age-inappropriate ads, objectionable public profile content, service-wide
          incidents, and authentication failures are prioritized ahead of general questions and
          feature requests.
        </p>
      </EditorialSection>
    </SurfaceLayout>
  );
}
