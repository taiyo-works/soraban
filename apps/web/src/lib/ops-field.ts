// 現場モード（Sprint 12c）の共通の定数・文言・時刻の規則。サーバー（API の検査・DTO）と画面・端末の保存が同じものを使う。
// ブラウザにもサーバーにも依らない純粋な部分だけを置く（DOM・fetch・DB に触れない）。
//
// 守ること：
//   - 通報を免除するような言い回し（12a 契約 15 の禁止語。ops-field.test.ts が一覧で検査する）は、どの文言にも使わない。
//   - 法令の条番号を書かない（条番号の表記は packages/regulations/src/model-aircraft.ts の定数経由だけ）。
//   - 緊急用務空域の情報源の名称・URL を新しく作らない。@soraban/regulations の参照先の定数だけを選択肢にする。
import { MODEL_AIRCRAFT_REFERENCES } from "@soraban/regulations";

// ---- 種別・項目 -----------------------------------------------------------

export const FIELD_EVENT_KINDS = ["check", "takeoff", "landing", "undo", "journal_linked"] as const;
export type FieldEventKind = (typeof FIELD_EVENT_KINDS)[number];

/** API で記録できる種別（journal_linked は日誌の保存と同じトランザクションでサーバーが書く）。 */
export const FIELD_RECORDABLE_KINDS = ["check", "takeoff", "landing", "undo"] as const;

/** 飛行前の確認項目（画面に並べる順）。 */
export const FIELD_CHECK_ITEMS = ["inspection", "emergency_airspace", "report_recheck", "carry"] as const;
export type FieldCheckItem = (typeof FIELD_CHECK_ITEMS)[number];
/** 確認の行を持つ項目（日常点検は実際の点検の記録から導出するため、確認の行を作らない）。 */
export const FIELD_RECORDABLE_CHECK_ITEMS = ["emergency_airspace", "report_recheck", "carry"] as const;
export type FieldRecordableCheckItem = (typeof FIELD_RECORDABLE_CHECK_ITEMS)[number];

export type FieldCheckResult = "done" | "not_designated" | "designated";

export const FIELD_CHECK_ITEM_LABEL: Readonly<Record<FieldCheckItem, string>> = {
  inspection: "日常点検",
  emergency_airspace: "緊急用務空域の確認",
  report_recheck: "通報済みの再確認",
  carry: "携行品",
};

/** 各項目を済ませる押しボタンの文言。 */
export const FIELD_CHECK_ACTION_LABEL: Readonly<Record<FieldCheckItem, string>> = {
  inspection: "日常点検をする",
  emergency_airspace: "確認した",
  report_recheck: "通報内容を再確認した",
  carry: "必要な書類・携行品を確認した",
};

export const FIELD_CHECK_RESULT_LABEL: Readonly<Record<FieldCheckResult, string>> = {
  done: "確認済み",
  not_designated: "指定されていない",
  designated: "指定されている",
};

// ---- 状態の語（色だけで区別しない。記号を添える） ------------------------------

export const FIELD_STATE_DONE = "済";
export const FIELD_STATE_TODO = "未";
export const FIELD_STATE_ABNORMAL = "異常あり";
export const FIELD_STATE_IN_FLIGHT = "飛行中";
export const FIELD_STATE_LANDED = "着陸済み";
export const FIELD_STATE_JOURNAL_PENDING = "日誌待ち";
export const FIELD_STATE_JOURNAL_DONE = "日誌済み";

/** 状態の記号（文字と一緒に出す）。 */
export const FIELD_STATE_MARK: Readonly<Record<"done" | "todo" | "abnormal" | "in_flight" | "designated", string>> = {
  done: "✓",
  todo: "－",
  abnormal: "！",
  in_flight: "▶",
  designated: "×",
};

// ---- 緊急用務空域 -----------------------------------------------------------

/** 緊急用務空域の確認元として選べるものの ID（@soraban/regulations の参照先の ID）。 */
export const EMERGENCY_SOURCE_REFERENCE_IDS = ["mlit-emergency-airspace-qa"] as const;

export type EmergencySourceOption = { readonly id: string; readonly title: string; readonly url: string };

