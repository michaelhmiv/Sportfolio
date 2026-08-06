import { SiDiscord } from "react-icons/si";
import { Link } from "wouter";
import { SPORTFOLIO_DISCORD_INVITE } from "@/lib/community-links";

const linkClass =
  "inline-flex min-h-11 items-center text-sm text-content-muted transition-colors duration-fast hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:min-h-8";

type FooterLink = {
  label: string;
  href: string;
  testId?: string;
};

type FooterSection = {
  title: string;
  links: readonly FooterLink[];
};

const sections: readonly FooterSection[] = [
  {
    title: "Company",
    links: [
      { label: "About", href: "/about", testId: "link-footer-about" },
      { label: "Contact", href: "/contact", testId: "link-footer-contact" },
      { label: "Blog", href: "/blog", testId: "link-footer-blog" },
    ],
  },
  {
    title: "Markets",
    links: [
      { label: "Player Pools", href: "/pools" },
      { label: "Wiki", href: "/wiki", testId: "link-footer-wiki" },
      { label: "Leaderboards", href: "/leaderboards" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy", testId: "link-footer-privacy" },
      { label: "Terms", href: "/terms", testId: "link-footer-terms" },
    ],
  },
] as const;

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer
      className="mt-auto border-t border-border-subtle bg-sidebar"
      data-testid="application-footer"
    >
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          {sections.map((section) => (
            <section key={section.title} aria-labelledby={`footer-${section.title.toLowerCase()}`}>
              <h2
                id={`footer-${section.title.toLowerCase()}`}
                className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-content-subtle"
              >
                {section.title}
              </h2>
              <ul>
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={linkClass} data-testid={link.testId}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section aria-labelledby="footer-community">
            <h2
              id="footer-community"
              className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-content-subtle"
            >
              Community
            </h2>
            <a
              href={SPORTFOLIO_DISCORD_INVITE}
              target="_blank"
              rel="noopener noreferrer"
              className={`${linkClass} gap-2`}
              data-testid="link-footer-discord"
            >
              <SiDiscord className="h-4 w-4" aria-hidden="true" />
              Discord
            </a>
          </section>
        </div>

        <div className="mt-5 flex flex-col gap-2 border-t border-border-subtle pt-4 text-xs text-content-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>© {currentYear} Sportfolio</p>
          <p className="max-w-xl sm:text-right">
            Trade player shares, scout talent, and manage a multi-sport portfolio.
          </p>
        </div>
      </div>
    </footer>
  );
}
