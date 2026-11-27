// 判定の画面（根拠のデータ）に出すデータセットの情報（Sprint 16-H2 差し戻し R-3）。
// 名称・基準年・確認日は、判定のときに保存した値を正にする。台帳（sources.json）の確認日が保存した値と一致するときだけ、
// 提供元・版・URL を台帳から足す。一致しない（判定の後に台帳が更新された）ときは足さず、その旨の印を付ける。
import { getDataset, type DatasetRecord } from "@soraban/regulations";
import type { TileDataset } from "@/components/ops/judgement-tiles";

export type SavedDataset = { readonly id: string; readonly name: string; readonly baseYear: number | null; readonly verifiedAt: string };

export const datasetInfo = (
  d: SavedDataset,
  stale: boolean,
  lookup: (id: string) => DatasetRecord = getDataset,
): TileDataset => {
  const base: TileDataset = { id: d.id, name: d.name, baseYear: d.baseYear, verifiedAt: d.verifiedAt, stale, ...(stale && Number.isNaN(Date.parse(d.verifiedAt)) ? { unreadable: true } : {}) };
  let r: DatasetRecord | null = null;
  try {
    r = lookup(d.id);
  } catch {
    r = null; // 台帳に無いデータセットは、保存した名称・基準年・確認日だけにする
  }
  if (r === null) return base;
  if (r.verifiedAt === d.verifiedAt) return { ...base, provider: r.provider, version: r.version, url: r.url };
  return { ...base, ledgerUpdated: true };
};
