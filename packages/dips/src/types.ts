// 通報ゲートウェイの型（Sprint 12b 設計 B）。このパッケージは DB・Next.js・@soraban/regulations に依存しない
// （判定の結果は、必要な部分だけを PlanForReport に写して受け取る）。

/** 通報の種別。 */
export type ReportKind = "new" | "change" | "cancel";
export const REPORT_KINDS: readonly ReportKind[] = ["new", "change", "cancel"];

/** 送信元。api は 12b では使わない（API アダプターは作らない）が、データの形には含める。 */
export type ReportChannel = "manual" | "mock" | "api";
export const REPORT_CHANNELS: readonly ReportChannel[] = ["manual", "mock", "api"];

/** 保存する状態。copied は保存せず監査に残す。cancelled は状態でなく、種別 cancel の別の行で表す。 */
export type ReportState = "prepared" | "reported_manual" | "submitted_api" | "failed" | "unknown" | "retracted";
export const REPORT_STATES: readonly ReportState[] = [
  "prepared",
  "reported_manual",
  "submitted_api",
  "failed",
  "unknown",
  "retracted",
];

/** 通報の要否（@soraban/regulations の ReportRequirementKind と同じ値。依存しないため再掲する）。 */
export type RequirementKind = "confirm" | "not_applicable_model" | "required" | "recommended";

/** 手続きの「済み」の記録の種類。 */
export type ProcedureRecordKind = "dips_permit" | "small_drone_law";
export const PROCEDURE_RECORD_KINDS: readonly ProcedureRecordKind[] = ["dips_permit", "small_drone_law"];

/** 通報の画面で入力する項目（DIPS の入力項目のうち、そらばんが計画に持たないもの）。未入力は undefined か null。 */
export type ReportInputs = {
  /** 通報用の名称（計画名が 30 文字を超えるときに使う）。 */
  readonly reportName?: string | null;
  /** 飛行目的のコード（1〜16）。 */
  readonly flightPurposes?: readonly number[] | null;
  readonly otherBusinessText?: string | null;
  readonly otherNonBusinessText?: string | null;
  readonly assistantsNumber?: number | null;
  readonly departurePoint?: string | null;
  readonly destinationPoint?: string | null;
  /** 航続可能時間（分）。 */
  readonly plannedMaxTime?: number | null;
  /** 飛行速度（km/h）。 */
  readonly flightSpeed?: number | null;
  /** "1"（講じる・行う）／"0"。 */
  readonly onsiteControlL3?: "1" | "0" | null;
  readonly onsiteControlL35?: "1" | "0" | null;
  readonly onsiteControl2?: "1" | "0" | null;
  readonly mooring?: "1" | "0" | null;
};

/** 通報内容の整形に使う計画・機体・操縦者・スナップショットの値（サービス層が DB から作る）。 */
export type PlanForReport = {
  readonly planId: string;
  readonly title: string;
  /** 予定開始（JST の分。`YYYY-MM-DDTHH:MM`）。 */
  readonly startAt: string;
  readonly durationMinutes: number;
  readonly placeName: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusM: number | null;
  readonly maxAltitudeM: number | null;
  /** 立入管理措置（計画の accessControl）。 */
  readonly accessControl: boolean | null;
  readonly permitNumbers: string | null;
  /**
   * 計画の許可番号に結びつき、範囲に収まって適用された許可・承認の登録（ちょうど 1 件のときだけ。Sprint 12d）。
   * 許可書発行日・許可期間（FPR No.76〜78）の元。無い・複数のときは null で、DIPS で入力する。登録は利用者の申告。
   */
  readonly permitRegistration?: {
    readonly permitNumber: string;
    readonly issuedOn: string;
    readonly validFrom: string;
    readonly validTo: string;
  } | null;
  readonly aircraftId: string;
  readonly aircraft: {
    readonly registrationMark: string;
    readonly modelName: string;
    readonly manufacturer: string;
    readonly airworthinessClass: "first" | "second" | null;
    readonly airworthinessCertNumber: string | null;
    readonly maxTakeoffWeightKg: number | null;
  };
  readonly pilotId: string;
  readonly pilot: {
    readonly fullName: string;
    readonly licenseClass: "first" | "second" | null;
    /** 閲覧者には伏せ字（licenseNumberMasked が真）。全桁は運航管理者と本人だけ。 */
    readonly licenseNumber: string | null;
    readonly licenseNumberMasked: boolean;
  };
  readonly snapshot: {
    readonly id: string;
    readonly checkEvidenceId: string;
    readonly diagnosisEvidenceId: string;
    /** 判定の結果の最終の flags（DID・空港の導出を含む）。 */
    readonly flags: readonly string[];
    /** 現在のスナップショットの手続きのうち、許可・承認に当たる procedureId（flight-permission-*・flight-approval-*）。 */
    readonly permitProcedureIds: readonly string[];
  };
  readonly inputs: ReportInputs;
};

