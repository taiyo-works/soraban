// 許可・承認の登録の照合（Sprint 12d 設計 C・D）。純粋関数。DB・時計・ネットワークに触れない。
//   normalizePermitNumber / splitPermitNumbers   許可番号の鍵と、計画の欄の番号の分割
//   matchPlanPermits                             計画の日時・場所・飛行の方法・機体・操縦者が登録の範囲に収まるかを調べる（規則 R1〜R9）
//   permitValidity                               登録の有効性の表示（一覧用。今日の日付で求める）
//
// 安全の原則：許可は「手続き不要」を生まない。確認できないもの（文章だけの範囲、計画の半径・最大高度・機体の重量が未入力、
// 登録にない番号）はすべて「適用しない」。判定に足す値は DIPS の許可・承認の 8 種（mlit:<種類>）だけで、同意・通報・公園・文化庁の値は
// 決して入れない。空港等周辺（airport）の個別許可は参考の表示だけで、判定に使う値を生まない（判断 7）。
// エンジン（@soraban/regulations）は変えない。ここで決めた値を判定の入力 pilotPermits に足すだけ（登録で適用した値の判定は、
// 同じ値を手入力した判定と同一になる）。
import { haversineMeters } from "@soraban/geo";
import { DIPS_PERMIT_BY_FLAG, DIPS_PERMIT_KINDS, DIPS_PERMIT_LABEL, dipsPermitValue, type DipsPermitKind } from "@soraban/regulations";
import { jstDate, parseJstMinute } from "@/lib/ops-time";

// ---- 種類・範囲の型 ------------------------------------------

/** 登録の種類。DIPS の許可・承認の 8 種と airport（空港等周辺の個別許可）。 */
export type PermitKind = DipsPermitKind | "airport";
export const PERMIT_KINDS: readonly PermitKind[] = [...DIPS_PERMIT_KINDS, "airport"];

/** DIPS の許可・承認の値（旧版の mlit と mlit:<種類>）。計画の手入力からは判定に使わない（登録の照合だけから入る）。 */
export const isDipsPermitValue = (v: string): boolean => v === "mlit" || v.startsWith("mlit:");

export const isDipsKind = (k: string): k is DipsPermitKind => (DIPS_PERMIT_KINDS as readonly string[]).includes(k);

export type PermitCoverage = "blanket" | "individual";

export type PermitCircle = { readonly name?: string; readonly lat: number; readonly lng: number; readonly radiusM: number };

export type PermitPlaceScope =
  | { readonly type: "nationwide" }
  | { readonly type: "circles"; readonly circles: readonly PermitCircle[] }
  | { readonly type: "text"; readonly text: string };

export type PermitListedScope = { readonly type: "any" } | { readonly type: "listed"; readonly ids: readonly string[] };

/** 照合に使う登録（ヘッド表の行に、現在の版の番号とハッシュを付けたもの）。 */
export type PermitRegistration = {
  readonly id: string;
  readonly versionNo: number;
  /** 現在の版の record_versions.content_hash。 */
  readonly versionHash: string;
  readonly permitNumber: string;
  readonly permitNumberKey: string;
  readonly coverage: PermitCoverage;
  readonly kinds: readonly PermitKind[];
  readonly airportNames: readonly string[];
  readonly issuedOn: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly status: "active" | "revoked";
  /** 失効・取消された日。この日以降は使えない（前日まで有効）。 */
  readonly revokedOn: string | null;
  readonly voided: boolean;
  readonly placeScope: PermitPlaceScope;
  readonly aircraftScope: PermitListedScope;
  readonly pilotScope: PermitListedScope;
  readonly maxAltitudeM: number | null;
  readonly maxWeightKg: number | null;
  readonly requiresObserver: boolean;
  readonly requiresAccessControl: boolean;
  readonly conditionsText: string | null;
};

