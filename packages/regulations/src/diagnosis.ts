// DIPS 飛行許可・承認 申請支援 — 手続き診断ロジック ＋ 制度データモデル。
//
// docs/spec.md §4（判定理由→手続きのマッピング）／§6（データモデル）を実装する。
//
// 設計の核:
//   - 制度データ（手続き定義・カテゴリー定義）は data/procedures/*.json・
//     data/categories/*.json に出典付きで保持し、ここでは「型付けして読み込む」
//     だけにする（コード直書き禁止・改正差し替え可能）。
//   - deriveDiagnosis は副作用のない純関数。空域フラグ（判定由来）＋飛行方法フラグ
//     （ユーザー入力）＋機体重量から、必要手続き配列を機械的に導出する。
//   - 機体重量 未指定／不明時は「厳しい側」に倒す（フェイルセーフ）。
//     100g 以上前提の航空法系手続きを表示する。

import type { DidDetail } from "./core";
import { normalizeDatasetKeys } from "./evidence";
import proceduresData from "../data/procedures/procedures.json";
import categoriesData from "../data/categories/categories.json";
import { subtractBusinessDays } from "./business-days";

// ── 特定飛行の区分（航空法 132条の85=空域 / 132条の86=方法）──
export type SpecificFlightFlag =
  | "airspace_airport" // 空域① 空港等周辺
  | "airspace_150m" // 空域② 150m以上
  | "airspace_did" // 空域③ DID上空
  | "airspace_emergency" // 空域④ 緊急用務空域
  | "method_night" // 方法① 夜間
  | "method_bvlos" // 方法② 目視外
  | "method_30m" // 方法③ 人・物件30m未満
  | "method_event" // 方法④ 催し場所上空
  | "method_dangerous" // 方法⑤ 危険物輸送
  | "method_drop"; // 方法⑥ 物件投下

// UI のチェックボックス／トグルで操作する「飛行方法」フラグの一覧（順序固定）。
// 空域フラグのうち 150m は高度入力相当としてここに含める（既存判定に高度入力が
// ないため新規フラグ入力として扱う）。空港・DID・緊急用務は判定由来。
export const FLIGHT_METHOD_FLAGS: readonly SpecificFlightFlag[] = [
  "method_night",
  "method_bvlos",
  "method_30m",
  "method_event",
  "method_dangerous",
  "method_drop",
  "airspace_150m",
];

// UI で操作する「空域」フラグの一覧（順序固定）。
// 原則は信号機判定（DID・空港の red）から自動導出するが、DID データはリポジトリ未追跡で
// 本番・CI では unknown/縮退する場合がある。そのため空域フラグもユーザーが手動で
// チェック／確認できるようにし、判定由来の red は自動でプリチェックする。
// 150m は高度入力相当として FLIGHT_METHOD_FLAGS 側に置くため、ここには含めない。
export const AIRSPACE_FLAGS: readonly SpecificFlightFlag[] = [
  "airspace_did",
  "airspace_airport",
  "airspace_emergency",
];

// 各 SpecificFlightFlag の表示ラベル（UI チェックボックスのラベル）。
export const SPECIFIC_FLIGHT_FLAG_LABEL: Readonly<
  Record<SpecificFlightFlag, string>
> = {
  airspace_airport: "空港等周辺",
  airspace_150m: "150m以上の高さ",
  airspace_did: "DID（人口集中地区）上空",
  airspace_emergency: "緊急用務空域",
  method_night: "夜間飛行",
  method_bvlos: "目視外飛行",
  method_30m: "人・物件から30m未満",
  method_event: "催し場所上空",
  method_dangerous: "危険物の輸送",
  method_drop: "物件の投下",
};

// ── 手続き（申請・登録・通報・書類）──
export type RequiredProcedureKind =
  | "flight_permission"
  | "flight_approval"
  | "drone_registration"
  | "flight_plan_report"
  | "flight_logbook"
  | "insurance"
  | "ordinance_coordination"
  | "facility_consent_notice";

export type ProcedureSystem = "DIPS 2.0" | "DRS" | "条例（各管理者）" | "都道府県公安委員会";

export type RequiredProcedure = {
  readonly id: string;
  readonly kind: RequiredProcedureKind;
  /** 例: "飛行許可（DID上空）" */
  readonly title: string;
  readonly system: ProcedureSystem;
  /** DRS と DIPS 2.0 を別 URL で持つ（別導線で案内するため） */
  readonly systemUrl: string;
  /** 例: "航空法 第132条の85 第1項第2号（人口集中地区(DID)の上空）" */
  readonly legalBasis: string;
  /** 出典 URL（条文・手引き）。空でないこと。 */
  readonly sourceUrl: string;
  /** IIB 条件で不要化できるか */
  readonly waivableByIIB: boolean;
  /** 提出期限の逆算日数（通常 10 開庁日）。登録・通報・日誌は 0。 */
  readonly leadTimeBusinessDays: number;
  readonly note?: string;
  /** §3.6 の要再確認事項に紐づくなら true（確定事実として表示しない） */
  readonly needsReverify?: boolean;
  /**
   * 改正レビュー用の検証日（ISO 8601）。この手続き定義を一次情報で確認した日付。
   * 既存 `RegulationConfidence.verifiedAt` の作法に倣い、各レコードが個別に持つことで
   * 「いつ時点の制度確認に基づくレコードか」を監査・改正レビューで同定できる（spec §8）。
   * レコード個別に無ければデータセット全体の検証日（procedures.json の top-level verifiedAt）に
   * フォールバックする。
   */
  readonly verifiedAt?: string;
};

