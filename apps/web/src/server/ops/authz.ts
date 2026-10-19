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
  | "inspection.void";

export type AuthzContext = {
  /**
   * 対象の操縦者が、操作する利用者自身に結び付いているか（pilot.update・pilot.readLicenseNumber で使う）。
   * 飛行記録・日常点検では、記録の操縦者（実施者）の行が自分に結び付いているか（Sprint 11 設計 D「自分の分」）。
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
];

export const can = (role: MemberRoleDb, action: OpsAction, ctx: AuthzContext = {}): boolean => {
  switch (action) {
    case "aircraft.read":
    case "pilot.read":
    case "flight.read":
    case "inspection.read":
      return true;
    case "pilot.update":
    case "pilot.readLicenseNumber":
    case "flight.create":
    case "flight.update":
    case "flight.readLicenseNumber":
    case "inspection.create":
    case "inspection.update":
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
      return role === "manager";
  }
};