/** 照合に使う計画の項目。 */
export type PlanPermitInput = {
  /** 予定開始（JST の `YYYY-MM-DDTHH:MM`）。 */
  readonly startAt: string;
  readonly durationMinutes: number;
  readonly lat: number;
  readonly lng: number;
  /** 範囲の半径（m）。未入力は null。 */
  readonly radiusM: number | null;
  /** 最大高度（m）。未入力は null。 */
  readonly maxAltitudeM: number | null;
  /** 判定の入力のフラグ（利用者が選んだものに、最大高度 150m 以上で足した airspace_150m）。 */
  readonly flags: readonly string[];
  /** 立入管理措置（あり true／なし false／未選択 null）。 */
  readonly accessControl: boolean | null;
  /** 補助者の配置（あり true／なし false／未選択 null）。 */
  readonly observer: boolean | null;
  readonly aircraftId: string;
  /** 機体の最大離陸重量（g）。分からなければ null。 */
  readonly aircraftWeightG: number | null;
  readonly pilotId: string;
  /** 計画の「許可・承認の番号」の欄の文字。 */
  readonly permitNumbers: string | null;
};

// ---- 番号 ----------------------------------------------------

/** 許可番号の鍵：Unicode NFKC → 空白をすべて除く → 英字を大文字に。 */
export const normalizePermitNumber = (s: string): string =>
  s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[a-z]/g, (c) => c.toUpperCase());

/** 番号の区切り（`,`・`，`・`、`・`;`・`；`・改行）。登録の番号には使えない。 */
export const PERMIT_NUMBER_SEPARATORS = /[,，、;；\r\n]/;

export type PermitNumberToken = { readonly text: string; readonly key: string };

/** 計画の欄の文字を番号に分ける。空の項は捨て、鍵の重複は最初の 1 つだけ残す（順序は入力の順）。 */
export const splitPermitNumbers = (text: string | null | undefined): PermitNumberToken[] => {
  if (!text) return [];
  const out: PermitNumberToken[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[,，、;；\r\n]+/)) {
    const t = part.trim();
    const key = normalizePermitNumber(t);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push({ text: t, key });
  }
  return out;
};

// ---- 日付 ----------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

const dayNumber = (d: string): number => Date.parse(`${d}T00:00:00Z`) / DAY_MS;

/** YYYY-MM-DD に日数を足す。 */
export const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** b − a の日数。 */
export const daysBetween = (a: string, b: string): number => Math.round(dayNumber(b) - dayNumber(a));

/** 飛行の窓：開始 = 予定開始、最終分 = 予定開始 + (所要時間 − 1) 分。開始日・最終日は JST の日付。読めなければ null。 */
export const flightWindow = (startAt: string, durationMinutes: number): { readonly from: string; readonly to: string } | null => {
  const start = parseJstMinute(startAt);
  if (start === null || !Number.isFinite(durationMinutes) || durationMinutes < 1) return null;
  const last = new Date(start.getTime() + (durationMinutes - 1) * 60_000);
  return { from: jstDate(start), to: jstDate(last) };
};

// ---- 結果の型 ------------------------------------------------

export type PermitReason =
  | "voided"
  | "not_started"
  | "expired"
  | "revoked"
  | "place_out_of_scope"
  | "place_extent_unknown"
  | "place_not_checkable"
  | "aircraft_out_of_scope"
  | "pilot_out_of_scope"
  | "altitude_over_limit"
  | "altitude_unknown"
  | "weight_over_limit"
  | "weight_unknown"
  | "observer_required"
  | "access_control_required";

export type PermitMatchStatus = "applied" | "reference" | "not_relevant" | "not_applied" | "unregistered";

/** 判定の根拠として残す登録の版（スナップショットの input.permitBasis の要素）。 */
export type PermitBasisEntry = {
  readonly registrationId: string;
  readonly versionNo: number;
  readonly versionHash: string;
  readonly permitNumber: string;
  readonly coverage: PermitCoverage;
  /** この計画で関係した種類。 */
  readonly kinds: readonly PermitKind[];
  /** DIPS の種類を適用したなら true、空港等周辺の参考なら false。 */
  readonly applied: boolean;
  readonly validFrom: string;
  /** 有効な最終日（満了日と、失効日の前日の早いほう）。 */
  readonly validTo: string;
  /** 照合した飛行の開始日・最終日。 */
  readonly window: { readonly from: string; readonly to: string };
};

