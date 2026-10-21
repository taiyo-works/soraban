// 飛行計画のフォームの選択肢と、判定画面からの入力の引き継ぎ（Sprint 12a 設計 F・J）。純粋関数・定数だけ。
// 選択肢の文言は @soraban/regulations の定数を使い、別に書かない。判定画面（regulation-checker）と同じ値を使う。
import {
  DIPS_PERMIT_KINDS,
  dipsPermitValue,
  PERMIT_VALUE_LABEL,
  SPECIFIC_FLIGHT_FLAG_LABEL,
  type SpecificFlightFlag,
} from "@soraban/regulations";

/** 判定が導出する空域のフラグ。利用者は選ばない（server/ops/plan-logic.ts の DERIVED_AIRSPACE_FLAGS と同じ）。 */
const DERIVED_FLAGS: readonly string[] = ["airspace_did", "airspace_airport"];

/** 計画のフォームで選べる飛行の方法・空域（定義の順。DID・空港周辺は判定が導出するため出さない）。 */
export const PLAN_FLAG_CHOICES: readonly { readonly value: SpecificFlightFlag; readonly label: string }[] = (
  Object.keys(SPECIFIC_FLIGHT_FLAG_LABEL) as SpecificFlightFlag[]
)
  .filter((f) => !DERIVED_FLAGS.includes(f))
  .map((value) => ({ value, label: SPECIFIC_FLIGHT_FLAG_LABEL[value] }));

/** 計画に入れられる許可・承認・同意（server/ops/validate-plan.ts の PLAN_PERMIT_VALUES と同じ順）。 */
export const PLAN_PERMIT_CHOICES: readonly { readonly value: string; readonly label: string }[] = [
  ...DIPS_PERMIT_KINDS.map(dipsPermitValue),
  "facility_manager",
  "pref_pubsafety_notice",
  "park_manager",
  "bunkacho_or_kyoiku",
].map((value) => ({ value, label: PERMIT_VALUE_LABEL[value] ?? value }));

/** 目的の例外（判定画面の「運航の目的」と同じ文言）。 */
export const PLAN_PURPOSE_CHOICES = [
  { value: "", label: "通常運航" },
  { value: "emergency", label: "緊急（災害復旧・人命救助）" },
  { value: "public_duty", label: "公務（警察・消防・自治体）" },
  { value: "city_event", label: "市が主催・後援する行事" },
] as const;

/** 立入管理措置／第三者上空（判定画面と同じ文言）。 */
export const PLAN_ACCESS_CHOICES = [
  { value: "", label: "未選択" },
  { value: "yes", label: "立入管理措置あり（第三者の上空で飛ばさない＝カテゴリー II）" },
  { value: "no_third_party", label: "立入管理措置なし（第三者の上空＝カテゴリー III／レベル4）" },
] as const;

/** 目視外飛行の補助者（判定画面と同じ文言）。 */
export const PLAN_OBSERVER_CHOICES = [
  { value: "", label: "未選択" },
  { value: "with", label: "補助者あり" },
  { value: "without", label: "補助者なし（より上位の運航要件）" },
] as const;

export type PlanAccessMode = (typeof PLAN_ACCESS_CHOICES)[number]["value"];
export type PlanObserverMode = (typeof PLAN_OBSERVER_CHOICES)[number]["value"];

// ---- 判定画面 → 計画のフォームへの入力の引き継ぎ -----------------------------

/** 引き継ぐ判定の入力（判定の結果は引き継がない。保存時にサーバーが判定を再実行する）。機体は引き継がない。 */
export type PlanHandoff = {
  readonly lat?: string;
  readonly lng?: string;
  /** 判定画面で入れた機体の重さ（g）。参考表示だけ。計画の判定には登録した機体の重量を使う。 */
  readonly weightG?: string;
  readonly flags: readonly SpecificFlightFlag[];
  readonly permits: readonly string[];
  readonly plannedDate?: string;
  readonly purpose: string;
  readonly access: PlanAccessMode;
  readonly observer: PlanObserverMode;
};

export const EMPTY_HANDOFF: PlanHandoff = { flags: [], permits: [], purpose: "", access: "", observer: "" };