/**
 * 緊急用務空域の確認元の選択肢。@soraban/regulations の参照先の定数だけから作る（名称・URL を新しく作らない）。
 * 現場で実際に使う確認先（国土交通省の公示のページ・DIPS 2.0 の地図など）はユーザーに確かめてから足す（Sprint 12c U13）。
 */
export const EMERGENCY_SOURCE_OPTIONS: readonly EmergencySourceOption[] = MODEL_AIRCRAFT_REFERENCES.filter((r) =>
  (EMERGENCY_SOURCE_REFERENCE_IDS as readonly string[]).includes(r.id),
).map((r) => ({ id: r.id, title: r.title, url: r.url }));

export const isEmergencySource = (v: unknown): v is string =>
  typeof v === "string" && EMERGENCY_SOURCE_OPTIONS.some((o) => o.id === v);

/** 「指定されている」を選んだときの、最上位の警告。 */
export const EMERGENCY_DESIGNATED_WARNING =
  "緊急用務空域に指定されています。指定中は原則として飛行できません。飛行を止めて、指定の状況を確かめてください。記録は残ります。";

/** 日常点検に異常があるときの案内（止めはしない）。 */
export const INSPECTION_ABNORMAL_GUIDANCE = "飛行を止めて不具合を確認してください。";

// ---- 通報済みの再確認 --------------------------------------------------------

/** 通報の記録を必須としない飛行（推奨）。通報を免除する言い方はしない。 */
export const FIELD_REPORT_NOT_REQUIRED_RECOMMENDED = "この飛行は通報の記録を必須としません（推奨）。";
/** 通報の記録を必須としない飛行（模型航空機）。 */
export const FIELD_REPORT_NOT_REQUIRED_MODEL = "この飛行は通報の記録を必須としません（対象外：模型航空機）。";
export const FIELD_REPORT_NONE_WARNING = "通報の記録がありません。通報内容を開いて、DIPS で通報したか確かめてください。";
export const FIELD_REPORT_CHANGED_WARNING = "計画が通報時から変わっています。変更通報が要るか確かめてください。";
export const FIELD_REPORT_OPEN_LABEL = "通報内容を開く";

// ---- 未了事項（離陸の写し） ---------------------------------------------------

export const FIELD_GAP_ITEMS = ["inspection", "emergency_airspace", "report", "confirmation", "judgement", "carry"] as const;
export type FieldGapItem = (typeof FIELD_GAP_ITEMS)[number];

export const FIELD_GAP_ITEM_LABEL: Readonly<Record<FieldGapItem, string>> = {
  inspection: "日常点検",
  emergency_airspace: "緊急用務空域の確認",
  report: "通報",
  confirmation: "運航管理者の確認",
  judgement: "判定",
  carry: "携行品の確認",
};

/** 未了の状態（短い語）。表示の文言は FIELD_GAP_STATE_LABEL。 */
export const FIELD_GAP_STATES = [
  "none",
  "abnormal",
  "designated",
  "stale",
  "changed",
  "after_takeoff",
  "draft",
  "pending",
  "returned",
] as const;
export type FieldGapState = (typeof FIELD_GAP_STATES)[number];

export const FIELD_GAP_STATE_LABEL: Readonly<Record<FieldGapState, string>> = {
  none: "記録なし",
  abnormal: "異常あり",
  designated: "指定されている",
  stale: "古い",
  changed: "計画が通報時から変わっている",
  after_takeoff: "記録が離陸より後",
  draft: "下書き",
  pending: "確認待ち",
  returned: "差し戻し",
};

/** 「確認（運航管理者）」の stale は「前の版への確認」と読む。 */
export const FIELD_CONFIRMATION_STALE_LABEL = "前の版への確認";

export type FieldGapLike = { readonly item: string; readonly state: string };

export const fieldGapLabel = (g: FieldGapLike): string => {
  const item = (FIELD_GAP_ITEM_LABEL as Record<string, string>)[g.item] ?? g.item;
  const state =
    g.item === "confirmation" && g.state === "stale"
      ? FIELD_CONFIRMATION_STALE_LABEL
      : g.item === "judgement" && g.state === "stale"
        ? "古い"
        : ((FIELD_GAP_STATE_LABEL as Record<string, string>)[g.state] ?? g.state);
  return `${item}（${state}）`;
};

