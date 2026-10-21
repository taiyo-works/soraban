// 通報の画面の入力と、手動の記録の入力の検査（Sprint 12b 設計 C・G）。純粋関数。
// 誤りは項目ごとに理由コードと文言で返す（API は 400 invalid_input の fields／codes にする）。
import type { ManualResult, ReportInputs } from "./types";

export type Validated<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly errors: Record<string, string>; readonly codes: Record<string, string> };

/** 飛行計画名称の最大文字数（FPR p46 項番 3）。コードポイントで数える。 */
export const MAX_REPORT_NAME_CHARS = 30;
/** 自由記述の最大文字数（原本に制限の記載がないため、そらばんの上限）。 */
export const MAX_FREE_TEXT_CHARS = 100;
export const MAX_ASSISTANTS = 99;
export const MAX_DIPS_NUMBER_CHARS = 50;
export const MAX_MEMO_CHARS = 500;

/** 文字数（コードポイント）。 */
export const charCount = (s: string): number => Array.from(s).length;

const JST_MINUTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** `YYYY-MM-DDTHH:MM`（JST）を UTC の Date にする。形が違う・存在しない日時は null。 */
export const parseJstMinuteString = (s: unknown): Date | null => {
  if (typeof s !== "string") return null;
  const m = JST_MINUTE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || y < 1900) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi) - 9 * 60 * 60 * 1000;
  const back = new Date(ms + 9 * 60 * 60 * 1000);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return new Date(ms);
};

/** Date を JST の `YYYY-MM-DDTHH:MM` にする（秒は切り捨て）。 */
export const toJstMinuteString = (d: Date): string => {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())}T${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
};

const collector = () => {
  const errors: Record<string, string> = {};
  const codes: Record<string, string> = {};
  const fail = (key: string, code: string, message: string): void => {
    if (key in errors) return;
    errors[key] = message;
    codes[key] = code;
  };
  const result = <T>(data: () => T): Validated<T> => (Object.keys(errors).length > 0 ? { ok: false, errors, codes } : { ok: true, data: data() });
  return { fail, result };
};

const hasControl = (s: string): boolean => /[\u0000-\u001f\u007f]/.test(s);

const isBlank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

// ---- 通報の画面の入力 ----------------------------------------------

