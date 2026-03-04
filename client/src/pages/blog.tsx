import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, User, ArrowRight } from "lucide-react";
import { useEffect } from "react";

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

  // Update page meta tags for SEO
  useEffect(() => {
    document.title = "Blog - Fantasy Sports Insights & NBA Trading Strategies | Sportfolio";

    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute(
        "content",
        "Latest insights on fantasy sports, NBA player trading strategies, boost tactics, and Sportfolio platform updates. Expert analysis for fantasy basketball enthusiasts.",
      );
    }

    return () => {
      document.title = "Sportfolio - Fantasy Sports Stock Market";
    };
  }, []);

  if (isLoading) {
    return (
      <div className="terminal-page p-6 md:p-12">
        <div className="max-w-4xl mx-auto">
          <div className="terminal-subtle text-center">Loading blog posts...</div>
        </div>
      </div>
    );
  }

  const posts = data?.posts || [];

  return (
    <div className="terminal-page">
      <div className="max-w-4xl mx-auto p-6 md:p-12">
        {/* Header */}
        <div className="terminal-shell mb-8 p-6">
          <div className="terminal-strip mb-4">Market Analysis Feed</div>
          <h1 className="terminal-heading text-3xl sm:text-4xl" data-testid="heading-blog">
            Sportfolio Blog
          </h1>
          <p className="terminal-subtle mt-3 max-w-2xl">
            News, insights, and updates about fantasy sports, NBA player trading, and the Sportfolio
            platform
          </p>
        </div>

        {/* Blog Posts Grid */}
        {posts.length > 0 ? (
          <div className="space-y-6">
            {posts.map((post) => (
              <Link key={post.id} href={`/blog/${post.slug}`}>
                <a data-testid={`blog-post-card-${post.slug}`}>
                  <Card
                    variant="terminal"
                    className="hover-elevate active-elevate-2 transition-colors hover:border-primary/40"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <CardTitle className="text-xl mb-2">{post.title}</CardTitle>
                          <CardDescription className="text-sm line-clamp-2">
                            {post.excerpt}
                          </CardDescription>
                        </div>
                        <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-1" />
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="terminal-subtle flex items-center gap-4">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(post.publishedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </a>
              </Link>
            ))}
          </div>
        ) : (
          <Card variant="terminal">
            <CardContent className="terminal-subtle py-12 text-center">
              No blog posts published yet. Check back soon for updates!
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