/** 離陸の記録の直後の帯。未了事項があっても記録は成功している（止める文言にしない）。 */
export const takeoffRecordedMessage = (hm: string, gaps: readonly FieldGapLike[]): string =>
  gaps.length === 0
    ? `離陸 ${hm} を記録しました。`
    : `離陸 ${hm} を記録しました。次の項目が未了です：${gaps.map(fieldGapLabel).join("、")}`;

export const landingRecordedMessage = (hm: string): string => `着陸 ${hm} を記録しました。`;
export const LANDING_OUTSIDE_PLAN_WINDOW = "計画の時間帯の外です。";
export const FIELD_UNDO_LABEL = "取り消す";
export const FIELD_AFTER_ENTRY_LABEL = "時刻を入れて記録する（あとから入力）";
export const FIELD_NO_WAKE_LOCK_NOTE = "この端末では画面の消灯を防げません。画面の自動ロックの設定を確かめてください。";
export const FIELD_OFFLINE_SCOPE_NOTE =
  "通信が切れても、押した記録は端末に残り、戻ったときに順番に送られます。ただし、画面そのものを圏外で開くことはできません。";

// ---- 時刻の規則 -------------------------------------------------------------

/** サーバーの現在より未来の許容（分）。超えると 400 future_time。 */
export const FIELD_FUTURE_TOLERANCE_MIN = 5;
/** その場の送信（queued でない）の、サーバーの現在との許容（分）。超えると 400 clock_skew。 */
export const FIELD_SKEW_TOLERANCE_MIN = 5;
/** 送信待ち（queued）で受ける古さの上限（時間）。超えると 400 too_old。 */
export const FIELD_QUEUED_MAX_AGE_HOURS = 72;
/** 離着陸ボタンの二度押しを無視する時間（ミリ秒）。 */
export const FIELD_DOUBLE_TAP_GUARD_MS = 1500;
/** 送信待ちを再試行する間隔（ミリ秒）。 */
export const OUTBOX_RETRY_INTERVAL_MS = 15_000;

export type FieldTimeCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "future_time" | "clock_skew" | "too_old" };

const MINUTE_MS = 60_000;

/**
 * 事実の時刻（分に切り捨て済み）をサーバーの現在と比べる。
 *   サーバーの現在より FIELD_FUTURE_TOLERANCE_MIN 分を超えて未来 → future_time
 *   queued でない（その場で送る）: 現在から ±FIELD_SKEW_TOLERANCE_MIN 分を超えて離れている → clock_skew
 *   queued: 現在から FIELD_QUEUED_MAX_AGE_HOURS 時間を超えて古い → too_old
 * 未来の検査を先に行う。
 */
export const checkFieldTime = (occurredAt: Date, now: Date, queued: boolean): FieldTimeCheck => {
  const diffMin = (occurredAt.getTime() - now.getTime()) / MINUTE_MS;
  if (diffMin > FIELD_FUTURE_TOLERANCE_MIN) return { ok: false, code: "future_time" };
  if (!queued) {
    if (Math.abs(diffMin) > FIELD_SKEW_TOLERANCE_MIN) return { ok: false, code: "clock_skew" };
    return { ok: true };
  }
  if (-diffMin > FIELD_QUEUED_MAX_AGE_HOURS * 60) return { ok: false, code: "too_old" };
  return { ok: true };
};

