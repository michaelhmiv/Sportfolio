import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
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
import { apiRequest, authenticatedFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  flattenHandbookChapters,
  getDefaultOpenHandbookSectionIds,
  getHandbookMatchState,
  getHandbookSectionIdForAnchor,
  getLegacyWikiHref,
  getRequiredOpenHandbookSectionIds,
} from "@/features/wiki/handbook";

type DocsHandbookResponse = {
  handbook: DocsHandbook;
};

type DocsSearchResponse = {
  results: DocsSearchResult[];
};

type HandbookMatchState = ReturnType<typeof getHandbookMatchState>;

function HandbookMarkdown({
  chapter,
  matchedHeadingIds,
}: {
  chapter: DocsHandbookChapter;
  matchedHeadingIds: Set<string>;
}) {
  let headingIndex = 0;

  const resolveHeadingId = (fallbackText: string) => {
    const nextHeading = chapter.headings[headingIndex];
    headingIndex += 1;
    return (
      nextHeading?.id || getDocsChapterHeadingAnchorId(chapter.section, chapter.slug, fallbackText)
    );
  };

  const resolveHeadingClassName = (headingId: string) =>
    matchedHeadingIds.has(headingId) ? "text-primary" : undefined;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => {
          const text = String(children).trim();
          const headingId = resolveHeadingId(text);
          return (
            <h1 id={headingId} className={resolveHeadingClassName(headingId)}>
              {children}
            </h1>
          );
        },
        h2: ({ children }) => {
          const text = String(children).trim();
          const headingId = resolveHeadingId(text);
          return (
            <h2 id={headingId} className={resolveHeadingClassName(headingId)}>
              {children}
            </h2>
          );
        },
        h3: ({ children }) => {
          const text = String(children).trim();
          const headingId = resolveHeadingId(text);
          return (
            <h3 id={headingId} className={resolveHeadingClassName(headingId)}>
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
  activeAnchorId,
  activeSectionId,
  openSectionIds,
  matchState,
  onNavigate,
  onSectionOpenChange,
}: {
  handbook: DocsHandbook;
  activeAnchorId: string;
  activeSectionId: string | null;
  openSectionIds: Set<string>;
  matchState: HandbookMatchState;
  onNavigate?: () => void;
  onSectionOpenChange: (sectionId: string, open: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      {handbook.sections.map((section) => {
        const isOpen = openSectionIds.has(section.id);
        const isSectionHighlighted =
          activeSectionId === section.id || matchState.matchedSectionAnchors.has(section.anchorId);

        return (
          <Collapsible
            key={section.id}
            open={isOpen}
            onOpenChange={(open) => onSectionOpenChange(section.id, open)}
          >
            <div className="flex items-center gap-2">
              <a
                href={`#${section.anchorId}`}
                onClick={() => onNavigate?.()}
                className={cn(
                  "flex-1 rounded-sm border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground flex items-center justify-between gap-2",
                  isSectionHighlighted && "border-primary/40 bg-primary/5 text-foreground",
                )}
              >
                <span>{section.label}</span>
                <Badge
                  variant="secondary"
                  className="rounded-sm border border-border bg-[hsl(var(--sidebar)/0.45)] font-mono text-[11px] shrink-0"
                >
                  {section.chapters.length}
                </Badge>
              </a>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:text-foreground",
                    isSectionHighlighted && "border-primary/40 bg-primary/5 text-foreground",
                  )}
                  aria-label={`${isOpen ? "Collapse" : "Expand"} ${section.label}`}
                  data-testid={`button-handbook-section-toggle-${section.id}`}
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="overflow-hidden pt-2">
              <div className="space-y-1 pl-3">
                {section.chapters.map((chapter) => {
                  const isChapterHighlighted =
                    matchState.matchedChapterAnchors.has(chapter.chapterAnchorId) ||
                    chapter.chapterAnchorId === activeAnchorId ||
                    chapter.headings.some((heading) => heading.id === activeAnchorId);

                  return (
                    <a
                      key={chapter.id}
                      href={`#${chapter.chapterAnchorId}`}
                      onClick={() => onNavigate?.()}
                      className={cn(
                        "block rounded-sm px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
                        isChapterHighlighted && "bg-primary/5 text-foreground",
                      )}
                    >
                      {chapter.title}
                    </a>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

export default function WikiPage() {
  const [, sectionParams] = useRoute("/wiki/:section");
  const legacySection = sectionParams?.section || "";
  const [, setLocation] = useLocation();
  const [searchValue, setSearchValue] = useState("");
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [activeAnchorId, setActiveAnchorId] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "").trim(),
  );
  const [openSectionIds, setOpenSectionIds] = useState<Set<string>>(new Set());
  const hasInitializedOpenSections = useRef(false);
  const deferredSearchValue = useDeferredValue(searchValue.trim());

  const { data, isLoading, error } = useQuery<DocsHandbookResponse>({
    queryKey: ["/api/docs/handbook"],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/docs/handbook");
      if (!response.ok) {
        throw new Error("Failed to fetch docs handbook");
      }
      return response.json();
    },
  });

  const { data: searchData } = useQuery<DocsSearchResponse>({
    queryKey: ["/api/docs/search", deferredSearchValue],
    enabled: deferredSearchValue.length > 0,
    queryFn: async () => {
      const response = await authenticatedFetch(
        `/api/docs/search?q=${encodeURIComponent(deferredSearchValue)}`,
      );
      if (!response.ok) {
        throw new Error("Failed to search docs");
      }
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
    if (!legacySection) {
      return;
    }

    setLocation(getLegacyWikiHref(legacySection), { replace: true });
  }, [legacySection, setLocation]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateActiveAnchorId = () => {
      setActiveAnchorId(window.location.hash.replace(/^#/, "").trim());
    };

    updateActiveAnchorId();
    window.addEventListener("hashchange", updateActiveAnchorId);

    return () => window.removeEventListener("hashchange", updateActiveAnchorId);
  }, []);

  useEffect(() => {
    if (!data?.handbook || !activeAnchorId) {
      return;
    }

    const handle = window.requestAnimationFrame(() => {
      document.getElementById(activeAnchorId)?.scrollIntoView({ block: "start" });
    });

    return () => window.cancelAnimationFrame(handle);
  }, [activeAnchorId, data?.handbook]);

  const handbook = data?.handbook;
  const searchResults = searchData?.results || [];
  const chapters = useMemo(() => (handbook ? flattenHandbookChapters(handbook) : []), [handbook]);
  const matchState = useMemo(
    () =>
      handbook
        ? getHandbookMatchState(handbook, deferredSearchValue, searchResults)
        : {
            matchedSectionAnchors: new Set<string>(),
            matchedChapterAnchors: new Set<string>(),
            matchedHeadingIds: new Set<string>(),
          },
    [deferredSearchValue, handbook, searchResults],
  );
  const activeSectionId = useMemo(
    () => (handbook ? getHandbookSectionIdForAnchor(handbook, activeAnchorId) : null),
    [activeAnchorId, handbook],
  );
  const requiredOpenSectionIds = useMemo(
    () =>
      handbook
        ? getRequiredOpenHandbookSectionIds(
            handbook,
            activeAnchorId,
            matchState.matchedSectionAnchors,
          )
        : new Set<string>(),
    [activeAnchorId, handbook, matchState.matchedSectionAnchors],
  );

  useEffect(() => {
    if (!handbook) {
      hasInitializedOpenSections.current = false;
      setOpenSectionIds(new Set());
      return;
    }

    if (hasInitializedOpenSections.current) {
      return;
    }

    setOpenSectionIds(getDefaultOpenHandbookSectionIds(handbook, activeAnchorId));
    hasInitializedOpenSections.current = true;
  }, [activeAnchorId, handbook]);

  useEffect(() => {
    if (!handbook || requiredOpenSectionIds.size === 0) {
      return;
    }

    setOpenSectionIds((currentOpenSectionIds) => {
      const nextOpenSectionIds = new Set(currentOpenSectionIds);
      let hasChanged = false;

      requiredOpenSectionIds.forEach((sectionId) => {
        if (!nextOpenSectionIds.has(sectionId)) {
          nextOpenSectionIds.add(sectionId);
          hasChanged = true;
        }
      });

      return hasChanged ? nextOpenSectionIds : currentOpenSectionIds;
    });
  }, [handbook, requiredOpenSectionIds]);

  const handleSectionOpenChange = (sectionId: string, open: boolean) => {
    setOpenSectionIds((currentOpenSectionIds) => {
      const nextOpenSectionIds = new Set(currentOpenSectionIds);

      if (open) {
        nextOpenSectionIds.add(sectionId);
      } else {
        nextOpenSectionIds.delete(sectionId);
      }

      return nextOpenSectionIds;
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchValue.trim();
    if (!query) {
      return;
    }

    await askMutation.mutateAsync(query);
  };

  if (legacySection) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="terminal-page p-6 md:p-10">
        <div className="max-w-6xl mx-auto">
          <div className="terminal-subtle text-center">Loading Sportfolio handbook...</div>
        </div>
      </div>
    );
  }

  if (error || !handbook) {
    return (
      <div className="terminal-page p-6 md:p-10">
        <div className="max-w-6xl mx-auto">
          <Card variant="terminal">
            <CardContent className="py-10 text-center">
              <p className="terminal-heading text-sm">Wiki unavailable</p>
              <p className="terminal-subtle mt-2">The handbook could not be loaded.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-page">
      <Drawer open={isTocOpen} onOpenChange={setIsTocOpen}>
        <DrawerContent className="border border-border bg-card text-foreground lg:hidden">
          <DrawerHeader className="gap-2 text-left">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <DrawerTitle className="terminal-heading text-sm">Handbook Chapters</DrawerTitle>
                <DrawerDescription className="terminal-subtle">
                  Jump to any section or chapter in the Sportfolio handbook.
                </DrawerDescription>
              </div>
              <DrawerClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  data-testid="button-wiki-mobile-toc-close"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </DrawerClose>
            </div>
          </DrawerHeader>
          <div className="max-h-[70vh] overflow-y-auto px-4 pb-6">
            <HandbookNavigation
              handbook={handbook}
              activeAnchorId={activeAnchorId}
              activeSectionId={activeSectionId}
              openSectionIds={openSectionIds}
              matchState={matchState}
              onNavigate={() => setIsTocOpen(false)}
              onSectionOpenChange={handleSectionOpenChange}
            />
          </div>
        </DrawerContent>
      </Drawer>

      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">
        <div className="terminal-shell mb-8 p-6 md:p-8">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="terminal-strip mb-3">
                  <BookOpen className="h-3.5 w-3.5" />
                  Canonical Sportfolio docs
                </div>
                <h1 className="terminal-heading text-3xl" data-testid="heading-wiki">
                  {handbook.title}
                </h1>
                <p className="terminal-subtle mt-2 max-w-3xl md:text-sm">{handbook.summary}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className="rounded-sm border border-border bg-[hsl(var(--sidebar)/0.45)] font-mono text-[11px]"
                >
                  {handbook.chapterCount} chapters
                </Badge>
                <Button
                  variant="terminalOutline"
                  className="gap-2 lg:hidden"
                  onClick={() => setIsTocOpen(true)}
                  data-testid="button-wiki-mobile-toc"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                  Chapters
                </Button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    variant="terminal"
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="Search the handbook or ask a natural-language question"
                    className="pl-9"
                    data-testid="input-wiki-search"
                  />
                </div>
                <Button variant="terminal" type="submit" className="gap-2 md:self-stretch">
                  <MessageSquare className="h-4 w-4" />
                  Ask Handbook
                </Button>
              </div>

              {deferredSearchValue.length > 0 && (
                <Card variant="terminal" className="border-primary/20">
                  <CardHeader className="space-y-2 pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="terminal-heading text-sm">Search Matches</CardTitle>
                      <Badge
                        variant="outline"
                        className="rounded-sm font-mono text-[11px] uppercase tracking-[0.08em]"
                      >
                        {searchResults.length}
                      </Badge>
                    </div>
                    <p className="terminal-subtle text-sm">
                      Matching chapters stay highlighted in the handbook while you type.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {searchResults.length > 0 ? (
                      searchResults.slice(0, 6).map((result) => (
                        <a
                          key={`${result.id}-${result.anchorId}`}
                          href={`#${result.anchorId}`}
                          className="block rounded-sm border px-3 py-3 transition-colors hover:border-primary/40"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">{result.title}</div>
                              <div className="terminal-subtle mt-1 text-sm">{result.summary}</div>
                            </div>
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          </div>
                        </a>
                      ))
                    ) : (
                      <p className="terminal-subtle text-sm">
                        No direct chapter matches yet. Press Enter to let the handbook answer in
                        docs mode.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </form>
          </div>
        </div>

        {askMutation.data && (
          <Card
            variant="terminal"
            className="mb-8 border-primary/30"
            data-testid="card-wiki-answer"
          >
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="rounded-sm font-mono text-[11px] uppercase tracking-[0.08em]"
                  >
                    Sportfolio Handbook
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="rounded-sm border border-border bg-[hsl(var(--sidebar)/0.45)] font-mono text-[11px]"
                  >
                    Docs mode
                  </Badge>
                  {askMutation.data.fallbackUsed && (
                    <Badge
                      variant="secondary"
                      className="rounded-sm border border-border bg-[hsl(var(--sidebar)/0.45)] font-mono text-[11px]"
                    >
                      handbook fallback
                    </Badge>
                  )}
                </div>
              </div>
              <CardTitle className="text-lg leading-tight">{askMutation.data.query}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="whitespace-pre-wrap text-sm leading-6">{askMutation.data.answer}</p>
              {askMutation.data.citations.length > 0 && (
                <div className="space-y-2">
                  <p className="terminal-heading text-sm">Jump to cited chapters</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {askMutation.data.citations.map((citation) => (
                      <a
                        key={`${citation.id}-${citation.anchorId}`}
                        href={`#${citation.anchorId}`}
                        className="block rounded-sm border px-3 py-3 transition-colors hover:border-primary/40"
                      >
                        <div className="font-medium">{citation.title}</div>
                        <div className="terminal-subtle mt-1 text-sm">{citation.excerpt}</div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {askMutation.isError && (
          <Card variant="terminal" className="mb-8 border-destructive/40">
            <CardContent className="py-6">
              <p className="terminal-heading text-sm">Could not answer from the handbook</p>
              <p className="terminal-subtle mt-2 text-sm">
                {askMutation.error.message || "The docs answer request failed."}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="terminal-heading text-lg">Sections</h2>
            <Badge
              variant="secondary"
              className="rounded-sm border border-border bg-[hsl(var(--sidebar)/0.45)] font-mono text-[11px]"
            >
              {handbook.sections.length}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {handbook.sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.anchorId}`}
                className="group block rounded-sm border p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.02]"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium text-sm">{section.label}</h3>
                  <Badge
                    variant="secondary"
                    className="rounded-sm border border-border bg-[hsl(var(--sidebar)/0.45)] font-mono text-[11px] shrink-0"
                  >
                    {section.chapters.length}
                  </Badge>
                </div>
                <p className="terminal-subtle mt-1 text-sm line-clamp-2">
                  {section.chapters.map((c) => c.title).join(" · ")}
                </p>
              </a>
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card
            variant="terminal"
            className="hidden lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-6rem)] lg:flex-col"
          >
            <CardHeader>
              <CardTitle className="terminal-heading text-sm">Chapters</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 px-0 pb-0">
              <ScrollArea className="h-full">
                <div className="px-6 pb-6">
                  <HandbookNavigation
                    handbook={handbook}
                    activeAnchorId={activeAnchorId}
                    activeSectionId={activeSectionId}
                    openSectionIds={openSectionIds}
                    matchState={matchState}
                    onSectionOpenChange={handleSectionOpenChange}
                  />
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="space-y-8">
            {handbook.sections.map((section) => (
              <section key={section.id} id={section.anchorId} className="scroll-mt-24 space-y-4">
                <div className="flex items-center gap-3">
                  <h2 className="terminal-heading text-2xl">{section.label}</h2>
                  <Badge
                    variant="secondary"
                    className="rounded-sm border border-border bg-[hsl(var(--sidebar)/0.45)] font-mono text-[11px]"
                  >
                    {section.chapters.length}
                  </Badge>
                </div>

                <div className="space-y-5">
                  {section.chapters.map((chapter) => (
                    <article
                      key={chapter.id}
                      id={chapter.chapterAnchorId}
                      className="scroll-mt-24"
                      data-testid={`chapter-${chapter.slug}`}
                    >
                      <Card
                        variant="terminal"
                        className={cn(
                          "border transition-colors",
                          matchState.matchedChapterAnchors.has(chapter.chapterAnchorId) &&
                            "border-primary/40",
                        )}
                      >
                        <CardHeader className="space-y-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className="rounded-sm font-mono text-[11px] uppercase tracking-[0.08em]"
                            >
                              {section.label}
                            </Badge>
                            <span className="terminal-subtle">
                              Reviewed {chapter.lastReviewedAt}
                            </span>
                          </div>
                          <div>
                            <h3 className="terminal-heading text-2xl">{chapter.title}</h3>
                            <p className="terminal-subtle mt-2 text-sm">{chapter.summary}</p>
                          </div>
                          {chapter.headings.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {chapter.headings.map((heading) => (
                                <a
                                  key={heading.id}
                                  href={`#${heading.id}`}
                                  className={cn(
                                    "rounded-sm border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground",
                                    matchState.matchedHeadingIds.has(heading.id) &&
                                      "border-primary/40 bg-primary/5 text-foreground",
                                  )}
                                >
                                  {heading.text}
                                </a>
                              ))}
                            </div>
                          )}
                        </CardHeader>
                        <CardContent className="prose prose-sm max-w-none dark:prose-invert">
                          <HandbookMarkdown
                            chapter={chapter}
                            matchedHeadingIds={matchState.matchedHeadingIds}
                          />
                        </CardContent>
                      </Card>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        {chapters.length === 0 && (
          <Card variant="terminal" className="mt-8">
            <CardContent className="py-10 text-center">
              <p className="terminal-heading text-sm">No handbook chapters available</p>
              <p className="terminal-subtle mt-2">
                The readable docs set is empty for this session.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
