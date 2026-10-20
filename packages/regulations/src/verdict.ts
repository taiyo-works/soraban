// 判定の 4 段（Sprint 11d、docs/spec.md §13.9、docs/00_NORTH_STAR.md §0.1.9）。
//
// 判定が答える問いは「この地点・この飛び方で、何の手続きを、いつまでに済ませれば飛べるか」。
// deriveFlightVerdict は副作用のない純関数で、地点判定の規制（元の判定）・飛行の条件のフラグ・
// 機体重量・許可から、全体の段階、規制と飛行の条件ごとの判定、要手続きの手続き（期限順）、
// 手続き済み（条件付き）の項目と条件、飛行の前後に必ず行うことを導く。
//
// 優先順位（不可侵）：
//   1. 見落としをなくす。どの許可を入れても、元の判定が該当（red）・該当の可能性（yellow）の規制は
//      手続き不要にならない。空港の敷地内と緊急用務空域は許可で変わらない（飛行不可）。
//      判定不能（unknown）は要手続き以上に集約する。
//   2. 法的な重さ（国の法律 → 条例 → 施設管理者の取り決め）の順に並べる。
//   3. 同じ重さの中では期限の早い順。期限が決まらない手続きは最後。

import { subtractBusinessDays } from "./business-days";
import {
  findSatisfyingExceptions,
  formatMachineCondition,
  normalizePilotPermits,
  type ClauseException,
  type FlightContext,
} from "./clause-graph";
import type { LegalTier, RegulationStatus, RegulationWithStatus } from "./core";
import {
  ALL_PROCEDURES,
  DRONE_THRESHOLD_G,
  SPECIFIC_FLIGHT_FLAG_LABEL,
  SMALL_DRONE_LAW_PROCEDURE_ID,
  type SpecificFlightFlag,
} from "./diagnosis";
import { AIRPORT_MLIT_PERMIT_NOT_APPLIED_NOTE } from "./permit-notes";

// ── 段階 ──

/** 全体の段階（4 段）。判定不能は集約で要手続きに寄せる。 */
export type VerdictLevel = "no_fly" | "needs_procedure" | "procedure_done" | "no_procedure";

/** 規制・飛行の条件ごとの判定（4 段＋判定不能）。 */
export type ItemVerdict = VerdictLevel | "unknown";

export const VERDICT_LEVELS: readonly VerdictLevel[] = [
  "no_fly",
  "needs_procedure",
  "procedure_done",
  "no_procedure",
];

/** 段階の表示（画面・PDF で同じ言葉を使う）。 */
export const VERDICT_LABEL: Readonly<Record<ItemVerdict, string>> = {
  no_fly: "飛行不可",
  needs_procedure: "要手続き",
  procedure_done: "手続き済み（条件付き）",
  no_procedure: "手続き不要",
  unknown: "判定不能（データ未整備）",
};

/** 段階の短い説明（結論の下に添える）。 */
export const VERDICT_HELP: Readonly<Record<VerdictLevel, string>> = {
  no_fly:
    "どの手続きでも飛べない、または当日は飛べない区分があります。許可・同意を入力しても変わりません。",
  needs_procedure:
    "手続きを済ませれば飛べます。下の手続きを期限までに済ませてください。",
  procedure_done:
    "入力した許可・同意で満たしています。許可の条件（許可書の飛行条件・飛行マニュアル・範囲・期間）を守ることが前提です。",
  no_procedure:
    "チェックした規制に当たりません。飛行の前後に必ず行うことは下を確認してください。",
};

/** 元の判定（status）の表示。旧版の黄の表示（確認と許可を一語にまとめた言葉）はやめる（spec §13.9.3）。 */
export const BASE_STATUS_LABEL: Readonly<Record<RegulationStatus, string>> = {
  red: "該当",
  yellow: "該当の可能性（要確認）",
  green: "非該当",
  unknown: "判定不能（データ未整備）",
};

/**
 * 旧版（0.3.0 まで）の総合判定の表示。履歴の旧形式（verdict なし）に使う。
 * 旧版の値であることを明示し、旧版の緑の表示の言葉（飛べると読める語）は使わない（spec §13.9.8）。
 */
export const LEGACY_STATUS_LABEL: Readonly<Record<RegulationStatus, string>> = {
  red: "該当あり（旧版の判定）",
  yellow: "要確認（旧版の判定）",
  green: "適用外（旧版の判定）",
  unknown: "判定不能（旧版の判定）",
};