// ── カテゴリー定義 ──
// "needs_verification" = 空域（DID 等）の該当／非該当を確認できず、特定飛行に該当するか
// 断定できない状態。「申請不要（カテゴリー I）」とは絶対に表示しない（要確認）。
export type DiagnosisCategory =
  | "I"
  | "needs_verification"
  | "II_A"
  | "II_B_eligible"
  | "III_level4"
  // 緊急用務空域の指定中＝原則飛行禁止。許可・承認の申請で飛べる区分ではない（Sprint 11a C4）。
  | "emergency_no_fly";

// 空域判定の三値（該当／非該当／未確認）。DID データ未整備・判定不能は "unverified"。
export type AirspaceDeterminationStatus = "applicable" | "not_applicable" | "unverified";

export const AIRSPACE_DETERMINATION_LABEL: Readonly<
  Record<AirspaceDeterminationStatus, string>
> = {
  applicable: "該当",
  not_applicable: "非該当",
  unverified: "未確認",
};

// 総重量 25kg 以上の境界（カテゴリー II の IIB 不要化不可・第三者賠償責任保険の必須化）。
export const HEAVY_DRONE_THRESHOLD_G = 25_000;

export type CategoryDefinition = {
  readonly id: DiagnosisCategory;
  readonly label: string;
  readonly description: string;
  readonly sourceUrl: string;
  /** 改正レビュー用の検証日（ISO 8601）。categories.json の検証日に基づく（spec §8）。 */
  readonly verifiedAt?: string;
};

// ── 飛行方法・運航条件（既存 FlightContext を拡張する独立コンテキスト）──
export type FlightMethodContext = {
  /** ユーザーが選んだ飛行方法 + 判定由来の空域フラグ */
  readonly flags: readonly SpecificFlightFlag[];
  /** ISO 日付（YYYY-MM-DD）。期限逆算に使う（S1 では保持のみ） */
  readonly plannedDate?: string;
  /** 第三者上空（III 判定用） */
  readonly thirdPartyOverflight?: boolean;
  /** 立入管理措置の有無（II/III 切り分け） */
  readonly accessControl?: boolean;
  /** 目視外: 補助者の有無（別扱い） */
  readonly bvlosWithObserver?: boolean;
};

// ── 診断結果（API レスポンス）──
export type ApplicationDiagnosis = {
  readonly category: DiagnosisCategory;
  /** 切り分けの根拠説明 */
  readonly categoryNote: string;
  readonly procedures: readonly RequiredProcedure[];
  /** 各手続きの提出期限。S1 では submitBy 未算出（S2 で期限カレンダー実装）。 */
  readonly deadlines: readonly {
    readonly procedureId: string;
    readonly submitBy?: string;
    readonly basis: string;
  }[];
  /** 特定飛行に該当するか（横断手続き付与の根拠） */
  readonly isSpecificFlight: boolean;
  /** DID（人口集中地区）上空の該当状況（三値）。未確認は「申請不要」と扱わない。 */
  readonly didStatus: AirspaceDeterminationStatus;
  /** DID 判定の詳細（「非該当（工業専用地域）」「除外未確認」の区別）。地点判定由来。 */
  readonly didDetail?: DidDetail;
  /** 要確認事項（DID 未確認・25kg 以上 等）。UI／PDF に表示する。 */
  readonly verificationNotes: readonly string[];
  /** 免責文（DEFAULT_DISCLAIMER を本機能向けに拡張） */
  readonly disclaimer: string;
};

// ============================================================
// 制度データの読み込み（型検証つき）
// ============================================================

const ALL_PROCEDURE_KINDS: ReadonlySet<RequiredProcedureKind> = new Set([
  "flight_permission",
  "flight_approval",
  "drone_registration",
  "flight_plan_report",
  "flight_logbook",
  "insurance",
  "ordinance_coordination",
  "facility_consent_notice",
]);

const ALL_SYSTEMS: ReadonlySet<ProcedureSystem> = new Set([
  "DIPS 2.0",
  "DRS",
  "条例（各管理者）",
  "都道府県公安委員会",
]);

type RawProcedure = {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly title?: unknown;
  readonly system?: unknown;
  readonly systemUrl?: unknown;
  readonly legalBasis?: unknown;
  readonly sourceUrl?: unknown;
  readonly waivableByIIB?: unknown;
  readonly leadTimeBusinessDays?: unknown;
  readonly note?: unknown;
  readonly needsReverify?: unknown;
  readonly verifiedAt?: unknown;
};