export type PermitNumberResult = {
  /** 計画の欄に書かれた表記（前後の空白は除く）。 */
  readonly numberText: string;
  readonly numberKey: string;
  readonly status: PermitMatchStatus;
  /** 満たさなかった規則（not_applied・unregistered のとき）。 */
  readonly reasons: readonly PermitReason[];
  /** 結びついた登録。unregistered は null（取消済みだけがある場合も null。理由は voided）。 */
  readonly registration: PermitRegistration | null;
  /** applied・reference のとき、この計画で関係した種類。 */
  readonly relevantKinds: readonly PermitKind[];
  /** 有効な最終日（満了日と、失効日の前日の早いほう）。登録があるとき。 */
  readonly effectiveLastDate: string | null;
};

export type PermitCandidate = {
  readonly registration: PermitRegistration;
  readonly relevantKinds: readonly PermitKind[];
  readonly effectiveLastDate: string;
};

export type PermitMatchResult = {
  /** 照合した飛行の窓。計画の予定開始が読めないときは null（何も適用しない）。 */
  readonly window: { readonly from: string; readonly to: string } | null;
  readonly numbers: readonly PermitNumberResult[];
  /** 判定の入力 pilotPermits に足す値（DIPS の 8 種の mlit:<種類> だけ。並べ替え済み、重複なし）。 */
  readonly grantedValues: readonly string[];
  /** applied・reference の登録（有効な最終日の遅い順、番号の昇順）。 */
  readonly basis: readonly PermitBasisEntry[];
  /** 番号が欄にない登録のうち、範囲に収まり関係する種類を含むもの（提案の表示用。判定には使わない）。 */
  readonly candidates: readonly PermitCandidate[];
};

export const EMPTY_PERMIT_MATCH: PermitMatchResult = { window: null, numbers: [], grantedValues: [], basis: [], candidates: [] };

/** 判定の入力に足すもの（matchPlanPermits の結果のうち判定に関わる部分）。 */
export type PermitApplication = Pick<PermitMatchResult, "grantedValues" | "basis">;

export const EMPTY_PERMIT_APPLICATION: PermitApplication = { grantedValues: [], basis: [] };

// ---- 照合 ----------------------------------------------------

/** 計画に関係する DIPS の種類：did（地点が DID かは判定が決めるため常に）と、判定の入力のフラグに対応する種類。 */
export const relevantDipsKinds = (flags: readonly string[]): DipsPermitKind[] => {
  const want = new Set<DipsPermitKind>(["did"]);
  for (const f of flags) {
    const v = (DIPS_PERMIT_BY_FLAG as Readonly<Record<string, string | undefined>>)[f];
    const kind = DIPS_PERMIT_KINDS.find((k) => dipsPermitValue(k) === v);
    if (kind) want.add(kind);
  }
  return DIPS_PERMIT_KINDS.filter((k) => want.has(k));
};

/** 有効な最終日 = min(valid_to, revoked_on の前日)。 */
export const effectiveLastDate = (r: Pick<PermitRegistration, "validTo" | "revokedOn">): string => {
  if (r.revokedOn === null) return r.validTo;
  const before = addDays(r.revokedOn, -1);
  return before < r.validTo ? before : r.validTo;
};

/** 円の包含：（計画の中心と円の中心の距離［m、整数に切り上げ］＋ 計画の半径）≤ 円の半径。 */
const circleContains = (c: PermitCircle, plan: PlanPermitInput, radiusM: number): boolean => {
  const d = Math.ceil(haversineMeters({ lat: plan.lat, lng: plan.lng }, { lat: c.lat, lng: c.lng }));
  return d + radiusM <= c.radiusM;
};

