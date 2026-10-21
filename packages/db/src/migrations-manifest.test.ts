import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LATEST_MIGRATION_VERSION, MIGRATION_VERSIONS } from "./migrations-manifest";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

describe("migrations-manifest", () => {
  it("packages/db/migrations の版と一致する", () => {
    const versions = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, 4))
      .sort();
    expect([...MIGRATION_VERSIONS]).toEqual(versions);
    expect(LATEST_MIGRATION_VERSION).toBe("0015");
  });
});
