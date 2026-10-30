// 書類・手続きの自動判定（Sprint 14 契約 B）。純粋関数。DB・時計・ネットワークに触れない。
//
// 登録内容（許可・承認、機体、操縦者、通報）から、飛行前に確認する 6 項目を「確認済み／要確認／満たさない」に分ける。
//   - 判定できないときは必ず「要確認」に倒す。「確認済み」「該当なし」「不要」と出さない（北極星 §0.1.9）。
//   - 通報を免除する言い回し（12a 契約 15 の禁止語）は使わない。推奨・対象外の計画は、12b の既存の語（通報の記録を必須としません）に添えて要確認のままにする。
//   - 各判定は根拠（登録の種類・番号または記号・期間・版）を返す。技能証明書の番号は根拠に含めない（名前と期限まで）。
//   - 「人が確認した」は計画ごとに持ち越す（humanConfirms）。満たさない項目は人の確認で変えない（登録を直す）。
//   - 判定の入力は、呼び出し側が同じ組織のデータだけから作る（組織をまたぐ登録を読まない）。
import { PERMIT_KIND_LABEL } from "./permit-logic";
import {
  FIELD_DOC_KEYS,
  FIELD_DOC_LABEL,
  FIELD_DOC_LICENSE_CONDITION_NOTE,
  FIELD_DOC_MANUAL_NOTE,
  FIELD_DOC_REGISTRATION_EXPIRY_NOTE,
  FIELD_DOC_REMOTE_ID_NOTE,
  FIELD_REPORT_NOT_REQUIRED_MODEL,
  FIELD_REPORT_NOT_REQUIRED_RECOMMENDED,
  FIELD_REPORT_RECORDED_LATE_NOTE,
  type FieldDocKey,
  type FieldDocStatus,
} from "@/lib/ops-field";

// ---- 入力 -----------------------------------------------------------------

export type DocsPermitNumber = {
  readonly numberText: string;
  /** この登録で関係した種類（permit-match の relevantKinds。適用したときだけ入る）。 */
  readonly kinds?: readonly string[];
  /** permit-match の結果（applied・reference・not_relevant・not_applied・unregistered）。 */
  readonly status: string;
  readonly registrationId: string | null;
  readonly permitNumber: string | null;
  readonly versionNo: number | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  /** 満たさなかった規則の文（not_applied・unregistered のとき）。 */
  readonly reasonLabels: readonly string[];
};

export type DocsJudgeInput = {
  /** 飛行の予定開始（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly plannedStartAtJst: string;
  /** 飛行の予定終了（JST の `YYYY-MM-DDTHH:MM`）。技能証明・許可は、予定終了日と判定時刻（離陸）の日付の遅い方で照合する。 */
  readonly plannedEndAtJst: string;
  /** 計画の飛行に必要な DIPS の許可・承認の種類（relevantDipsKinds）。登録の種類がこれをすべて覆うときだけ確認済みにする。 */
  readonly wantedKinds: readonly string[];
  /** 判定の時刻（JST の `YYYY-MM-DDTHH:MM`。画面では現在、離陸の未了事項では離陸の時刻）。通報が離陸より前かの判定に使う。 */
  readonly atJst: string;
  readonly permits: readonly DocsPermitNumber[];
  /** 計画の機体。登録が読めなければ null。 */
  readonly aircraft: {
    readonly id: string;
    readonly registrationMark: string;
    readonly status: "active" | "suspended" | "deregistered";
    readonly voided: boolean;
  } | null;
  readonly pilot: {
    readonly id: string;
    readonly fullName: string;
    readonly hasLicense: boolean;
    /** YYYY-MM-DD。未入力は null。 */
    readonly licenseExpiresOn: string | null;
    /** 限定の登録（種類・重量・昼間・目視内）のどれかがある。 */
    readonly hasLimitation: boolean;
    /** 取り消された操縦者の登録。 */
    readonly voided?: boolean;
  } | null;
  readonly report: {
    /** reportRequirement の kind（required・confirm・recommended・not_applicable_model）。 */
    readonly requirementKind: string;
    /** reportStatus の code（reported・change_review ほか）。 */
    readonly statusCode: string;
    readonly effective: {
      readonly id: string;
      readonly dipsNumber: string | null;
      readonly numberUnavailable: boolean;
      readonly reportedAtJst: string | null;
      /** サーバーが決めた記録の時刻（created_at。JST の `YYYY-MM-DDTHH:MM`）。省略は通報日時だけで比べる。 */
      readonly recordedAtJst?: string | null;
    } | null;
  };
  /** 人が確認した項目（計画ごと。取り消されていない最新の行）。at は確認の時刻（ISO）、eventId は取り消す行。 */
  readonly humanConfirms: Partial<Record<FieldDocKey, { readonly at: string; readonly eventId: string }>>;
};