/** 通報の画面の入力の検査。すべて任意（未入力は通報内容の「未入力」として警告される）。未知のキーは読まない。 */
export const validateReportInputs = (raw: unknown): Validated<ReportInputs> => {
  const c = collector();
  const input = raw === undefined || raw === null ? {} : raw;
  if (typeof input !== "object" || Array.isArray(input)) {
    c.fail("inputs", "invalid", "通報の入力の形が正しくありません");
    return c.result(() => ({}));
  }
  const o = input as Record<string, unknown>;

  const text = (key: string, label: string, max: number): string | null | undefined => {
    const v = o[key];
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== "string") {
      c.fail(key, "invalid", `${label}は文字で入力してください`);
      return undefined;
    }
    const t = v.trim();
    if (t === "") return null;
    if (hasControl(t)) {
      c.fail(key, "invalid", `${label}に使えない文字が含まれています`);
      return undefined;
    }
    if (charCount(t) > max) {
      c.fail(key, key === "reportName" ? "name_too_long" : "too_long", `${label}は ${max} 文字以内にしてください`);
      return undefined;
    }
    return t;
  };

  const int = (key: string, label: string, min: number, max: number, step = 1): number | null | undefined => {
    const v = o[key];
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
    if (!Number.isInteger(n)) {
      c.fail(key, "invalid", `${label}は整数で入力してください`);
      return undefined;
    }
    if (n < min || n > max) {
      c.fail(key, "range", `${label}は ${min}〜${max} の範囲です`);
      return undefined;
    }
    if (step > 1 && n % step !== 0) {
      c.fail(key, "step", `${label}は ${step} 刻みで入力してください`);
      return undefined;
    }
    return n;
  };

  const flag = (key: string, label: string): "1" | "0" | null | undefined => {
    const v = o[key];
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    if (v === "1" || v === "0") return v;
    c.fail(key, "invalid", `${label}は「1」か「0」で入力してください`);
    return undefined;
  };

  const reportName = text("reportName", "通報用の名称", MAX_REPORT_NAME_CHARS);
  const otherBusinessText = text("otherBusinessText", "その他1の理由", MAX_FREE_TEXT_CHARS);
  const otherNonBusinessText = text("otherNonBusinessText", "その他2の理由", MAX_FREE_TEXT_CHARS);
  const departurePoint = text("departurePoint", "出発地", MAX_FREE_TEXT_CHARS);
  const destinationPoint = text("destinationPoint", "目的地", MAX_FREE_TEXT_CHARS);
  const assistantsNumber = int("assistantsNumber", "補助者の人数", 0, MAX_ASSISTANTS);
  const plannedMaxTime = int("plannedMaxTime", "航続可能時間", 5, 1440, 5);
  const flightSpeed = int("flightSpeed", "飛行速度", 1, 999);
  const onsiteControlL3 = flag("onsiteControlL3", "立入管理措置（レベル3飛行）");
  const onsiteControlL35 = flag("onsiteControlL35", "立入管理措置（レベル3.5飛行関連）");
  const onsiteControl2 = flag("onsiteControl2", "立入禁止措置");
  const mooring = flag("mooring", "係留飛行");

  let flightPurposes: number[] | null | undefined;
  const fp = o["flightPurposes"];
  if (fp === undefined) flightPurposes = undefined;
  else if (fp === null) flightPurposes = null;
  else if (!Array.isArray(fp)) {
    c.fail("flightPurposes", "invalid", "飛行目的の形が正しくありません");
  } else {
    const list: number[] = [];
    for (const x of fp) {
      if (typeof x !== "number" || !Number.isInteger(x) || x < 1 || x > 16) {
        c.fail("flightPurposes", "range", "飛行目的は 1〜16 のコードで選んでください");
        break;
      }
      if (!list.includes(x)) list.push(x);
    }
    flightPurposes = list.sort((a, b) => a - b);
  }

  // その他の理由：13・16 を選んだときは必須
  if (Array.isArray(flightPurposes)) {
    if (flightPurposes.includes(13) && isBlank(otherBusinessText) && otherBusinessText !== undefined) {
      c.fail("otherBusinessText", "required", "その他1（業務）の理由を入力してください");
    }
    if (flightPurposes.includes(16) && isBlank(otherNonBusinessText) && otherNonBusinessText !== undefined) {
      c.fail("otherNonBusinessText", "required", "その他2（業務以外）の理由を入力してください");
    }
  }

  return c.result(() => {
    const out: Record<string, unknown> = {};
    const put = (k: string, v: unknown) => {
      if (v !== undefined) out[k] = v;
    };
    put("reportName", reportName);
    put("flightPurposes", flightPurposes);
    put("otherBusinessText", otherBusinessText);
    put("otherNonBusinessText", otherNonBusinessText);
    put("assistantsNumber", assistantsNumber);
    put("departurePoint", departurePoint);
    put("destinationPoint", destinationPoint);
    put("plannedMaxTime", plannedMaxTime);
    put("flightSpeed", flightSpeed);
    put("onsiteControlL3", onsiteControlL3);
    put("onsiteControlL35", onsiteControlL35);
    put("onsiteControl2", onsiteControl2);
    put("mooring", mooring);
    return out as ReportInputs;
  });
};

// ---- 手動の記録 ----------------------------------------------------

/** 番号の扱い（データ number_or_declared_unavailable）に従う。required_number なら番号の宣言を認めない。 */
export type ManualValidateOptions = {
  readonly numberPolicy?: "number_or_declared_unavailable" | "required_number";
  /** 確認の二つを求めるか（既定 true。訂正では求めない）。 */
  readonly requireConfirmations?: boolean;
};

/**
 * 手動の記録の検査。確認の二つが揃わない・番号も宣言もない・両方ある・宣言なのにメモがない・通報日時が JST 分の形でない
 * ・通報日時が現在より後、は誤り。
 */
