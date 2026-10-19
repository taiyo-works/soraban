import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  prepareAddressIndex,
  searchBundledAddress,
  type AddressBundleEntry,
  type AddressIndexFile,
  type AddressParcelFile,
  type GeocodeHit,
} from "@soraban/regulations/address";

// 住所検索の索引の読み込み口（Sprint 9）。
//
// 既定（本番）：@soraban/regulations/address が静的 import で同梱した索引を使う（ファイル I/O・外部通信なし）。
// 差し替え（任意）：ADDRESS_DATA_DIR に index-XX.json（と parcels-XX.json）を置いたディレクトリを指定すると、
// そちらを読む。E2E のフィクスチャ用サーバー（e2e/fixtures/address、実在の住所ではない）と手元の検証に使う。
export const ADDRESS_DATA_DIR_OVERRIDE: string | undefined = process.env["ADDRESS_DATA_DIR"] || undefined;

let overridePrepared: Promise<ReturnType<typeof prepareAddressIndex>> | null = null;

const loadOverride = async (dir: string): Promise<ReturnType<typeof prepareAddressIndex>> => {
  const files = await fs.readdir(dir);
  const bundle: Record<string, AddressBundleEntry> = {};
  for (const f of files) {
    const m = /^index-(\d+)\.json$/.exec(f);
    if (!m) continue;
    const index = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as AddressIndexFile;
    const pf = path.join(dir, `parcels-${m[1]}.json`);
    const parcels = files.includes(`parcels-${m[1]}.json`)
      ? (JSON.parse(await fs.readFile(pf, "utf8")) as AddressParcelFile)
      : null;
    bundle[m[1]!] = { index, parcels };
  }
  return prepareAddressIndex(bundle);
};

/** 住所検索の検索関数を返す（差し替えがあればその索引、なければ同梱索引）。 */
export const resolveAddressSearch = async (): Promise<(q: string) => GeocodeHit[]> => {
  if (!ADDRESS_DATA_DIR_OVERRIDE) return (q) => searchBundledAddress(q);
  overridePrepared ??= loadOverride(ADDRESS_DATA_DIR_OVERRIDE);
  const prepared = await overridePrepared;
  return (q) => searchBundledAddress(q, prepared);
};