/** 全体の集約の順序（強い順）。 */
const LEVEL_RANK: Readonly<Record<VerdictLevel, number>> = {
  no_fly: 3,
  needs_procedure: 2,
  procedure_done: 1,
  no_procedure: 0,
};

// ── 許可の値と表示 ──

/** DIPS の許可・承認の種類（Sprint 11d B1）。空港等周辺は含めない（個別の許可と調整が要る）。 */
export type DipsPermitKind =
  | "did"
  | "150m"
  | "night"
  | "bvlos"
  | "30m"
  | "event"
  | "dangerous"
  | "drop";

export const DIPS_PERMIT_KINDS: readonly DipsPermitKind[] = [
  "did",
  "150m",
  "night",
  "bvlos",
  "30m",
  "event",
  "dangerous",
  "drop",
];

export const dipsPermitValue = (kind: DipsPermitKind): string => `mlit:${kind}`;

/** DIPS の許可・承認の種類の表示。 */
export const DIPS_PERMIT_LABEL: Readonly<Record<DipsPermitKind, string>> = {
  did: "DID 上空の飛行許可",
  "150m": "150m 以上の飛行許可",
  night: "夜間飛行の承認",
  bvlos: "目視外飛行の承認",
  "30m": "人・物件から 30m 未満の飛行承認",
  event: "催し場所上空の飛行承認",
  dangerous: "危険物輸送の承認",
  drop: "物件投下の承認",
};

/** 飛行の条件のフラグ → それを満たす DIPS の許可・承認の値。空港等周辺・緊急用務空域は満たせない。 */
export const DIPS_PERMIT_BY_FLAG: Readonly<Partial<Record<SpecificFlightFlag, string>>> = {
  airspace_did: "mlit:did",
  airspace_150m: "mlit:150m",
  method_night: "mlit:night",
  method_bvlos: "mlit:bvlos",
  method_30m: "mlit:30m",
  method_event: "mlit:event",
  method_dangerous: "mlit:dangerous",
  method_drop: "mlit:drop",
};

/** 許可・同意の値の表示（画面・PDF・履歴で共通）。 */
export const PERMIT_VALUE_LABEL: Readonly<Record<string, string>> = {
  mlit: "国交省 DIPS（旧版の入力。DID 上空の許可として読む）",
  ...Object.fromEntries(
    DIPS_PERMIT_KINDS.map((k) => [dipsPermitValue(k), `国交省 DIPS：${DIPS_PERMIT_LABEL[k]}`]),
  ),
  park_manager: "公園管理者の許可",
  facility_manager: "施設管理者の同意",
  pref_pubsafety_notice: "公安委員会への通報（飛行禁止法）",
  facility_manager_and_pref_pubsafety: "飛行禁止法の同意＋通報（旧版の値）",
  bunkacho_or_kyoiku: "文化庁・教育委員会の許可",
};

/** 目的の表示。 */
export const PURPOSE_VALUE_LABEL: Readonly<Record<string, string>> = {
  emergency: "目的：緊急（災害復旧・人命救助）",
  public_duty: "目的：公務（警察・消防・自治体）",
  city_event: "目的：市が主催・後援する行事",
};

/** 手続き済み（条件付き）に必ず添える文（spec §13.9.5）。 */
export const PERMIT_SCOPE_NOT_VERIFIED_NOTE =
  "許可の範囲と有効期間は照合していません。許可書で確認してください。";

/** 目的による例外に添える文（未決 3）。 */
export const PURPOSE_EXCEPTION_CONDITION =
  "目的の例外に当たることを、根拠となる依頼・後援の書面で確かめてください（自己申告のため、手続き不要とはしません）。";

const PERMIT_CONDITION_NOTE =
  "許可書・同意書に書かれた飛行の条件（場所・期間・飛行の方法・機体・操縦者）と飛行マニュアルを守ってください。";

// ── 出力の型 ──

/** 規制・飛行の条件に当てた許可・目的。 */
export type AppliedPermit = {
  /** 例外節の id（飛行の条件のときは "dips:<フラグ>"）。 */
  readonly id: string;
  /** 表示（例：国交省 DIPS：DID 上空の飛行許可）。 */
  readonly label: string;
  /** 例外節の文。 */
  readonly condition: string;
  /** 機械可読の条件（例：permit_holder == mlit:did）。 */
  readonly machine: string;
  /** 目的による例外か。 */
  readonly byPurpose: boolean;
};

