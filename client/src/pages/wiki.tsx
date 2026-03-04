import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { BookOpen, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DocsArticleSummary } from "@shared/docs";

type DocsIndexResponse = {
  articles: DocsArticleSummary[];
};

const sectionLabels: Record<string, string> = {
  "getting-started": "Getting Started",
  gameplay: "Gameplay",
  features: "Features",
  agent: "Agent",
  cli: "CLI",
  faq: "FAQ",
  changelog: "Changelog",
  troubleshooting: "Troubleshooting",
  internal: "Internal",
};

export default function WikiPage() {
  const [, params] = useRoute("/wiki/:section");
  const selectedSection = params?.section || "";
  const [searchValue, setSearchValue] = useState("");
  const { data, isLoading, error } = useQuery<DocsIndexResponse>({
    queryKey: ["/api/docs/index"],
  });

  const filteredArticles = useMemo(() => {
    const articles = data?.articles || [];
    const normalizedSearch = searchValue.trim().toLowerCase();

    return articles.filter((article) => {
      if (selectedSection && article.section !== selectedSection) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        article.title,
        article.summary,
        article.section,
        article.searchKeywords.join(" "),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [data?.articles, searchValue, selectedSection]);

  const sections = useMemo(
    () => Array.from(new Set((data?.articles || []).map((article) => article.section))),
    [data?.articles],
  );

  const groupedArticles = useMemo(() => {
    return filteredArticles.reduce<Record<string, DocsArticleSummary[]>>((groups, article) => {
      if (!groups[article.section]) {
        groups[article.section] = [];
      }
      groups[article.section].push(article);
      return groups;
    }, {});
  }, [filteredArticles]);

  if (isLoading) {
    return (
      <div className="terminal-page p-6 md:p-10">
        <div className="max-w-6xl mx-auto">
          <div className="terminal-subtle text-center">Loading Sportfolio wiki...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="terminal-page p-6 md:p-10">
        <div className="max-w-6xl mx-auto">
          <Card variant="terminal">
            <CardContent className="py-10 text-center">
              <p className="terminal-heading text-sm">Wiki unavailable</p>
              <p className="terminal-subtle mt-2">The documentation index could not be loaded.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-page">
      <div className="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-10">
        <div className="terminal-shell mb-8 p-6 md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="terminal-strip mb-3">
                <BookOpen className="h-3.5 w-3.5" />
                Canonical Sportfolio docs
              </div>
              <h1 className="terminal-heading text-3xl" data-testid="heading-wiki">
                Sportfolio Wiki
              </h1>
              <p className="terminal-subtle mt-2 max-w-2xl md:text-sm">
                Gameplay mechanics, product guides, agent usage, FAQs, and release notes now live in
                one versioned hub.
              </p>
            </div>
            <div className="w-full md:max-w-sm">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  variant="terminal"
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder="Search docs"
                  className="pl-9"
                  data-testid="input-wiki-search"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Card variant="terminal" className="h-fit">
            <CardHeader>
              <CardTitle className="terminal-heading text-sm">Sections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link
                href="/wiki"
                className={`block rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
                  !selectedSection
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                All articles
              </Link>
              {sections.map((section) => (
                <Link
                  key={section}
                  href={`/wiki/${section}`}
                  className={`block rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
                    selectedSection === section
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {sectionLabels[section] || section}
                </Link>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-6">
            {Object.entries(groupedArticles)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([section, articles]) => (
                <section key={section}>
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="terminal-heading text-lg">
                      {sectionLabels[section] || section}
                    </h2>
                    <Badge
                      variant="secondary"
                      className="rounded-sm border border-border bg-[hsl(var(--sidebar)/0.45)] font-mono text-[11px]"
                    >
                      {articles.length}
                    </Badge>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {articles.map((article) => (
                      <Link key={article.id} href={article.urlPath}>
                        <Card
                          variant="terminal"
                          className="h-full border transition-colors hover:border-primary/40"
                        >
                          <CardHeader className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <Badge
                                variant="outline"
                                className="rounded-sm font-mono text-[11px] uppercase tracking-[0.08em]"
                              >
                                {sectionLabels[article.section] || article.section}
                              </Badge>
                              <span className="terminal-subtle">
                                Reviewed {article.lastReviewedAt}
                              </span>
                            </div>
                            <CardTitle className="text-lg leading-tight">{article.title}</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="terminal-subtle text-sm">{article.summary}</p>
                            <div className="terminal-label mt-4 flex items-center gap-2 text-[11px]">
                              Read article
                              <ChevronRight className="h-4 w-4" />
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}

            {filteredArticles.length === 0 && (
              <Card variant="terminal">
                <CardContent className="py-10 text-center">
                  <p className="terminal-heading text-sm">No matching docs</p>
                  <p className="terminal-subtle mt-2">
                    Try a broader search or switch back to all sections.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
