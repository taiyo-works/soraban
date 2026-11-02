// 画面・API の表示用の文言（Sprint 12b 設計 H）。画面は定数だけを使う。
// 禁止語（通報が要らないと読める言い回しなど）を含めない（messages.test.ts が全文を検査する）。
import { MAX_AREA_VERTICES } from "@soraban/geo";
import type { ReportPolicy } from "./policy";
import type { ProcedureRecordKind, ReportChannel, ReportKind, ReportState } from "./types";

export const NEEDS_CONFIRMATION_MARK = "※要確認";

// ---- 固定の文言 ----------------------------------------------------

/**
 * 公式の手続きの案内（Sprint 18-2 B5）。以前は同じ趣旨の文が 4 つの定数に重複していたものを、この 1 つに揃える。
 * REPORT_NOTICE_MANUAL はこれを連結する。packages/regulations の REPORT_FIXED_NOTE・PLAN_JUDGEMENT_DISCLAIMER は
 * 同じ文を持ち（パッケージ間の依存を作らないため）、apps/web の単体テストで一致を確かめる。
 * 「許可・承認の申請」の語は境界の文として許可された使い方（暫定版。専門家確認の前）。「代行」「代理」の語は使わない。
 */
export const OFFICIAL_PROCEDURE_NOTE = "許可・承認の申請と飛行計画の通報は、利用者本人が DIPS 2.0 などの公式の手続きで行います。";

/** 手動のとき、通報の画面の目立つ位置に出す。 */
export const REPORT_NOTICE_MANUAL = `そらばんは DIPS に送信しません。この内容を DIPS 2.0 で通報し、通報した日時と番号をここに記録してください。記録するまで『通報済み』にはなりません。${OFFICIAL_PROCEDURE_NOTE}`;

/** 模擬のとき。 */
export const REPORT_NOTICE_MOCK = "模擬（開発用）です。実際の DIPS には送信されません。";

/** 模擬の振る舞いが DIPS の実際の仕様ではないこと。 */
export const MOCK_ASSUMPTION_NOTE =
  "重複の判定・エラーの形・時間切れの扱いは、DIPS の実際の仕様ではなく、そらばん独自の仮定です。";

export const REPORT_NOTICE_BY_CHANNEL: Readonly<Record<"manual" | "mock", string>> = {
  manual: REPORT_NOTICE_MANUAL,
  mock: REPORT_NOTICE_MOCK,
};

/** 記録は利用者の申告であること。 */
export const REPORT_SELF_REPORT_NOTE = "記録は利用者の申告です。そらばんが DIPS に送信したものではありません。";


// ---- 表示名 --------------------------------------------------------

export const REPORT_CHANNEL_LABEL: Readonly<Record<ReportChannel, string>> = {
  manual: "手動（利用者の申告）",
  mock: "模擬（開発用）",
  api: "API",
};

export const REPORT_KIND_LABEL: Readonly<Record<ReportKind, string>> = {
  new: "新規",
  change: "変更",
  cancel: "取消",
};

export const ADAPTER_MODE_LABEL: Readonly<Record<"user_reported" | "direct", string>> = {
  user_reported: "コピー → 記録",
  direct: "送信内容の確認 → 送信",
};

export const PREPARED_STALE_LABEL = "送信の途中で止まった可能性があります（結果不明として扱います）";

/** 通報の行の状態の表示（stale は prepared のまま 5 分を超えたもの）。 */
export const reportStateLabel = (state: ReportState, channel: ReportChannel, stale = false): string => {
  switch (state) {
    case "prepared":
      return stale ? PREPARED_STALE_LABEL : "送信中です";
    case "reported_manual":
      return "DIPS で通報済み（利用者の申告・手動記録）";
    case "submitted_api":
      return channel === "mock" ? "送信済み（模擬・開発用）" : "送信済み（API）";
    case "failed":
      return "失敗しました。再送できます";
    case "unknown":
      return "送信結果が不明です。DIPS の画面で確かめてください";
    case "retracted":
      return "記録を取り下げました";
  }
};

/** 取消の行の状態の表示。 */
export const cancelStateLabel = (state: ReportState, stale = false): string => {
  switch (state) {
    case "reported_manual":
    case "submitted_api":
      return "取消済み（DIPS での取消を記録）";
    case "retracted":
      return "取消の記録を取り下げました";
    case "prepared":
      return stale ? PREPARED_STALE_LABEL : "送信中です";
    case "failed":
      return "失敗しました";
    case "unknown":
      return "取消の結果が不明です。DIPS の画面で確かめてください";
  }
};