/** 登録 1 件を計画に当てる。満たさない規則はすべて返す（途中で止めない）。 */
export const checkRegistration = (r: PermitRegistration, plan: PlanPermitInput, window: { readonly from: string; readonly to: string } | null): PermitReason[] => {
  const reasons: PermitReason[] = [];
  if (r.voided) return ["voided"];
  // R2 期間
  if (window === null) {
    reasons.push("not_started");
  } else {
    if (window.from < r.validFrom) reasons.push("not_started");
    const last = effectiveLastDate(r);
    if (window.to > last) {
      // 失効が有効な最終日を縮めているときは revoked、期間の満了は expired
      const cutByRevocation = r.revokedOn !== null && addDays(r.revokedOn, -1) < r.validTo;
      reasons.push(cutByRevocation ? "revoked" : "expired");
    }
  }
  // R3 場所
  const place = r.placeScope;
  if (place.type === "text") reasons.push("place_not_checkable");
  else if (place.type === "circles") {
    if (plan.radiusM === null) reasons.push("place_extent_unknown");
    else if (!place.circles.some((c) => circleContains(c, plan, plan.radiusM as number))) reasons.push("place_out_of_scope");
  }
  // R4・R5 機体・操縦者
  if (r.aircraftScope.type === "listed" && !r.aircraftScope.ids.includes(plan.aircraftId)) reasons.push("aircraft_out_of_scope");
  if (r.pilotScope.type === "listed" && !r.pilotScope.ids.includes(plan.pilotId)) reasons.push("pilot_out_of_scope");
  // R6 高度
  if (r.maxAltitudeM !== null) {
    if (plan.maxAltitudeM === null) reasons.push("altitude_unknown");
    else if (plan.maxAltitudeM > r.maxAltitudeM) reasons.push("altitude_over_limit");
  }
  // R7 重量（g に直して比べる）
  if (r.maxWeightKg !== null) {
    if (plan.aircraftWeightG === null) reasons.push("weight_unknown");
    else if (plan.aircraftWeightG > Math.round(r.maxWeightKg * 1000)) reasons.push("weight_over_limit");
  }
  // R8 補助者（登録の種類に bvlos を含み、計画が method_bvlos を選んでいるとき）
  if (r.requiresObserver && r.kinds.includes("bvlos") && plan.flags.includes("method_bvlos") && plan.observer !== true) {
    reasons.push("observer_required");
  }
  // R9 立入管理措置
  if (r.requiresAccessControl && plan.accessControl !== true) reasons.push("access_control_required");
  return reasons;
};

const compareByEffectiveLast = (a: { readonly last: string; readonly number: string }, b: { readonly last: string; readonly number: string }): number =>
  a.last < b.last ? 1 : a.last > b.last ? -1 : a.number < b.number ? -1 : a.number > b.number ? 1 : 0;

/**
 * 計画の許可番号の欄の番号を登録に結びつけ、範囲に収まるものだけを適用する（設計 C）。
 * 範囲外・期限切れ・失効・取消・未登録・確認できないものは適用しない（要手続きのまま）。出力は決定的。
 */