// ---- 出力 -----------------------------------------------------------------

export type DocJudgement = {
  readonly key: FieldDocKey;
  readonly label: string;
  /** 登録内容からの自動判定。 */
  readonly status: FieldDocStatus;
  /** 人が確認した（要確認のものだけ。満たさないは変えない）。 */
  readonly humanConfirmed: boolean;
  readonly humanConfirmEventId: string | null;
  readonly humanConfirmedAt: string | null;
  /** 画面の状態。確認済み（自動）・確認済み（人が確認）・要確認・満たさない。 */
  readonly effective: "confirmed_auto" | "confirmed_human" | "needs_check" | "unmet";
  /** 根拠（登録の種類、番号または記号、期間、版）。技能証明書の番号は含めない。 */
  readonly basis: readonly string[];
  /** 状態の説明（要確認・満たさないの理由、注記）。 */
  readonly notes: readonly string[];
  /** 登録の画面（機体・操縦者・許可・通報）。無ければ null。 */
  readonly href: string | null;
  /** 「確認した」を出してよいか（自動判定が要確認で、まだ人が確認していない）。 */
  readonly canConfirm: boolean;
  /** 離陸の未了事項に数えるか（要確認・満たさないで、人が確認していない。通報は既存の report の未了が担う）。 */
  readonly countsAsGap: boolean;
};

const dateOf = (jst: string): string => jst.slice(0, 10);
/** 照合日：予定終了日と、判定時刻（離陸）の日付の遅い方。 */
const lateDateOf = (i: DocsJudgeInput): string => {
  const end = dateOf(i.plannedEndAtJst);
  const at = dateOf(i.atJst);
  return end > at ? end : at;
};

const j = (
  key: FieldDocKey,
  status: FieldDocStatus,
  basis: readonly string[],
  notes: readonly string[],
  href: string | null,
  opts: { readonly input: DocsJudgeInput; readonly confirmable?: boolean; readonly gap?: boolean },
): DocJudgement => {
  const hc = opts.input.humanConfirms[key];
  const confirmable = opts.confirmable ?? true;
  const humanConfirmed = status === "needs_check" && confirmable && hc !== undefined;
  const effective: DocJudgement["effective"] =
    status === "unmet" ? "unmet" : status === "confirmed" ? "confirmed_auto" : humanConfirmed ? "confirmed_human" : "needs_check";
  return {
    key,
    label: FIELD_DOC_LABEL[key],
    status,
    humanConfirmed,
    humanConfirmEventId: humanConfirmed ? hc.eventId : null,
    humanConfirmedAt: humanConfirmed ? hc.at : null,
    effective,
    basis,
    notes,
    href,
    canConfirm: status === "needs_check" && confirmable && !humanConfirmed,
    countsAsGap: (opts.gap ?? true) && (effective === "needs_check" || effective === "unmet"),
  };
};

// ---- 項目ごとの判定 -----------------------------------------------------------

const permitBasisOf = (n: DocsPermitNumber): string => {
  const period = n.validFrom || n.validTo ? `${n.validFrom ?? "—"}〜${n.validTo ?? "—"}` : "期間の登録なし";
  return `許可・承認 ${n.permitNumber ?? n.numberText}（${period}${n.versionNo !== null ? `／登録の版 ${n.versionNo}` : ""}）`;
};

