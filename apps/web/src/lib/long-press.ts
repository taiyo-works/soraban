// 地図の長押し（タッチ）判定（Sprint 9 D）。
//
// 指 1 本で delayMs（既定 500ms）以上押し、その間の移動が tolerancePx（既定 10px）以内なら長押しとする。
// 次の場合は取り消す：2 本目の指が触れた／指が tolerancePx を超えて動いた／地図が動いた／指が離れた。
// DOM・地図ライブラリに依存しない純粋な状態機械にして、単体テストで検証できるようにする。

export type TouchPoint = { readonly x: number; readonly y: number };

export type LongPressOptions = {
  readonly delayMs?: number;
  readonly tolerancePx?: number;
  /** 長押しが成立したとき（押し始めの画面座標を渡す）。 */
  readonly onLongPress: (start: TouchPoint) => void;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
};

export const LONG_PRESS_DELAY_MS = 500;
export const LONG_PRESS_TOLERANCE_PX = 10;

export type LongPressDetector = {
  /** touchstart。touches は画面上のすべての指。 */
  readonly start: (touches: readonly TouchPoint[]) => void;
  readonly move: (touches: readonly TouchPoint[]) => void;
  readonly end: () => void;
  /** 地図が動いた（パン・ズーム・回転）。 */
  readonly mapMoved: () => void;
  readonly cancel: () => void;
  /** 判定中か（テスト用）。 */
  readonly pending: () => boolean;
};

export const createLongPressDetector = (options: LongPressOptions): LongPressDetector => {
  const delay = options.delayMs ?? LONG_PRESS_DELAY_MS;
  const tol = options.tolerancePx ?? LONG_PRESS_TOLERANCE_PX;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let origin: TouchPoint | null = null;

  const cancel = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    origin = null;
  };

  return {
    start: (touches) => {
      cancel();
      if (touches.length !== 1) return; // 2 本目の指が触れたら取り消し（新たに始めない）
      const p = touches[0]!;
      origin = { x: p.x, y: p.y };
      timer = setTimer(() => {
        const o = origin;
        timer = null;
        origin = null;
        if (o) options.onLongPress(o);
      }, delay);
    },
    move: (touches) => {
      if (origin === null) return;
      if (touches.length !== 1) return cancel();
      const p = touches[0]!;
      if (Math.hypot(p.x - origin.x, p.y - origin.y) > tol) cancel();
    },
    end: cancel,
    mapMoved: cancel,
    cancel,
    pending: () => timer !== null,
  };
};
