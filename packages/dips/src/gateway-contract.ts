// ゲートウェイの契約テスト群 gatewayContract(makeAdapter)（Sprint 12b 設計 J・契約 12）。
// アダプターを引数に取る形で書き、手動・模擬で同じ群を流す。API アダプターは作らないため skip として載せ、
// 理由と skip の件数をテスト出力に表示する（通っていないことを隠さない）。
// サービス層の契約（冪等性・取消・再送・外部の呼び出しの間にトランザクションを開けない 等）は、同じようにアダプターを
// 差し替えて DB で流す（apps/web の reports.db.test.ts）。
import { describe, expect, it } from "vitest";
import type { NotificationGateway } from "./gateway";
import { prepareReport } from "./prepare";
import { basePlan } from "./test-fixtures";
import { canTransition } from "./transitions";
import type { ActorRef, ManualResult, MockScenario, ReportRef, SubmitContext } from "./types";

export const API_SKIP_REASON = "DIPS 2.0 API の申請は保留（HANDOFF 2026-10-21）。API アダプターは 12b では作らない";

const NOW = new Date("2027-01-05T03:00:00Z");
const ACTOR: ActorRef = { memberId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "運航 管理子", role: "manager" };
const MANUAL: ManualResult = {
  reportedAt: "2027-01-05T11:30",
  dipsNumber: "FP-0001",
  confirmedDipsDone: true,
  confirmedMatchesLatest: true,
};
const REF: ReportRef = { reportId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", dipsNumber: "FP-0001" };

export type ContractAdapter = {
  readonly name: string;
  readonly make: () => NotificationGateway;
  /** 送信の文脈（手動は manualResult、模擬はシナリオ）。 */
  readonly ctx: (key: string, scenario?: MockScenario) => SubmitContext;
};

const manualAdapter = (make: () => NotificationGateway): ContractAdapter => ({
  name: "manual",
  make,
  ctx: (key) => ({ idempotencyKey: key, actor: ACTOR, now: NOW, manualResult: MANUAL }),
});
const mockAdapter = (make: () => NotificationGateway): ContractAdapter => ({
  name: "mock",
  make,
  ctx: (key, scenario) => ({ idempotencyKey: key, actor: ACTOR, now: NOW, ...(scenario ? { mockScenario: scenario } : {}) }),
});

export const contractAdapter = (kind: "manual" | "mock", make: () => NotificationGateway): ContractAdapter =>
  kind === "manual" ? manualAdapter(make) : mockAdapter(make);

type Case = {
  readonly title: string;
  readonly run: (a: ContractAdapter) => Promise<void>;
  /** 外部へ送る（direct）アダプターだけに適用する。 */
  readonly directOnly?: true;
};

const KEY = "k".repeat(64);

export const GATEWAY_CONTRACT_CASES: readonly Case[] = [
  {
    title: "capabilities：mode と能力が、送信元の前提と一致する（変更はできる。取消は手動だけが送れる）",
    run: async (a) => {
      const g = a.make();
      const c = g.capabilities();
      expect(c.canChange).toBe(true);
      expect(c.canStatus).toBe(false);
      if (g.adapter === "manual") expect(c).toMatchObject({ mode: "user_reported", canCancel: true });
      else expect(c).toMatchObject({ mode: "direct", canCancel: false });
    },
  },
  {
    title: "prepare：副作用がなく、同じ入力・同じ対応表の版なら、どのアダプターでも基準の整形と同じ結果",
    run: async (a) => {
      const g = a.make();
      const plan = basePlan();
      for (const kind of ["new", "change", "cancel"] as const) {
        const first = g.prepare(plan, kind);
        expect(g.prepare(plan, kind)).toEqual(first);
        expect(first).toEqual(prepareReport(plan, kind));
      }
    },
  },
  {
    title: "submit：結果が遷移表の許す状態で、証跡 ID・指紋・対応表の版・送信元を持つ",
    run: async (a) => {
      const g = a.make();
      const prepared = g.prepare(basePlan(), "new");
      const r = await g.submit(prepared, a.ctx(KEY));
      if (g.capabilities().mode === "user_reported") {
        expect(canTransition(null, r.state, g.adapter)).toBe(true);
        expect(r.state).toBe("reported_manual");
      } else {
        expect(canTransition(null, "prepared", g.adapter)).toBe(true);
        expect(canTransition("prepared", r.state, g.adapter)).toBe(true);
      }
      expect(r.trace).toEqual({
        channel: g.adapter,
        snapshotId: prepared.snapshot.id,
        checkEvidenceId: prepared.snapshot.checkEvidenceId,
        diagnosisEvidenceId: prepared.snapshot.diagnosisEvidenceId,
        fingerprint: prepared.fingerprint,
        mapRevision: prepared.mapRevision,
      });
      expect(r.trace.snapshotId).toBeTruthy();
      expect(r.trace.checkEvidenceId).toBeTruthy();
      expect(r.trace.diagnosisEvidenceId).toBeTruthy();
    },
  },
  {
    title: "submit：同じ冪等性キーの二度目は既存の結果（二重にならない）",
    run: async (a) => {
      const g = a.make();
      const prepared = g.prepare(basePlan(), "new");
      const one = await g.submit(prepared, a.ctx(KEY));
      const two = await g.submit(prepared, a.ctx(KEY));
      expect({ ...two, replayed: false }).toEqual({ ...one, replayed: false });
      expect(two.dipsNumber).toBe(one.dipsNumber);
      expect(two.reportedAt).toBe(one.reportedAt);
      // 別のキーは別の通報（模擬は別の番号）
      const other = await g.submit(prepared, a.ctx("z".repeat(64)));
      if (g.adapter === "mock") expect(other.dipsNumber).not.toBe(one.dipsNumber);
    },
  },
  {
    title: "cancel：canCancel が真なら取消を記録できる結果、偽なら手動の記録に倒す",
    run: async (a) => {
      const g = a.make();
      const prepared = g.prepare(basePlan(), "cancel");
      const r = await g.cancel(REF, { ...a.ctx("c".repeat(64)), prepared, reason: "計画の中止" });
      if (g.capabilities().canCancel) {
        expect(r.mode).toBe("recorded");
        if (r.mode === "recorded") expect(r.result.state).toBe("reported_manual");
      } else {
        expect(r.mode).toBe("manual_record_required");
        if (r.mode === "manual_record_required") expect(r.message).toContain("DIPS の画面");
      }
    },
  },
  {
    title: "status：DIPS 側の状態は取得できない（Unsupported）",
    run: async (a) => {
      const r = await a.make().status(REF);
      expect(r).toMatchObject({ supported: false });
    },
  },
  {
    title: "模擬 timeout・server_error：結果不明（unknown）で、自動で再送しない",
    directOnly: true,
    run: async (a) => {
      const g = a.make();
      const prepared = g.prepare(basePlan(), "new");
      for (const sc of ["timeout", "server_error"] as const) {
        const r = await g.submit(prepared, a.ctx(`${sc}-${KEY}`.slice(0, 64), sc));
        expect(r.state).toBe("unknown");
        expect(r.dipsNumber).toBeNull();
        expect(r.errorKind).toBe(sc);
        expect(canTransition("prepared", "unknown", g.adapter)).toBe(true);
        // unknown から prepared への遷移（自動の再送）は表にない
        expect(canTransition("unknown", "prepared", g.adapter)).toBe(false);
      }
    },
  },
  {
    title: "模擬 rejected・unauthorized：確定した失敗（failed）。同じキーで再送でき、二重にならない",
    directOnly: true,
    run: async (a) => {
      const g = a.make();
      const prepared = g.prepare(basePlan(), "new");
      const rejected = await g.submit(prepared, a.ctx(KEY, "rejected"));
      expect(rejected).toMatchObject({ state: "failed", errorKind: "rejected", httpStatus: 400 });
      const unauth = await g.submit(prepared, a.ctx(KEY, "unauthorized"));
      expect(unauth).toMatchObject({ state: "failed", errorKind: "unauthorized", httpStatus: 401 });
      expect(unauth.message).toContain("DIPS と再度連携してください");
      expect(canTransition("failed", "prepared", g.adapter)).toBe(true);
      // 同じ行・同じキーでの再送が受理される。もう一度送っても同じ結果（二重の登録にならない）
      const retry = await g.submit(prepared, a.ctx(KEY, "ok"));
      expect(retry.state).toBe("submitted_api");
      const again = await g.submit(prepared, a.ctx(KEY, "ok"));
      expect(again.dipsNumber).toBe(retry.dipsNumber);
      expect(again.replayed).toBe(true);
    },
  },
  {
    title: "模擬 ok：FPR の応答と同じ形（flightPlanId・受付日時 yyyy/MM/dd HH:mm・重複件数）を externalRef に入れる",
    directOnly: true,
    run: async (a) => {
      const r = await a.make().submit(a.make().prepare(basePlan(), "new"), a.ctx(KEY, "ok"));
      expect(r.state).toBe("submitted_api");
      expect(r.externalRef).toMatchObject({
        flightPlanId: r.dipsNumber,
        flightPlanRegistrationResult: "登録完了",
        flightPlanRegistrationDatetime: "2027/01/05 12:00",
        existOtherFlightRoutesCount: 0,
      });
      expect(r.reportedAt).toBe("2027-01-05T12:00");
      expect(r.externalStatus).toBeNull();
    },
  },
  {
    title: "模擬 unknown_status：未知の外部状況を externalStatus に入れ、状態は増やさない（submitted_api のまま）",
    directOnly: true,
    run: async (a) => {
      const r = await a.make().submit(a.make().prepare(basePlan(), "new"), a.ctx(KEY, "unknown_status"));
      expect(r.state).toBe("submitted_api");
      expect(r.externalStatus).toEqual({ raw: "XYZ", fetchedAt: NOW.toISOString() });
    },
  },
  {
    title: "手動：二つの確認や番号が欠けた結果は受け付けない（外部には何も送らない）",
    run: async (a) => {
      const g = a.make();
      if (g.capabilities().mode !== "user_reported") return;
      const prepared = g.prepare(basePlan(), "new");
      await expect(g.submit(prepared, { idempotencyKey: KEY, actor: ACTOR, now: NOW, manualResult: { ...MANUAL, confirmedDipsDone: false } })).rejects.toMatchObject({
        name: "GatewayInputError",
      });
      await expect(g.submit(prepared, { idempotencyKey: KEY, actor: ACTOR, now: NOW })).rejects.toMatchObject({ name: "GatewayInputError" });
    },
  },
];

/** 手動・模擬の契約テストを流し、API アダプターは skip として載せる（理由と件数を出力する）。 */
export const gatewayContract = (adapters: readonly ContractAdapter[]): void => {
  for (const a of adapters) {
    describe(`ゲートウェイの契約（${a.name}）`, () => {
      const direct = a.make().capabilities().mode === "direct";
      for (const c of GATEWAY_CONTRACT_CASES) {
        if (c.directOnly && !direct) continue;
        it(c.title, () => c.run(a));
      }
    });
  }

  describe("ゲートウェイの契約（API・未実装）", () => {
    it(`API アダプターの契約は skip する（${GATEWAY_CONTRACT_CASES.length} 件。理由：${API_SKIP_REASON}）`, () => {
      console.warn(`[skip] ゲートウェイの契約 API（未実装）：${GATEWAY_CONTRACT_CASES.length} 件を skip。理由：${API_SKIP_REASON}`);
      expect(GATEWAY_CONTRACT_CASES.length).toBeGreaterThan(0);
    });
    for (const c of GATEWAY_CONTRACT_CASES) it.skip(`[api] ${c.title}`, () => undefined);
  });
};
