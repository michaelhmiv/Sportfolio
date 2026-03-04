import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ArrowLeft, BookOpen, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DocsArticle, DocsArticleSummary } from "@shared/docs";

type DocsArticleResponse = {
  article: DocsArticle;
};

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

function toHeadingId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export default function WikiArticlePage() {
  const [, params] = useRoute("/wiki/:section/:slug");
  const section = params?.section || "";
  const slug = params?.slug || "";

  const { data, isLoading, error } = useQuery<DocsArticleResponse>({
    queryKey: ["/api/docs/article", section, slug],
    enabled: Boolean(section && slug),
    queryFn: async () => {
      const response = await fetch(`/api/docs/article/${section}/${slug}`);
      if (!response.ok) {
        throw new Error("Failed to fetch docs article");
      }
      return response.json();
    },
  });

  const { data: indexData } = useQuery<DocsIndexResponse>({
    queryKey: ["/api/docs/index"],
  });

  if (isLoading) {
    return (
      <div className="terminal-page p-6 md:p-10">
        <div className="terminal-subtle max-w-5xl mx-auto text-center">Loading article...</div>
      </div>
    );
  }

  if (error || !data?.article) {
    return (
      <div className="terminal-page p-6 md:p-10">
        <div className="max-w-5xl mx-auto">
          <Card variant="terminal">
            <CardContent className="py-10 text-center">
              <p className="terminal-heading text-sm">Article not found</p>
              <p className="terminal-subtle mt-2">The requested wiki article is unavailable.</p>
              <div className="mt-6">
                <Link href="/wiki">
                  <Button variant="terminalOutline">Back to wiki</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const article = data.article;
  const relatedArticles = (indexData?.articles || []).filter((entry) =>
    article.relatedArticleIds.includes(entry.id),
  );

  return (
    <div className="terminal-page">
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-8 md:py-10">
        <div className="terminal-subtle mb-6 flex flex-wrap items-center gap-2 text-sm">
          <Link href="/wiki" className="inline-flex items-center gap-1 hover:text-foreground">
            <BookOpen className="h-4 w-4" />
            Wiki
          </Link>
          <ChevronRight className="h-4 w-4" />
          <Link
            href={`/wiki/${article.section}`}
            className="hover:text-foreground"
            data-testid="link-wiki-section"
          >
            {sectionLabels[article.section] || article.section}
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground">{article.title}</span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <Link href="/wiki">
              <Button
                variant="terminalOutline"
                className="mb-4 gap-2"
                data-testid="button-wiki-back"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to wiki
              </Button>
            </Link>

            <Card variant="terminal">
              <CardHeader className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="rounded-sm font-mono text-[11px] uppercase tracking-[0.08em]"
                  >
                    {sectionLabels[article.section] || article.section}
                  </Badge>
                  <span className="terminal-subtle">Reviewed {article.lastReviewedAt}</span>
                </div>
                <div>
                  <h1 className="terminal-heading text-3xl" data-testid="heading-wiki-article">
                    {article.title}
                  </h1>
                  <p className="terminal-subtle mt-3 md:text-sm">{article.summary}</p>
                </div>
              </CardHeader>
              <CardContent className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => {
                      const text = String(children).trim();
                      return <h1 id={toHeadingId(text)}>{children}</h1>;
                    },
                    h2: ({ children }) => {
                      const text = String(children).trim();
                      return <h2 id={toHeadingId(text)}>{children}</h2>;
                    },
                    h3: ({ children }) => {
                      const text = String(children).trim();
                      return <h3 id={toHeadingId(text)}>{children}</h3>;
                    },
                  }}
                >
                  {article.bodyMarkdown}
                </ReactMarkdown>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card variant="terminal">
              <CardHeader>
                <CardTitle className="terminal-heading text-sm">On this page</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {article.headings.map((heading) => (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className={`block font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground ${
                      heading.depth > 1 ? "pl-3" : ""
                    }`}
                  >
                    {heading.text}
                  </a>
                ))}
                {article.headings.length === 0 && (
                  <p className="terminal-subtle">No sections listed.</p>
                )}
              </CardContent>
            </Card>

            {relatedArticles.length > 0 && (
              <Card variant="terminal">
                <CardHeader>
                  <CardTitle className="terminal-heading text-sm">Related articles</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {relatedArticles.map((related) => (
                    <Link
                      key={related.id}
                      href={related.urlPath}
                      className="block rounded-sm border px-3 py-2 transition-colors hover:border-primary/40"
                    >
                      <div className="font-medium">{related.title}</div>
                      <div className="terminal-subtle mt-1">{related.summary}</div>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
