// 認可の判断（Sprint 10 設計 B「役割ごとの操作」）。純粋関数 1 か所にまとめ、単体テストで全組み合わせを確かめる。
import type { MemberRoleDb } from "@soraban/db";

export type OpsAction =
  | "aircraft.read"
  | "aircraft.create"
  | "aircraft.update"
  | "aircraft.void"
  | "pilot.read"
  | "pilot.create"
  | "pilot.void"
  | "pilot.link"
  | "pilot.update"
  | "pilot.readLicenseNumber"
  | "member.read"
  | "member.invite"
  | "member.update"
  // Sprint 11：飛行記録・日常点検記録
  | "flight.read"
  | "flight.create"
  | "flight.update"
  | "flight.void"
  | "flight.readLicenseNumber"
  | "inspection.read"
  | "inspection.create"
  | "inspection.update"
  | "inspection.void"
  // Sprint 12a：飛行計画・判定スナップショット・運航管理者の確認・よく使う地点
  | "plan.read"
  | "plan.create"
  | "plan.update"
  | "plan.cancel"
  | "plan.confirm"
  | "snapshot.read"
  | "place.read"
  | "place.create"
  | "place.update"
  | "place.void"
  // Sprint 12b：通報の記録・手続きの「済み」の記録
  | "report.read"
  | "report.record"
  | "report.correct"
  | "report.retract"
  | "report.resolve"
  | "report.copyAudit"
  | "procedure.record"
  // Sprint 12c：現場モード（飛行前の確認・離着陸・取り消す）と「今日」。閲覧は全役割。記録は運航管理者は全員分（代理入力）、
  // 操縦者は自分が操縦者の計画だけ、閲覧者は不可
  | "field.read"
  | "field.record";

export type AuthzContext = {
  /**
   * 対象の操縦者が、操作する利用者自身に結び付いているか（pilot.update・pilot.readLicenseNumber で使う）。
   * 飛行記録・日常点検では、記録の操縦者（実施者）の行が自分に結び付いているか（Sprint 11 設計 D「自分の分」）。
   * 飛行計画（plan.create・plan.update・plan.cancel）では、計画の操縦者の行が自分に結び付いているか（Sprint 12a 設計 D）。
   * 現場の記録（field.record）も同じ。通報・手続きの記録（report.record 等・procedure.record）も、計画の操縦者の行が自分に結び付いているか（Sprint 12b 設計 F）。
   * 操縦者の行に結び付いていない操縦者役割の利用者は、常に isSelf=false になる。
   */
  readonly isSelf?: boolean;
};

export const OPS_ACTIONS: readonly OpsAction[] = [
  "aircraft.read",
  "aircraft.create",
  "aircraft.update",
  "aircraft.void",
  "pilot.read",
  "pilot.create",
  "pilot.void",
  "pilot.link",
  "pilot.update",
  "pilot.readLicenseNumber",
  "member.read",
  "member.invite",
  "member.update",
  "flight.read",
  "flight.create",
  "flight.update",
  "flight.void",
  "flight.readLicenseNumber",
  "inspection.read",
  "inspection.create",
  "inspection.update",
  "inspection.void",
  "plan.read",
  "plan.create",
  "plan.update",
  "plan.cancel",
  "plan.confirm",
  "snapshot.read",
  "place.read",
  "place.create",
  "place.update",
  "place.void",
  "report.read",
  "report.record",
  "report.correct",
  "report.retract",
  "report.resolve",
  "report.copyAudit",
  "procedure.record",
  "field.read",
  "field.record",
];

export const can = (role: MemberRoleDb, action: OpsAction, ctx: AuthzContext = {}): boolean => {
  switch (action) {
    case "aircraft.read":
    case "pilot.read":
    case "flight.read":
    case "inspection.read":
    case "plan.read":
    case "snapshot.read":
    case "place.read":
    // 通報内容・履歴・状況の閲覧は全役割（技能証明書番号の全桁は flight.readLicenseNumber と同じ規則で運航管理者と本人だけ）
    case "report.read":
    // 現場モードの状態・今日の画面の閲覧は全役割
    case "field.read":
      return true;
    case "pilot.update":
    case "pilot.readLicenseNumber":
    case "flight.create":
    case "flight.update":
    case "flight.readLicenseNumber":
    case "inspection.create":
    case "inspection.update":
    case "plan.create":
    case "plan.update":
    case "plan.cancel":
    // Sprint 12b：通報の記録・訂正・取り下げ・結果不明の確定・コピーの監査、手続きの「済み」の記録は、
    // 運航管理者は全員分、操縦者は自分が操縦者の計画だけ、閲覧者は不可
    case "report.record":
    case "report.correct":
    case "report.retract":
    case "report.resolve":
    case "report.copyAudit":
    case "procedure.record":
    case "field.record":
      return role === "manager" || (role === "pilot" && ctx.isSelf === true);
    case "aircraft.create":
    case "aircraft.update":
    case "aircraft.void":
    case "pilot.create":
    case "pilot.void":
    case "pilot.link":
    case "member.read":
    case "member.invite":
    case "member.update":
    case "flight.void":
    case "inspection.void":
    case "plan.confirm":
    case "place.create":
    case "place.update":
    case "place.void":
      return role === "manager";
  }
};