// JSON の各レコードを RequiredProcedure に正規化する。
// legalBasis・sourceUrl が空のレコードはデータ不備として落とす（安全クリティカル）。
//
// 第 2 引数 datasetVerifiedAt は procedures.json の top-level 検証日。
// レコード個別に verifiedAt が無い場合はこれにフォールバックし、
// 「検証日メタが必ず入っている」契約（sprint-4）をデータ駆動で満たす。
const parseProcedure = (
  raw: RawProcedure,
  datasetVerifiedAt: string | undefined,
): RequiredProcedure | null => {
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.kind !== "string" || !ALL_PROCEDURE_KINDS.has(raw.kind as RequiredProcedureKind)) {
    return null;
  }
  if (typeof raw.title !== "string" || raw.title.length === 0) return null;
  if (typeof raw.system !== "string" || !ALL_SYSTEMS.has(raw.system as ProcedureSystem)) {
    return null;
  }
  if (typeof raw.systemUrl !== "string" || raw.systemUrl.length === 0) return null;
  // 法的根拠・出典 URL は「空でなく必ず持つ」ことが契約。欠落は不採用。
  if (typeof raw.legalBasis !== "string" || raw.legalBasis.length === 0) return null;
  if (typeof raw.sourceUrl !== "string" || raw.sourceUrl.length === 0) return null;
  const leadTime =
    typeof raw.leadTimeBusinessDays === "number" && Number.isFinite(raw.leadTimeBusinessDays)
      ? raw.leadTimeBusinessDays
      : 10;
  // 検証日メタ: レコード個別 → データセット全体 の順でフォールバック。
  const verifiedAt =
    typeof raw.verifiedAt === "string" && raw.verifiedAt.length > 0
      ? raw.verifiedAt
      : datasetVerifiedAt;
  return {
    id: raw.id,
    kind: raw.kind as RequiredProcedureKind,
    title: raw.title,
    system: raw.system as ProcedureSystem,
    systemUrl: raw.systemUrl,
    legalBasis: raw.legalBasis,
    sourceUrl: raw.sourceUrl,
    waivableByIIB: raw.waivableByIIB === true,
    leadTimeBusinessDays: leadTime,
    ...(typeof raw.note === "string" && raw.note.length > 0 ? { note: raw.note } : {}),
    ...(raw.needsReverify === true ? { needsReverify: true } : {}),
    ...(typeof verifiedAt === "string" && verifiedAt.length > 0 ? { verifiedAt } : {}),
  };
};

// 制度データ（procedures.json）の検証日。一次情報でこのデータセットを確認した日付。
// UI／PDF に「いつ時点の制度確認に基づくか」を明示するために export する（spec §8）。
export const PROCEDURES_VERIFIED_AT: string = (() => {
  const v = (proceduresData as { verifiedAt?: unknown }).verifiedAt;
  return typeof v === "string" && v.length > 0 ? v : "";
})();

// 制度データ（手続き・カテゴリーのデータと判定規則）の版の番号。procedures.json の revision。
// 同じ確認日に二度直しても申請支援の証跡 ID が版の違いを表せるよう、証跡ペイロードの d.rev に入れる
// （Sprint 11a D2）。revision が無い旧データは 1 とみなす。
export const PROCEDURES_REVISION: number = (() => {
  const v = (proceduresData as { revision?: unknown }).revision;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 1;
})();

// 起動時に 1 度だけ手続き定義を読み込み、id → RequiredProcedure の索引を作る。
const PROCEDURES: ReadonlyMap<string, RequiredProcedure> = (() => {
  const dataset = proceduresData as {
    procedures?: readonly RawProcedure[];
    verifiedAt?: unknown;
  };
  const datasetVerifiedAt =
    typeof dataset.verifiedAt === "string" && dataset.verifiedAt.length > 0
      ? dataset.verifiedAt
      : undefined;
  const raw = dataset.procedures ?? [];
  const map = new Map<string, RequiredProcedure>();
  for (const p of raw) {
    const parsed = parseProcedure(p, datasetVerifiedAt);
    if (parsed) map.set(parsed.id, parsed);
  }
  return map;
})();

// id で手続き定義を引く。未定義 id はデータ不備として例外を投げる（黙殺しない）。
const proc = (id: string): RequiredProcedure => {
  const p = PROCEDURES.get(id);
  if (!p) {
    throw new Error(`procedure 定義が見つかりません（データ不備）: ${id}`);
  }
  return p;
};

export const ALL_PROCEDURES: readonly RequiredProcedure[] = Array.from(PROCEDURES.values());

