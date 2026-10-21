// Sprint 12c 契約 14（単体）：画面の消灯の防止。navigator.wakeLock を差し替えて確かめる。
import { describe, expect, it } from "vitest";
import { decideWakeLock, WakeLockController, wakeLockNote, type WakeLockEnv, type WakeLockSentinelLike } from "./wake-lock";

class FakeSentinel implements WakeLockSentinelLike {
  released = false;
  private listeners: (() => void)[] = [];
  async release(): Promise<void> {
    this.released = true;
    for (const l of this.listeners) l();
  }
  addEventListener(_t: "release", l: () => void): void {
    this.listeners.push(l);
  }
  /** 端末側の解放（画面が隠れた等）。 */
  fireRelease(): void {
    this.released = true;
    for (const l of this.listeners) l();
  }
}

const makeEnv = (over: { wakeLock?: boolean; secure?: boolean; failRequest?: boolean } = {}) => {
  const state = { visible: true, listeners: [] as (() => void)[], requests: 0, sentinels: [] as FakeSentinel[] };
  const env: WakeLockEnv = {
    ...(over.wakeLock === false
      ? {}
      : {
          wakeLock: {
            request: async () => {
              state.requests += 1;
              if (over.failRequest) throw new Error("NotAllowedError");
              const s = new FakeSentinel();
              state.sentinels.push(s);
              return s;
            },
          },
        }),
    isSecureContext: over.secure ?? true,
    visibility: () => (state.visible ? "visible" : "hidden"),
    onVisibilityChange: (l) => {
      state.listeners.push(l);
      return () => {
        state.listeners = state.listeners.filter((x) => x !== l);
      };
    },
  };
  const setVisible = async (v: boolean) => {
    state.visible = v;
    for (const l of [...state.listeners]) l();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { env, state, setVisible };
};

describe("decideWakeLock", () => {
  const ok = { inFlight: true, visible: true, supported: true, secure: true, held: false };
  it("飛行中・表示中・対応・HTTPS のときだけ取得する", () => {
    expect(decideWakeLock(ok)).toBe("acquire");
    for (const k of ["inFlight", "visible", "supported", "secure"] as const) expect(decideWakeLock({ ...ok, [k]: false })).toBe("none");
  });
  it("保持中に、着陸・画面が隠れた・非対応になったら解放する。条件が続けば何もしない", () => {
    expect(decideWakeLock({ ...ok, held: true })).toBe("none");
    expect(decideWakeLock({ ...ok, held: true, inFlight: false })).toBe("release");
    expect(decideWakeLock({ ...ok, held: true, visible: false })).toBe("release");
  });
});

describe("WakeLockController", () => {
  it("飛行中だけ取得し、着陸（飛行中でなくなる）で解放する", async () => {
    const { env, state } = makeEnv();
    const statuses: string[] = [];
    const c = new WakeLockController(env, (s) => statuses.push(s));
    await c.setInFlight(false);
    expect(state.requests).toBe(0);
    await c.setInFlight(true);
    expect(state.requests).toBe(1);
    expect(c.status).toBe("held");
    await c.setInFlight(true);
    expect(state.requests).toBe(1);
    await c.setInFlight(false);
    expect(state.sentinels[0]!.released).toBe(true);
    expect(c.status).toBe("idle");
    expect(statuses).toEqual(["held", "idle"]);
    await c.destroy();
  });

  it("取り消す（飛行中でなくなる）でも解放し、離陸で取り直す", async () => {
    const { env, state } = makeEnv();
    const c = new WakeLockController(env);
    await c.setInFlight(true);
    await c.setInFlight(false);
    await c.setInFlight(true);
    expect(state.requests).toBe(2);
    expect(state.sentinels[0]!.released).toBe(true);
    expect(state.sentinels[1]!.released).toBe(false);
    await c.destroy();
    expect(state.sentinels[1]!.released).toBe(true);
  });

  it("画面が隠れたら解放し、戻ったら取り直す", async () => {
    const { env, state, setVisible } = makeEnv();
    const c = new WakeLockController(env);
    await c.setInFlight(true);
    await setVisible(false);
    expect(state.sentinels[0]!.released).toBe(true);
    expect(c.status).toBe("idle");
    await setVisible(true);
    expect(state.requests).toBe(2);
    expect(c.status).toBe("held");
    await c.destroy();
  });

  it("端末側で解放された（release イベント）あと、画面が戻れば取り直せる", async () => {
    const { env, state, setVisible } = makeEnv();
    const c = new WakeLockController(env);
    await c.setInFlight(true);
    state.sentinels[0]!.fireRelease();
    expect(c.status).toBe("idle");
    await setVisible(true);
    expect(state.requests).toBe(2);
    await c.destroy();
  });

  it("非対応の端末：何も壊さず、何も呼ばない。注記だけを出す", async () => {
    const { env, state } = makeEnv({ wakeLock: false });
    const c = new WakeLockController(env);
    expect(c.status).toBe("unsupported");
    await c.setInFlight(true);
    expect(state.requests).toBe(0);
    expect(c.status).toBe("unsupported");
    expect(wakeLockNote(c.status, true)).toBe("この端末では画面の消灯を防げません。画面の自動ロックの設定を確かめてください。");
    expect(wakeLockNote(c.status, false)).toBeNull();
  });

  it("HTTPS でない：取得しない。注記を出す", async () => {
    const { env, state } = makeEnv({ secure: false });
    const c = new WakeLockController(env);
    await c.setInFlight(true);
    expect(state.requests).toBe(0);
    expect(c.status).toBe("insecure");
    expect(wakeLockNote(c.status, true)).not.toBeNull();
  });

  it("取得に失敗（省電力モード等）：例外にせず failed。注記を出す。次の機会に取り直せる", async () => {
    const { env, state } = makeEnv({ failRequest: true });
    const c = new WakeLockController(env);
    await expect(c.setInFlight(true)).resolves.toBeUndefined();
    expect(c.status).toBe("failed");
    expect(state.requests).toBe(1);
    expect(wakeLockNote(c.status, true)).not.toBeNull();
    await c.setInFlight(true);
    expect(state.requests).toBe(2);
  });

  it("取得を待っている間に着陸した：取得したものはすぐ解放する", async () => {
    const { env, state } = makeEnv();
    const c = new WakeLockController(env);
    const p = c.setInFlight(true);
    void c.setInFlight(false);
    await p;
    await new Promise((r) => setTimeout(r, 0));
    expect(state.sentinels.every((s) => s.released)).toBe(true);
    expect(c.status === "idle" || c.status === "held").toBe(true);
    expect(wakeLockNote("held", true)).toBeNull();
  });
});