export const validateManualResult = (raw: unknown, now: Date, opts: ManualValidateOptions = {}): Validated<ManualResult> => {
  const c = collector();
  const policy = opts.numberPolicy ?? "number_or_declared_unavailable";
  const requireConfirmations = opts.requireConfirmations ?? true;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    c.fail("manual", "required", "通報の結果を入力してください");
    return c.result(() => ({}) as ManualResult);
  }
  const o = raw as Record<string, unknown>;

  let reportedAt = "";
  if (isBlank(o["reportedAt"])) {
    c.fail("reportedAt", "required", "通報した日時を入力してください");
  } else {
    const d = parseJstMinuteString(o["reportedAt"]);
    if (!d) c.fail("reportedAt", "time_format", "日付と時刻を YYYY-MM-DDTHH:MM（日本時間、分まで）で入力してください");
    else if (d.getTime() > now.getTime()) c.fail("reportedAt", "in_future", "通報した日時が現在より後です");
    else reportedAt = o["reportedAt"] as string;
  }

  let dipsNumber: string | null = null;
  const rawNumber = o["dipsNumber"];
  if (rawNumber !== undefined && rawNumber !== null) {
    if (typeof rawNumber !== "string") c.fail("dipsNumber", "invalid", "番号は文字で入力してください");
    else {
      const t = rawNumber.trim();
      if (t !== "") {
        if (hasControl(t)) c.fail("dipsNumber", "invalid", "番号に使えない文字が含まれています");
        else if (charCount(t) > MAX_DIPS_NUMBER_CHARS) c.fail("dipsNumber", "too_long", `番号は ${MAX_DIPS_NUMBER_CHARS} 文字以内にしてください`);
        else dipsNumber = t;
      }
    }
  }
  const rawUnavailable = o["numberUnavailable"];
  if (rawUnavailable !== undefined && rawUnavailable !== null && typeof rawUnavailable !== "boolean") {
    c.fail("numberUnavailable", "invalid", "番号の有無の宣言が正しくありません");
  }
  const numberUnavailable = rawUnavailable === true;
  if (dipsNumber !== null && numberUnavailable) {
    c.fail("numberUnavailable", "number_conflict", "番号と「番号が表示されなかった」は同時に指定できません");
  } else if (dipsNumber === null && !numberUnavailable) {
    c.fail("dipsNumber", "number_required", "DIPS の番号を入力するか、「番号が表示されなかった」を選んでください");
  } else if (numberUnavailable && policy === "required_number") {
    c.fail("numberUnavailable", "number_required", "DIPS の番号を入力してください");
  }

  let memo: string | null = null;
  const rawMemo = o["memo"];
  if (rawMemo !== undefined && rawMemo !== null) {
    if (typeof rawMemo !== "string") c.fail("memo", "invalid", "メモは文字で入力してください");
    else {
      const t = rawMemo.trim();
      if (t !== "") {
        if (charCount(t) > MAX_MEMO_CHARS) c.fail("memo", "too_long", `メモは ${MAX_MEMO_CHARS} 文字以内にしてください`);
        else memo = t;
      }
    }
  }
  if (numberUnavailable && dipsNumber === null && memo === null) {
    c.fail("memo", "memo_required", "番号がないときは、控えのメモ（画面の表示・時刻など）を入力してください");
  }

  const confirmedDipsDone = o["confirmedDipsDone"] === true;
  const confirmedMatchesLatest = o["confirmedMatchesLatest"] === true;
  if (requireConfirmations) {
    if (!confirmedDipsDone) c.fail("confirmedDipsDone", "confirm_required", "「DIPS 2.0 の画面で通報を完了した」の確認が必要です");
    if (!confirmedMatchesLatest) {
      c.fail("confirmedMatchesLatest", "confirm_required", "「通報した内容は、この計画の最新の版と一致している」の確認が必要です");
    }
  }

  return c.result(() => ({
    reportedAt,
    dipsNumber,
    numberUnavailable,
    memo,
    confirmedDipsDone,
    confirmedMatchesLatest,
  }));
};

/** 理由（訂正・取り下げ・確定で必須。1〜500 文字）。 */
export const validateReason = (raw: unknown, key = "reason"): Validated<string> => {
  const c = collector();
  let reason = "";
  if (typeof raw !== "string" || raw.trim() === "") c.fail(key, "required", "理由を入力してください");
  else if (charCount(raw.trim()) > MAX_MEMO_CHARS) c.fail(key, "too_long", `理由は ${MAX_MEMO_CHARS} 文字以内にしてください`);
  else reason = raw.trim();
  return c.result(() => reason);
};
