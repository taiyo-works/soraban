// このファイルは packages/regulations/scripts/build-industrial-exclusive.mjs が生成する。手で編集しない。
//
// 工業専用地域（DID 除外）のポリゴンを市町村単位で静的 import する。
import type { IndustrialBundleFile } from "../industrial-exclusive";
import m31201 from "../../data/industrial-exclusive/by-muni/31201.json";
import m31202 from "../../data/industrial-exclusive/by-muni/31202.json";
import m31203 from "../../data/industrial-exclusive/by-muni/31203.json";
import m31204 from "../../data/industrial-exclusive/by-muni/31204.json";
import m31384 from "../../data/industrial-exclusive/by-muni/31384.json";
import m32201 from "../../data/industrial-exclusive/by-muni/32201.json";
import m32203 from "../../data/industrial-exclusive/by-muni/32203.json";
import m32204 from "../../data/industrial-exclusive/by-muni/32204.json";
import m32205 from "../../data/industrial-exclusive/by-muni/32205.json";
import m32206 from "../../data/industrial-exclusive/by-muni/32206.json";
import m32209 from "../../data/industrial-exclusive/by-muni/32209.json";

export const INDUSTRIAL_BUNDLE: Readonly<Record<string, IndustrialBundleFile>> = {
  "31201": m31201 as unknown as IndustrialBundleFile,
  "31202": m31202 as unknown as IndustrialBundleFile,
  "31203": m31203 as unknown as IndustrialBundleFile,
  "31204": m31204 as unknown as IndustrialBundleFile,
  "31384": m31384 as unknown as IndustrialBundleFile,
  "32201": m32201 as unknown as IndustrialBundleFile,
  "32203": m32203 as unknown as IndustrialBundleFile,
  "32204": m32204 as unknown as IndustrialBundleFile,
  "32205": m32205 as unknown as IndustrialBundleFile,
  "32206": m32206 as unknown as IndustrialBundleFile,
  "32209": m32209 as unknown as IndustrialBundleFile,
};
