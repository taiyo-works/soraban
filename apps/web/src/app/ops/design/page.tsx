import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { parseConfig } from "@/components/ui/catalog/config";
import { DesignCatalog } from "@/components/ui/catalog/design-catalog";
import { isStyleView, parseStyleConfig } from "@/components/ui/catalog/style-config";
import { StyleTrial } from "@/components/ui/catalog/style-trial";
import { isDesignCatalogEnabled } from "@/lib/design-catalog";

// Design catalog (Sprint 12g stage 1a). No auth, no DB, no external calls.
// The env check runs per request (connection()) so the build output does not bake the flag in.
// proxy.ts answers 404 first when the flag is off; notFound() here is the second line of defence.
export const metadata: Metadata = {
  title: { absolute: "デザイン見本 — そらばん" },
  robots: { index: false, follow: false },
};

export default async function DesignCatalogPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  if (!isDesignCatalogEnabled(process.env)) notFound();
  const query = await searchParams;
  // ?view=style: the style trial (five palettes, square corners). A separate server component; the default view below is untouched.
  if (isStyleView(query)) return <StyleTrial config={parseStyleConfig(query)} />;
  // The configuration (theme, field mode, density, screen) comes from the query string so a view can be shared as a link.
  const initial = parseConfig(query);
  // A forced theme must be on <html> before the first paint (html[data-theme] drives the tokens and color-scheme). The
  // client effect only handles later changes. This inline script runs while the document is parsed, before the
  // stylesheet-dependent content paints; its value is one of two fixed words (the parsed enum), never the raw query.
  return (
    <>
      {initial.theme === "auto" ? null : <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.theme="${initial.theme}"` }} />}
      <DesignCatalog initial={initial} />
    </>
  );
}
