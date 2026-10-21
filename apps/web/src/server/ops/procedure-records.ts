// 手続きの「済み」の記録のサービス層（Sprint 12b 設計 D3・E）。許可・承認の申請（dips_permit）と、小型無人機等飛行禁止法の
// 同意・通報（small_drone_law）を、利用者の申告として追記専用の表（plan_procedure_records）に残す。
// 判定の結論（手続き済み（条件付き））は変えない。「許可済み」とは出さず、「申請済み（利用者の申告）」と表示する。
// 有効な記録は、計画ごと・種別ごとの最新の行が done のもの。記録時のスナップショットと現在のスナップショットが違うとき
// （計画の訂正や再判定で判定が変わった）は「前の判定に対する記録です」と出し、次にやることに戻る。
import { PROCEDURE_RECORD_NOTE } from "@soraban/dips";
import { loadPlanBundle } from "./plans";
import {
  procedureRecordDto,
  summarizeProcedureRecords,
  type ProcedureRecordDto,
  type ProcedureRecordSummaryDto,
} from "./report-dto";
import { asInput, assertCan, type OpsContext } from "./service";
import * as store from "./store";
import { OpsError } from "./store";
import { nowOf } from "./records";
import { validateProcedureRecord } from "./validate-report";

export type ProcedureRecordsView = {
  readonly planId: string;
  readonly planVersion: number;
  readonly snapshotId: string;
  /** 記録は利用者の申告であること。 */
  readonly note: string;
  /** 種別ごとの要約（対象かどうか・有効な記録・前の判定に対する記録・期限の文言）。 */
  readonly summary: readonly ProcedureRecordSummaryDto[];
  /** 記録の履歴（新しい順。取り下げも行として残る）。 */
  readonly records: readonly ProcedureRecordDto[];
  readonly canRecord: boolean;
};

const view = async (ctx: OpsContext, planId: string): Promise<ProcedureRecordsView> => {
  const { plan, extras, dto } = await loadPlanBundle(ctx, planId);
  const records = [...extras.records].reverse().map((r) => procedureRecordDto(r, plan.current_snapshot_id));
  return {
    planId: plan.id,
    planVersion: plan.current_version,
    snapshotId: plan.current_snapshot_id,
    note: PROCEDURE_RECORD_NOTE,
    summary: summarizeProcedureRecords(extras.records, plan),
    records,
    canRecord: assertableRecord(ctx, dto.isSelf),
  };
};

const assertableRecord = (ctx: OpsContext, isSelf: boolean): boolean => {
  try {
    assertCan(ctx, "procedure.record", isSelf);
    return true;
  } catch {
    return false;
  }
};

/** 手続きの記録の一覧と、種別ごとの要約。他の組織の計画は 404。閲覧は全役割。 */
export const listProcedureRecords = async (ctx: OpsContext, planId: string): Promise<ProcedureRecordsView> => {
  assertCan(ctx, "plan.read");
  return view(ctx, planId);
};

/**
 * 手続きの「済み」の記録を追加する（追記専用）。done はすべての確認が真のときだけ（偽は 400。DB の CHECK でも拒否）。
 * 取り下げ（retract）は理由が必須で、有効な記録があるときだけ。計画の現在のスナップショット・最新の版に対してだけ記録できる
 * （expectedPlanVersion が違えば 409）。
 */
export const createProcedureRecord = async (ctx: OpsContext, planId: string, body: unknown): Promise<ProcedureRecordsView & { readonly record: ProcedureRecordDto }> => {
  const { plan, dto, extras } = await loadPlanBundle(ctx, planId);
  assertCan(ctx, "procedure.record", dto.isSelf);
  const v = validateProcedureRecord(asInput(body), nowOf(ctx));
  if (!v.ok) throw new OpsError(400, "invalid_input", v.errors, v.codes);
  const r = v.data;
  if (r.expectedPlanVersion !== null && r.expectedPlanVersion !== plan.current_version) throw new OpsError(409, "version_conflict");
  if (r.action === "done") {
    if (plan.voided_at !== null) throw new OpsError(409, "voided");
    // 同じスナップショットに対する有効な記録が既にある（二度押し）→ 新しい行を作らない
    const latest = [...extras.records].filter((x) => x.kind === r.kind).pop();
    if (latest && latest.action === "done" && latest.snapshot_id === plan.current_snapshot_id) throw new OpsError(409, "already_recorded");
  }
  const id = await store.insertProcedureRecord(ctx.db, {
    orgId: ctx.member.org_id,
    planId: plan.id,
    kind: r.kind,
    action: r.action,
    doneAtJst: r.action === "done" ? r.doneAt : null,
    reference: r.action === "done" ? r.reference : null,
    checks:
      r.action === "done"
        ? r.kind === "dips_permit"
          ? { applicationCompleted: true }
          : { facilityConsentObtained: true, policeNoticeDone: true }
        : {},
    snapshotId: plan.current_snapshot_id,
    planVersion: plan.current_version,
    recordedByMemberId: ctx.member.id,
    reason: r.action === "retract" ? r.reason : null,
  });
  const after = await view(ctx, planId);
  const record = after.records.find((x) => x.id === id);
  if (!record) throw new OpsError(404, "not_found");
  return { ...after, record };
};