export const matchPlanPermits = (plan: PlanPermitInput, registrations: readonly PermitRegistration[]): PermitMatchResult => {
  const window = flightWindow(plan.startAt, plan.durationMinutes);
  const tokens = splitPermitNumbers(plan.permitNumbers);
  const wanted = relevantDipsKinds(plan.flags);
  // 取消していない登録を優先する（取消した番号は再登録できるため、同じ鍵が複数ありうる）
  const byKey = new Map<string, PermitRegistration>();
  for (const r of registrations) {
    const cur = byKey.get(r.permitNumberKey);
    if (!cur || (cur.voided && !r.voided)) byKey.set(r.permitNumberKey, r);
  }

  const numbers: PermitNumberResult[] = tokens.map((t): PermitNumberResult => {
    const reg = byKey.get(t.key);
    if (!reg) {
      return { numberText: t.text, numberKey: t.key, status: "unregistered", reasons: [], registration: null, relevantKinds: [], effectiveLastDate: null };
    }
    if (reg.voided) {
      return { numberText: t.text, numberKey: t.key, status: "unregistered", reasons: ["voided"], registration: null, relevantKinds: [], effectiveLastDate: null };
    }
    const last = effectiveLastDate(reg);
    const reasons = checkRegistration(reg, plan, window);
    if (reasons.length > 0) {
      return { numberText: t.text, numberKey: t.key, status: "not_applied", reasons, registration: reg, relevantKinds: [], effectiveLastDate: last };
    }
    const dips = wanted.filter((k) => reg.kinds.includes(k));
    const hasAirport = reg.kinds.includes("airport");
    if (dips.length > 0) {
      const relevantKinds: PermitKind[] = hasAirport ? [...dips, "airport"] : dips;
      return { numberText: t.text, numberKey: t.key, status: "applied", reasons: [], registration: reg, relevantKinds, effectiveLastDate: last };
    }
    if (hasAirport) {
      return { numberText: t.text, numberKey: t.key, status: "reference", reasons: [], registration: reg, relevantKinds: ["airport"], effectiveLastDate: last };
    }
    return { numberText: t.text, numberKey: t.key, status: "not_relevant", reasons: [], registration: reg, relevantKinds: [], effectiveLastDate: last };
  });

  // 判定に足す値：applied の登録の、関係する DIPS の種類だけ
  const granted = new Set<string>();
  for (const n of numbers) {
    if (n.status !== "applied") continue;
    for (const k of n.relevantKinds) if (isDipsKind(k)) granted.add(dipsPermitValue(k));
  }
  const grantedValues = [...granted].sort();

  // 根拠：applied・reference を、有効な最終日の遅い順・番号の昇順に
  const basis = numbers
    .filter((n) => (n.status === "applied" || n.status === "reference") && n.registration !== null && window !== null)
    .map((n) => ({ n, last: n.effectiveLastDate as string, number: n.registration!.permitNumber }))
    .sort(compareByEffectiveLast)
    .map(({ n }): PermitBasisEntry => {
      const r = n.registration!;
      return {
        registrationId: r.id,
        versionNo: r.versionNo,
        versionHash: r.versionHash,
        permitNumber: r.permitNumber,
        coverage: r.coverage,
        kinds: n.relevantKinds,
        applied: n.status === "applied",
        validFrom: r.validFrom,
        validTo: n.effectiveLastDate as string,
        window: { from: window!.from, to: window!.to },
      };
    });

  // 候補：番号が欄にない登録のうち、applied と同じ判定になるもの
  const inField = new Set(tokens.map((t) => t.key));
  const candidates = registrations
    .filter((r) => !r.voided && !inField.has(r.permitNumberKey))
    .filter((r) => checkRegistration(r, plan, window).length === 0 && wanted.some((k) => r.kinds.includes(k)))
    .map((r) => ({ registration: r, relevantKinds: wanted.filter((k) => r.kinds.includes(k)) as readonly PermitKind[], effectiveLastDate: effectiveLastDate(r) }))
    .sort((a, b) => compareByEffectiveLast({ last: a.effectiveLastDate, number: a.registration.permitNumber }, { last: b.effectiveLastDate, number: b.registration.permitNumber }));

  return { window, numbers, grantedValues, basis, candidates };
};

// ---- 登録の有効性（一覧用。今日の日付で求める） ------------------

export type PermitValidity = "upcoming" | "valid" | "expiring" | "expired" | "revoked" | "voided";

/** 満了まで何日以内を「期限間近」とするか（表示だけ。次にやることには出さない）。 */
export const PERMIT_EXPIRING_DAYS = 30;

export const permitValidity = (r: Pick<PermitRegistration, "validFrom" | "validTo" | "status" | "voided">, today: string): PermitValidity => {
  if (r.voided) return "voided";
  if (r.status === "revoked") return "revoked";
  if (today < r.validFrom) return "upcoming";
  if (today > r.validTo) return "expired";
  if (daysBetween(today, r.validTo) <= PERMIT_EXPIRING_DAYS) return "expiring";
  return "valid";
};

// ---- 文言（画面・API が共有する定数。1 か所） -------------------

/** 登録の有効性の表示（文字 + 記号。色だけで区別しない）。 */
export const PERMIT_VALIDITY_LABEL: Readonly<Record<PermitValidity, string>> = {
  upcoming: "◇ 開始前",
  valid: "● 有効",
  expiring: "▲ 期限間近（30 日以内）",
  expired: "× 期限切れ",
  revoked: "× 失効",
  voided: "× 取消",
};

