// このファイルは packages/regulations/scripts/build-did-r2.mjs が生成する。手で編集しない。
//
// 鳥取県（31）・島根県（32）の DID（国土数値情報 A16 令和2年）を静的 import で同梱し、
// 本番（Vercel）でもファイル I/O なしで読み込めるようにする。
import type { DidBundleFile } from "../did-data";
import pref31 from "../../data/did/r2/pref-31.json";
import pref32 from "../../data/did/r2/pref-32.json";

export const DID_BUNDLE: Readonly<Record<string, DidBundleFile>> = {
  "31": pref31 as unknown as DidBundleFile,
  "32": pref32 as unknown as DidBundleFile,
};
