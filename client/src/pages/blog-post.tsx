import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Calendar, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useRoute } from "wouter";
import { SchemaOrg, schemas } from "@/components/schema-org";
import { PageHero, SurfaceLayout } from "@/components/surface-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { resolveApiUrl } from "@/lib/native-runtime";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  publishedAt: string;
  createdAt: string;
}

interface Author {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

export default function BlogPost() {
  const [, params] = useRoute("/blog/:slug");
  const slug = params?.slug || "";

  const { data, isLoading, error } = useQuery<{ post: BlogPost; author: Author | null }>({
    queryKey: ["/api/blog", slug],
    enabled: !!slug,
    queryFn: async () => {
      const response = await fetch(resolveApiUrl(`/api/blog/${slug}`));
      if (!response.ok) throw new Error("Failed to fetch blog post");
      return response.json();
    },
  });

  useEffect(() => {
    if (!data?.post) return;
    document.title = `${data.post.title} | Sportfolio Blog`;
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) metaDescription.setAttribute("content", data.post.excerpt);

    const ogTags = [
      { property: "og:title", content: data.post.title },
      { property: "og:description", content: data.post.excerpt },
      { property: "og:type", content: "article" },
      { property: "og:url", content: `${window.location.origin}/blog/${data.post.slug}` },
      { property: "article:published_time", content: data.post.publishedAt },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: data.post.title },
      { name: "twitter:description", content: data.post.excerpt },
    ];

    ogTags.forEach((tag) => {
      const property = (tag.property || tag.name) as string;
      const attribute = tag.property ? "property" : "name";
      let meta = document.querySelector(`meta[${attribute}="${property}"]`);
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute(attribute, property);
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", tag.content);
    });

    return () => {
      document.title = "Sportfolio - Fantasy Sports Stock Market";
    };
  }, [data?.post]);

  if (isLoading) {
    return (
      <SurfaceLayout kind="public">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="h-8 w-32 animate-pulse rounded-control bg-surface-raised" />
          <div className="mt-8 h-14 max-w-2xl animate-pulse rounded-panel bg-surface-raised" />
          <div className="mt-5 h-6 max-w-xl animate-pulse rounded-control bg-surface-raised" />
          <div className="mt-12 h-96 animate-pulse rounded-panel bg-surface-raised" />
        </div>
      </SurfaceLayout>
    );
  }

  if (error || !data) {
    return (
      <SurfaceLayout kind="public">
        <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
          <Card variant="empty">
            <CardContent className="p-8 text-center">
              <h1 className="text-2xl font-bold text-content-strong">Article not found</h1>
              <p className="mt-3 leading-6 text-content-muted">
                The article does not exist or is no longer available.
              </p>
              <Button asChild className="mt-6 gap-2">
                <Link href="/blog">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back to the blog
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </SurfaceLayout>
    );
  }

  const { post, author } = data;
  const authorName = author
    ? author.firstName && author.lastName
      ? `${author.firstName} ${author.lastName}`
      : author.username
    : null;

  return (
    <SurfaceLayout kind="public">
      <SchemaOrg
        schema={schemas.createArticle({
          title: post.title,
          excerpt: post.excerpt,
          content: post.content,
          publishedAt: post.publishedAt,
          slug: post.slug,
          authorId: author?.id,
        })}
      />
      <PageHero
        eyebrow="Sportfolio journal"
        title={post.title}
        description={post.excerpt}
        compact
      />

      <article
        className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8"
        data-testid="article-blog-post"
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border-subtle pb-6 text-sm text-content-subtle">
          <span className="flex items-center gap-2">
            <Calendar className="h-4 w-4" aria-hidden="true" />
            {new Date(post.publishedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
          {authorName ? (
            <span className="flex items-center gap-2">
              <User className="h-4 w-4" aria-hidden="true" />
              {authorName}
            </span>
          ) : null}
        </div>

        <div
          className="prose prose-lg mt-10 max-w-none prose-headings:font-bold prose-a:text-brand dark:prose-invert"
          data-testid="content-blog-post"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content}</ReactMarkdown>
        </div>

        <div className="mt-14 border-t border-border-subtle pt-7">
          <Button asChild variant="outline" className="gap-2" data-testid="button-back-to-blog">
            <Link href="/blog">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to the blog
            </Link>
          </Button>
        </div>
      </article>
    </SurfaceLayout>
  );
}
