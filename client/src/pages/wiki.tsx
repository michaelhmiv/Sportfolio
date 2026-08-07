import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  FileText,
  Menu,
  MessageSquare,
  Search,
  Sparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getDocsChapterHeadingAnchorId,
  type DocsAnswerResponse,
  type DocsHandbook,
  type DocsHandbookChapter,
  type DocsSearchResult,
} from "@shared/docs";
import { SurfaceLayout, PageHero } from "@/components/surface-layout";
import { apiRequest, authenticatedFetch } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getLegacyWikiHref } from "@/features/wiki/handbook";

type DocsHandbookResponse = { handbook: DocsHandbook };
type DocsSearchResponse = { results: DocsSearchResult[] };

function getHash() {
  return typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "").trim();
}

function findChapterForAnchor(handbook: DocsHandbook, anchor: string): DocsHandbookChapter | null {
  if (!anchor) return null;
  for (const section of handbook.sections) {
    for (const chapter of section.chapters) {
      if (
        chapter.chapterAnchorId === anchor ||
        chapter.headings.some((heading) => heading.id === anchor)
      ) {
        return chapter;
      }
    }
  }
  return null;
}

function HandbookMarkdown({ chapter }: { chapter: DocsHandbookChapter }) {
  let headingIndex = 0;
  const resolveHeadingId = (fallbackText: string) => {
    const heading = chapter.headings[headingIndex];
    headingIndex += 1;
    return (
      heading?.id || getDocsChapterHeadingAnchorId(chapter.section, chapter.slug, fallbackText)
    );
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => {
          const id = resolveHeadingId(String(children).trim());
          return (
            <h1 id={id} className="scroll-mt-28">
              {children}
            </h1>
          );
        },
        h2: ({ children }) => {
          const id = resolveHeadingId(String(children).trim());
          return (
            <h2 id={id} className="scroll-mt-28">
              {children}
            </h2>
          );
        },
        h3: ({ children }) => {
          const id = resolveHeadingId(String(children).trim());
          return (
            <h3 id={id} className="scroll-mt-28">
              {children}
            </h3>
          );
        },
      }}
    >
      {chapter.bodyMarkdown}
    </ReactMarkdown>
  );
}

