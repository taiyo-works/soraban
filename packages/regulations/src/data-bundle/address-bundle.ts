// このファイルは packages/regulations/scripts/build-address-index.mjs が生成する。手で編集しない。
// （データ取得前の空の索引。fetch-address-data ワークフローの生成物で置き換える）
import type { AddressIndexFile, AddressParcelFile } from "../address/types";

export const ADDRESS_BUNDLE: Readonly<
  Record<string, { readonly index: AddressIndexFile; readonly parcels: AddressParcelFile | null }>
> = {};