/** 失敗・結果不明の種類（error_kind）の表示。 */
export const REPORT_ERROR_KIND_LABEL: Readonly<Record<string, string>> = {
  rejected: "リクエストのパラメータが正しくありません（模擬：HTTP 400 相当）",
  unauthorized: "DIPS と再度連携してください（模擬：トークン切れ）",
  server_error: "DIPS 側でエラーが起きました。登録されたか分かりません（模擬：HTTP 500 相当）",
  timeout: "応答がありませんでした。登録されたか分かりません（模擬：時間切れ）",
  adapter_error: "送信中にエラーが起きました。登録されたか分かりません",
  result_not_recorded: "送信の結果を記録できませんでした。登録されたか分かりません",
  confirmed_not_registered: "DIPS の画面で、通報されていないことを確認しました",
};

/** 試行の監査の操作の表示。 */
export const ATTEMPT_OPERATION_LABEL: Readonly<Record<string, string>> = {
  copy: "コピー",
  submit: "送信",
  status: "状況の確認",
  cancel: "取消の記録",
  manual_record: "手動の記録",
  correct: "訂正",
  retract: "取り下げ",
  resolve: "結果不明の確定",
};

export const ATTEMPT_RESULT_LABEL: Readonly<Record<string, string>> = {
  success: "成功",
  failure: "失敗",
  unknown: "結果不明",
};

/** 未知の外部状況。状態は増やさず、生の値を示す。 */
export const externalStatusLabel = (raw: string): string => `状況：不明（${raw}）`;

// ---- 項目の表示 ----------------------------------------------------

export const MISSING_VALUE_LABEL = "未入力（DIPS で入力）";
export const DIPS_ONLY_LABEL = "そらばんは保持しません。DIPS で入力してください";
export const NOT_APPLICABLE_LABEL = "該当なし";
export const ROUTE_GUIDE =
  "経路は DIPS の地図で描いてください（コピーできません）。下の座標を目安にしてください。";
export const LICENSE_MASKED_NOTE = "技能証明書番号の全桁は、運航管理者と本人にだけ表示します。";
export const COPY_AUDIT_NOTE = "コピーした項目は、誰がいつコピーしたかを記録します（値は記録しません）。";

export const dipsOnlyValue = (apiField: string | null): string =>
  apiField ? `${DIPS_ONLY_LABEL}（${apiField}）` : DIPS_ONLY_LABEL;

// ---- 警告 ----------------------------------------------------------

export const PREPARE_WARNING_MESSAGE = {
  name_too_long: "飛行計画名称は 30 文字までです。切り詰めていません。通報用の名称を入力してください",
  duration_rounded_up: "所要時間は 5 分単位です。切り上げています（終了日時は所要時間から計算されるため）",
  duration_out_of_range: "所要時間は 5〜1440 分です",
  altitude_missing: "最大高度が未入力です。DIPS の飛行する高度は 1〜999 m です",
  altitude_out_of_range: "飛行する高度は 1〜999 m です。値は変えていません。DIPS で入力できる範囲か確かめてください",
  emergency_airspace: "緊急用務空域は通報の項目にありません。この判定は飛行できない判定です",
  radius_missing: "範囲の半径が未入力のため、経路（円）を作れません。DIPS の地図で描いてください",
  route_multiple_areas:
    "DIPS に出す範囲は 1 つです。計画を分けるか、1 つにまとめてください（複数を出せるかは確認していません）",
  route_too_many_vertices: `頂点が ${MAX_AREA_VERTICES} 点を超えています。この上限はそらばんの暫定の設計値で、DIPS の値ではありません（DIPS の上限は確認していません）。頂点を減らしてください`,
  max_time_invalid: "航続可能時間は 5 分単位で 5〜1440 分です",
  speed_invalid: "飛行速度は 1〜999 km/h の整数です",
  assistants_invalid: "補助者の人数は 0 以上の整数です",
  permit_number_missing: "判定に許可・承認の手続きがありますが、許可・承認番号が空です",
  permit_dates_format_unconfirmed:
    "※要確認：許可書発行日・許可期間の日付の形式は、ガイドラインに指定がありません。登録は利用者の入力です。DIPS の入力画面で形式と内容を許可書と照らして確かめてください",
  purpose_text_missing: "その他の理由を入力してください",
  onsite_control_missing: "立入管理措置が未入力です",
  license_masked: "技能証明書番号は伏せ字です（運航管理者と本人だけが全桁を見られます）",
  license_missing: "技能証明書番号が登録されていません",
  weight_missing: "機体の最大離陸重量が登録されていません",
} as const;

export type PrepareWarningCode = keyof typeof PREPARE_WARNING_MESSAGE;

// ---- 記録の検査 ----------------------------------------------------

export const MANUAL_CONFIRM_DIPS_DONE = "DIPS 2.0 の画面で通報を完了した";
export const MANUAL_CONFIRM_MATCHES_LATEST = "通報した内容は、この計画の最新の版と一致している";
export const MANUAL_NUMBER_UNAVAILABLE_LABEL = "番号が表示されなかった";