/** 規制または飛行の条件ごとの判定。 */
export type VerdictItem = {
  /** 規制 id、または飛行の条件のフラグ。 */
  readonly id: string;
  readonly kind: "regulation" | "flight_condition";
  readonly title: string;
  readonly legalTier: LegalTier;
  /** 元の判定（許可を当てる前）。飛行の条件は利用者が選んだもの＝該当（red）。 */
  readonly baseStatus: RegulationStatus;
  readonly verdict: ItemVerdict;
  readonly appliedPermits: readonly AppliedPermit[];
  /** 判定の理由。 */
  readonly reason: string;
};

export type VerdictDeadline = {
  /** 期限の文言（日付があれば含む）。 */
  readonly label: string;
  /** 期限の日付（YYYY-MM-DD）。飛行予定日がないか、期限が決まらないときは無い。 */
  readonly date?: string;
  /**
   * 並べ替え用：飛行開始の何日前までか（暦日の目安）。大きいほど早い。期限が決まらないものは null（最後）。
   */
  readonly leadDays: number | null;
};

/** 要手続きの手続き（結論の下の段取り）。 */
export type VerdictProcedure = {
  readonly id: string;
  readonly title: string;
  /** 出す先。 */
  readonly submitTo: string;
  readonly deadline: VerdictDeadline;
  readonly legalTier: LegalTier;
  /** この手続きが要る理由（元の判定）。 */
  readonly reason: string;
  /** 由来の規制 id または飛行の条件のフラグ。 */
  readonly itemId: string;
  /** 申請支援の手続きデータ（procedures.json）の id。条例の手続きなど対応が無いものは無い。 */
  readonly procedureId?: string;
};

/** 手続き済み（条件付き）の項目。 */
export type VerdictDoneItem = {
  readonly itemId: string;
  readonly title: string;
  readonly legalTier: LegalTier;
  readonly baseStatus: RegulationStatus;
  readonly appliedPermits: readonly AppliedPermit[];
  /** 守るべき条件（範囲・期間を照合していない旨を必ず含む）。 */
  readonly conditions: readonly string[];
  /** 対応する申請支援の手続き id（印を付ける）。 */
  readonly procedureIds: readonly string[];
};

/** 飛行不可の理由。 */
export type VerdictNoFlyItem = {
  readonly itemId: string;
  readonly title: string;
  readonly reason: string;
};

export type PerFlightDutyKind = "premise" | "per_flight";

/** 飛行の前後に必ず行うこと（段階を決めない）。 */
export type PerFlightDuty = {
  readonly id: string;
  readonly title: string;
  readonly kind: PerFlightDutyKind;
  readonly detail: string;
};

export type FlightVerdict = {
  readonly level: VerdictLevel;
  /** 判定不能の規制の件数（結論の位置に必ず出す）。 */
  readonly unknownCount: number;
  readonly items: readonly VerdictItem[];
  readonly noFly: readonly VerdictNoFlyItem[];
  readonly procedures: readonly VerdictProcedure[];
  readonly done: readonly VerdictDoneItem[];
  readonly perFlightDuties: readonly PerFlightDuty[];
  /** 判定に当てた許可・同意の値（入力。旧値の読み替え後、並べ替え済み）。 */
  readonly permits: readonly string[];
  /** 判定に当てた目的（通常運航は無い）。 */
  readonly purpose?: string;
};

export type DeriveFlightVerdictInput = {
  /** 地点判定の規制（status は元の判定）。 */
  readonly regulations: readonly RegulationWithStatus[];
  /** 飛行の条件のフラグ（飛行の方法と、利用者が選ぶ空域。地点判定由来の DID・空港を含んでもよい）。 */
  readonly flags?: readonly SpecificFlightFlag[];
  /** 機体重量・許可・目的。 */
  readonly ctx?: FlightContext;
  /** 飛行予定日（YYYY-MM-DD）。期限の日付を出す。 */
  readonly plannedDate?: string;
};

// ── 規制ごとの手続きの定義 ──

const procedureTitle = (id: string): string =>
  ALL_PROCEDURES.find((p) => p.id === id)?.title ?? id;

const DIPS_SUBMIT_TO = "国土交通省（DIPS 2.0）";
const UNDETERMINED_DEADLINE_LABEL = "管理者の定めによる（未収録）。早めに管理者へ確認してください";