/** 照合の状態の表示（文字 + 記号）。 */
export const PERMIT_MATCH_STATUS_LABEL: Readonly<Record<PermitMatchStatus, string>> = {
  applied: "● 適用",
  reference: "◇ 参考（空港等周辺。判定の段は変えません）",
  not_relevant: "－ 関係なし",
  not_applied: "× 適用しない",
  unregistered: "？ 未登録（判定には使いません）",
};

/** 理由コードごとの文（画面・API の応答が共有する）。 */
export const PERMIT_REASON_LABEL: Readonly<Record<PermitReason, string>> = {
  voided: "取消された登録です",
  not_started: "飛行の日が許可期間の開始前です",
  expired: "許可期間が飛行の最終日より前に終わっています",
  revoked: "飛行の最終日までに失効しています",
  place_out_of_scope: "飛行の場所が許可の範囲（円）に収まっていません",
  place_extent_unknown: "計画の範囲の半径が未入力のため、場所が許可の範囲に収まるか確かめられません",
  place_not_checkable: "許可の場所が文章だけのため、照合できません（許可書で確認してください）",
  aircraft_out_of_scope: "計画の機体が許可の機体に含まれていません",
  pilot_out_of_scope: "計画の操縦者が許可の操縦者に含まれていません",
  altitude_over_limit: "計画の最大高度が許可の条件を超えています",
  altitude_unknown: "計画の最大高度が未入力のため、許可の高度の条件を確かめられません",
  weight_over_limit: "機体の最大離陸重量が許可の条件を超えています",
  weight_unknown: "機体の最大離陸重量が分からないため、許可の重量の条件を確かめられません",
  observer_required: "許可の条件は補助者の配置です。計画で補助者の配置が「あり」になっていません",
  access_control_required: "許可の条件は立入管理措置です。計画で立入管理措置が「あり」になっていません",
};

export const PERMIT_KIND_LABEL: Readonly<Record<PermitKind, string>> = {
  ...DIPS_PERMIT_LABEL,
  airport: "空港等周辺の個別許可（調整が要る許可。判定の段は変えません）",
};

/** 登録は利用者の申告である旨（画面・API の応答に常に添える）。 */
export const PERMIT_DECLARATION_NOTE = "登録は利用者の入力です。許可書で確認してください。";

/** 登録は DIPS に接続しない旨（固定の文言）。 */
export const PERMIT_NO_DIPS_NOTE = "このアプリは DIPS に接続しません。許可・承認の結果は、利用者が登録します。";

/** 判定の「手続き済み（条件付き）」の項目で、登録が根拠のときにエンジンの注記の代わりに出す文（表示だけの置き換え）。 */
export const permitAppliedNote = (permitNumber: string): string =>
  `登録した許可（${permitNumber}）の範囲と期間に収まっています。${PERMIT_DECLARATION_NOTE}`;

/** 空港等周辺の項目に添える文（参考の登録があるとき）。 */
export const permitAirportReferenceNote = (permitNumber: string): string =>
  `個別許可の登録があります（${permitNumber}）。判定の段は変えていません。許可書の条件と空港の設置管理者等との調整を確認してください。`;

/** 範囲・様式の文言に添える要確認の注記（包括許可・個別許可の実際の様式は未照合）。 */
export const PERMIT_FORMAT_UNVERIFIED_NOTE =
  "※要確認：包括許可・個別許可の様式、書かれる条件、除外される空域・飛行の方法は、国土交通省の資料と照合していません。許可書で確認してください。";

/** 機体・操縦者を限定しない（any）を選んだときの注記。 */
export const PERMIT_ANY_SCOPE_NOTE = "限定しない場合も、許可書に機体・操縦者の限定がないか許可書で確認してください。";

/** 場所を文章のみにしたときの注記。 */
export const PERMIT_TEXT_PLACE_NOTE = "場所が文章だけの許可は照合できないため、判定には適用しません。";

