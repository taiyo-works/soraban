// Sprint 10 契約 7：3 役割 × 設計 B の表の全操作（自分・他人の区別を含む）の可否が表と一致する。
import { describe, expect, it } from "vitest";
import { can, OPS_ACTIONS, type OpsAction } from "./authz";

type Row = { readonly action: OpsAction; readonly isSelf?: boolean; readonly manager: boolean; readonly pilot: boolean; readonly viewer: boolean };

// docs/sprints/sprint-10.md 設計 B「役割ごとの操作（第1段階）」の表をそのまま写したもの。
const TABLE: readonly Row[] = [
  // 機体・操縦者の一覧と詳細の閲覧
  { action: "aircraft.read", manager: true, pilot: true, viewer: true },
  { action: "pilot.read", manager: true, pilot: true, viewer: true },
  // 機体の登録・訂正・取消
  { action: "aircraft.create", manager: true, pilot: false, viewer: false },
  { action: "aircraft.update", manager: true, pilot: false, viewer: false },
  { action: "aircraft.void", manager: true, pilot: false, viewer: false },
  // 操縦者の登録・取消、利用者との結び付け
  { action: "pilot.create", manager: true, pilot: false, viewer: false },
  { action: "pilot.void", manager: true, pilot: false, viewer: false },
  { action: "pilot.link", manager: true, pilot: false, viewer: false },
  // 操縦者の訂正（操縦者は自分に結び付いた操縦者だけ）
  { action: "pilot.update", isSelf: true, manager: true, pilot: true, viewer: false },
  { action: "pilot.update", isSelf: false, manager: true, pilot: false, viewer: false },
  // 技能証明書番号の全桁の表示（操縦者は自分の分だけ）
  { action: "pilot.readLicenseNumber", isSelf: true, manager: true, pilot: true, viewer: false },
  { action: "pilot.readLicenseNumber", isSelf: false, manager: true, pilot: false, viewer: false },
  // 利用者の招待・役割の変更・停止
  { action: "member.read", manager: true, pilot: false, viewer: false },
  { action: "member.invite", manager: true, pilot: false, viewer: false },
  { action: "member.update", manager: true, pilot: false, viewer: false },

  // Sprint 11 契約 14：docs/sprints/sprint-11.md 設計 D の表
  // 飛行記録・日常点検記録の一覧と詳細の閲覧
  { action: "flight.read", manager: true, pilot: true, viewer: true },
  { action: "inspection.read", manager: true, pilot: true, viewer: true },
  // 飛行記録の作成（運航管理者はどの操縦者の分も、操縦者は自分に結び付いた操縦者の分だけ）
  { action: "flight.create", isSelf: true, manager: true, pilot: true, viewer: false },
  { action: "flight.create", isSelf: false, manager: true, pilot: false, viewer: false },
  // 飛行記録の訂正（操縦者は自分の分だけ）
  { action: "flight.update", isSelf: true, manager: true, pilot: true, viewer: false },
  { action: "flight.update", isSelf: false, manager: true, pilot: false, viewer: false },
  // 飛行記録の取消（運航管理者だけ。操縦者は自分の分でも不可）
  { action: "flight.void", isSelf: true, manager: true, pilot: false, viewer: false },
  { action: "flight.void", isSelf: false, manager: true, pilot: false, viewer: false },
  // 日常点検記録の作成・訂正（操縦者は実施者が自分の分だけ）
  { action: "inspection.create", isSelf: true, manager: true, pilot: true, viewer: false },
  { action: "inspection.create", isSelf: false, manager: true, pilot: false, viewer: false },
  { action: "inspection.update", isSelf: true, manager: true, pilot: true, viewer: false },
  { action: "inspection.update", isSelf: false, manager: true, pilot: false, viewer: false },
  // 日常点検記録の取消（運航管理者だけ）
  { action: "inspection.void", isSelf: true, manager: true, pilot: false, viewer: false },
  { action: "inspection.void", isSelf: false, manager: true, pilot: false, viewer: false },
  // 技能証明書番号（飛行記録の写し）の全桁（操縦者は自分の分だけ。閲覧者は不可）
  { action: "flight.readLicenseNumber", isSelf: true, manager: true, pilot: true, viewer: false },
  { action: "flight.readLicenseNumber", isSelf: false, manager: true, pilot: false, viewer: false },
];

describe("can（役割 × 操作）", () => {
  it("表がすべての操作を網羅している", () => {
    expect(new Set(TABLE.map((r) => r.action))).toEqual(new Set(OPS_ACTIONS));
  });

  for (const row of TABLE) {
    for (const role of ["manager", "pilot", "viewer"] as const) {
      it(`${role} × ${row.action}${row.isSelf === undefined ? "" : row.isSelf ? "（自分）" : "（他人）"} → ${row[role] ? "可" : "不可"}`, () => {
        expect(can(role, row.action, { isSelf: row.isSelf })).toBe(row[role]);
      });
    }
  }

  it("操縦者の行に結び付いていない操縦者役割の利用者（isSelf を渡さない）は、飛行記録・日常点検を作れない", () => {
    for (const a of ["flight.create", "flight.update", "inspection.create", "inspection.update", "flight.readLicenseNumber"] as const) {
      expect(can("pilot", a)).toBe(false);
      expect(can("pilot", a, { isSelf: false })).toBe(false);
    }
  });

  it("閲覧者は自分の操縦者であっても訂正・全桁表示ができない", () => {
    expect(can("viewer", "pilot.update", { isSelf: true })).toBe(false);
    expect(can("viewer", "pilot.readLicenseNumber", { isSelf: true })).toBe(false);
  });
});