function HandbookNavigation({
  handbook,
  activeChapter,
  onSelect,
}: {
  handbook: DocsHandbook;
  activeChapter: DocsHandbookChapter | null;
  onSelect: (chapter: DocsHandbookChapter) => void;
}) {
  return (
    <nav className="space-y-6" aria-label="Handbook chapters">
      {handbook.sections.map((section) => (
        <section key={section.id}>
          <div className="mb-2 flex items-center justify-between gap-2 px-2">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-content-subtle">
              {section.label}
            </h2>
            <span className="text-xs tabular-nums text-content-subtle">
              {section.chapters.length}
            </span>
          </div>
          <div className="space-y-1">
            {section.chapters.map((chapter) => {
              const selected = activeChapter?.id === chapter.id;
              return (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => onSelect(chapter)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-control px-3 py-2 text-left text-sm transition-colors",
                    selected
                      ? "bg-brand-subtle text-content"
                      : "text-content-muted hover:bg-hover hover:text-content",
                  )}
                >
                  <FileText
                    className={cn("mt-0.5 h-4 w-4 shrink-0", selected && "text-brand")}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 leading-5">{chapter.title}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}

export default function WikiPage() {
  const [, sectionParams] = useRoute("/wiki/:section");
  const legacySection = sectionParams?.section || "";
  const [, setLocation] = useLocation();
  const [searchValue, setSearchValue] = useState("");
  const [activeAnchor, setActiveAnchor] = useState(getHash);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const deferredSearch = useDeferredValue(searchValue.trim());

  const { data, isLoading, error } = useQuery<DocsHandbookResponse>({
    queryKey: ["/api/docs/handbook"],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/docs/handbook");
      if (!response.ok) throw new Error("Failed to fetch docs handbook");
      return response.json();
    },
  });

  const { data: searchData } = useQuery<DocsSearchResponse>({
    queryKey: ["/api/docs/search", deferredSearch],
    enabled: deferredSearch.length > 0,
    queryFn: async () => {
      const response = await authenticatedFetch(
        `/api/docs/search?q=${encodeURIComponent(deferredSearch)}`,
      );
      if (!response.ok) throw new Error("Failed to search docs");
      return response.json();
    },
  });

  const askMutation = useMutation<DocsAnswerResponse, Error, string>({
    mutationFn: async (query) => {
      const response = await apiRequest("POST", "/api/docs/ask", { query });
      return (await response.json()) as DocsAnswerResponse;
    },
  });

  useEffect(() => {
    if (!legacySection) return;
    setLocation(getLegacyWikiHref(legacySection), { replace: true });
  }, [legacySection, setLocation]);

  useEffect(() => {
    const update = () => setActiveAnchor(getHash());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);

  const handbook = data?.handbook;
  const activeChapter = useMemo(
    () => (handbook ? findChapterForAnchor(handbook, activeAnchor) : null),
    [activeAnchor, handbook],
  );
  const activeSection = useMemo(
    () =>
      handbook?.sections.find((section) =>
        section.chapters.some((chapter) => chapter.id === activeChapter?.id),
      ),
    [activeChapter?.id, handbook],
  );
  const searchResults = searchData?.results || [];

  const selectChapter = (chapter: DocsHandbookChapter, anchor = chapter.chapterAnchorId) => {
    window.history.pushState(null, "", `/wiki#${anchor}`);
    setActiveAnchor(anchor);
    setMobileNavigationOpen(false);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  const selectAnchor = (anchor: string) => {
    if (!handbook) return;
    const chapter = findChapterForAnchor(handbook, anchor);
    if (!chapter) return;
    selectChapter(chapter, anchor);
    window.requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const submitQuestion = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = searchValue.trim();
    if (!query) return;
    await askMutation.mutateAsync(query);
  };

  if (legacySection) return null;

  return (
    <SurfaceLayout kind="docs">
      <PageHero
        eyebrow="Sportfolio handbook"
        title="Learn the market without fighting the documentation."
        description="Browse focused chapters, search the complete handbook, or ask a direct question about trading, scouting, boosts, collections, and account features."
        icon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
        compact
      />

      {isLoading ? (
        <div className="mx-auto max-w-7xl px-4 py-16 text-center text-content-muted">
          Loading Sportfolio handbook…
        </div>
      ) : error || !handbook ? (
        <div className="mx-auto max-w-2xl px-4 py-16">
          <Card variant="alert">
            <CardContent className="p-6 text-center">
              <h2 className="text-lg font-bold text-content-strong">Handbook unavailable</h2>
              <p className="mt-2 text-content-muted">
                The documentation service could not be loaded.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <div className="border-b border-border-subtle bg-surface/70">
            <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
              <form onSubmit={submitQuestion} className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle"
                    aria-hidden="true"
                  />
                  <Input
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="Search chapters or ask a Sportfolio question"
                    className="h-11 pl-10"
                    data-testid="input-wiki-search"
                  />
                </div>
                <Button
                  type="submit"
                  className="h-11 gap-2"
                  disabled={!searchValue.trim() || askMutation.isPending}
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Ask handbook
                </Button>
              </form>

              {deferredSearch ? (
                <div className="mt-3 overflow-hidden rounded-panel border border-border-subtle bg-surface shadow-medium">
                  {searchResults.length ? (
                    searchResults.slice(0, 6).map((result) => (
                      <button
                        key={`${result.id}-${result.anchorId}`}
                        type="button"
                        onClick={() => selectAnchor(result.anchorId)}
                        className="flex w-full items-start justify-between gap-4 border-b border-border-subtle px-4 py-3 text-left last:border-b-0 hover:bg-hover"
                      >
                        <span>
                          <span className="font-semibold text-content">{result.title}</span>
                          <span className="mt-1 block text-sm text-content-muted">
                            {result.summary}
                          </span>
                        </span>
                        <ChevronRight
                          className="mt-1 h-4 w-4 shrink-0 text-content-subtle"
                          aria-hidden="true"
                        />
                      </button>
                    ))
                  ) : (
                    <p className="px-4 py-4 text-sm text-content-muted">
                      No direct chapter matches. Submit the question for a handbook answer.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <Drawer open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
            <DrawerContent className="max-h-[85dvh]">
              <DrawerHeader className="text-left">
                <DrawerTitle>Handbook chapters</DrawerTitle>
                <DrawerDescription>
                  Select one chapter to open a focused reading view.
                </DrawerDescription>
              </DrawerHeader>
              <div className="overflow-y-auto px-4 pb-6">
                <HandbookNavigation
                  handbook={handbook}
                  activeChapter={activeChapter}
                  onSelect={selectChapter}
                />
                <DrawerClose asChild>
                  <Button variant="outline" className="mt-6 w-full">
                    Close
                  </Button>
                </DrawerClose>
              </div>
            </DrawerContent>
          </Drawer>

          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-8 lg:py-12">
            <aside className="hidden lg:block">
              <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-3">
                <button
                  type="button"
                  onClick={() => {
                    window.history.pushState(null, "", "/wiki");
                    setActiveAnchor("");
                  }}
                  className={cn(
                    "mb-6 flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm font-semibold",
                    !activeChapter
                      ? "bg-brand-subtle text-content"
                      : "text-content-muted hover:bg-hover hover:text-content",
                  )}
                >
                  <BookOpen className="h-4 w-4 text-brand" aria-hidden="true" />
                  Handbook overview
                </button>
                <HandbookNavigation
                  handbook={handbook}
                  activeChapter={activeChapter}
                  onSelect={selectChapter}
                />
              </div>
            </aside>

            <main className="min-w-0">
              <Button
                variant="outline"
                className="mb-5 gap-2 lg:hidden"
                onClick={() => setMobileNavigationOpen(true)}
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
                Browse chapters
              </Button>

              {askMutation.data ? (
                <Card variant="summary" className="mb-8 border-brand/30">
                  <CardContent className="p-5 sm:p-6">
                    <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      Handbook answer
                    </div>
                    <h2 className="mt-3 text-xl font-bold text-content-strong">
                      {askMutation.data.query}
                    </h2>
                    <p className="mt-3 whitespace-pre-wrap leading-7 text-content-muted">
                      {askMutation.data.answer}
                    </p>
                    {askMutation.data.citations.length ? (
                      <div className="mt-5 flex flex-wrap gap-2">
                        {askMutation.data.citations.map((citation) => (
                          <Button
                            key={`${citation.id}-${citation.anchorId}`}
                            variant="outline"
                            size="sm"
                            onClick={() => selectAnchor(citation.anchorId)}
                          >
                            {citation.title}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              {askMutation.isError ? (
                <div className="mb-8 rounded-panel border border-destructive/30 bg-destructive-subtle p-4 text-sm text-destructive">
                  {askMutation.error.message || "The handbook could not answer that question."}
                </div>
              ) : null}

              {activeChapter ? (
                <article>
                  <Button
                    variant="ghost"
                    className="mb-4 -ml-3 gap-2 text-content-muted"
                    onClick={() => {
                      window.history.pushState(null, "", "/wiki");
                      setActiveAnchor("");
                    }}
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Handbook overview
                  </Button>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{activeSection?.label || activeChapter.section}</Badge>
                    <span className="text-sm text-content-subtle">
                      Reviewed {activeChapter.lastReviewedAt}
                    </span>
                  </div>
                  <h1 className="mt-5 text-3xl font-black tracking-tight text-content-strong sm:text-4xl">
                    {activeChapter.title}
                  </h1>
                  <p className="mt-4 max-w-3xl text-lg leading-8 text-content-muted">
                    {activeChapter.summary}
                  </p>

                  {activeChapter.headings.length ? (
                    <nav className="mt-7 flex flex-wrap gap-2" aria-label="Chapter headings">
                      {activeChapter.headings.map((heading) => (
                        <a
                          key={heading.id}
                          href={`#${heading.id}`}
                          className="rounded-pill border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-content-muted hover:border-border-strong hover:text-content"
                        >
                          {heading.text}
                        </a>
                      ))}
                    </nav>
                  ) : null}

                  <div className="prose prose-slate mt-10 max-w-none prose-headings:scroll-mt-28 prose-headings:font-bold prose-a:text-brand dark:prose-invert">
                    <HandbookMarkdown chapter={activeChapter} />
                  </div>
                </article>
              ) : (
                <div>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
                        {handbook.chapterCount} focused guides
                      </p>
                      <h2 className="mt-2 text-3xl font-black tracking-tight text-content-strong">
                        Choose what you need to understand.
                      </h2>
                    </div>
                  </div>
                  <p className="mt-4 max-w-2xl leading-7 text-content-muted">{handbook.summary}</p>

                  <div className="mt-9 grid gap-5 md:grid-cols-2">
                    {handbook.sections.map((section) => (
                      <section
                        key={section.id}
                        className="rounded-panel border border-border-subtle bg-surface p-5 shadow-low"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-lg font-bold text-content-strong">{section.label}</h3>
                          <Badge variant="secondary">{section.chapters.length}</Badge>
                        </div>
                        <div className="mt-4 space-y-1">
                          {section.chapters.slice(0, 4).map((chapter) => (
                            <button
                              key={chapter.id}
                              type="button"
                              onClick={() => selectChapter(chapter)}
                              className="group flex w-full items-start justify-between gap-3 rounded-control px-2 py-2 text-left hover:bg-hover"
                            >
                              <span>
                                <span className="block text-sm font-medium text-content group-hover:text-brand">
                                  {chapter.title}
                                </span>
                                <span className="mt-0.5 line-clamp-1 block text-xs text-content-subtle">
                                  {chapter.summary}
                                </span>
                              </span>
                              <ChevronRight
                                className="mt-1 h-4 w-4 shrink-0 text-content-subtle"
                                aria-hidden="true"
                              />
                            </button>
                          ))}
                        </div>
                        {section.chapters.length > 4 ? (
                          <p className="mt-3 px-2 text-xs text-content-subtle">
                            +{section.chapters.length - 4} more chapters in navigation
                          </p>
                        ) : null}
                      </section>
                    ))}
                  </div>
                </div>
              )}
            </main>
          </div>
        </>
      )}
    </SurfaceLayout>
  );
}
