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
  | "ordinance_coordination";

export type ProcedureSystem = "DIPS2.0" | "DRS" | "条例（各管理者）";

export type RequiredProcedure = {
  readonly id: string;
  readonly kind: RequiredProcedureKind;
  /** 例: "飛行許可（DID上空）" */
  readonly title: string;
  readonly system: ProcedureSystem;
  /** DRS と DIPS2.0 を別 URL で持つ（別導線で案内するため） */
  readonly systemUrl: string;
  /** 例: "航空法 第132条の85 第1項第3号" */
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
export type DiagnosisCategory = "I" | "II_A" | "II_B_eligible" | "III_level4";

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
]);

const ALL_SYSTEMS: ReadonlySet<ProcedureSystem> = new Set([
  "DIPS2.0",
  "DRS",
  "条例（各管理者）",
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
  const valid: ReadonlySet<DiagnosisCategory> = new Set(["I", "II_A", "II_B_eligible", "III_level4"]);
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
const classifyCategory = (
  flags: readonly SpecificFlightFlag[],
  isRegulated: boolean,
  input: DeriveDiagnosisInput,
): DiagnosisCategory => {
  if (flags.length === 0) return "I";
  // 第三者上空 / 立入管理措置なしを明示選択 → III（レベル4）。
  if (input.thirdPartyOverflight === true || input.accessControl === false) {
    return "III_level4";
  }
  if (!isRegulated) return "I"; // 100g 未満は航空法上の特定飛行に該当しない
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

  const category = classifyCategory(flags, isRegulated, input);

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
    disclaimer: DIAGNOSIS_DISCLAIMER,
  };
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
};