export type PlanHandoffSource = {
  readonly lat: string;
  readonly lng: string;
  readonly weightG: string;
  readonly flags: readonly string[];
  readonly permits: readonly string[];
  readonly plannedDate: string;
  readonly purpose: string;
  readonly access: string;
  readonly observer: string;
};

/** 判定画面の入力から、計画のフォームを開くリンクを作る。空の項目は付けない。 */
export const buildPlanHandoffHref = (s: PlanHandoffSource): string => {
  const q = new URLSearchParams();
  if (s.lat.trim()) q.set("lat", s.lat.trim());
  if (s.lng.trim()) q.set("lng", s.lng.trim());
  if (s.weightG.trim()) q.set("weightG", s.weightG.trim());
  if (s.flags.length > 0) q.set("flags", s.flags.join(","));
  if (s.permits.length > 0) q.set("permits", s.permits.join(","));
  if (s.plannedDate.trim()) q.set("date", s.plannedDate.trim());
  if (s.purpose && s.purpose !== "general") q.set("purpose", s.purpose);
  if (s.access) q.set("access", s.access);
  if (s.observer) q.set("observer", s.observer);
  const qs = q.toString();
  return qs ? `/ops/plans/new?${qs}` : "/ops/plans/new";
};

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const list = (v: string | string[] | undefined): string[] =>
  (first(v) ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const NUMBER = /^-?\d{1,3}(\.\d{1,6})?$/;

/** クエリから引き継ぎを読む。知らない値・形の違う値は捨てる（フォームの検査はサーバーが行う）。 */
export const parsePlanHandoff = (sp: Readonly<Record<string, string | string[] | undefined>>): PlanHandoff => {
  const lat = first(sp["lat"])?.trim();
  const lng = first(sp["lng"])?.trim();
  const w = first(sp["weightG"])?.trim();
  const date = first(sp["date"])?.trim();
  const purpose = first(sp["purpose"])?.trim() ?? "";
  const access = first(sp["access"])?.trim() ?? "";
  const observer = first(sp["observer"])?.trim() ?? "";
  const flagSet = new Set(list(sp["flags"]));
  const permitSet = new Set(list(sp["permits"]));
  return {
    ...(lat && NUMBER.test(lat) ? { lat } : {}),
    ...(lng && NUMBER.test(lng) ? { lng } : {}),
    ...(w && /^\d{1,7}(\.\d{1,3})?$/.test(w) ? { weightG: w } : {}),
    flags: PLAN_FLAG_CHOICES.map((c) => c.value).filter((f) => flagSet.has(f)),
    permits: PLAN_PERMIT_CHOICES.map((c) => c.value).filter((p) => permitSet.has(p)),
    ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { plannedDate: date } : {}),
    purpose: PLAN_PURPOSE_CHOICES.some((c) => c.value === purpose) ? purpose : "",
    access: access === "yes" || access === "no_third_party" ? access : "",
    observer: observer === "with" || observer === "without" ? observer : "",
  };
};

// ---- フォームの入力値 ----------------------------------------

/** フォームの入力値（すべて文字列。送るときに整える）。 */
export type PlanFormValues = {
  readonly title: string;
  readonly aircraftId: string;
  readonly pilotId: string;
  readonly startDate: string;
  readonly startTime: string;
  readonly duration: string;
  readonly purpose: string;
  readonly savedPlaceId: string;
  readonly placeName: string;
  readonly lat: string;
  readonly lng: string;
  readonly radius: string;
  readonly altitude: string;
  readonly flags: readonly string[];
  readonly permits: readonly string[];
  readonly judgementPurpose: string;
  readonly access: string;
  readonly observer: string;
  readonly permitNumbers: string;
  readonly notes: string;
};

export const EMPTY_PLAN_VALUES: PlanFormValues = {
  title: "",
  aircraftId: "",
  pilotId: "",
  startDate: "",
  startTime: "",
  duration: "",
  purpose: "",
  savedPlaceId: "",
  placeName: "",
  lat: "",
  lng: "",
  radius: "",
  altitude: "",
  flags: [],
  permits: [],
  judgementPurpose: "",
  access: "",
  observer: "",
  permitNumbers: "",
  notes: "",
};

