import { useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { getLegacyWikiHref } from "@/features/wiki/handbook";

export default function WikiArticlePage() {
  const [, params] = useRoute("/wiki/:section/:slug");
  const section = params?.section || "";
  const slug = params?.slug || "";
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (section && slug) {
      setLocation(getLegacyWikiHref(section, slug), { replace: true });
      return;
    }

    setLocation("/wiki", { replace: true });
  }, [section, setLocation, slug]);

  return null;
}