/** 経過時間の表示（H:MM:SS）。負の値は 0 にする。 */
export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}`;
};

// ---- 誤りの表示 -------------------------------------------------------------

/** 現場の記録の誤り（API の error コード）→ 利用者に見せる理由。 */
export const FIELD_ERROR_MESSAGE: Readonly<Record<string, string>> = {
  clock_skew: "端末の時刻がずれています。時刻の設定（自動）を確かめてください。",
  future_time: "端末の時刻が進みすぎています。時刻の設定（自動）を確かめてください。",
  too_old: "古すぎて送れません（72 時間まで）。「あとから入力」で日誌に記録してください。",
  plan_cancelled: "計画は中止されています。新しい離陸・確認は記録できません。",
  already_in_flight: "すでに飛行中です。先に着陸を記録してください。",
  no_open_flight: "飛行中の離陸がありません。",
  landing_exists: "着陸が記録されています。先に着陸を取り消してください。",
  journal_exists: "日誌が保存されています。誤りは飛行記録を取り消して記録し直してください。",
  already_journaled: "この飛行はすでに日誌に記録されています。",
  already_undone: "すでに取り消されています。",
  not_undoable: "この記録は取り消せません。",
  invalid_target: "取り消す・結び付ける対象が正しくありません。",
  request_conflict: "同じ識別子で内容の違う記録があります。",
  not_found: "計画または記録が見つかりません。",
  forbidden: "この操作を行う権限がありません。",
  invalid_input: "入力が正しくありません。",
};

export const fieldErrorMessage = (code: string): string => FIELD_ERROR_MESSAGE[code] ?? "送れませんでした。";

// ---- 日誌の食い違い（知らせるだけ。保存は止めない） -----------------------------

export const JOURNAL_MISMATCH_CODES = ["outside_plan_window", "report_missing", "report_after_takeoff"] as const;
export type JournalMismatchCode = (typeof JOURNAL_MISMATCH_CODES)[number];

export const JOURNAL_MISMATCH_REPORT_MISSING = "特定飛行ですが、離陸の時点で DIPS の通報の記録がありません。";
export const JOURNAL_MISMATCH_REPORT_AFTER_TAKEOFF = "通報の記録が離陸より後です。事前の通報として数えません。";

/** 計画の時間帯の外で飛行したときの文言。早い・遅いの分数を添える（離陸が早い／着陸が遅い）。 */
export const outsidePlanWindowLabel = (earlyMinutes: number, lateMinutes: number): string => {
  const parts = [
    earlyMinutes > 0 ? `離陸が ${earlyMinutes} 分早い` : null,
    lateMinutes > 0 ? `着陸が ${lateMinutes} 分遅い` : null,
  ].filter((x): x is string => x !== null);
  return `計画の時間帯の外で飛行しています（${parts.join("／")}）。`;
};

/** 「日誌の食い違いを確認する」を出す期間（日数。直近だけ出て、時間で消える）。 */
export const JOURNAL_MISMATCH_RECENT_DAYS = 3;

// ---- 画面への経路（今日の「次にやること」・現場モードの導線） -----------------------

export type FieldAnchor = "preflight" | "flight" | "journal";

/** 現場モード。アンカーで段階（飛行前・離着陸・日誌）を指す。 */
export const fieldHref = (planId: string, anchor?: FieldAnchor): string =>
  `/ops/plans/${planId}/field${anchor ? `#${anchor}` : ""}`;

/** 日常点検の入力（機体・計画を引き継ぐ）。保存後は現場モードへ戻る（returnTo は同じオリジンの /ops/ 配下のパスだけ）。 */
export const inspectionNewHref = (planId: string): string =>
  `/ops/inspections/new?planId=${planId}&returnTo=${encodeURIComponent(fieldHref(planId, "preflight"))}`;

/** 日誌（飛行記録）の入力。takeoffEventId があれば実際の離着陸の時刻を引き継ぐ（計画の予定時刻は入れない）。 */
export const journalNewHref = (planId: string, takeoffEventId?: string | null): string =>
  `/ops/flights/new?planId=${planId}${takeoffEventId ? `&takeoffEventId=${takeoffEventId}` : ""}`;

// ---- 「今日」の空の状態 ------------------------------------------------------------

/** 今日の画面に飛行計画がまったくないとき（何がないか）。 */
export const TODAY_EMPTY_NONE = "予定されている飛行計画はありません。";
/** 今日の計画はあるが、これから飛ぶものがないとき。 */
export const TODAY_EMPTY_TODAY = "これから飛ぶ飛行計画はありません。";
/** 空の状態で一緒に出す、次にできること。 */
export const TODAY_EMPTY_ACTIONS: readonly { readonly label: string; readonly href: string }[] = [
  { label: "飛行計画を作る", href: "/ops/plans/new" },
  { label: "地点を判定する", href: "/" },
];
