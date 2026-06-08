import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// monorepo ルート (= apps/web から2つ上)。ファイルトレースのルートをここに固定し、
// 関数の依存解決を正しくモノレポ全体にスコープする。
const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const nextConfig: NextConfig = {
  cacheComponents: true,
  transpilePackages: ["@soraban/db", "@soraban/regulations", "@soraban/geo"],

  // 規制データ (airports / parks) は @soraban/regulations で静的 import して
  // バンドルに同梱する方針 (Turbopack ビルドは outputFileTracingIncludes を
  // 適用しないため、ランタイム fs 読みは使わない)。
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