const CATEGORIES: ReadonlyMap<DiagnosisCategory, CategoryDefinition> = (() => {
  const dataset = categoriesData as {
    categories?: readonly {
      id?: unknown;
      label?: unknown;
      description?: unknown;
      sourceUrl?: unknown;
      verifiedAt?: unknown;
    }[];
    verifiedAt?: unknown;
  };
  const datasetVerifiedAt =
    typeof dataset.verifiedAt === "string" && dataset.verifiedAt.length > 0
      ? dataset.verifiedAt
      : undefined;
  const raw = dataset.categories ?? [];
  const valid: ReadonlySet<DiagnosisCategory> = new Set([
    "I",
    "needs_verification",
    "II_A",
    "II_B_eligible",
    "III_level4",
    "emergency_no_fly",
  ]);
  const map = new Map<DiagnosisCategory, CategoryDefinition>();
  for (const c of raw) {
    if (typeof c.id !== "string" || !valid.has(c.id as DiagnosisCategory)) continue;
    if (typeof c.label !== "string" || typeof c.description !== "string") continue;
    if (typeof c.sourceUrl !== "string" || c.sourceUrl.length === 0) continue;
    // 検証日メタ: レコード個別 → データセット全体 の順でフォールバック（spec §8）。
    const verifiedAt =
      typeof c.verifiedAt === "string" && c.verifiedAt.length > 0
        ? c.verifiedAt
        : datasetVerifiedAt;
    map.set(c.id as DiagnosisCategory, {
      id: c.id as DiagnosisCategory,
      label: c.label,
      description: c.description,
      sourceUrl: c.sourceUrl,
      ...(typeof verifiedAt === "string" && verifiedAt.length > 0 ? { verifiedAt } : {}),
    });
  }
  return map;
})();

export const getCategoryDefinition = (id: DiagnosisCategory): CategoryDefinition => {
  const c = CATEGORIES.get(id);
  if (!c) throw new Error(`category 定義が見つかりません（データ不備）: ${id}`);
  return c;
};

export const ALL_CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = Array.from(
  CATEGORIES.values(),
);

// ============================================================
// マッピング（spec §4）: SpecificFlightFlag → procedure id
// ============================================================

// 各 特定飛行フラグが導く手続き id。データ（PROCEDURES）と整合させる。
// このマップ自体が「判定理由 → 手続き」の構造化表現（§4 の TS 表現）。
const FLAG_TO_PROCEDURE_ID: Readonly<Record<SpecificFlightFlag, string>> = {
  airspace_airport: "flight-permission-airport",
  airspace_150m: "flight-permission-150m",
  airspace_did: "flight-permission-did",
  airspace_emergency: "flight-permission-emergency-airspace",
  method_night: "flight-approval-night",
  method_bvlos: "flight-approval-bvlos",
  method_30m: "flight-approval-30m",
  method_event: "flight-approval-event",
  method_dangerous: "flight-approval-dangerous",
  method_drop: "flight-approval-drop",
};

// 横断手続き（特定飛行に該当する場合に常に付与）。
const CROSS_CUTTING_PROCEDURE_IDS: readonly string[] = [
  "flight-plan-report",
  "flight-logbook",
];

// 航空法上の「無人航空機」に該当する重量境界（100g 以上が対象）。
export const DRONE_THRESHOLD_G = 100;

// 本機能の免責文（DEFAULT_DISCLAIMER を本機能向けに拡張）。
// 契約: 全画面に「最終確認は DIPS／航空局で」を含む免責を表示する。
export const DIAGNOSIS_DISCLAIMER =
  "本診断は補助情報であり、必要な手続きを最終的に保証するものではありません。" +
  "最終確認は必ず DIPS（飛行許可・承認）／DRS（機体登録）／航空局および各管理者で行ってください。" +
  "法令・制度は改正される場合があります。";

// ============================================================
// 導出（純関数）
// ============================================================

// 機体重量が航空法上の「無人航空機」に該当するか。
//   - 未指定（undefined）→ true（フェイルセーフ＝厳しい側。100g 以上前提で扱う）
//   - 100g 以上 → true
//   - 100g 未満 → false（航空法系の手続きは不要）
const isRegulatedDrone = (droneWeightG: number | undefined): boolean => {
  if (typeof droneWeightG !== "number" || !Number.isFinite(droneWeightG)) return true;
  return droneWeightG >= DRONE_THRESHOLD_G;
};

const AVIATION_LAW_KINDS: ReadonlySet<RequiredProcedureKind> = new Set([
  "flight_permission",
  "flight_approval",
  "drone_registration",
  "flight_plan_report",
  "flight_logbook",
]);

