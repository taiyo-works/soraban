// 画面の消灯の防止（Screen Wake Lock API。Sprint 12c 設計 H・契約 14）。ブラウザに依らない判定と制御だけを置く
// （navigator・document は引数で受け、テストでは差し替える）。
//
// 規則：
//   - 飛行中（開いた離陸がある）だけ取得する。着陸・取り消す・画面が隠れたときは解放し、戻ったら取り直す。
//   - 非対応の端末・HTTPS でない・取得に失敗したときは、何も壊さず静かに何もしない（控えめな注記だけを出す）。
import { FIELD_NO_WAKE_LOCK_NOTE } from "./ops-field";

export type WakeLockSentinelLike = {
  release(): Promise<void>;
  addEventListener?(type: "release", listener: () => void): void;
};

export type WakeLockEnv = {
  /** navigator.wakeLock（対応しない端末では undefined）。 */
  readonly wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
  /** window.isSecureContext（HTTPS または localhost）。 */
  readonly isSecureContext: boolean;
  /** document.visibilityState。 */
  readonly visibility: () => "visible" | "hidden";
  /** visibilitychange の購読。解除する関数を返す。 */
  readonly onVisibilityChange: (listener: () => void) => () => void;
};

export type WakeLockStatus = "idle" | "held" | "unsupported" | "insecure" | "failed";

export type WakeLockDecision = "acquire" | "release" | "none";

/** 取得・解放の判断（純粋）。 */
export const decideWakeLock = (i: {
  readonly inFlight: boolean;
  readonly visible: boolean;
  readonly supported: boolean;
  readonly secure: boolean;
  readonly held: boolean;
}): WakeLockDecision => {
  const want = i.inFlight && i.visible && i.supported && i.secure;
  if (want && !i.held) return "acquire";
  if (!want && i.held) return "release";
  return "none";
};

/** 利用者に見せる注記（取得できない端末・条件のとき）。取得できているとき・飛行中でないときは null。 */
export const wakeLockNote = (status: WakeLockStatus, inFlight: boolean): string | null =>
  inFlight && (status === "unsupported" || status === "insecure" || status === "failed") ? FIELD_NO_WAKE_LOCK_NOTE : null;

export class WakeLockController {
  private inFlight = false;
  private sentinel: WakeLockSentinelLike | null = null;
  private pending = false;
  private destroyed = false;
  private current: WakeLockStatus;
  private readonly off: () => void;

  constructor(
    private readonly env: WakeLockEnv,
    private readonly onChange: (status: WakeLockStatus) => void = () => undefined,
  ) {
    this.current = !env.wakeLock ? "unsupported" : !env.isSecureContext ? "insecure" : "idle";
    this.off = env.onVisibilityChange(() => void this.sync());
  }

  get status(): WakeLockStatus {
    return this.current;
  }

  /** 開いた離陸があるか（飛行中か）を伝える。 */
  setInFlight(inFlight: boolean): Promise<void> {
    this.inFlight = inFlight;
    return this.sync();
  }

  private set(status: WakeLockStatus): void {
    if (this.current === status) return;
    this.current = status;
    this.onChange(status);
  }

  private async sync(): Promise<void> {
    if (this.destroyed || this.pending) return;
    const supported = !!this.env.wakeLock;
    const secure = this.env.isSecureContext;
    const decision = decideWakeLock({
      inFlight: this.inFlight,
      visible: this.env.visibility() === "visible",
      supported,
      secure,
      held: this.sentinel !== null,
    });
    if (decision === "none") {
      if (!supported) this.set("unsupported");
      else if (!secure) this.set("insecure");
      return;
    }
    this.pending = true;
    try {
      if (decision === "acquire") {
        try {
          const s = await this.env.wakeLock!.request("screen");
          if (this.destroyed || !this.inFlight) {
            // 待っている間に着陸・破棄された
            await s.release().catch(() => undefined);
            return;
          }
          s.addEventListener?.("release", () => {
            // 端末側で解放された（画面が隠れた等）。取り直せるように保持をやめる
            if (this.sentinel === s) {
              this.sentinel = null;
              this.set("idle");
            }
          });
          this.sentinel = s;
          this.set("held");
        } catch {
          // 取得に失敗（省電力モード等）。何も壊さず、注記だけを出す
          this.sentinel = null;
          this.set("failed");
        }
      } else {
        const s = this.sentinel;
        this.sentinel = null;
        try {
          await s?.release();
        } catch {
          // 解放に失敗しても何もしない
        }
        this.set("idle");
      }
    } finally {
      this.pending = false;
    }
    // 待っている間に状態が変わっていたら、もう一度合わせる
    const again = decideWakeLock({
      inFlight: this.inFlight,
      visible: this.env.visibility() === "visible",
      supported,
      secure,
      held: this.sentinel !== null,
    });
    if (again !== "none" && this.current !== "failed") await this.sync();
  }

  /** 画面を離れるとき。解放し、購読を解く。 */
  async destroy(): Promise<void> {
    this.destroyed = true;
    this.off();
    const s = this.sentinel;
    this.sentinel = null;
    try {
      await s?.release();
    } catch {
      // 何もしない
    }
  }
}
