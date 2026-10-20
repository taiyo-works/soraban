// Sprint 11e 契約 8・15 の基準を作る共通の入力（テストとベースライン生成スクリプトで共有する）。
// 判定の中身（verdict）と証跡 ID を、Sprint 11d（2446ec7、エンジンは dd87b87 まで同じ）の結果と比べる。
import {
  DEFAULT_INDUSTRIAL_SOURCE,
  loadBundledDid,
  BUNDLED_DID_PREF_CODES,
  type FlightContext,
  type SpecificFlightFlag,
} from "@soraban/regulations";
import type { RegulationDataProvider } from "./check-core";

export const BASELINE_LOCATIONS = [
  { name: "米子市役所", loc: { lat: 35.4278, lng: 133.3314 }, muni: "31202" },
  { name: "美保基地の周辺", loc: { lat: 35.4936, lng: 133.26604 }, muni: "31204" },
  { name: "出雲縁結び空港の周辺", loc: { lat: 35.44, lng: 132.89 }, muni: "32203" },
  { name: "出雲縁結び空港の敷地内", loc: { lat: 35.4136, lng: 132.89 }, muni: "32203" },
  { name: "鳥取市の工業専用地域", loc: { lat: 35.474926, lng: 134.222963 }, muni: "31201" },
] as const;

export const BASELINE_WEIGHTS: readonly (number | undefined)[] = [900, undefined, 100, 50];
export const BASELINE_FLAGS: readonly (readonly SpecificFlightFlag[])[] = [[], ["airspace_150m"], ["method_night"]];

export const baselineProvider = (muniCode: string): RegulationDataProvider => ({
  loadDid: async (pref) => loadBundledDid(pref),
  didPrefCodes: async () => BUNDLED_DID_PREF_CODES,
  industrial: DEFAULT_INDUSTRIAL_SOURCE,
  reverseGeocode: async () => ({ muniCode }),
});

export const BASELINE_NOW = () => new Date("2026-10-20T00:00:00.000Z");

export const baselineCtx = (w: number | undefined): FlightContext | undefined =>
  w !== undefined ? { droneWeightG: w } : undefined;

export const baselineKey = (name: string, w: number | undefined, flags: readonly string[]): string =>
  `${name}|${w ?? "未指定"}|${flags.join("+") || "なし"}`;
