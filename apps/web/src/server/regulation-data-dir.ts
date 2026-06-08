import "server-only";
import path from "node:path";

// DID(人口集中地区) ポリゴンのディレクトリ。
//
// 実データ (did/by-pref/pref-XX.geojson) は現状リポジトリ未追跡で容量も大きく、
// Vercel の関数バンドルにも含まれない。そのため本番では基本的に存在せず、DID 判定は
// computeOverall 側で unknown に安全縮退する。外部にデータを置く場合は DID_DATA_DIR を
// 指定すればそのディレクトリを参照する。
//
// (airports は @soraban/regulations が静的 import で同梱するため、ここでは扱わない。
//  parks も同様に zones.ts が import 済み。fs 読みが残るのは DID のみ。)
export const DID_DIR =
  process.env["DID_DATA_DIR"] ??
  path.join(
    process.cwd(),
    "..",
    "..",
    "packages",
    "regulations",
    "data",
    "did",
    "by-pref",
  );