// ---- 通報の状況（導出） --------------------------------------------

export type ReportStatusCode =
  | "not_applicable_model"
  | "no_record"
  | "reported"
  | "change_review"
  | "cancel_needed"
  | "cancelled"
  | "unknown"
  | "failed"
  | "sending";

export const REPORT_STATUS_LABEL: Readonly<Record<ReportStatusCode, string>> = {
  not_applicable_model: "DIPS の飛行計画の通報は対象外（模型航空機）",
  no_record: "通報の記録がありません",
  reported: "DIPS で通報済み（利用者の申告・手動記録）",
  change_review: "計画が通報時から変わっています。変更通報の要否を確認してください",
  cancel_needed: "計画は中止されました。DIPS で通報を取り消し、結果を記録してください",
  cancelled: "取消済み",
  unknown: "送信結果が不明です。DIPS の画面で確かめてください",
  failed: "失敗しました。再送できます",
  sending: "送信中です",
};

/** 一覧の印（文字と記号を添える。色だけで区別しない）。 */
export const REPORT_STATUS_MARK: Readonly<Record<ReportStatusCode, string>> = {
  not_applicable_model: "－",
  no_record: "！",
  reported: "✓",
  change_review: "△",
  cancel_needed: "！",
  cancelled: "－",
  unknown: "？",
  failed: "×",
  sending: "…",
};

export const REPORT_STATUS_SHORT_LABEL: Readonly<Record<ReportStatusCode, string>> = {
  not_applicable_model: "対象外",
  no_record: "記録なし",
  reported: "記録あり",
  change_review: "変更の確認",
  cancel_needed: "取消が必要",
  cancelled: "取消済み",
  unknown: "結果不明",
  failed: "失敗",
  sending: "送信中",
};

// ---- 期限 ----------------------------------------------------------

export const DEADLINE_GUIDE_LABEL = "社内の目安（飛行開始の 24 時間前）";
export const DEADLINE_GUIDE_DISCLAIMER = "社内の目安であり、法定の期限ではありません。";
export const DEADLINE_PAST_GUIDE_MESSAGE = "社内の目安（飛行開始の 24 時間前）を過ぎています";
export const DEADLINE_OVERDUE_STARTED_MESSAGE = "飛行開始の時刻を過ぎていますが、通報の記録がありません";
export const DEADLINE_RECOMMENDED_MESSAGE = "通報を行うことを推奨します";
export const deadlineUpcomingMessage = (hours: number): string => `目安まであと ${hours} 時間`;

/** 飛行開始の後に通報の記録がないときの罰則の注記。条文は一次資料で未照合のため「※要確認」を付け、金額は出さない。 */
export const deadlinePenaltyNote = (policy: ReportPolicy): string =>
  `通報せずに特定飛行を行うと罰則の対象になりえます（${policy.penalty.lawName}${policy.penalty.article}。${policy.penalty.uncheckedNote}）`;

// ---- 次にやること --------------------------------------------------

export type NextActionId =
  | "request_confirmation"
  | "confirm"
  | "fix_returned"
  | "rejudge"
  | "report"
  | "record_result"
  | "change_report"
  | "cancel_report"
  | "apply_permit"
  | "notify_police"
  | "consider_report"
  // Sprint 12d：許可・承認の申請が済みで、判定に許可の手続きが残り、計画の番号に適用できる登録がないときの、結果の登録
  | "register_permit"
  // Sprint 12c：飛行当日・現場の次にやること（今日の画面。通報とは別に、記録の有無から導出する）
  | "record_landing"
  | "do_inspection"
  | "check_emergency_airspace"
  // Sprint 14：着陸のあと、飛行後点検が未了
  | "do_post_inspection"
  | "write_journal"
  | "review_journal_mismatch"
  | "renew_license"
  // Sprint 12e：事故・ヒヤリハット（記録の有無から導出する。計画に結び付かない記録にも出る）
  | "confirm_incident_report"
  | "complete_incident_detail";

/** Sprint 12c で足した、計画の通報・確認の導出（planNextActions）には含まれない次にやること。 */
export const FIELD_NEXT_ACTION_IDS = [
  "record_landing",
  "do_inspection",
  "check_emergency_airspace",
  "do_post_inspection",
  "write_journal",
  "review_journal_mismatch",
  "renew_license",
] as const;
export type FieldNextActionId = (typeof FIELD_NEXT_ACTION_IDS)[number];
/** Sprint 12e で足した、事故・ヒヤリハットの次にやること（計画の通報・確認の導出には含まれない）。 */
export const INCIDENT_NEXT_ACTION_IDS = ["confirm_incident_report", "complete_incident_detail"] as const;
export type IncidentNextActionId = (typeof INCIDENT_NEXT_ACTION_IDS)[number];
/** 12b までの、計画の通報・確認の導出の次にやること。 */
export type PlanNextActionId = Exclude<NextActionId, FieldNextActionId | IncidentNextActionId>;

