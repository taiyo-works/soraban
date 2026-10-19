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

  it("閲覧者は自分の操縦者であっても訂正・全桁表示ができない", () => {
    expect(can("viewer", "pilot.update", { isSelf: true })).toBe(false);
    expect(can("viewer", "pilot.readLicenseNumber", { isSelf: true })).toBe(false);
  });
});