/** 整形した項目 1 つ。 */
export type PreparedItemStatus =
  | "filled"
  /** 必須だが入力がない（DIPS で入力）。 */
  | "missing"
  /** そらばんが持たない。DIPS で入力する。 */
  | "dips_only"
  /** 条件に当たらない（例：その他1の理由で 13 を選んでいない）。 */
  | "not_applicable"
  /** 経路（コピー対象でない。座標を表示する）。 */
  | "route";

export type PrepareWarning = { readonly code: string; readonly message: string };

export type PreparedItem = {
  readonly key: string;
  readonly apiNo: number;
  readonly apiField: string | null;
  readonly label: string;
  readonly dipsScreenLabel: string | null;
  readonly order: number;
  readonly group: string;
  readonly source: string;
  readonly status: PreparedItemStatus;
  /** 人が読む値。未入力は null。 */
  readonly value: string | null;
  /** API 形式の値（文字列で表す。配列は JSON、経路は GeoJSON の文字列）。未入力は null。 */
  readonly apiValue: string | null;
  /** コピーする文字列。コピーできない項目（経路・dips_only・未入力・伏せ字）は null。 */
  readonly copyText: string | null;
  readonly copyable: boolean;
  readonly personal: boolean;
  /** 単位（例：分・m）。値には含めない。 */
  readonly unit: string | null;
  /** 入力がない。 */
  readonly missing: boolean;
  /** 必須の入力か（未入力の必須項目の件数に数える）。 */
  readonly required: boolean;
  readonly requirementRef: string | null;
  readonly screenStatus: string;
  readonly warnings: readonly PrepareWarning[];
};

export type PreparedGroup = {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  /** この組に、画面での確認がまだの行（screenStatus が unconfirmed）が含まれる → 「※要確認」を出す。 */
  readonly needsConfirmation: boolean;
  readonly itemKeys: readonly string[];
};

export type FingerprintParts = {
  readonly startAt: string;
  readonly durationMinutes: number;
  readonly lat: number;
  readonly lng: number;
  readonly radiusM: number | null;
  readonly maxAltitudeM: number | null;
  readonly aircraftId: string;
  readonly pilotId: string;
  readonly flags: readonly string[];
};

export type PreparedReport = {
  readonly kind: ReportKind;
  readonly planId: string;
  readonly mapRevision: number;
  readonly mapVerifiedAt: string;
  readonly items: readonly PreparedItem[];
  readonly groups: readonly PreparedGroup[];
  /** 全体の警告（項目の警告のうち、全体に関わるもの）。 */
  readonly warnings: readonly PrepareWarning[];
  /** 未入力の必須項目の件数（そらばんが持たず DIPS で入力する項目は数えない）。 */
  readonly missingRequiredCount: number;
  readonly fingerprint: string;
  readonly fingerprintParts: FingerprintParts;
  readonly snapshot: PlanForReport["snapshot"];
  /** 記録（content）に写す入力。 */
  readonly inputs: ReportInputs;
};

