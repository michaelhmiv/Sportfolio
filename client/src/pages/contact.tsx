import { Bug, Lightbulb, Mail, MessageCircle, ShieldAlert } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { Link } from "wouter";
import { EditorialSection, PageHero, SurfaceLayout } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";
import { SPORTFOLIO_DISCORD_INVITE, SPORTFOLIO_SUPPORT_EMAIL } from "@/lib/community-links";

const channels = [
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

export default function Contact() {
  return (
    <SurfaceLayout kind="public">
      <PageHero
        eyebrow="Sportfolio support"
        title="Get the issue to the right place."
        description="Choose the channel that matches your request so account problems, bug reports, and gameplay questions can be handled with the right context."
        icon={<MessageCircle className="h-4 w-4" aria-hidden="true" />}
      />

      <EditorialSection
        title="Support channels"
        description="Do not post passwords, sign-in links, OAuth codes, access tokens, or payment credentials in Discord or email."
      >
        <div className="grid gap-5 lg:grid-cols-3">
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

      <EditorialSection title="What to include" className="bg-surface">
        <div className="grid gap-8 md:grid-cols-2">
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
          Sportfolio aims to respond to direct support requests within 24 to 48 hours. Service-wide
          incidents and authentication failures are prioritized ahead of general questions and
          feature requests.
        </p>
      </EditorialSection>
    </SurfaceLayout>
  );
}
