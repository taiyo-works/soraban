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
  transpilePackages: ["@soraban/db", "@soraban/dips", "@soraban/regulations", "@soraban/geo"],

  // 規制データ (airports / parks) は @soraban/regulations で静的 import して
  // バンドルに同梱する方針 (Turbopack ビルドは outputFileTracingIncludes を
  // 適用しないため、ランタイム fs 読みは使わない)。
  outputFileTracingRoot: repoRoot,

  // E2E でフィクスチャ用の next dev を同時に起動するとき、.next のロックが衝突しないよう
  // 出力先を環境変数で分けられるようにする（未設定は既定の .next）。
  distDir: process.env["NEXT_DIST_DIR"] || ".next",

  // Sprint 9：現在地ボタンのため、位置情報を自サイトにだけ許可する（他の Permissions-Policy の設定はない）。
  // 社内での試験運用中は、検索エンジンに載せない（X-Robots-Tag: noindex）。本格公開のときに外す。
  // robots.txt で巡回を禁止すると noindex が読まれなくなるため、robots.txt では禁止しない。
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Permissions-Policy", value: "geolocation=(self)" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
