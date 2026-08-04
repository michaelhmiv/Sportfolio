import express, { type Express, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";
import { storage } from "./storage";
import {
  DEFAULT_ROUTE_META,
  HOW_IT_WORKS_FAQS,
  getRouteSeoMeta,
  isKnownAppRoute,
  normalizeRoutePath,
  normalizeSiteUrl,
  toCanonicalUrl,
  type RouteSeoMeta,
} from "@shared/seo";

const viteLogger = createLogger();
const SEO_MARKER = "<!-- SEO_HEAD -->";

type SeoRenderContext = {
  meta: RouteSeoMeta;
  siteUrl: string;
  canonicalUrl: string;
  statusCode: number;
  ogType: "website" | "article";
  twitterCard: "summary" | "summary_large_image";
  articlePublishedAt?: string;
  articleModifiedAt?: string;
  jsonLd: Array<Record<string, unknown>>;
  prerenderedHtml: string;
};

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toIsoDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function getSiteUrl(req: Request): string {
  const envSiteUrl =
    process.env.PUBLIC_SITE_URL || process.env.SITE_URL || process.env.VITE_PUBLIC_SITE_URL;
  if (envSiteUrl?.trim()) {
    return normalizeSiteUrl(envSiteUrl);
  }

  if (process.env.NODE_ENV === "production") {
    return normalizeSiteUrl(undefined);
  }

  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  const proto = forwardedProto || req.protocol || "https";

  if (!host) return normalizeSiteUrl(undefined);
  return normalizeSiteUrl(`${proto}://${host}`);
}

function buildBaseJsonLd(siteUrl: string): Array<Record<string, unknown>> {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Sportfolio",
      description:
        "Fantasy sports stock market platform where users trade player shares, scout players, and use boost mechanics.",
      url: siteUrl,
      logo: `${siteUrl}/favicon.png`,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Sportfolio",
      url: siteUrl,
      potentialAction: {
        "@type": "SearchAction",
        target: `${siteUrl}/pools?search={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ];
}

function buildFaqJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: HOW_IT_WORKS_FAQS.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

function buildWebApplicationJsonLd(siteUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Sportfolio",
    applicationCategory: "GameApplication",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    url: siteUrl,
  };
}

function buildBreadcrumbJsonLd(
  siteUrl: string,
  normalizedPath: string,
  pageTitle: string,
): Record<string, unknown> {
  const breadcrumbs: Array<{ name: string; url: string }> = [{ name: "Home", url: siteUrl }];
  const slug = normalizedPath.split("/")[2] || "";

  if (normalizedPath === "/blog") {
    breadcrumbs.push({ name: "Blog", url: `${siteUrl}/blog` });
  } else if (/^\/blog\/[^/]+$/.test(normalizedPath)) {
    breadcrumbs.push({ name: "Blog", url: `${siteUrl}/blog` });
    breadcrumbs.push({ name: pageTitle, url: `${siteUrl}/blog/${slug}` });
  } else if (normalizedPath !== "/") {
    breadcrumbs.push({ name: pageTitle, url: `${siteUrl}${normalizedPath}` });
  }

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function humanDate(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function buildPrerenderedBody({
  normalizedPath,
  meta,
  siteUrl,
  blogPosts = [],
  blogPost,
}: {
  normalizedPath: string;
  meta: RouteSeoMeta;
  siteUrl: string;
  blogPosts?: Array<{
    title: string;
    slug: string;
    excerpt: string;
    publishedAt?: unknown;
  }>;
  blogPost?: {
    title: string;
    excerpt: string;
    slug: string;
    publishedAt?: unknown;
  } | null;
}): string {
  if (meta.robots === "noindex,nofollow") {
    return `
      <main style="max-width:56rem;margin:2rem auto;padding:0 1rem;">
        <h1>${escapeHtml(meta.title)}</h1>
        <p>${escapeHtml(meta.description)}</p>
      </main>
    `;
  }

  if (normalizedPath === "/blog") {
    const items = blogPosts
      .map((post) => {
        const publishedAt = humanDate(post.publishedAt);
        return `
          <article style="padding:1rem 0;border-bottom:1px solid #e5e7eb;">
            <h2 style="margin:0 0 .5rem 0;font-size:1.125rem;">
              <a href="/blog/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a>
            </h2>
            ${publishedAt ? `<p style="margin:.25rem 0;color:#6b7280;">${escapeHtml(publishedAt)}</p>` : ""}
            <p style="margin:.5rem 0 0 0;">${escapeHtml(post.excerpt || "")}</p>
          </article>
        `;
      })
      .join("");

    return `
      <main style="max-width:56rem;margin:2rem auto;padding:0 1rem;">
        <h1>${escapeHtml(meta.title)}</h1>
        <p>${escapeHtml(meta.description)}</p>
        <section>${items || "<p>No published posts available.</p>"}</section>
      </main>
    `;
  }

  if (/^\/blog\/[^/]+$/.test(normalizedPath) && blogPost) {
    const publishedAt = humanDate(blogPost.publishedAt);
    return `
      <main style="max-width:56rem;margin:2rem auto;padding:0 1rem;">
        <article>
          <h1>${escapeHtml(blogPost.title)}</h1>
          ${publishedAt ? `<p style="color:#6b7280;">${escapeHtml(publishedAt)}</p>` : ""}
          <p>${escapeHtml(blogPost.excerpt || "")}</p>
          <p><a href="/blog">View all Sportfolio blog posts</a></p>
        </article>
      </main>
    `;
  }

  if (normalizedPath === "/how-it-works") {
    const faqItems = HOW_IT_WORKS_FAQS.map(
      (faq) => `
        <dt style="font-weight:600;margin-top:1rem;">${escapeHtml(faq.question)}</dt>
        <dd style="margin:.25rem 0 0 0;">${escapeHtml(faq.answer)}</dd>
      `,
    ).join("");

    return `
      <main style="max-width:56rem;margin:2rem auto;padding:0 1rem;">
        <h1>${escapeHtml(meta.title)}</h1>
        <p>${escapeHtml(meta.description)}</p>
        <dl>${faqItems}</dl>
      </main>
    `;
  }

  if (normalizedPath === "/wiki" || /^\/wiki\/[^/]+(?:\/[^/]+)?$/.test(normalizedPath)) {
    return `
      <main style="max-width:56rem;margin:2rem auto;padding:0 1rem;">
        <h1>${escapeHtml(meta.title)}</h1>
        <p>${escapeHtml(meta.description)}</p>
        <p><a href="/wiki">Open the Sportfolio wiki</a></p>
      </main>
    `;
  }

  if (normalizedPath === "/") {
    return `
      <div class="sf-boot">
        <main class="sf-boot__panel" aria-labelledby="sf-boot-title">
          <div class="sf-boot__topline">
            <span>System</span>
            <span class="sf-boot__topline-value">Public Market Terminal</span>
          </div>
          <div class="sf-boot__body">
            <p class="sf-boot__eyebrow">Live Market Boot</p>
            <h1 id="sf-boot-title" class="sf-boot__title">Sportfolio</h1>
            <p class="sf-boot__status">Loading live markets, boosts, and leaderboards</p>
            <p class="sf-boot__copy">
              Real-time pricing, player pools, and boost systems are initializing now.
            </p>
            <div class="sf-boot__board" aria-label="Startup status">
              <div class="sf-boot__row">
                <span class="sf-boot__label">Surface</span>
                <span class="sf-boot__value">Public Dashboard</span>
              </div>
              <div class="sf-boot__row">
                <span class="sf-boot__label">Modules</span>
                <span class="sf-boot__value">Pools | Boosts | Leaders</span>
              </div>
              <div class="sf-boot__row">
                <span class="sf-boot__label">State</span>
                <span class="sf-boot__value sf-boot__value--positive">Syncing Live Market Data</span>
              </div>
            </div>
            <ul class="sf-boot__chips" aria-label="Core product areas">
              <li class="sf-boot__chip">Player Pools</li>
              <li class="sf-boot__chip">Daily Boosts</li>
              <li class="sf-boot__chip">Leaderboards</li>
              <li class="sf-boot__chip">Analysis</li>
            </ul>
            <div class="sf-boot__footer" role="status" aria-live="polite">
              <span class="sf-boot__spinner" aria-hidden="true"></span>
              <span class="sf-boot__footer-text">Fetching live game and market data...</span>
            </div>
            <noscript>
              <div class="sf-boot__noscript">
                <p>JavaScript is required for the live Sportfolio app. You can still browse the public sections below.</p>
                <div class="sf-boot__noscript-links">
                  <a href="/pools">Player Pools</a>
                  <a href="/wiki">Wiki</a>
                  <a href="/leaderboards">Leaderboards</a>
                  <a href="/blog">Analysis</a>
                </div>
              </div>
            </noscript>
          </div>
        </main>
      </div>
    `;
  }

  if (normalizedPath === "/leaderboards") {
    return `
      <main style="max-width:56rem;margin:2rem auto;padding:0 1rem;">
        <h1>Leaderboards</h1>
        <p>${escapeHtml(meta.description)}</p>
        <p>Track top portfolios, boost performance, and active traders.</p>
      </main>
    `;
  }

  if (normalizedPath === "/pools") {
    return `
      <main style="max-width:56rem;margin:2rem auto;padding:0 1rem;">
        <h1>Player Pools</h1>
        <p>${escapeHtml(meta.description)}</p>
        <p>Discover AMM-backed player markets with real-time price movement and liquidity.</p>
      </main>
    `;
  }

  if (normalizedPath === "/about" || normalizedPath === "/contact" || normalizedPath === "/news") {
    return `
      <main style="max-width:56rem;margin:2rem auto;padding:0 1rem;">
        <h1>${escapeHtml(meta.title)}</h1>
        <p>${escapeHtml(meta.description)}</p>
      </main>
    `;
  }

  return `
    <main style="max-width:56rem;margin:2rem auto;padding:0 1rem;">
      <h1>${escapeHtml(meta.title)}</h1>
      <p>${escapeHtml(meta.description)}</p>
      <p><a href="${escapeHtml(siteUrl)}">Go to Sportfolio home</a></p>
    </main>
  `;
}

function shouldHandleAsHtml(req: Request, pathname: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (pathname.startsWith("/api/")) return false;
  if (/\.[a-z0-9]{1,8}$/i.test(pathname)) return false;
  const accept = req.headers.accept || "";
  return accept.includes("text/html") || accept.includes("*/*") || accept.trim() === "";
}

async function resolveSeoContext(pathname: string, siteUrl: string): Promise<SeoRenderContext> {
  const normalizedPath = normalizeRoutePath(pathname);
  let meta = getRouteSeoMeta(normalizedPath);
  let statusCode = isKnownAppRoute(normalizedPath) ? 200 : 404;
  let ogType: SeoRenderContext["ogType"] = "website";
  let twitterCard: SeoRenderContext["twitterCard"] = "summary_large_image";
  let articlePublishedAt: string | undefined;
  let articleModifiedAt: string | undefined;
  let prerenderedHtml = "";
  let listPosts: Array<{ title: string; slug: string; excerpt: string; publishedAt?: unknown }> =
    [];
  let blogPostForPrerender: {
    title: string;
    excerpt: string;
    slug: string;
    publishedAt?: unknown;
  } | null = null;

  const jsonLd = buildBaseJsonLd(siteUrl);
  if (normalizedPath === "/") {
    jsonLd.push(buildWebApplicationJsonLd(siteUrl));
  }
  if (normalizedPath === "/how-it-works") {
    jsonLd.push(buildFaqJsonLd());
  }

  if (/^\/blog\/[^/]+$/.test(normalizedPath)) {
    const slug = decodeURIComponent(normalizedPath.split("/")[2] || "");
    const post = await storage.getBlogPostBySlug(slug);

    if (!post || !post.publishedAt) {
      statusCode = 404;
      meta = {
        ...DEFAULT_ROUTE_META,
        title: "Blog Post Not Found | Sportfolio",
        description: "The requested blog post could not be found.",
        canonicalPath: normalizedPath,
        robots: "noindex,nofollow",
      };
    } else {
      const excerpt = String(post.excerpt || "").trim() || DEFAULT_ROUTE_META.description;
      meta = {
        title: `${post.title} | Sportfolio Blog`,
        description: excerpt,
        canonicalPath: `/blog/${post.slug}`,
        robots: "index,follow",
      };
      ogType = "article";
      twitterCard = "summary_large_image";
      articlePublishedAt = toIsoDate(post.publishedAt);
      articleModifiedAt = toIsoDate(post.updatedAt || post.publishedAt);
      blogPostForPrerender = {
        title: post.title,
        excerpt,
        slug: post.slug,
        publishedAt: post.publishedAt,
      };

      jsonLd.push({
        "@context": "https://schema.org",
        "@type": "Article",
        headline: post.title,
        description: excerpt,
        datePublished: articlePublishedAt,
        dateModified: articleModifiedAt,
        author: {
          "@type": "Person",
          name: "Sportfolio Team",
        },
        publisher: {
          "@type": "Organization",
          name: "Sportfolio",
          logo: {
            "@type": "ImageObject",
            url: `${siteUrl}/favicon.png`,
          },
        },
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": `${siteUrl}/blog/${post.slug}`,
        },
      });
    }
  }

  if (normalizedPath === "/blog") {
    const { posts } = await storage.getBlogPosts({
      limit: 25,
      offset: 0,
      publishedOnly: true,
    });
    listPosts = posts.map((post) => ({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      publishedAt: post.publishedAt,
    }));
  }

  if (statusCode === 404 && meta.robots === "index,follow") {
    meta = { ...meta, robots: "noindex,nofollow" };
  }

  jsonLd.push(buildBreadcrumbJsonLd(siteUrl, normalizedPath, meta.title));

  const canonicalUrl = toCanonicalUrl(siteUrl, meta.canonicalPath);
  prerenderedHtml = buildPrerenderedBody({
    normalizedPath,
    meta,
    siteUrl,
    blogPosts: listPosts,
    blogPost: blogPostForPrerender,
  });

  return {
    meta,
    siteUrl,
    canonicalUrl,
    statusCode,
    ogType,
    twitterCard,
    articlePublishedAt,
    articleModifiedAt,
    jsonLd,
    prerenderedHtml,
  };
}

function stripManagedSeoHeadTags(html: string): string {
  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta[^>]*name=["']description["'][^>]*>\s*/gi, "")
    .replace(/<meta[^>]*name=["']robots["'][^>]*>\s*/gi, "")
    .replace(/<link[^>]*rel=["']canonical["'][^>]*>\s*/gi, "")
    .replace(/<meta[^>]*property=["']og:[^"']+["'][^>]*>\s*/gi, "")
    .replace(/<meta[^>]*name=["']twitter:[^"']+["'][^>]*>\s*/gi, "")
    .replace(/<meta[^>]*property=["']article:[^"']+["'][^>]*>\s*/gi, "")
    .replace(/<script[^>]*id=["']seo-json-ld-[^"']*["'][\s\S]*?<\/script>\s*/gi, "");
}

function buildSeoHeadBlock(ctx: SeoRenderContext): string {
  const title = escapeHtml(ctx.meta.title);
  const description = escapeHtml(ctx.meta.description);
  const canonicalUrl = escapeHtml(ctx.canonicalUrl);
  const ogImage = escapeHtml(`${ctx.siteUrl}/social-preview.png`);
  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${ctx.meta.robots}" />`,
    `<link rel="canonical" href="${canonicalUrl}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="${ctx.ogType}" />`,
    `<meta property="og:url" content="${canonicalUrl}" />`,
    `<meta property="og:site_name" content="Sportfolio" />`,
    `<meta property="og:image" content="${ogImage}" />`,
    `<meta name="twitter:card" content="${ctx.twitterCard}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${ogImage}" />`,
    `<link rel="alternate" type="application/rss+xml" title="Sportfolio Blog Feed" href="${escapeHtml(ctx.siteUrl)}/feed.xml" />`,
    `<link rel="alternate" type="application/feed+json" title="Sportfolio JSON Feed" href="${escapeHtml(ctx.siteUrl)}/feed.json" />`,
  ];

  if (ctx.articlePublishedAt) {
    tags.push(
      `<meta property="article:published_time" content="${escapeHtml(ctx.articlePublishedAt)}" />`,
    );
  }
  if (ctx.articleModifiedAt) {
    tags.push(
      `<meta property="article:modified_time" content="${escapeHtml(ctx.articleModifiedAt)}" />`,
    );
  }

  const jsonLdTags = ctx.jsonLd.map((schema, index) => {
    const payload = JSON.stringify(schema).replace(/</g, "\\u003c");
    return `<script id="seo-json-ld-${index}" type="application/ld+json">${payload}</script>`;
  });

  return [...tags, ...jsonLdTags].join("\n    ");
}

function injectSeoHead(templateHtml: string, seoHeadBlock: string): string {
  const sanitizedTemplate = stripManagedSeoHeadTags(templateHtml);
  if (sanitizedTemplate.includes(SEO_MARKER)) {
    return sanitizedTemplate.replace(SEO_MARKER, seoHeadBlock);
  }
  return sanitizedTemplate.replace("</head>", `    ${seoHeadBlock}\n  </head>`);
}

function injectPrerenderedBody(templateHtml: string, prerenderedHtml: string): string {
  return templateHtml.replace(/<div id="root"><\/div>/i, `<div id="root">${prerenderedHtml}</div>`);
}

async function renderAppHtml({
  req,
  res,
  templateHtml,
  transformTemplate,
}: {
  req: Request;
  res: Response;
  templateHtml: string;
  transformTemplate?: (url: string, html: string) => Promise<string>;
}) {
  const pathname = normalizeRoutePath(req.path || req.originalUrl || "/");
  if (!shouldHandleAsHtml(req, pathname)) {
    if (pathname.startsWith("/api/")) {
      return res.status(404).json({ error: "Not found" });
    }
    return res.status(404).send("Not Found");
  }

  const siteUrl = getSiteUrl(req);
  const seoContext = await resolveSeoContext(pathname, siteUrl);
  const transformedTemplate = transformTemplate
    ? await transformTemplate(req.originalUrl, templateHtml)
    : templateHtml;
  const withSeoHead = injectSeoHead(transformedTemplate, buildSeoHeadBlock(seoContext));
  const page = injectPrerenderedBody(withSeoHead, seoContext.prerenderedHtml);

  return res.status(seoContext.statusCode).set({ "Content-Type": "text/html" }).end(page);
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

function parseOptionalPort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function setupVite(app: Express, server: Server) {
  const hmrHost = process.env.VITE_HMR_HOST?.trim();
  const hmrClientPort = parseOptionalPort(
    process.env.VITE_HMR_CLIENT_PORT || process.env.VITE_HMR_PORT,
  );
  const hmrProtocol = process.env.VITE_HMR_PROTOCOL?.trim();
  const serverOptions = {
    middlewareMode: true,
    hmr: {
      server,
      ...(hmrHost ? { host: hmrHost } : {}),
      ...(hmrClientPort ? { clientPort: hmrClientPort, port: hmrClientPort } : {}),
      ...(hmrProtocol ? { protocol: hmrProtocol } : {}),
    },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    try {
      const clientTemplate = path.resolve(import.meta.dirname, "..", "client", "index.html");
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(`src="/src/main.tsx"`, `src="/src/main.tsx?v=${nanoid()}"`);

      await renderAppHtml({
        req,
        res,
        templateHtml: template,
        transformTemplate: (url, html) => vite.transformIndexHtml(url, html),
      });
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const indexPath = path.resolve(distPath, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Could not find index.html in build directory: ${indexPath}`);
  }

  const oauthConsentPath = path.resolve(distPath, "oauth", "consent", "index.html");
  if (!fs.existsSync(oauthConsentPath)) {
    throw new Error(`Could not find OAuth consent entry point: ${oauthConsentPath}`);
  }

  const indexTemplate = fs.readFileSync(indexPath, "utf-8");

  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      index: false,
      immutable: true,
      maxAge: "1y",
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );

  // OAuth providers redirect to the configured authorization path without
  // the entry file name. Serve the dedicated Vite entry before the general
  // static middleware can redirect the directory to a trailing slash or let
  // the main SPA catch-all render its 404 page.
  app.use(
    "/oauth/consent",
    express.static(path.dirname(oauthConsentPath), {
      index: "index.html",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "public, max-age=60, must-revalidate");
        }
      },
    }),
  );

  app.use(
    express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "public, max-age=60, must-revalidate");
          return;
        }

        if (/\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/i.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
        }
      },
    }),
  );

  app.use("*", async (req, res, next) => {
    try {
      await renderAppHtml({
        req,
        res,
        templateHtml: indexTemplate,
      });
    } catch (error) {
      next(error);
    }
  });
}