export const NEXT_ACTION_LABEL: Readonly<Record<NextActionId, string>> = {
  request_confirmation: "確認を依頼する",
  confirm: "計画を確認する",
  fix_returned: "差し戻しを直す",
  rejudge: "判定をやり直す",
  report: "飛行計画を DIPS で通報する",
  record_result: "通報の結果を記録する",
  change_report: "通報を変更する",
  cancel_report: "通報を取り消す",
  apply_permit: "許可・承認を申請する",
  notify_police: "警察へ通報する",
  register_permit: "取得した許可・承認を登録する",
  consider_report: "通報を検討する（推奨）",
  record_landing: "着陸を記録する",
  do_inspection: "日常点検をする",
  check_emergency_airspace: "緊急用務空域を確認する",
  do_post_inspection: "飛行後点検をする",
  write_journal: "日誌を記入する",
  review_journal_mismatch: "日誌の食い違いを確認する",
  renew_license: "技能証明の有効期限を確認する",
  confirm_incident_report: "事故・ヒヤリハットの報告の要否を確認する",
  complete_incident_detail: "事故・ヒヤリハットの詳細を記入する",
};

export const NEXT_ACTIONS_EMPTY_LABEL = "いまやることはありません";

// ---- 手続きの記録 --------------------------------------------------

export const PROCEDURE_RECORD_KIND_LABEL: Readonly<Record<ProcedureRecordKind, string>> = {
  dips_permit: "許可・承認の申請",
  small_drone_law: "小型無人機等飛行禁止法の同意・通報",
};

export const PROCEDURE_RECORD_DONE_LABEL: Readonly<Record<ProcedureRecordKind, string>> = {
  dips_permit: "申請済み（利用者の申告）",
  small_drone_law: "同意・通報を記録済み（利用者の申告）",
};

export const PROCEDURE_RECORD_NONE_LABEL = "記録なし";
export const PROCEDURE_RECORD_RETRACTED_LABEL = "取り下げました";

export const PROCEDURE_CHECK_LABEL = {
  applicationCompleted: "DIPS 2.0 で許可・承認の申請を完了した",
  facilityConsentObtained: "対象施設の管理者の同意を得た",
  policeNoticeDone: "都道府県公安委員会へ通報した",
} as const;

export const PROCEDURE_RECORD_STALE_LABEL = "前の判定に対する記録です。もう一度確認してください";
export const PROCEDURE_RECORD_NOTE = `記録は利用者の申告です。許可・承認の取得を示すものではありません。${OFFICIAL_PROCEDURE_NOTE}`;

// 申請支援のフラグが無効のとき、dips_permit の新しい記録は受け付けない（Sprint 18-2）。既存の行は消さず、次の表示で読むだけにする。
// 上の PROCEDURE_RECORD_KIND_LABEL.dips_permit・PROCEDURE_RECORD_DONE_LABEL.dips_permit・PROCEDURE_CHECK_LABEL.applicationCompleted は、
// フラグ有効のときの表示に残す（値は変えない）。
/** 以前の記録（dips_permit）の見出し。 */
export const PROCEDURE_RECORD_LEGACY_KIND_LABEL = "以前の記録：許可・承認の手続きの申告（受付を停止しています）";
/** 以前の記録（dips_permit）の「済み」の表示。 */
export const PROCEDURE_RECORD_LEGACY_DONE_LABEL = "以前の申告（許可・承認の取得を示すものではありません）";
/** dips_permit の新しい記録を受け付けないときの 409 のメッセージ。 */
export const PROCEDURE_KIND_DISABLED_MESSAGE = "この記録は受け付けていません";
/** 手続きの記録の対象が無いときの文（procedure-none）。 */
export const PROCEDURE_NONE_NOTE = "この計画の判定には、記録する手続き（小型無人機等飛行禁止法の同意・通報）はありません。";
/** 「手続きの記録」の節の説明（フラグ無効）。 */
export const PROCEDURE_SECTION_DESCRIPTION = "小型無人機等飛行禁止法の同意・通報を、済んだら記録します。記録は利用者の申告です。";

// ---- 警告（通報の記録の前） ----------------------------------------

export const WARNING_PLAN_NOT_CONFIRMED = "計画はまだ運航管理者に確認されていません。確認前でも通報の記録はできます。";
export const WARNING_JUDGEMENT_STALE = "判定が古くなっています。判定をやり直してから通報の内容を確かめてください。";
export const WARNING_PLAN_DRAFT = "計画が下書きのため、通報の記録はできません。先に確認を依頼してください。";
export const WARNING_PLAN_VOIDED = "計画は中止されています。通報の記録はできません（取消の記録はできます）。";