const judgePermit = (i: DocsJudgeInput): DocJudgement => {
  const href = "/ops/permits";
  const rel = i.permits.filter((n) => n.status !== "not_relevant");
  if (rel.length === 0) {
    return j("permit", "needs_check", [], ["この計画に結びつけた許可・承認の登録がありません。必要かどうかを人が確認します。"], href, { input: i });
  }
  const late = lateDateOf(i);
  const link = (n: DocsPermitNumber | undefined): string => (n?.registrationId ? `/ops/permits/${n.registrationId}` : href);
  // 実際の離陸日が予定より遅く、適用した登録の有効な最終日を過ぎるときは、期間外（満たさない）として扱う
  const lapsed = (n: DocsPermitNumber): boolean => n.status === "applied" && n.validTo !== null && n.validTo < late;
  const applied = rel.filter((n) => n.status === "applied" && !lapsed(n));
  const notApplied = rel.filter((n) => n.status === "not_applied" || lapsed(n));
  if (applied.length === rel.length) {
    // 適用された登録の種類の和集合が、計画の飛行に必要な種類をすべて覆うときだけ確認済み（一部の種類だけでは確認済みにしない）
    const covered = new Set(applied.flatMap((n) => n.kinds ?? []));
    const missing = i.wantedKinds.filter((k) => !covered.has(k));
    if (i.wantedKinds.length > 0 && missing.length === 0) {
      return j("permit", "confirmed", rel.map(permitBasisOf), [], link(rel[0]), { input: i });
    }
    return j(
      "permit",
      "needs_check",
      rel.map(permitBasisOf),
      [
        i.wantedKinds.length === 0
          ? "計画の飛行に必要な許可・承認の種類を判定できません。人が確認します。"
          : `計画の飛行に必要な種類のうち、登録で確認できない種類があります（${missing.map((k) => PERMIT_KIND_LABEL[k as keyof typeof PERMIT_KIND_LABEL] ?? k).join("・")}）。人が確認します。`,
      ],
      link(rel[0]),
      { input: i },
    );
  }
  if (applied.length === 0 && notApplied.length > 0) {
    return j(
      "permit",
      "unmet",
      notApplied.map(permitBasisOf),
      notApplied.flatMap((n) => (n.reasonLabels.length > 0 ? n.reasonLabels : ["許可期間が飛行の最終日より前に終わっています"])),
      link(notApplied[0]),
      { input: i },
    );
  }
  // 一部だけ適用／未登録／参考だけ：判定できないので要確認
  return j(
    "permit",
    "needs_check",
    rel.map(permitBasisOf),
    ["一部の許可・承認が、期間・範囲を満たすと確認できていません。人が確認します。", ...rel.filter((n) => n.status !== "applied").flatMap((n) => n.reasonLabels)],
    link(rel[0]),
    { input: i },
  );
};

const judgeRegistration = (i: DocsJudgeInput): DocJudgement => {
  const a = i.aircraft;
  if (!a || a.registrationMark.trim() === "") {
    return j("registration", "needs_check", [], ["機体の登録記号が機体台帳で確認できません。人が確認します。"], a ? `/ops/aircraft/${a.id}` : "/ops/aircraft", { input: i });
  }
  const href = `/ops/aircraft/${a.id}`;
  const basis = [`登録記号 ${a.registrationMark}`];
  if (a.voided) return j("registration", "unmet", basis, ["機体の登録が取り消されています。"], href, { input: i });
  if (a.status === "suspended") return j("registration", "unmet", basis, ["機体の状態が休止です。"], href, { input: i });
  if (a.status === "deregistered") return j("registration", "unmet", basis, ["機体の状態が登録取消です。"], href, { input: i });
  return j("registration", "confirmed", basis, [FIELD_DOC_REGISTRATION_EXPIRY_NOTE], href, { input: i });
};

/** リモートID：既存の機体登録に対応する列が無いため、常に要確認（判定できないものを確認済みにしない）。 */
const judgeRemoteId = (i: DocsJudgeInput): DocJudgement =>
  j("remote_id", "needs_check", [], [FIELD_DOC_REMOTE_ID_NOTE], i.aircraft ? `/ops/aircraft/${i.aircraft.id}` : "/ops/aircraft", { input: i });

const judgeLicense = (i: DocsJudgeInput): DocJudgement => {
  const p = i.pilot;
  if (!p) return j("license", "needs_check", [], ["操縦者の登録が確認できません。人が確認します。"], "/ops/pilots", { input: i });
  const href = `/ops/pilots/${p.id}`;
  if (p.voided) return j("license", "unmet", [`${p.fullName}`], ["操縦者の登録が取り消されています。"], href, { input: i });
  if (!p.hasLicense) return j("license", "needs_check", [`${p.fullName}`], ["技能証明の登録がありません。人が確認します。"], href, { input: i });
  if (p.licenseExpiresOn === null) {
    return j("license", "needs_check", [`${p.fullName}`], ["技能証明の有効期限が未入力です。人が確認します。"], href, { input: i });
  }
  const basis = [`${p.fullName}／有効期限 ${p.licenseExpiresOn}`];
  if (p.licenseExpiresOn < lateDateOf(i)) {
    return j("license", "unmet", basis, ["技能証明の有効期限が飛行日より前です。"], href, { input: i });
  }
  if (p.hasLimitation) {
    // 限定などの条件は自動で確認済みにしない
    return j("license", "needs_check", basis, ["限定の登録があります。計画の飛行が限定に収まるか、人が確認します。", FIELD_DOC_LICENSE_CONDITION_NOTE], href, { input: i });
  }
  return j("license", "confirmed", basis, [FIELD_DOC_LICENSE_CONDITION_NOTE], href, { input: i });
};

