import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { parseConfig } from "@/components/ui/catalog/config";
import { DesignCatalog } from "@/components/ui/catalog/design-catalog";
import { isDesignCatalogEnabled } from "@/lib/design-catalog";

// Design catalog (Sprint 12g stage 1a). No auth, no DB, no external calls.
// The env check runs per request (connection()) so the build output does not bake the flag in.
// proxy.ts answers 404 first when the flag is off; notFound() here is the second line of defence.
export const metadata: Metadata = {
  title: "デザイン見本 — そらばん",
  robots: { index: false, follow: false },
};

export default async function DesignCatalogPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  if (!isDesignCatalogEnabled(process.env)) notFound();
  // The configuration (theme, palette, field mode, density, screen) comes from the query string so a view can be shared as a link.
  return <DesignCatalog initial={parseConfig(await searchParams)} />;
}