/** 利用者が DIPS で通報した結果（手動アダプター）。 */
export type ManualResult = {
  /** 通報日時（JST の分。`YYYY-MM-DDTHH:MM`）。 */
  readonly reportedAt: string;
  readonly dipsNumber?: string | null;
  /** 「番号が表示されなかった」の宣言。 */
  readonly numberUnavailable?: boolean;
  readonly memo?: string | null;
  readonly confirmedDipsDone: boolean;
  readonly confirmedMatchesLatest: boolean;
};

export type ActorRef = { readonly memberId: string; readonly displayName: string; readonly role: string };

export type MockScenario = "ok" | "rejected" | "unauthorized" | "server_error" | "timeout" | "unknown_status";
export const MOCK_SCENARIOS: readonly MockScenario[] = [
  "ok",
  "rejected",
  "unauthorized",
  "server_error",
  "timeout",
  "unknown_status",
];

export type SubmitContext = {
  readonly idempotencyKey: string;
  readonly actor: ActorRef;
  readonly now: Date;
  /** 手動：利用者が DIPS で通報した結果。 */
  readonly manualResult?: ManualResult;
  /** 模擬：結果の指定（テスト・E2E）。 */
  readonly mockScenario?: MockScenario;
};

/** 取消の文脈。prepared は取消の通報内容（根拠の付与に使う。手動の記録に必要）。 */
export type CancelContext = SubmitContext & { readonly reason?: string; readonly prepared?: PreparedReport };

export type ReportRef = { readonly reportId: string; readonly dipsNumber: string | null };

/** DIPS が返す状況の生の値。状態は増やさず、そのまま保存して「状況：不明（生の値）」と表示する。 */
export type ExternalStatus = { readonly raw: string; readonly fetchedAt: string };

/** FPR の応答と同じ形（模擬が入れる。API 接続時は応答の要約を入れる）。 */
export type ExternalRef = Readonly<Record<string, unknown>>;

/** 記録の根拠（どのアダプターでも結果に付く）。 */
export type ResultTrace = {
  readonly channel: ReportChannel;
  readonly snapshotId: string;
  readonly checkEvidenceId: string;
  readonly diagnosisEvidenceId: string;
  readonly fingerprint: string;
  readonly mapRevision: number;
};

export type SubmitResult = {
  /** 遷移表の許す状態：reported_manual／submitted_api／failed／unknown。 */
  readonly state: "reported_manual" | "submitted_api" | "failed" | "unknown";
  readonly reportedAt: string | null;
  readonly dipsNumber: string | null;
  readonly numberUnavailable: boolean;
  readonly memo: string | null;
  readonly confirmedDipsDone: boolean;
  readonly confirmedMatchesLatest: boolean;
  readonly errorKind: string | null;
  readonly httpStatus: number | null;
  /** 利用者に見せる文言（失敗・結果不明のとき）。 */
  readonly message: string | null;
  readonly externalRef: ExternalRef | null;
  readonly externalStatus: ExternalStatus | null;
  /** 同じ冪等性キーの結果を再び返したか（模擬）。 */
  readonly replayed: boolean;
  readonly trace: ResultTrace;
};

export type Unsupported = { readonly supported: false; readonly message: string };

export type StatusResult = {
  readonly supported: true;
  readonly externalStatus: ExternalStatus;
};

export type CancelResult =
  /** 取消を記録できる（手動：利用者が DIPS で取り消した結果）。 */
  | { readonly mode: "recorded"; readonly result: SubmitResult }
  /** このアダプターは取消を送れない。手動の記録に倒す。 */
  | { readonly mode: "manual_record_required"; readonly message: string };

export type GatewayCapabilities = {
  readonly mode: "user_reported" | "direct";
  readonly canStatus: boolean;
  readonly canChange: boolean;
  readonly canCancel: boolean;
};
