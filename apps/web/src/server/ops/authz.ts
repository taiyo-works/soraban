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
  | "member.update";

export type AuthzContext = {
  /** 対象の操縦者が、操作する利用者自身に結び付いているか（pilot.update・pilot.readLicenseNumber で使う）。 */
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
];

export const can = (role: MemberRoleDb, action: OpsAction, ctx: AuthzContext = {}): boolean => {
  switch (action) {
    case "aircraft.read":
    case "pilot.read":
      return true;
    case "pilot.update":
    case "pilot.readLicenseNumber":
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
      return role === "manager";
  }
};
