// 手動アダプター（既定。Sprint 12b 設計 B）。mode = user_reported。外部には何も送らない。
// submit は、利用者が DIPS で通報した結果（manualResult：通報日時・番号または番号なしの宣言・二つの確認）を検査して、
// reported_manual の結果を返す。取消も、利用者が DIPS で取り消した結果を記録する。
import { REPORT_FIELDS, type ReportFieldsData } from "../fields";
import { assertSubmittable, GatewayInputError, traceOf, UNSUPPORTED_STATUS, type NotificationGateway } from "../gateway";
import { prepareReport } from "../prepare";
import type {
  CancelContext,
  CancelResult,
  GatewayCapabilities,
  PlanForReport,
  PreparedReport,
  ReportKind,
  ReportRef,
  StatusResult,
  SubmitContext,
  SubmitResult,
  Unsupported,
} from "../types";
import { validateManualResult } from "../validate";

export class ManualGateway implements NotificationGateway {
  readonly adapter = "manual" as const;

  constructor(private readonly fields: ReportFieldsData = REPORT_FIELDS) {}

  capabilities(): GatewayCapabilities {
    return { mode: "user_reported", canStatus: false, canChange: true, canCancel: true };
  }

  prepare(input: PlanForReport, kind: ReportKind): PreparedReport {
    return prepareReport(input, kind, this.fields);
  }

  async submit(prepared: PreparedReport, ctx: SubmitContext): Promise<SubmitResult> {
    assertSubmittable(prepared);
    const v = validateManualResult(ctx.manualResult, ctx.now, { numberPolicy: this.fields.numberPolicy });
    if (!v.ok) throw new GatewayInputError(v.errors, v.codes);
    return {
      state: "reported_manual",
      reportedAt: v.data.reportedAt,
      dipsNumber: v.data.dipsNumber ?? null,
      numberUnavailable: v.data.numberUnavailable === true,
      memo: v.data.memo ?? null,
      confirmedDipsDone: true,
      confirmedMatchesLatest: true,
      errorKind: null,
      httpStatus: null,
      message: null,
      externalRef: null,
      externalStatus: null,
      replayed: false,
      trace: traceOf(prepared, "manual"),
    };
  }

  async status(_ref: ReportRef): Promise<StatusResult | Unsupported> {
    return UNSUPPORTED_STATUS;
  }

  async cancel(_ref: ReportRef, ctx: CancelContext): Promise<CancelResult> {
    // 取消は、利用者が DIPS で取り消した結果の記録（submit と同じ検査）。根拠は prepared から付ける。
    if (!ctx.prepared) throw new Error("cancel requires the prepared report of the cancellation");
    return { mode: "recorded", result: await this.submit(ctx.prepared, ctx) };
  }
}