export type DeriveDiagnosisInput = {
  /** ユーザーが選んだ飛行方法 + 判定由来の空域フラグ（重複は許容、内部で正規化） */
  readonly flags: readonly SpecificFlightFlag[];
  /** 機体重量 (g)。未指定（undefined）はフェイルセーフで 100g 以上扱い。 */
  readonly droneWeightG?: number;
  /** 立入管理措置の有無（カテゴリー切り分け用）。 */
  readonly accessControl?: boolean;
  /** 第三者上空か（III＝レベル4 判定用）。 */
  readonly thirdPartyOverflight?: boolean;
  /** 飛行予定日（ISO 日付）。S1 では deadlines.basis に保持のみ。 */
  readonly plannedDate?: string;
  /**
   * 地点判定由来の DID 該当状況（三値）。flags に airspace_did があれば常に "applicable"。
   * 未指定は後方互換のため flags のみで判断する（API は常に指定する）。
   */
  readonly didStatus?: AirspaceDeterminationStatus;
  /** 地点判定由来の DID 判定の詳細（表示用。カテゴリーには影響しない）。 */
  readonly didDetail?: DidDetail;
  /**
   * 小型無人機等飛行禁止法の対象施設の周辺地域（red／yellow）に該当するか。
   * true のとき「施設管理者の同意＋公安委員会への事前通報」を手続きに加える（重量に関係なく）。
   */
  readonly smallDroneLawTriggered?: boolean;
  /**
   * 目視外飛行の補助者の有無。false（補助者なし）のとき、レベル3.5飛行の保険と
   * 人口集中地区の上空を経路に含める場合の安全確保措置の注記を加える（Sprint 11a C2・C3）。
   */
  readonly bvlosWithObserver?: boolean;
};

// ── 注記の出典（一次資料。画面ではリンク、PDF では URL の文字列として出す）──
/** 通達 国空無機第338898号（農薬等の空中散布の承認不要）。 */
export const PESTICIDE_NOTICE_URL = "https://www.mlit.go.jp/common/001990796.pdf";
/** 制度改正の資料（総重量25kg以上の第三者賠償責任保険・レベル3.5飛行）。 */
export const INSURANCE_SOURCE_URL = "https://www.mlit.go.jp/common/001909323.pdf";
/** 審査要領（カテゴリーⅡ飛行）最終改正 令和8年9月29日。 */
export const CATEGORY_II_REVIEW_GUIDELINE_URL = "https://www.mlit.go.jp/koku/content/001866503.pdf";

const PESTICIDE_NOTE =
  "農薬等の空中散布で、通達（国空無機第338898号）の要件（第一種または第二種の機体認証、機体の種類に限定した一等または二等の技能証明、農地・森林の区域内で作物の上端等から 4m 以下、催し場所の上空以外 など）を満たす場合は、夜間・目視外・30m 未満・危険物輸送・物件投下の承認は不要です。人口集中地区の上空は、通達の要件に加えて、別に航空法第132条の85 の規定に従う必要があります（通達 4.）。飛行計画の通報と飛行日誌は引き続き必要です。" +
  `（出典: ${PESTICIDE_NOTICE_URL} ）`;
const LEVEL35_INSURANCE_NOTE =
  "補助者を配置しない目視外飛行で、立入管理措置をレベル3.5飛行（機上のカメラによる確認）で行う場合は、機体の重量にかかわらず第三者賠償責任保険への加入が必要です。" +
  `（出典: ${INSURANCE_SOURCE_URL} ）`;
const BVLOS_DID_NOTE =
  "補助者を配置しない目視外飛行で、やむを得ず人口集中地区の上空を飛行経路に含める場合は、第三者及び物件への危害を防ぐための十分な安全確保措置が求められます（審査要領（カテゴリーⅡ飛行）5-4(3)c)ア。令和8年9月29日の改正で取扱いが明確化）。" +
  `（出典: ${CATEGORY_II_REVIEW_GUIDELINE_URL} ）`;
/**
 * 緊急用務空域の診断で横断手続きに添える注記。原則飛行禁止の説明はカテゴリーの説明（categories.json）に
 * 一度だけ書き、ここでは繰り返さない（Sprint 11a 仕上げ）。確認待ちの事項ではないため、
 * 画面・PDF では「要確認」の見出しを付けない（verificationNoteLabel）。
 */
export const EMERGENCY_NO_FLY_NOTE =
  "下の機体登録・飛行計画の通報・飛行日誌などの手続きは、緊急用務空域の指定が解除された後に飛行する場合に必要になるものです（飛行しないなら不要です）。";

/** 注記の見出し。緊急用務空域の注記は事実の言い切りなので「要確認」を付けない。 */
export const verificationNoteLabel = (note: string): string =>
  note === EMERGENCY_NO_FLY_NOTE ? "※ " : "※ 要確認: ";

const isHeavyDrone = (droneWeightG: number | undefined): boolean =>
  typeof droneWeightG === "number" &&
  Number.isFinite(droneWeightG) &&
  droneWeightG >= HEAVY_DRONE_THRESHOLD_G;

const resolveDidStatus = (
  flags: readonly SpecificFlightFlag[],
  didStatus: AirspaceDeterminationStatus | undefined,
): AirspaceDeterminationStatus => {
  if (flags.includes("airspace_did")) return "applicable";
  if (didStatus === "unverified") return "unverified";
  return "not_applicable";
};

