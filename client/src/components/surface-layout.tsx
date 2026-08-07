import { type ReactNode, useLayoutEffect } from "react";
import { ArrowLeft, BarChart3, BookOpen, Home, ShieldCheck, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import logoUrl from "@assets/Sportfolio png_1763227952318.png";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "./surface-layout.css";

export type SurfaceKind = "auth" | "docs" | "public" | "legal" | "status";

const primaryLinks = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/pools", label: "Player Pools", icon: TrendingUp },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/wiki", label: "Handbook", icon: BookOpen },
] as const;

function BrandLink() {
  return (
    <Link
      href="/"
      className="inline-flex min-h-11 items-center gap-2 rounded-control px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      aria-label="Sportfolio dashboard"
    >
      <img src={logoUrl} alt="" width={36} height={36} className="h-9 w-9" />
      <span className="text-lg font-extrabold tracking-tight text-brand">Sportfolio</span>
    </Link>
  );
}

export function SurfaceLayout({
  kind,
  children,
  showFooter = kind !== "auth" && kind !== "status",
}: {
  kind: SurfaceKind;
  children: ReactNode;
  showFooter?: boolean;
}) {
  useLayoutEffect(() => {
    const previous = document.body.dataset.routeSurface;
    document.body.dataset.routeSurface = kind;

    return () => {
      if (previous) document.body.dataset.routeSurface = previous;
      else delete document.body.dataset.routeSurface;
    };
  }, [kind]);

  const compact = kind === "auth" || kind === "status";

  return (
    <div
      className="surface-layout min-h-[100dvh] bg-canvas text-foreground"
      data-surface-kind={kind}
    >
      <header className="surface-site-header sticky top-0 z-40 border-b border-border-subtle bg-canvas/92 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <BrandLink />

          {compact ? (
            <Button asChild variant="ghost" className="gap-2">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Back to dashboard</span>
                <span className="sm:hidden">Back</span>
              </Link>
            </Button>
          ) : (
            <nav aria-label="Public navigation" className="flex items-center gap-1">
              {primaryLinks.map(({ href, label, icon: Icon }) => (
                <Button
                  key={href}
                  asChild
                  variant="ghost"
                  size="sm"
                  className={cn("gap-2", href !== "/" && "hidden sm:inline-flex")}
                >
                  <Link href={href}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {label}
                  </Link>
                </Button>
              ))}
              <Button asChild size="sm" className="ml-1">
                <Link href="/login">Sign in</Link>
              </Button>
            </nav>
          )}
        </div>
      </header>

      <main className="surface-site-main min-h-[calc(100dvh-4rem)]">{children}</main>

      {showFooter ? (
        <footer className="border-t border-border-subtle bg-surface/70">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-7 text-sm text-content-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-brand" aria-hidden="true" />
              <span>Virtual sports-market gameplay. No cash-out or real-money wagering.</span>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Link href="/about" className="hover:text-content">
                About
              </Link>
              <Link href="/contact" className="hover:text-content">
                Contact
              </Link>
              <Link href="/privacy" className="hover:text-content">
                Privacy
              </Link>
              <Link href="/terms" className="hover:text-content">
                Terms
              </Link>
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}

export function PageHero({
  eyebrow,
  title,
  description,
  icon,
  actions,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className="relative overflow-hidden border-b border-border-subtle bg-surface">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--brand)/0.14),transparent_42%)]" />
      <div
        className={cn(
          "relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8",
          compact ? "py-10 sm:py-14" : "py-14 sm:py-20",
        )}
      >
        <div className="max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-pill border border-brand/25 bg-brand-subtle px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
            {icon}
            {eyebrow}
          </div>
          <h1 className="max-w-3xl text-4xl font-black tracking-[-0.035em] text-content-strong sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-content-muted sm:text-lg">
            {description}
          </p>
          {actions ? <div className="mt-7 flex flex-wrap gap-3">{actions}</div> : null}
        </div>
      </div>
    </section>
  );
}

export function EditorialSection({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-b border-border-subtle last:border-b-0", className)}>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        {(title || description) && (
          <div className="mb-7 max-w-2xl">
            {title ? (
              <h2 className="text-2xl font-bold tracking-tight text-content-strong">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-2 leading-7 text-content-muted">{description}</p>
            ) : null}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

export function AuthSurface({
  eyebrow = "Secure account access",
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <SurfaceLayout kind="auth" showFooter={false}>
      <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-6xl items-stretch lg:grid-cols-[1.05fr_0.95fr]">
        <aside className="relative hidden overflow-hidden border-r border-border-subtle bg-surface px-10 py-14 lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--brand)/0.18),transparent_44%)]" />
          <div className="relative">
            <div className="inline-flex rounded-pill border border-brand/25 bg-brand-subtle px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
              Live multi-sport exchange
            </div>
            <h2 className="mt-6 max-w-md text-4xl font-black tracking-[-0.035em] text-content-strong">
              Your sports knowledge, expressed as a portfolio.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-content-muted">
              Follow live player markets, build positions across sports, scout long-term talent, and
              use game-day boosts from one account.
            </p>
          </div>
          <div className="relative grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[
              "Live player-market pricing",
              "Multi-sport portfolio tracking",
              "Secure single-use sign-in links",
            ].map((item) => (
              <div
                key={item}
                className="rounded-panel border border-border-subtle bg-canvas/70 px-4 py-3 text-sm font-medium text-content"
              >
                {item}
              </div>
            ))}
          </div>
        </aside>

        <div className="flex items-center justify-center px-4 py-10 sm:px-8 lg:px-12">
          <div className="w-full max-w-md">
            <div className="mb-6 lg:hidden">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
                {eyebrow}
              </div>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-content-strong">
                {title}
              </h1>
              <p className="mt-3 leading-6 text-content-muted">{description}</p>
            </div>
            <div className="hidden lg:block">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
                {eyebrow}
              </div>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-content-strong">
                {title}
              </h1>
              <p className="mt-3 leading-6 text-content-muted">{description}</p>
            </div>
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </div>
    </SurfaceLayout>
  );
}

export function StatusSurface({
  children,
  width = "max-w-lg",
}: {
  children: ReactNode;
  width?: string;
}) {
  return (
    <SurfaceLayout kind="status" showFooter={false}>
      <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-10">
        <div className={cn("w-full", width)}>{children}</div>
      </div>
    </SurfaceLayout>
  );
}

export function DocumentShell({
  title,
  summary,
  effectiveDate,
  sections,
  children,
}: {
  title: string;
  summary: string;
  effectiveDate?: string;
  sections: readonly { id: string; title: string }[];
  children: ReactNode;
}) {
  return (
    <SurfaceLayout kind="legal">
      <PageHero eyebrow="Policy reference" title={title} description={summary} compact />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-8 lg:py-14">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1" aria-label={`${title} sections`}>
            <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-content-subtle">
              On this page
            </p>
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="block rounded-control px-3 py-2 text-sm text-content-muted transition-colors hover:bg-hover hover:text-content"
              >
                {section.title}
              </a>
            ))}
          </nav>
        </aside>
        <article className="min-w-0 max-w-3xl space-y-10">
          {children}
          {effectiveDate ? (
            <p className="border-t border-border-subtle pt-6 text-sm text-content-subtle">
              Effective and last updated: {effectiveDate}
            </p>
          ) : null}
        </article>
      </div>
    </SurfaceLayout>
  );
}

export function DocumentSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-bold tracking-tight text-content-strong">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-content-muted">{children}</div>
    </section>
  );
}