/** 計画の DIPS の許可・承認を手入力できなくなった旨（400 dips_permit_from_registry の理由と、画面の案内）。 */
export const DIPS_PERMIT_FROM_REGISTRY_MESSAGE = "許可・承認は登録から照合します。許可・承認の登録を作り、許可番号の欄に番号を入れてください。";

/** 計画の許可番号の欄に、登録にない番号があるときの警告。 */
export const PERMIT_UNREGISTERED_WARNING = "登録にありません。判定には使いません。";

// ---- 計画の DTO・API の応答に使う要約（画面・API が共有） --------------------

export type PermitNumberSummary = {
  readonly numberText: string;
  readonly status: PermitMatchStatus;
  readonly statusLabel: string;
  readonly reasons: readonly { readonly code: PermitReason; readonly label: string }[];
  readonly registrationId: string | null;
  readonly permitNumber: string | null;
  /** 照合に使った登録の版（スナップショットの根拠と同じ値）。 */
  readonly versionNo: number | null;
  readonly versionHash: string | null;
  readonly validFrom: string | null;
  /** 有効な最終日（満了日と、失効日の前日の早いほう）。 */
  readonly validTo: string | null;
  readonly kinds: readonly { readonly kind: PermitKind; readonly label: string }[];
  /** 適用した登録に常に添える、機械的に照合できない条件の文章。 */
  readonly conditionsText: string | null;
  /** 機体・操縦者を限定しない登録に添える注記（許可書で確認）。 */
  readonly scopeNotes: readonly string[];
};

export type PlanPermitSummary = {
  /** 照合した飛行の窓（JST の開始日・最終日）。許可番号のない計画は null。 */
  readonly window: { readonly from: string; readonly to: string } | null;
  readonly numbers: readonly PermitNumberSummary[];
  /** 判定の入力に足した DIPS の値。 */
  readonly grantedValues: readonly string[];
  readonly appliedCount: number;
  readonly referenceCount: number;
  readonly unregisteredCount: number;
  /** 常に添える固定の文言（登録は利用者の入力。許可書で確認）。 */
  readonly note: string;
};

export const summarizePermitMatch = (m: PermitMatchResult): PlanPermitSummary => ({
  window: m.window,
  numbers: m.numbers.map((n): PermitNumberSummary => {
    const r = n.registration;
    const scopeNotes: string[] = [];
    if (r && (r.aircraftScope.type === "any" || r.pilotScope.type === "any")) scopeNotes.push(PERMIT_ANY_SCOPE_NOTE);
    return {
      numberText: n.numberText,
      status: n.status,
      statusLabel: PERMIT_MATCH_STATUS_LABEL[n.status],
      reasons: n.reasons.map((code) => ({ code, label: PERMIT_REASON_LABEL[code] })),
      registrationId: r?.id ?? null,
      permitNumber: r?.permitNumber ?? null,
      versionNo: r?.versionNo ?? null,
      versionHash: r?.versionHash ?? null,
      validFrom: r?.validFrom ?? null,
      validTo: n.effectiveLastDate,
      kinds: n.relevantKinds.map((kind) => ({ kind, label: PERMIT_KIND_LABEL[kind] })),
      conditionsText: n.status === "applied" || n.status === "reference" ? (r?.conditionsText ?? null) : null,
      scopeNotes,
    };
  }),
  grantedValues: m.grantedValues,
  appliedCount: m.numbers.filter((n) => n.status === "applied").length,
  referenceCount: m.numbers.filter((n) => n.status === "reference").length,
  unregisteredCount: m.numbers.filter((n) => n.status === "unregistered").length,
  note: PERMIT_DECLARATION_NOTE,
});

/** 通報に許可書発行日・許可期間を出す登録：適用された登録がちょうど 1 件のときだけ（無い・複数なら null）。 */
export const reportRegistrationOf = (m: Pick<PermitMatchResult, "numbers">): PermitRegistration | null => {
  const applied = m.numbers.filter((n) => n.status === "applied" && n.registration !== null);
  return applied.length === 1 ? applied[0]!.registration : null;
};