// 重複・未知値を除いた特定飛行フラグの正規化（順序は SPECIFIC_FLIGHT_FLAG_LABEL に従う）。
const normalizeFlags = (
  flags: readonly SpecificFlightFlag[],
): readonly SpecificFlightFlag[] => {
  const valid = new Set<SpecificFlightFlag>(
    Object.keys(SPECIFIC_FLIGHT_FLAG_LABEL) as SpecificFlightFlag[],
  );
  const seen = new Set<SpecificFlightFlag>();
  for (const f of flags) {
    if (valid.has(f)) seen.add(f);
  }
  return (Object.keys(SPECIFIC_FLIGHT_FLAG_LABEL) as SpecificFlightFlag[]).filter((f) =>
    seen.has(f),
  );
};

// カテゴリー切り分け（spec §3.3）:
//   - 特定飛行に非該当 → I
//   - 第三者上空（立入管理措置なし）→ III＝レベル4
//   - 該当する特定飛行が「すべて IIB で不要化可能」かつ重量規制対象 → IIB 相当
//   - それ以外（IIB 不可の区分を含む）→ IIA 相当
//   - 25kg 以上は IIB 不要化の対象外 → IIA 相当（許可・承認が必要）
//   - 特定飛行フラグなし かつ DID 未確認 → needs_verification（申請不要とは断定しない）
const classifyCategory = (
  flags: readonly SpecificFlightFlag[],
  isRegulated: boolean,
  input: DeriveDiagnosisInput,
  didStatus: AirspaceDeterminationStatus,
): DiagnosisCategory => {
  // 緊急用務空域は原則飛行禁止で、他の許可があっても飛べない。第三者上空・25kg 以上・IIB の可否より先に、
  // 機体の重量にかかわらず（100g 未満を含む。教則 第5版）判定する（Sprint 11a C4）。
  if (flags.includes("airspace_emergency")) return "emergency_no_fly";
  if (flags.length === 0) {
    return isRegulated && didStatus === "unverified" ? "needs_verification" : "I";
  }
  // 第三者上空 / 立入管理措置なしを明示選択 → III（レベル4）。
  if (input.thirdPartyOverflight === true || input.accessControl === false) {
    return "III_level4";
  }
  if (!isRegulated) return "I"; // 100g 未満は航空法上の特定飛行に該当しない
  // 総重量 25kg 以上は IIB（申請不要化）の対象外。個別に許可・承認が必要。
  if (isHeavyDrone(input.droneWeightG)) return "II_A";
  // 該当フラグの手続きがすべて IIB で不要化可能なら IIB 相当。
  const allWaivable = flags.every((f) => {
    const id = FLAG_TO_PROCEDURE_ID[f];
    return proc(id).waivableByIIB;
  });
  return allWaivable ? "II_B_eligible" : "II_A";
};

