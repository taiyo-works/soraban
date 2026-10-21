// 模擬アダプター（開発・CI・E2E だけ。Sprint 12b 設計 B）。mode = direct、canChange = true、canCancel = false（API と同じ前提）。
// 同じプロセスの中で、シナリオ（mockScenario）に応じた結果を返す。外部には何も送らない（ネットワーク呼び出しを持たない）。
//
// 重要：重複の判定・エラーの形・時間切れの扱いは、DIPS の実際の仕様ではなく、そらばん独自の仮定である。
//   実際の DIPS には送信されない。HTTP を通す模擬サーバーは、API アダプターを足すとき（Phase 2）に足す。
//   本番・プレビューでは使えない（config.ts）。
//
//   シナリオ        結果の状態       意味
//   ok             submitted_api   受理。番号（模擬の採番）と受付日時。FPR の応答（flightPlanId・flightPlanRegistrationDatetime・
//                                  existOtherFlightRoutesCount）と同じ形を externalRef に入れる
//   rejected       failed          確定した失敗（HTTP 400 相当。パラメータ不正）。再送できる
//   unauthorized   failed          トークン切れ相当（401）。「DIPS と再度連携してください」
//   server_error   unknown         HTTP 500 相当。登録されたか分からないため結果不明（二重通報を避ける）
//   timeout        unknown         応答なし。同上（実際の時間切れの判定はサービス層。ここは即座に時間切れの結果を返す）
//   unknown_status submitted_api   未知の外部状況（生の値 "XYZ"）を externalStatus に入れて返す。状態は増やさない
import { REPORT_FIELDS, type ReportFieldsData } from "../fields";
import { traceOf, UNSUPPORTED_STATUS, type NotificationGateway } from "../gateway";
import { REPORT_ERROR_KIND_LABEL } from "../messages";
import { prepareReport } from "../prepare";
import { sha256Hex } from "../sha256";
import type {
  CancelContext,
  CancelResult,
  GatewayCapabilities,
  MockScenario,
  PlanForReport,
  PreparedReport,
  ReportKind,
  ReportRef,
  StatusResult,
  SubmitContext,
  SubmitResult,
  Unsupported,
} from "../types";
import { toJstMinuteString } from "../validate";

export const MOCK_UNAUTHORIZED_MESSAGE = REPORT_ERROR_KIND_LABEL["unauthorized"]!;
export const MOCK_REJECTED_MESSAGE = REPORT_ERROR_KIND_LABEL["rejected"]!;
export const MOCK_SERVER_ERROR_MESSAGE = REPORT_ERROR_KIND_LABEL["server_error"]!;
export const MOCK_TIMEOUT_MESSAGE = REPORT_ERROR_KIND_LABEL["timeout"]!;
export const MOCK_UNKNOWN_STATUS_RAW = "XYZ";

/** 受付日時の形式 yyyy/MM/dd HH:mm（FPR の応答 flightPlanRegistrationDatetime と同じ）。 */
export const formatRegistrationDatetime = (d: Date): string => toJstMinuteString(d).replace(/-/g, "/").replace("T", " ");

export class MockGateway implements NotificationGateway {
  readonly adapter = "mock" as const;

  /** 受理した結果（同じ冪等性キーの 2 回目は、受理した結果をそのまま返す）。プロセス内だけ。契約テストの確認用。 */
  private readonly accepted = new Map<string, SubmitResult>();

  constructor(private readonly fields: ReportFieldsData = REPORT_FIELDS) {}

  capabilities(): GatewayCapabilities {
    return { mode: "direct", canStatus: false, canChange: true, canCancel: false };
  }

  prepare(input: PlanForReport, kind: ReportKind): PreparedReport {
    return prepareReport(input, kind, this.fields);
  }

  async submit(prepared: PreparedReport, ctx: SubmitContext): Promise<SubmitResult> {
    const scenario: MockScenario = ctx.mockScenario ?? "ok";
    const trace = traceOf(prepared, "mock");
    const base = {
      reportedAt: null,
      dipsNumber: null,
      numberUnavailable: false,
      memo: null,
      confirmedDipsDone: false,
      confirmedMatchesLatest: false,
      errorKind: null,
      httpStatus: null,
      message: null,
      externalRef: null,
      externalStatus: null,
      replayed: false,
      trace,
    } as const;

    if (scenario === "rejected") {
      return { ...base, state: "failed", errorKind: "rejected", httpStatus: 400, message: MOCK_REJECTED_MESSAGE };
    }
    if (scenario === "unauthorized") {
      return { ...base, state: "failed", errorKind: "unauthorized", httpStatus: 401, message: MOCK_UNAUTHORIZED_MESSAGE };
    }
    if (scenario === "server_error") {
      return { ...base, state: "unknown", errorKind: "server_error", httpStatus: 500, message: MOCK_SERVER_ERROR_MESSAGE };
    }
    if (scenario === "timeout") {
      return { ...base, state: "unknown", errorKind: "timeout", httpStatus: null, message: MOCK_TIMEOUT_MESSAGE };
    }

    // ok・unknown_status：受理。同じキーなら受理した結果をそのまま返す
    const prior = this.accepted.get(ctx.idempotencyKey);
    if (prior) return { ...prior, replayed: true };
    const id = `MOCK-${sha256Hex(`soraban-mock-dips|${ctx.idempotencyKey}`).slice(0, 10).toUpperCase()}`;
    const result: SubmitResult = {
      ...base,
      state: "submitted_api",
      reportedAt: toJstMinuteString(ctx.now),
      dipsNumber: id,
      httpStatus: 200,
      externalRef: {
        flightPlanId: id,
        flightPlanRegistrationResult: "登録完了",
        flightPlanRegistrationDatetime: formatRegistrationDatetime(ctx.now),
        existOtherFlightRoutesCount: 0,
      },
      externalStatus: scenario === "unknown_status" ? { raw: MOCK_UNKNOWN_STATUS_RAW, fetchedAt: ctx.now.toISOString() } : null,
    };
    this.accepted.set(ctx.idempotencyKey, result);
    return result;
  }

  async status(_ref: ReportRef): Promise<StatusResult | Unsupported> {
    return UNSUPPORTED_STATUS;
  }

  async cancel(_ref: ReportRef, _ctx: CancelContext): Promise<CancelResult> {
    // API と同じ前提：取消の API は無い。DIPS の画面で取り消した結果を、手動の記録に倒す
    return {
      mode: "manual_record_required",
      message: "取消は DIPS の画面で行い、その結果を記録してください（模擬も API と同じく、取消を送れません）。",
    };
  }
}
