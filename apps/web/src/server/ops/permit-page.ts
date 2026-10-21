// 許可・承認の登録の画面（サーバーコンポーネント）が使う選択肢の読み出し。認可・組織の絞り込みはサービス層が行う。
import { DIPS_PERMIT_BY_FLAG, dipsPermitValue } from "@soraban/regulations";
import { permitAirportReferenceNote, permitAppliedNote, type PermitKind, type PlanPermitSummary } from "./permit-logic";
import { getPlanPermits, listPermits } from "./permits";
import { listAircraft, listPilots, type OpsContext } from "./service";

/** 範囲に選べる機体（登録記号）・操縦者（氏名）。取消済みは、すでに範囲に選んでいる（keepIds）ものだけ残す。 */
export const permitFormOptions = async (
  ctx: OpsContext,
  keepIds: readonly string[] = [],
): Promise<{ aircraft: { id: string; label: string }[]; pilots: { id: string; label: string }[] }> => {
  const keep = new Set(keepIds);
  const [aircraft, pilots] = await Promise.all([listAircraft(ctx, true), listPilots(ctx, true)]);
  return {
    aircraft: aircraft
      .filter((a) => !a.voided || keep.has(a.id))
      .map((a) => ({ id: a.id, label: `${a.registrationMark}（${a.modelName}）${a.voided ? "［取消済み］" : ""}` })),
    pilots: pilots.filter((p) => !p.voided || keep.has(p.id)).map((p) => ({ id: p.id, label: `${p.fullName}${p.voided ? "［取消済み］" : ""}` })),
  };
};

// ---- 判定の項目への「表示だけの置き換え」 ------------------------------------

/** 判定の要約（VerdictSummary）に渡す、許可の登録に基づく表示の置き換え。スナップショットの結果は変えない。 */
export type VerdictPermitNotes = {
  /** 登録が根拠の項目（項目の id）→ エンジンの「範囲と有効期間は照合していません」の代わりに出す文。 */
  readonly applied: Readonly<Record<string, string>>;
  /** 項目（項目の id）に添える文（空港等周辺の参考の登録）。判定の段は変えない。 */
  readonly item: Readonly<Record<string, string>>;
};

const itemIdsOfKind = (kind: PermitKind): string[] => {
  if (kind === "did") return ["aviation-law-did", "airspace_did"];
  if (kind === "airport") return ["aviation-law-airport", "airspace_airport"];
  const value = dipsPermitValue(kind);
  return Object.entries(DIPS_PERMIT_BY_FLAG)
    .filter(([, v]) => v === value)
    .map(([flag]) => flag);
};

/** 計画の照合の要約から、判定の項目ごとの表示の置き換えを作る（適用した種類の項目と、参考の空港等周辺の項目）。 */
export const verdictPermitNotes = (summary: PlanPermitSummary): VerdictPermitNotes => {
  const appliedNumbers = new Map<string, string[]>();
  const referenceNumbers = new Map<string, string[]>();
  for (const n of summary.numbers) {
    if (n.status !== "applied" && n.status !== "reference") continue;
    const label = n.permitNumber ?? n.numberText;
    for (const k of n.kinds) {
      for (const id of itemIdsOfKind(k.kind)) {
        const target = n.status === "reference" || k.kind === "airport" ? referenceNumbers : appliedNumbers;
        target.set(id, [...(target.get(id) ?? []), label]);
      }
    }
  }
  const applied: Record<string, string> = {};
  for (const [id, nums] of appliedNumbers) applied[id] = permitAppliedNote([...new Set(nums)].join("・"));
  const item: Record<string, string> = {};
  for (const [id, nums] of referenceNumbers) item[id] = permitAirportReferenceNote([...new Set(nums)].join("・"));
  return { applied, item };
};

// ---- 計画のフォームの許可番号の案内 -------------------------------------------

/** 計画のフォームに渡す、許可番号の欄の案内（番号ごとの保存済みの照合の結果と、候補）。 */
export type PermitHelper = {
  /** 保存済みの計画の照合の結果（訂正のときだけ）。保存すると、入力の内容で照合し直す。 */
  readonly saved: readonly { readonly numberText: string; readonly status: string; readonly statusLabel: string; readonly reasons: readonly string[] }[];
  /** 「番号を入れる」の候補。訂正：範囲に収まるもの（番号が欄にないもの）。新規：有効な登録（範囲の照合は保存したときに行う）。 */
  readonly candidates: readonly { readonly permitNumber: string; readonly summary: string }[];
  readonly candidatesNote: string;
  /** 取消していない登録の番号（欄の番号が登録にあるかを、入力中に示すため）。 */
  readonly registeredNumbers: readonly string[];
};

export const permitHelperFor = async (ctx: OpsContext, planId: string | null): Promise<PermitHelper> => {
  const registry = await listPermits(ctx, {});
  const registeredNumbers = registry.map((r) => r.permitNumber);
  if (planId !== null) {
    const m = await getPlanPermits(ctx, planId);
    return {
      saved: m.permits.numbers.map((n) => ({ numberText: n.numberText, status: n.status, statusLabel: n.statusLabel, reasons: n.reasons.map((r) => r.label) })),
      candidates: m.candidates.map((c) => ({
        permitNumber: c.insertText,
        summary: `${c.coverageLabel}／${c.kinds.map((k) => k.label).join("、")}／版 ${c.versionNo}／${c.validFrom} 〜 ${c.validTo}`,
      })),
      candidatesNote: "保存した計画の日時・場所・機体・操縦者が範囲に収まる登録です。番号を欄に足すだけで、保存するまで判定には使いません。",
      registeredNumbers,
    };
  }
  return {
    saved: [],
    candidates: registry
      .filter((r) => r.validity === "valid" || r.validity === "expiring" || r.validity === "upcoming")
      .map((r) => ({ permitNumber: r.permitNumber, summary: `${r.coverageLabel}／${r.kinds.map((k) => k.label).join("、")}／${r.validFrom} 〜 ${r.validTo}` })),
    candidatesNote: "登録済みの許可・承認です。範囲に収まるかは、計画を保存したときに照合します（収まらなければ判定には使いません）。",
    registeredNumbers,
  };
};

/** スナップショットが根拠にした登録（permitBasis）から、判定の項目への表示の置き換えを作る（保存した判定を、保存したときの根拠で見せる）。 */
export const verdictPermitNotesFromBasis = (
  basis: readonly { readonly permitNumber: string; readonly kinds: readonly PermitKind[]; readonly applied: boolean }[],
): VerdictPermitNotes =>
  verdictPermitNotes({
    window: null,
    numbers: basis.map((b) => ({
      numberText: b.permitNumber,
      status: b.applied ? "applied" : "reference",
      statusLabel: "",
      reasons: [],
      registrationId: null,
      permitNumber: b.permitNumber,
      versionNo: null,
      versionHash: null,
      validFrom: null,
      validTo: null,
      kinds: b.kinds.map((kind) => ({ kind, label: "" })),
      conditionsText: null,
      scopeNotes: [],
    })),
    grantedValues: [],
    appliedCount: 0,
    referenceCount: 0,
    unregisteredCount: 0,
    note: "",
  });