// spec §4 のマッピングを実装した導出純関数。
// 入力: 空域フラグ＋飛行方法フラグ＋機体重量
// 出力: ApplicationDiagnosis（必要手続き配列・カテゴリー・横断手続きを含む）
export const deriveDiagnosis = (input: DeriveDiagnosisInput): ApplicationDiagnosis => {
  const flags = normalizeFlags(input.flags);
  const isRegulated = isRegulatedDrone(input.droneWeightG);

  const procedures: RequiredProcedure[] = [];
  const pushUnique = (p: RequiredProcedure): void => {
    if (!procedures.some((x) => x.id === p.id)) procedures.push(p);
  };

  // 特定飛行に該当するか = 重量規制対象 かつ フラグが 1 件以上。
  // 100g 未満は航空法上の無人航空機に非該当なので、特定飛行も成立しない。
  const isSpecificFlight = isRegulated && flags.length > 0;

  if (isRegulated) {
    // 各フラグ → 対応する飛行許可／承認手続き。
    for (const f of flags) {
      pushUnique(proc(FLAG_TO_PROCEDURE_ID[f]));
    }
    // 機体登録（DRS）＋リモートID は 100g 以上で常に必要。
    pushUnique(proc("drone-registration"));
    // 特定飛行に該当するなら横断手続き（飛行計画通報・飛行日誌）を常に付与。
    if (isSpecificFlight) {
      for (const id of CROSS_CUTTING_PROCEDURE_IDS) pushUnique(proc(id));
    }
  }
  // 緊急用務空域の指定の確認は 100g 未満の機体も対象（教則 第5版）。申請する手続きではない（期限 0）。
  if (flags.includes("airspace_emergency")) {
    pushUnique(proc(FLAG_TO_PROCEDURE_ID.airspace_emergency));
  }
  // 小型無人機等飛行禁止法は航空法と別系統で、100g 未満の機体も対象（重量で除外しない）。
  if (input.smallDroneLawTriggered === true) {
    pushUnique(proc(SMALL_DRONE_LAW_PROCEDURE_ID));
  }

  const didStatus = resolveDidStatus(flags, input.didStatus);
  const category = classifyCategory(flags, isRegulated, input, didStatus);
  const heavy = isRegulated && isHeavyDrone(input.droneWeightG);

  // 25kg 以上で許可・承認申請が必要（または要確認）な場合は第三者賠償責任保険が必須
  // （令和7年10月1日以降の新規申請。制度改正の資料 001909323.pdf）。emergency_no_fly は飛行しないため付けない。
  if (
    heavy &&
    (category === "II_A" || category === "III_level4" || category === "needs_verification")
  ) {
    pushUnique(proc("insurance-third-party-25kg"));
  }

  const verificationNotes: string[] = [];
  if (isRegulated && didStatus === "unverified") {
    verificationNotes.push(
      "DID（人口集中地区）の該当／非該当を確認できていません（未確認）。地理院地図・DIPS で DID 該当を確認するまで「申請不要」とは判断できません（要確認）。",
    );
  }
  if (heavy) {
    verificationNotes.push(
      "総重量 25kg 以上のため、カテゴリー II でも IIB による申請不要化はできません。新規の飛行許可・承認申請では第三者賠償責任保険への加入が必要です（令和7年10月1日以降）。",
    );
  }

  if (category === "emergency_no_fly") {
    verificationNotes.push(EMERGENCY_NO_FLY_NOTE);
  }
  if (isRegulated && (flags.includes("method_drop") || flags.includes("method_dangerous"))) {
    verificationNotes.push(PESTICIDE_NOTE);
  }
  if (isRegulated && flags.includes("method_bvlos") && input.bvlosWithObserver === false) {
    verificationNotes.push(LEVEL35_INSURANCE_NOTE);
    if (didStatus === "applicable") verificationNotes.push(BVLOS_DID_NOTE);
  }

  // deadlines: 提出期限の逆算（S2 期限カレンダー）。
  //   - 飛行予定日が入力されていれば「飛行日 − leadTime 開庁日（土日祝除く）」で
  //     具体的な提出期限日（submitBy）を算出する。
  //   - 未入力なら submitBy は未確定（UI 側で「飛行予定日を入力してください」と促す）。
  // leadTime 0 の手続き（登録・通報・日誌）は提出期限の逆算対象外なので除外する。
  const planned = input.plannedDate;
  const deadlines = procedures
    .filter((p) => p.leadTimeBusinessDays > 0)
    .map((p) => {
      const submitBy =
        planned !== undefined
          ? (subtractBusinessDays(planned, p.leadTimeBusinessDays) ?? undefined)
          : undefined;
      return {
        procedureId: p.id,
        ...(submitBy !== undefined ? { submitBy } : {}),
        basis:
          planned !== undefined && submitBy !== undefined
            ? `飛行予定日（${planned}）の ${p.leadTimeBusinessDays} 開庁日以上前までに提出（土日・国民の祝日を除く）。提出期限の目安は ${submitBy}。`
            : planned !== undefined
              ? `飛行予定日（${planned}）の ${p.leadTimeBusinessDays} 開庁日以上前までに提出（土日・国民の祝日を除く）。`
              : `飛行開始の ${p.leadTimeBusinessDays} 開庁日以上前までに提出（土日・国民の祝日を除く。飛行予定日を入力すると具体的な期限日を算出します）。`,
      };
    });

  return {
    category,
    categoryNote: getCategoryDefinition(category).description,
    procedures,
    deadlines,
    isSpecificFlight,
    didStatus,
    ...(input.didDetail !== undefined ? { didDetail: input.didDetail } : {}),
    verificationNotes,
    disclaimer: DIAGNOSIS_DISCLAIMER,
  };
};

/** 飛行禁止法の手続き（施設管理者の同意＋公安委員会への事前通報）の id。 */
export const SMALL_DRONE_LAW_PROCEDURE_ID = "small-drone-law-consent-notice";

/**
 * 判定由来の空域フラグとユーザー指定（プリセットの curated 値を含む）の空域フラグを合流する。
 * エンジンの DID 判定が「該当」「非該当」のときは、ユーザー指定の airspace_did を採用しない
 * （curated フラグはエンジンが「未確認」のときの補完に限る。Sprint 7）。
 */
export const mergeAirspaceFlags = (params: {
  readonly derivedFlags: readonly SpecificFlightFlag[];
  readonly userFlags: readonly SpecificFlightFlag[];
  readonly autoDidStatus: AirspaceDeterminationStatus;
}): readonly SpecificFlightFlag[] => {
  const user =
    params.autoDidStatus === "unverified"
      ? params.userFlags
      : params.userFlags.filter((f) => f !== "airspace_did");
  return Array.from(new Set<SpecificFlightFlag>([...params.derivedFlags, ...user]));
};

/** 地点判定の DID 規制から判定の詳細を取り出す（無ければ undefined）。 */
export const deriveDidDetailFromRegulations = (
  regulations: readonly { readonly id: string; readonly didDetail?: DidDetail }[],
): DidDetail | undefined => regulations.find((r) => r.id === "aviation-law-did")?.didDetail;

/**
 * DID 三値の表示文言。非該当のうち工業専用地域による除外は「非該当（工業専用地域）」と区別する。
 * 該当のうち除外未確認は「該当（工業専用地域の除外：未確認）」と示す。
 */