const judgeReport = (i: DocsJudgeInput): DocJudgement => {
  const r = i.report;
  // 通報の画面は呼び出し側が計画の ID で決める（ここでは相対の目印だけ返す）
  const href = "report";
  if (r.requirementKind === "recommended" || r.requirementKind === "not_applicable_model") {
    // 免除と読める語は使わない。必須としないという既存の語に添えて、要確認のまま（未了には数えない）
    const note = r.requirementKind === "recommended" ? FIELD_REPORT_NOT_REQUIRED_RECOMMENDED : FIELD_REPORT_NOT_REQUIRED_MODEL;
    return j("report", "needs_check", [], [note], href, { input: i, confirmable: false, gap: false });
  }
  if (r.requirementKind !== "required" && r.requirementKind !== "confirm") {
    return j("report", "needs_check", [], ["通報の要否を判定できません。人が確認します。"], href, { input: i, confirmable: false });
  }
  const e = r.effective;
  if (r.statusCode === "change_review") {
    return j("report", "needs_check", e ? [`受付番号 ${e.dipsNumber ?? "（番号なし）"}`] : [], ["計画が通報時から変わっています。変更の通報が要るか確かめてください。"], href, { input: i, confirmable: false });
  }
  if (r.statusCode !== "reported" || !e) {
    return j("report", "needs_check", [], ["通報の記録がありません。DIPS で通報したか確かめて、記録してください。"], href, { input: i, confirmable: false });
  }
  const num = e.numberUnavailable ? null : e.dipsNumber && e.dipsNumber.trim() !== "" ? e.dipsNumber.trim() : null;
  if (num === null) {
    return j("report", "needs_check", [], ["通報の受付番号がありません。番号を記録してください。"], href, { input: i, confirmable: false });
  }
  // Sprint 15（U-2）：根拠に、通報日時（DIPS での通報。利用者の入力）と、そらばんへの記録の時刻（サーバーが決める）の両方を出す。
  // 判定は記録の時刻でも比べるため、DIPS で離陸前に通報していても、記録が離陸より後なら要確認になる。その理由を読めるようにする。
  const basis = [
    `受付番号 ${num}`,
    `通報日時 ${e.reportedAtJst ? e.reportedAtJst.replace("T", " ") : "（記録なし）"}（DIPS での通報。利用者の入力）`,
    ...(e.recordedAtJst ? [`そらばんへの記録 ${e.recordedAtJst.replace("T", " ")}`] : []),
  ];
  // 前後はサーバーが決める記録の時刻でも比べる（入力された通報日時が前でも、記録が離陸より後なら事前の通報として数えない）
  if (e.reportedAtJst === null || e.reportedAtJst > i.atJst || (e.recordedAtJst != null && e.recordedAtJst > i.atJst)) {
    // 離陸より後に記録された通報は、事前の通報として数えない
    const recordedLate = e.reportedAtJst !== null && e.reportedAtJst <= i.atJst && e.recordedAtJst != null && e.recordedAtJst > i.atJst;
    return j(
      "report",
      "needs_check",
      basis,
      [
        "通報の記録が離陸より後です。事前の通報として数えません。",
        ...(recordedLate ? [FIELD_REPORT_RECORDED_LATE_NOTE] : []),
      ],
      href,
      { input: i, confirmable: false },
    );
  }
  return j("report", "confirmed", basis, [], href, { input: i });
};

/** 飛行マニュアルの組み合わせ制限：登録が無いため常に要確認（制限の数値・条件を創作しない）。 */
const judgeManual = (i: DocsJudgeInput): DocJudgement => j("manual", "needs_check", [], [FIELD_DOC_MANUAL_NOTE], null, { input: i });

/** 6 項目の判定（FIELD_DOC_KEYS の順）。 */
export const judgeFieldDocs = (i: DocsJudgeInput): DocJudgement[] => {
  const by: Record<FieldDocKey, DocJudgement> = {
    permit: judgePermit(i),
    registration: judgeRegistration(i),
    remote_id: judgeRemoteId(i),
    license: judgeLicense(i),
    report: judgeReport(i),
    manual: judgeManual(i),
  };
  return FIELD_DOC_KEYS.map((k) => by[k]);
};

/** 判定を離陸の未了事項に写す（要確認・満たさない。人が確認した要確認は数えない。通報は既存の report の未了が担う）。 */
export const docGapsOf = (docs: readonly DocJudgement[]): { readonly key: Exclude<FieldDocKey, "report">; readonly state: "needs_check" | "unmet" }[] =>
  docs
    .filter((d): d is DocJudgement & { key: Exclude<FieldDocKey, "report"> } => d.key !== "report" && d.countsAsGap)
    .map((d) => ({ key: d.key, state: d.effective === "unmet" ? ("unmet" as const) : ("needs_check" as const) }));
