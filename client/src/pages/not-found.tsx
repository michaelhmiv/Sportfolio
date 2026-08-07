import { ArrowRight, BookOpen, Home, SearchX } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="terminal-page flex min-h-[70dvh] items-center justify-center px-4 py-10">
      <Card variant="empty" className="w-full max-w-2xl overflow-hidden">
        <CardContent className="p-7 text-center sm:p-10">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-circle bg-surface-raised text-content-subtle">
            <SearchX className="h-8 w-8" aria-hidden="true" />
          </div>
          <p className="mt-6 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
            404 · Route unavailable
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-content-strong">
            This page is not in the current market.
          </h1>
          <p className="mx-auto mt-4 max-w-lg leading-7 text-content-muted">
            The address may be outdated, incomplete, or tied to a feature that has moved. Use one of
            the active destinations below.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Button asChild className="gap-2">
              <Link href="/">
                <Home className="h-4 w-4" aria-hidden="true" />
                Dashboard
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/wiki">
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                Search the handbook
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
