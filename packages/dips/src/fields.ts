// 通報内容の項目の対応表（データ）の読み込み（Sprint 12b 設計 B）。
// データは data/report-fields.json（procedures.json と同じ流儀：revision・verifiedAt・出典つき）。
// 画面の入力順の表示と、将来の API の入力項目の両方が同じ表を使う。項目の追加・変更はデータの更新で済み、型・画面は変えない。
import fieldsJson from "../data/report-fields.json";

export type FieldSource = "plan" | "aircraft" | "pilot" | "snapshot" | "report_input" | "dips_only" | "api_only";
export const FIELD_SOURCES: readonly FieldSource[] = [
  "plan",
  "aircraft",
  "pilot",
  "snapshot",
  "report_input",
  "dips_only",
  "api_only",
];

export type ApiRequired = "required" | "conditional" | "optional";
export type ApiType = "object" | "string" | "number" | "array_number" | "array" | "geojson_string" | "none";

export type FieldRange = {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly integer?: boolean;
  readonly maxChars?: number;
};

export type ReportField = {
  /** 原本（FPR ガイドライン 1.10 版 p46〜52）の項番。 */
  readonly apiNo: number;
  readonly key: string;
  /** 原本のパラメータ名。原本に名前がない行は null。 */
  readonly apiField: string | null;
  readonly label: string;
  /** DIPS の画面の項目名。未確認は null（U4）。 */
  readonly dipsScreenLabel: string | null;
  readonly order: number;
  readonly group: string;
  readonly source: FieldSource;
  readonly apiType: ApiType;
  readonly apiRequired: ApiRequired;
  readonly range: FieldRange | null;
  readonly unit: string | null;
  readonly format: string | null;
  readonly codes: Readonly<Record<string, string>> | null;
  /** 個人情報（技能証明書番号・氏名）。通報の記録の写しには入れない。 */
  readonly personal: boolean;
  readonly copyable: boolean;
  readonly apiStatus: string;
  /** DIPS の通報画面での照合の状態。unconfirmed の行を含むまとまりに「※要確認」を出す。 */
  readonly screenStatus: "confirmed" | "unconfirmed";
  /** 通報要領 4(3) の a〜n との対応。未確認は null（U3）。 */
  readonly requirementRef: string | null;
  readonly note: string | null;
};

export type ReportFieldGroup = { readonly id: string; readonly label: string; readonly order: number };

export type ReportFieldsData = {
  readonly revision: number;
  readonly verifiedAt: string;
  readonly source: { readonly title: string; readonly pages: string; readonly note: string };
  readonly numberPolicy: "number_or_declared_unavailable" | "required_number";
  readonly routeFormat: {
    /** 円の半径の置き場所。既定は properties（リクエストのサンプルに合わせる）。 */
    readonly circleRadiusPlacement: "properties" | "geometry" | "both";
    readonly note: string;
    /** 多角形の環の閉じ方。既定は open。closed は検証環境で受理を確かめるまで使わない。 */
    readonly polygonRing: "open" | "closed";
    readonly polygonRingNote: string;
    /** 範囲が 2 つ以上のときの扱い。single_only（既定）は通報の準備を止める。first_only は設けない。 */
    readonly multiArea: "single_only";
    readonly multiAreaNote: string;
    readonly coordinateNote: string;
  };
  readonly groups: readonly ReportFieldGroup[];
  readonly fields: readonly ReportField[];
};

/** 同梱の対応表。 */
export const REPORT_FIELDS: ReportFieldsData = fieldsJson as unknown as ReportFieldsData;

/** 表の順（order）に並べた行。 */
export const sortedFields = (data: ReportFieldsData = REPORT_FIELDS): readonly ReportField[] =>
  [...data.fields].sort((a, b) => a.order - b.order);

/** 画面に出す行（api_only は出さない）。 */
export const displayFields = (data: ReportFieldsData = REPORT_FIELDS): readonly ReportField[] =>
  sortedFields(data).filter((f) => f.source !== "api_only");

/** key → 行。 */
export const fieldByKey = (key: string, data: ReportFieldsData = REPORT_FIELDS): ReportField | undefined =>
  data.fields.find((f) => f.key === key);

/** 画面の確認が済んでいない行（unconfirmed）を含むまとまりの id。「※要確認」を出す。データから求める。 */
export const groupsNeedingConfirmation = (data: ReportFieldsData = REPORT_FIELDS): ReadonlySet<string> =>
  new Set(displayFields(data).filter((f) => f.screenStatus === "unconfirmed").map((f) => f.group));

/** 番号の扱い（データで持つ）。 */
export type NumberPolicy = ReportFieldsData["numberPolicy"];
