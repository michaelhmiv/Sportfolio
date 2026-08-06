import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Calendar, Newspaper } from "lucide-react";
import { Link } from "wouter";
import { PageHero, SurfaceLayout } from "@/components/surface-layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  publishedAt: string;
  createdAt: string;
}

export default function Blog() {
  const { data, isLoading } = useQuery<{ posts: BlogPost[]; total: number }>({
    queryKey: ["/api/blog"],
  });

  useEffect(() => {
    document.title = "Sportfolio Blog | Player Markets, Strategy, and Product Updates";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute(
        "content",
        "Sportfolio strategy, multi-sport player-market analysis, gameplay guides, and platform updates.",
      );
    }
    return () => {
      document.title = "Sportfolio - Fantasy Sports Stock Market";
    };
  }, []);

  const posts = data?.posts || [];

  return (
    <SurfaceLayout kind="public">
      <PageHero
        eyebrow="Sportfolio journal"
        title="Market notes, strategy, and product updates."
        description="Longer-form analysis of player markets, portfolio strategy, game-day systems, supported sports, and the decisions behind the platform."
        icon={<Newspaper className="h-4 w-4" aria-hidden="true" />}
        compact
      />

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        {isLoading ? (
          <div className="grid gap-5 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-48 animate-pulse rounded-panel border border-border-subtle bg-surface-raised" />
            ))}
          </div>
        ) : posts.length ? (
          <div className="grid gap-5 md:grid-cols-2">
            {posts.map((post, index) => (
              <Link key={post.id} href={`/blog/${post.slug}`}>
                <Card
                  variant="interactive"
                  className={`group h-full ${index === 0 && posts.length > 2 ? "md:col-span-2" : ""}`}
                  data-testid={`blog-post-card-${post.slug}`}
                >
                  <CardContent className="flex h-full flex-col p-6 sm:p-7">
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant="outline">Market briefing</Badge>
                      <span className="flex items-center gap-1.5 text-xs text-content-subtle">
                        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                        {new Date(post.publishedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    <h2 className={`mt-5 font-bold tracking-tight text-content-strong group-hover:text-brand ${index === 0 && posts.length > 2 ? "text-2xl sm:text-3xl" : "text-xl"}`}>
                      {post.title}
                    </h2>
                    <p className="mt-3 flex-1 leading-7 text-content-muted">{post.excerpt}</p>
                    <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand">
                      Read article <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card variant="empty">
            <CardContent className="px-6 py-14 text-center">
              <Newspaper className="mx-auto h-8 w-8 text-content-subtle" aria-hidden="true" />
              <h2 className="mt-4 text-lg font-bold text-content-strong">No articles published yet</h2>
              <p className="mt-2 text-content-muted">Platform updates and strategy notes will appear here.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </SurfaceLayout>
  );
}