const DIPS_LEAD_BUSINESS_DAYS = 10;
/** 10 開庁日の暦日の目安（並べ替え用。飛行予定日がないとき）。 */
const DIPS_LEAD_CALENDAR_APPROX = 14;

const isoToUtcMs = (iso: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const msToIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const subtractCalendarDays = (iso: string, days: number): string | null => {
  const ms = isoToUtcMs(iso);
  return ms === null ? null : msToIso(ms - days * 86_400_000);
};

const calendarDaysBetween = (fromIso: string, toIso: string): number | null => {
  const a = isoToUtcMs(fromIso);
  const b = isoToUtcMs(toIso);
  return a === null || b === null ? null : Math.round((b - a) / 86_400_000);
};

/** DIPS の許可・承認の期限（飛行開始の 10 開庁日以上前）。 */
export const dipsDeadline = (plannedDate: string | undefined): VerdictDeadline => {
  const date =
    plannedDate !== undefined
      ? (subtractBusinessDays(plannedDate, DIPS_LEAD_BUSINESS_DAYS) ?? undefined)
      : undefined;
  if (plannedDate !== undefined && date !== undefined) {
    return {
      label: `${date} まで（飛行予定日 ${plannedDate} の 10 開庁日以上前。土日・国民の祝日を除く）`,
      date,
      leadDays: calendarDaysBetween(date, plannedDate) ?? DIPS_LEAD_CALENDAR_APPROX,
    };
  }
  return {
    label: "飛行開始の 10 開庁日以上前まで（土日・国民の祝日を除く。飛行予定日を入れると日付を出します）",
    leadDays: DIPS_LEAD_CALENDAR_APPROX,
  };
};

/** 飛行禁止法の公安委員会への通報の期限（飛行開始の 48 時間前まで。開庁日計算の対象にしない）。 */
export const smallDroneNoticeDeadline = (plannedDate: string | undefined): VerdictDeadline => {
  const date = plannedDate !== undefined ? (subtractCalendarDays(plannedDate, 2) ?? undefined) : undefined;
  if (plannedDate !== undefined && date !== undefined) {
    return {
      label: `${date}（飛行予定日 ${plannedDate} の 2 日前）の、飛行開始と同じ時刻まで（飛行開始の 48 時間前まで）`,
      date,
      leadDays: 2,
    };
  }
  return {
    label: "飛行開始の 48 時間前まで（時間で数えます。飛行予定日を入れると日付を出します）",
    leadDays: 2,
  };
};

/** 飛行禁止法の施設管理者の同意の期限（法定の期限なし。通報より前）。 */
export const smallDroneConsentDeadline = (): VerdictDeadline => ({
  label: "通報より前（法定の期限なし。通報に同意の書面の写しを添えるため、先に済ませる）",
  // 通報（2 日）より少し早く並べる。
  leadDays: 2.5,
});

const undeterminedDeadline = (): VerdictDeadline => ({
  label: UNDETERMINED_DEADLINE_LABEL,
  leadDays: null,
});

const regulationShortName = (r: RegulationWithStatus): string => {
  const i = r.title.indexOf(" — ");
  return i >= 0 ? r.title.slice(0, i) : r.title;
};

/** 規制が要手続きのときに並べる手続き（1 件以上）。 */
const proceduresForRegulation = (
  r: RegulationWithStatus,
  plannedDate: string | undefined,
  reason: string,
  permits: readonly string[],
): VerdictProcedure[] => {
  const base = { legalTier: r.legalTier, reason, itemId: r.id };
  if (r.id === "aviation-law-did") {
    return [
      {
        ...base,
        id: "verdict-did-permit",
        title: procedureTitle("flight-permission-did"),
        submitTo: DIPS_SUBMIT_TO,
        deadline: dipsDeadline(plannedDate),
        procedureId: "flight-permission-did",
      },
    ];
  }
  if (r.id === "aviation-law-airport") {
    return [
      {
        ...base,
        id: "verdict-airport-permit",
        title: procedureTitle("flight-permission-airport"),
        submitTo: `${DIPS_SUBMIT_TO}・空港の設置管理者等との調整`,
        deadline: dipsDeadline(plannedDate),
        procedureId: "flight-permission-airport",
      },
    ];
  }
  if (r.id === "small-drone-law" || r.id === "miho-airbase-no-fly") {
    // 同意だけを入力しているときは、残る通報だけを並べる（同意と通報の両方で手続き済みになる）。
    const consentGiven = permits.includes("facility_manager");
    return [
      ...(consentGiven
        ? []
        : [
            {
              ...base,
              id: "verdict-small-drone-consent",
              title: "対象施設の管理者の同意",
              submitTo: "対象施設の管理者",
              deadline: smallDroneConsentDeadline(),
              procedureId: SMALL_DRONE_LAW_PROCEDURE_ID,
            },
          ]),
      {
        ...base,
        id: "verdict-small-drone-notice",
        title: "都道府県公安委員会への通報（飛行禁止法）",
        submitTo: "都道府県公安委員会（管轄の警察署経由）",
        deadline: smallDroneNoticeDeadline(plannedDate),
        procedureId: SMALL_DRONE_LAW_PROCEDURE_ID,
      },
    ];
  }
  if (r.id.endsWith("-park-ordinance")) {
    return [
      {
        ...base,
        id: `verdict-${r.id}`,
        title: "都市公園の管理者の許可",
        submitTo: `${r.authority}（公園の管理者）`,
        deadline: undeterminedDeadline(),
      },
    ];
  }
  if (r.id.endsWith("-heritage-protection")) {
    return [
      {
        ...base,
        id: `verdict-${r.id}`,
        title: "史跡の現状変更の許可（文化庁長官・教育委員会）",
        submitTo: r.authority,
        deadline: undeterminedDeadline(),
      },
    ];
  }
  if (r.id.endsWith("-pref-nuisance-prevention")) {
    return [
      {
        ...base,
        id: `verdict-${r.id}`,
        title: "施設管理者との事前調整（県条例）",
        submitTo: "周辺の施設の管理者・自治体の担当部署",
        deadline: undeterminedDeadline(),
      },
    ];
  }
  // 収録外の規制：管理者に確認する（安全側）。
  return [
    {
      ...base,
      id: `verdict-${r.id}`,
      title: `${regulationShortName(r)}の手続き`,
      submitTo: r.authority,
      deadline: undeterminedDeadline(),
    },
  ];
};

/** 判定不能の規制の確認（要手続きに寄せる）。未収録の市町村ではテンプレートの自治体名が残るため、種類の名前で出す。 */
const confirmTarget = (r: RegulationWithStatus): { name: string; submitTo: string } => {
  if (r.id.endsWith("-heritage-protection")) {
    return { name: "史跡・文化財（文化財保護法・文化財保護条例）", submitTo: "地点の市町村の教育委員会・文化庁" };
  }
  if (r.id.endsWith("-park-ordinance")) {
    return { name: "都市公園（都市公園条例）", submitTo: "地点の市町村の公園の管理者" };
  }
  if (r.id.endsWith("-pref-nuisance-prevention")) {
    return { name: "県の迷惑行為等防止条例", submitTo: "地点の都道府県・周辺の施設の管理者" };
  }
  return { name: regulationShortName(r), submitTo: r.authority };
};

const confirmProcedureForUnknown = (r: RegulationWithStatus): VerdictProcedure => {
  const t = confirmTarget(r);
  return {
    id: `verdict-confirm-${r.id}`,
    title: `${t.name}の該当を確認（データ未整備）`,
    submitTo: t.submitTo,
    deadline: {
      label: "飛行の前に（データが未整備のため、該当するかを管理者・一次資料で確かめる）",
      leadDays: null,
    },
    legalTier: r.legalTier,
    reason: `判定不能（データ未整備）：${r.note}`,
    itemId: r.id,
  };
};

// ── 許可の表示 ──

const toAppliedPermit = (ex: ClauseException): AppliedPermit => {
  const m = ex.machine;
  const byPurpose = m?.type === "purpose";
  let label = ex.condition;
  if (m?.type === "permit_holder" && typeof m.value === "string") {
    label = PERMIT_VALUE_LABEL[m.value] ?? m.value;
  } else if (m?.type === "permit_holder_all" && m.values) {
    label = m.values.map((v) => PERMIT_VALUE_LABEL[v] ?? v).join(" ＋ ");
  } else if (byPurpose && typeof m?.value === "string") {
    label = PURPOSE_VALUE_LABEL[m.value] ?? `目的：${m.value}`;
  }
  return {
    id: ex.id,
    label,
    condition: ex.condition,
    machine: m ? formatMachineCondition(m) : "",
    byPurpose,
  };
};

const doneConditions = (permits: readonly AppliedPermit[]): string[] => {
  const out: string[] = [];
  if (permits.some((p) => !p.byPurpose)) out.push(PERMIT_CONDITION_NOTE);
  if (permits.some((p) => p.byPurpose)) out.push(PURPOSE_EXCEPTION_CONDITION);
  out.push(PERMIT_SCOPE_NOT_VERIFIED_NOTE);
  return out;
};

const doneProcedureIdsForRegulation = (id: string): string[] => {
  if (id === "aviation-law-did") return ["flight-permission-did"];
  if (id === "small-drone-law" || id === "miho-airbase-no-fly") return [SMALL_DRONE_LAW_PROCEDURE_ID];
  return [];
};

// ── 導出 ──

const isRegulatedDrone = (w: number | undefined): boolean =>
  typeof w !== "number" || !Number.isFinite(w) || w >= DRONE_THRESHOLD_G;

const EMERGENCY_NO_FLY_REASON =
  "緊急用務空域は、指定中は飛行できません（他の飛行許可があっても不可。機体の重量を問いません）。飛行の直前に指定の有無を確認してください。";

const AIRSPACE_FLAG_REGULATION: Readonly<Partial<Record<SpecificFlightFlag, string>>> = {
  airspace_did: "aviation-law-did",
  airspace_airport: "aviation-law-airport",
};

/** 規制ごとの判定（spec §13.9.3）。 */
const regulationItem = (r: RegulationWithStatus, ctx: FlightContext | undefined): VerdictItem => {
  const base = {
    id: r.id,
    kind: "regulation" as const,
    title: r.title,
    legalTier: r.legalTier,
    baseStatus: r.status,
  };
  if (r.status === "unknown") {
    return { ...base, verdict: "unknown", appliedPermits: [], reason: `判定不能（データ未整備）。${r.note}` };
  }
  // 飛行不可の区分（空港の敷地内）は、元の判定や例外より先に評価する（重量・許可・目的で変わらない）。
  if (r.noFlyCategory === true) {
    return { ...base, verdict: "no_fly", appliedPermits: [], reason: `該当。${r.note}` };
  }
  if (r.status === "green") {
    const excluded = (r.appliedExceptions ?? []).map((e) => e.condition).join(" / ");
    return {
      ...base,
      verdict: "no_procedure",
      appliedPermits: [],
      reason: excluded.length > 0 ? `非該当（対象外：${excluded}）` : "非該当",
    };
  }
  const possibly = r.status === "yellow" ? "該当の可能性（要確認）。" : "該当。";
  const satisfied = findSatisfyingExceptions(r.clauseGraph, ctx).map(toAppliedPermit);
  if (satisfied.length > 0) {
    return {
      ...base,
      verdict: "procedure_done",
      appliedPermits: satisfied,
      reason: `${possibly}入力した許可・同意・目的で満たしています。`,
    };
  }
  const airportNote =
    r.id === "aviation-law-airport" ? ` ${AIRPORT_MLIT_PERMIT_NOT_APPLIED_NOTE}` : "";
  return {
    ...base,
    verdict: "needs_procedure",
    appliedPermits: [],
    reason: `${possibly}${r.note}${airportNote}`,
  };
};

/** 飛行の条件ごとの判定（方法・利用者が選ぶ空域）。 */
const flightConditionItem = (
  flag: SpecificFlightFlag,
  regulated: boolean,
  permits: readonly string[],
): VerdictItem => {
  const base = {
    id: flag,
    kind: "flight_condition" as const,
    title: SPECIFIC_FLIGHT_FLAG_LABEL[flag],
    legalTier: 1 as LegalTier,
    baseStatus: "red" as RegulationStatus,
  };
  if (flag === "airspace_emergency") {
    return { ...base, verdict: "no_fly", appliedPermits: [], reason: EMERGENCY_NO_FLY_REASON };
  }
  if (!regulated) {
    return {
      ...base,
      baseStatus: "green",
      verdict: "no_procedure",
      appliedPermits: [],
      reason: "機体重量が 100g 未満のため、航空法の特定飛行に当たりません（非該当）。",
    };
  }
  if (flag === "airspace_airport") {
    return {
      ...base,
      verdict: "needs_procedure",
      appliedPermits: [],
      reason: `該当（利用者が選んだ空域）。${AIRPORT_MLIT_PERMIT_NOT_APPLIED_NOTE}`,
    };
  }
  const value = DIPS_PERMIT_BY_FLAG[flag];
  if (value !== undefined && permits.includes(value)) {
    return {
      ...base,
      verdict: "procedure_done",
      appliedPermits: [
        {
          id: `dips:${flag}`,
          label: PERMIT_VALUE_LABEL[value] ?? value,
          condition: "国土交通大臣の許可・承認を取得している場合",
          machine: `permit_holder == ${value}`,
          byPurpose: false,
        },
      ],
      reason: "該当（利用者が選んだ飛行の条件）。入力した DIPS の許可・承認で満たしています。",
    };
  }
  return {
    ...base,
    verdict: "needs_procedure",
    appliedPermits: [],
    reason: "該当（利用者が選んだ飛行の条件）。DIPS で許可・承認を受ける必要があります。",
  };
};

const FLAG_PROCEDURE_ID: Readonly<Partial<Record<SpecificFlightFlag, string>>> = {
  airspace_did: "flight-permission-did",
  airspace_airport: "flight-permission-airport",
  airspace_150m: "flight-permission-150m",
  method_night: "flight-approval-night",
  method_bvlos: "flight-approval-bvlos",
  method_30m: "flight-approval-30m",
  method_event: "flight-approval-event",
  method_dangerous: "flight-approval-dangerous",
  method_drop: "flight-approval-drop",
};

const FLAG_ORDER: readonly SpecificFlightFlag[] = [
  "airspace_emergency",
  "airspace_airport",
  "airspace_did",
  "airspace_150m",
  "method_night",
  "method_bvlos",
  "method_30m",
  "method_event",
  "method_dangerous",
  "method_drop",
];

/** 全体の集約（spec §13.9.4）。判定不能は要手続きに寄せる。項目が 0 件なら要手続き。 */
export const aggregateVerdictLevel = (items: readonly { readonly verdict: ItemVerdict }[]): VerdictLevel => {
  if (items.length === 0) return "needs_procedure";
  let level: VerdictLevel = "no_procedure";
  for (const it of items) {
    const v: VerdictLevel = it.verdict === "unknown" ? "needs_procedure" : it.verdict;
    if (LEVEL_RANK[v] > LEVEL_RANK[level]) level = v;
  }
  return level;
};

/** 手続きの並べ方（spec §13.9.6）：法的な重さ → 期限の早い順（期限が決まらないものは最後）→ 元の順。 */
export const sortVerdictProcedures = (procs: readonly VerdictProcedure[]): VerdictProcedure[] =>
  procs
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      if (a.p.legalTier !== b.p.legalTier) return a.p.legalTier - b.p.legalTier;
      const la = a.p.deadline.leadDays;
      const lb = b.p.deadline.leadDays;
      if (la === null && lb !== null) return 1;
      if (la !== null && lb === null) return -1;
      if (la !== null && lb !== null && la !== lb) return lb - la;
      return a.i - b.i;
    })
    .map((x) => x.p);

