// このファイルは packages/regulations/scripts/build-did-r2.mjs が生成する。手で編集しない。
//
// 鳥取県（31）・島根県（32）の DID（国土数値情報 A16 令和2年）を静的 import で同梱し、
// 本番（Vercel）でもファイル I/O なしで読み込めるようにする。
// 現在は本体データ未取得のため空（DID 判定は「未確認」に縮退する）。取得手順は data/did/README.md。
import type { DidBundleFile } from "../did-data";

export const DID_BUNDLE: Readonly<Record<string, DidBundleFile>> = {};
