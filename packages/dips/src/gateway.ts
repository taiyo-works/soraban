// 通報ゲートウェイ（ポート。Sprint 12b 設計 B）。通報の送信を 1 つの抽象の裏に置く。
// 画面とデータモデルは、アダプターが手動でも模擬でも（将来の API でも）同じ。画面は capabilities().mode だけで分岐する：
//   user_reported なら「コピー → 記録」、direct なら「送信内容の確認 → 送信」。
import type {
  CancelContext,
  CancelResult,
  GatewayCapabilities,
  PlanForReport,
  PreparedReport,
  ReportChannel,
  ReportKind,
  ReportRef,
  ResultTrace,
  StatusResult,
  SubmitContext,
  SubmitResult,
  Unsupported,
} from "./types";

export interface NotificationGateway {
  readonly adapter: ReportChannel;
  capabilities(): GatewayCapabilities;
  /** 副作用なし。どのアダプターでも同じ結果（対応表を使う）。 */
  prepare(input: PlanForReport, kind: ReportKind): PreparedReport;
  /** manual：manualResult を検査して reported_manual の結果を返す（外部には何も送らない）。mock：シナリオに応じた結果を返す。 */
  submit(prepared: PreparedReport, ctx: SubmitContext): Promise<SubmitResult>;
  /** manual・mock：Unsupported（DIPS 側の状態は取得できない）。 */
  status(ref: ReportRef): Promise<StatusResult | Unsupported>;
  /** canCancel が偽なら、手動の記録に倒す（mode: manual_record_required）。 */
  cancel(ref: ReportRef, ctx: CancelContext): Promise<CancelResult>;
}

/** 入力の誤り（手動の記録の検査など）。API は 400 invalid_input にする。 */
export class GatewayInputError extends Error {
  override readonly name = "GatewayInputError";
  constructor(
    readonly fieldErrors: Readonly<Record<string, string>>,
    readonly fieldCodes: Readonly<Record<string, string>>,
  ) {
    super("invalid input");
  }
}

/** 記録の根拠（どのアダプターの結果にも付ける）。 */
export const traceOf = (prepared: PreparedReport, channel: ReportChannel): ResultTrace => ({
  channel,
  snapshotId: prepared.snapshot.id,
  checkEvidenceId: prepared.snapshot.checkEvidenceId,
  diagnosisEvidenceId: prepared.snapshot.diagnosisEvidenceId,
  fingerprint: prepared.fingerprint,
  mapRevision: prepared.mapRevision,
});

export const UNSUPPORTED_STATUS: Unsupported = {
  supported: false,
  message: "DIPS 側の状態は取得できません。記録は利用者の申告です。",
};
