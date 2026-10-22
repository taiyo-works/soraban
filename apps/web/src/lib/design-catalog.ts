// Design catalog gate (Sprint 12g stage 1a).
// The catalog at /ops/design is a static page for reviewing the design system. It is shown only when
// DESIGN_CATALOG is exactly "1" AND the deployment is not production (VERCEL_ENV !== "production").
// Everything else (unset, "0", "true", production with the flag set) is a 404.

/** Request header set by proxy.ts for the catalog so layout-level code can skip auth lookups. */
export const DESIGN_CATALOG_HEADER = "x-soraban-design-catalog";

/** The catalog route. It is the only route added by Sprint 12g. */
export const DESIGN_CATALOG_PATH = "/ops/design";

export const isDesignCatalogEnabled = (env: Readonly<Record<string, string | undefined>>): boolean =>
  env["DESIGN_CATALOG"] === "1" && env["VERCEL_ENV"] !== "production";
