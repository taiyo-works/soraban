// このファイルは packages/regulations/scripts/build-industrial-exclusive.mjs が生成する。手で編集しない。
//
// 工業専用地域（DID 除外）のポリゴンを市町村単位で静的 import する。
// 収録済みの市町村がまだないため空（DID 内の地点は「工業専用地域の除外：未確認」で表示される）。
import type { IndustrialBundleFile } from "../industrial-exclusive";

export const INDUSTRIAL_BUNDLE: Readonly<Record<string, IndustrialBundleFile>> = {};