export const formatDidDetermination = (
  status: AirspaceDeterminationStatus,
  detail?: DidDetail,
): string => {
  if (status === "not_applicable" && detail === "industrial_exclusive") {
    return "非該当（工業専用地域）";
  }
  if (status === "applicable" && detail === "in_did_exclusion_unverified") {
    return "該当（工業専用地域の除外：未確認）";
  }
  return AIRSPACE_DETERMINATION_LABEL[status];
};

// 既存 RegulationCheckResult の空域フラグ（DID・空港）から SpecificFlightFlag を抽出する。
// 信号機判定の理由を起点に手続きを自動導出する（spec §2.1）ための橋渡し。
//   - aviation-law-did が red → airspace_did
//   - aviation-law-airport が red → airspace_airport
//   - miho-airbase-no-fly は小型無人機等飛行禁止法であり航空法の特定飛行ではないため
//     ここでは flag 化しない（別系統。手続きは別途案内）。
export const extractAirspaceFlagsFromRegulations = (
  regulations: readonly { readonly id: string; readonly status: string }[],
): readonly SpecificFlightFlag[] => {
  const flags: SpecificFlightFlag[] = [];
  for (const r of regulations) {
    if (r.status !== "red") continue;
    if (r.id === "aviation-law-did") flags.push("airspace_did");
    if (r.id === "aviation-law-airport") flags.push("airspace_airport");
  }
  return flags;
};

// 地点判定の DID 規制（aviation-law-did）の status を三値に写像する。
//   red → 該当 / green → 非該当 / yellow・unknown・レコード欠落 → 未確認
export const deriveDidStatusFromRegulations = (
  regulations: readonly { readonly id: string; readonly status: string }[],
): AirspaceDeterminationStatus => {
  const did = regulations.find((r) => r.id === "aviation-law-did");
  if (!did) return "unverified";
  if (did.status === "red") return "applicable";
  if (did.status === "green") return "not_applicable";
  return "unverified";
};

export const REQUIRED_PROCEDURE_KIND_LABEL: Readonly<
  Record<RequiredProcedureKind, string>
> = {
  flight_permission: "飛行許可",
  flight_approval: "飛行承認",
  drone_registration: "機体登録",
  flight_plan_report: "飛行計画通報",
  flight_logbook: "飛行日誌",
  insurance: "保険",
  ordinance_coordination: "条例協議",
  facility_consent_notice: "同意・事前通報",
};

export type DiagnosisEvidencePayloadInput = {
  readonly engineVersion: string;
  readonly lat: number;
  readonly lng: number;
  readonly checkedAt: string;
  readonly regulationIds: readonly string[];
  readonly droneWeightG?: number;
  readonly flags: readonly SpecificFlightFlag[];
  readonly plannedDate?: string;
  readonly accessControl?: boolean;
  readonly thirdPartyOverflight?: boolean;
  readonly bvlosWithObserver?: boolean;
  readonly category: DiagnosisCategory;
  readonly procedureIds: readonly string[];
  /** DID 該当状況（三値）。未指定は null として正規化。 */
  readonly didStatus?: AirspaceDeterminationStatus;
  /** 判定に使ったデータセット（ID と確認日）。データ更新で証跡 ID が変わる。 */
  readonly datasets?: readonly { readonly id: string; readonly verifiedAt: string }[];
};

/**
 * 申請支援診断の証跡（evidenceId）採番用に、入力・導出結果を決定論的な JSON 文字列に正規化する。
 * キー順・配列順（flags / regulationIds / procedureIds のソート）を固定し、
 * 同一の診断条件・同一時刻であれば常に同一のペイロード文字列を返す（spec §6.3）。
 */
export const buildDiagnosisEvidencePayload = (
  input: DiagnosisEvidencePayloadInput,
): string => {
  const sortedRegulations = [...input.regulationIds].sort();
  const sortedFlags = [...new Set(input.flags)].sort();
  const sortedProcedures = [...input.procedureIds].sort();
  return JSON.stringify({
    v: input.engineVersion,
    lat: Number(input.lat.toFixed(6)),
    lng: Number(input.lng.toFixed(6)),
    t: input.checkedAt,
    r: sortedRegulations,
    w: typeof input.droneWeightG === "number" ? input.droneWeightG : null,
    d: {
      f: sortedFlags,
      pd: input.plannedDate ?? null,
      ac: typeof input.accessControl === "boolean" ? input.accessControl : null,
      tp: typeof input.thirdPartyOverflight === "boolean" ? input.thirdPartyOverflight : null,
      bv: typeof input.bvlosWithObserver === "boolean" ? input.bvlosWithObserver : null,
      cat: input.category,
      p: sortedProcedures,
      did: input.didStatus ?? null,
      ver: PROCEDURES_VERIFIED_AT || null,
      rev: PROCEDURES_REVISION,
    },
    ds: normalizeDatasetKeys(input.datasets ?? []),
  });
};

