import { useEffect } from "react";
import { normalizeSiteUrl } from "@shared/seo";

interface SchemaOrgProps {
  schema: Record<string, any> | Record<string, any>[];
}

const SITE_URL = normalizeSiteUrl(import.meta.env.VITE_PUBLIC_SITE_URL);

// Simple hash function for generating stable script IDs
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

export function SchemaOrg({ schema }: SchemaOrgProps) {
  useEffect(() => {
    const schemaArray = Array.isArray(schema) ? schema : [schema];
    const schemaString = JSON.stringify(schemaArray);
    const scriptId = `schema-org-${hashString(schemaString)}`;

    // Remove any existing script with this ID
    const existingScript = document.getElementById(scriptId);
    if (existingScript) {
      return; // Already exists, no need to re-add
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.type = "application/ld+json";
    script.text = schemaArray.length === 1 ? JSON.stringify(schemaArray[0]) : schemaString;

    // Avoid duplicate payloads when the server already injected matching JSON-LD.
    const duplicateScript = Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
    ).find((existing) => existing.text === script.text);
    if (duplicateScript) {
      return;
    }

    document.head.appendChild(script);

    return () => {
      const scriptToRemove = document.getElementById(scriptId);
      if (scriptToRemove) {
        scriptToRemove.remove();
      }
    };
  }, [schema]);

  return null;
}

export const schemas = {
  organization: {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Sportfolio",
    description:
      "Fantasy sports stock market platform where you can trade player shares like stocks, vest shares, and use boost mechanics.",
    url: SITE_URL,
    logo: `${SITE_URL}/favicon.png`,
    sameAs: [],
  },

  website: {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Sportfolio",
    description:
      "Trade player shares like stocks. Vest, trade, and use daily boosts with real-time pricing.",
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/pools?search={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  },

  webApplication: {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Sportfolio",
    description: "Fantasy sports stock market platform",
    applicationCategory: "GameApplication",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  },

  createArticle: (post: {
    title: string;
    excerpt: string;
    content: string;
    publishedAt: string;
    slug: string;
    authorId?: string;
  }) => ({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    articleBody: post.content,
    datePublished: post.publishedAt,
    dateModified: post.publishedAt,
    author: {
      "@type": "Person",
      name: "Sportfolio Team",
    },
    publisher: {
      "@type": "Organization",
      name: "Sportfolio",
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/favicon.png`,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${SITE_URL}/blog/${post.slug}`,
    },
  }),

  createPlayer: (player: { name: string; team: string; position: string; id: string }) => ({
    "@context": "https://schema.org",
    "@type": "Person",
    name: player.name,
    jobTitle: "Professional Basketball Player",
    memberOf: {
      "@type": "SportsTeam",
      name: player.team,
    },
    url: `${SITE_URL}/player/${player.id}`,
  }),

  faqPage: (faqs: Array<{ question: string; answer: string }>) => ({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  }),

  breadcrumbList: (items: Array<{ name: string; url: string }>) => ({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }),
};
