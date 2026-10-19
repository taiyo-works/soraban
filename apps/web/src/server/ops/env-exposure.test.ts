// Sprint 10 契約 3：認証関係の環境変数をブラウザに渡さない（NEXT_PUBLIC_ で始まる認証関係の環境変数がない）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REPO = path.resolve(WEB, "..", "..");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (name === "node_modules" || name.startsWith(".next")) return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe("認証関係の環境変数", () => {
  it("apps/web のソース・設定と .env.example に NEXT_PUBLIC_ で始まる認証関係の変数がない", () => {
    const files = [
      ...walk(path.join(WEB, "src")).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f)),
      path.join(WEB, "next.config.ts"),
      path.join(REPO, ".env.example"),
    ];
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/NEXT_PUBLIC_[A-Z0-9_]*/g)) {
        if (/AUTH|NEON|OPS|SECRET|DATABASE/.test(m[0])) hits.push(`${path.relative(REPO, f)}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