/**
 * 判定の導出（純関数）。地点判定の規制・飛行の条件のフラグ・機体重量・許可・目的から、4 段の判定と
 * 手続きの段取りを返す。
 */
export const deriveFlightVerdict = (input: DeriveFlightVerdictInput): FlightVerdict => {
  const ctx = input.ctx;
  const permits = [...normalizePilotPermits(ctx?.pilotPermits)].sort();
  const regulated = isRegulatedDrone(ctx?.droneWeightG);
  const plannedDate =
    typeof input.plannedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.plannedDate)
      ? input.plannedDate
      : undefined;

  const regItems = input.regulations.map((r) => regulationItem(r, ctx));
  const regById = new Map(input.regulations.map((r) => [r.id, r]));

  // 飛行の条件：重複を除き、決まった順に並べる。地点判定の規制が該当（red／yellow）として扱う空域は重ねない。
  const flagSet = new Set(input.flags ?? []);
  const flagItems: VerdictItem[] = [];
  for (const f of FLAG_ORDER) {
    if (!flagSet.has(f)) continue;
    const regId = AIRSPACE_FLAG_REGULATION[f];
    if (regId !== undefined) {
      const r = regById.get(regId);
      if (r && (r.status === "red" || r.status === "yellow")) continue;
    }
    flagItems.push(flightConditionItem(f, regulated, permits));
  }

  const items = [...regItems, ...flagItems];
  const unknownCount = regItems.filter((i) => i.verdict === "unknown").length;
  const level = aggregateVerdictLevel(items);

  // 飛行不可の理由
  const noFly: VerdictNoFlyItem[] = items
    .filter((i) => i.verdict === "no_fly")
    .map((i) => ({ itemId: i.id, title: i.title, reason: i.reason }));

  // 要手続きの手続き
  const rawProcedures: VerdictProcedure[] = [];
  for (const it of items) {
    if (it.verdict === "unknown") {
      const r = regById.get(it.id);
      if (r) rawProcedures.push(confirmProcedureForUnknown(r));
      continue;
    }
    if (it.verdict !== "needs_procedure") continue;
    if (it.kind === "regulation") {
      const r = regById.get(it.id)!;
      rawProcedures.push(...proceduresForRegulation(r, plannedDate, it.reason, permits));
    } else {
      const flag = it.id as SpecificFlightFlag;
      const procId = FLAG_PROCEDURE_ID[flag];
      rawProcedures.push({
        id: `verdict-${flag}`,
        title: procId !== undefined ? procedureTitle(procId) : SPECIFIC_FLIGHT_FLAG_LABEL[flag],
        submitTo:
          flag === "airspace_airport"
            ? `${DIPS_SUBMIT_TO}・空港の設置管理者等との調整`
            : DIPS_SUBMIT_TO,
        deadline: dipsDeadline(plannedDate),
        legalTier: 1,
        reason: it.reason,
        itemId: it.id,
        ...(procId !== undefined ? { procedureId: procId } : {}),
      });
    }
  }
  const procedures = sortVerdictProcedures(rawProcedures);

  // 手続き済み（条件付き）
  const done: VerdictDoneItem[] = items
    .filter((i) => i.verdict === "procedure_done")
    .map((i) => {
      const procIds =
        i.kind === "regulation"
          ? doneProcedureIdsForRegulation(i.id)
          : FLAG_PROCEDURE_ID[i.id as SpecificFlightFlag] !== undefined
            ? [FLAG_PROCEDURE_ID[i.id as SpecificFlightFlag]!]
            : [];
      return {
        itemId: i.id,
        title: i.title,
        legalTier: i.legalTier,
        baseStatus: i.baseStatus,
        appliedPermits: i.appliedPermits,
        conditions: doneConditions(i.appliedPermits),
        procedureIds: procIds,
      };
    })
    .sort((a, b) => a.legalTier - b.legalTier);

  // 飛行の前後に必ず行うこと（段階を決めない）
  const aviationHit =
    regulated &&
    (items.some(
      (i) =>
        (i.id === "aviation-law-did" || i.id === "aviation-law-airport") &&
        (i.baseStatus === "red" || i.baseStatus === "yellow" || i.baseStatus === "unknown"),
    ) ||
      flagItems.some((i) => i.id !== "airspace_emergency"));
  const perFlightDuties: PerFlightDuty[] = [];
  if (regulated) {
    perFlightDuties.push({
      id: "drone-registration",
      title: procedureTitle("drone-registration"),
      kind: "premise",
      detail: "100g 以上の機体の前提です（判定の段階には影響しません）。登録記号の表示とリモート ID の搭載を確かめてください。",
    });
  }
  if (aviationHit) {
    perFlightDuties.push(
      {
        id: "flight-plan-report",
        title: procedureTitle("flight-plan-report"),
        kind: "per_flight",
        detail: "特定飛行のたびに、飛行の前に DIPS 2.0 で通報します。",
      },
      {
        id: "flight-logbook",
        title: procedureTitle("flight-logbook"),
        kind: "per_flight",
        detail: "特定飛行のたびに、飛行・日常点検・点検整備を記録します。",
      },
    );
  }
  perFlightDuties.push({
    id: "emergency-airspace-check",
    title: "緊急用務空域の指定の確認",
    kind: "per_flight",
    detail: "飛行の直前に、緊急用務空域が指定されていないかを確認します（指定中は飛行できません。機体の重量を問いません）。",
  });

  return {
    level,
    unknownCount,
    items,
    noFly,
    procedures,
    done,
    perFlightDuties,
    permits,
    ...(typeof ctx?.purpose === "string" && ctx.purpose !== "general" ? { purpose: ctx.purpose } : {}),
  };
};

/** 規制 id → 判定（evidence_log.per_regulation_verdict）。 */
export const perRegulationVerdict = (
  verdict: Pick<FlightVerdict, "items">,
): Readonly<Record<string, ItemVerdict>> =>
  Object.fromEntries(verdict.items.filter((i) => i.kind === "regulation").map((i) => [i.id, i.verdict]));
