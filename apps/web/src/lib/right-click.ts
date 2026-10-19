// 地図の右クリックによる地点指定の判定（Sprint 9 D）。
//
// 右ボタンを押したまま動かす（右ドラッグ）と地図が回転する。その操作で地点が決まらないよう、
// 右ボタンを押した位置から tolerancePx（既定 4px）以上動いた場合の contextmenu は無視する。
// contextmenu は OS によって mousedown 時（macOS・Linux）にも mouseup 後（Windows）にも来るため、
// ボタンを押している間に来たものは mouseup まで判定を待つ。DOM に依存しない純粋な状態機械。

export const RIGHT_CLICK_TOLERANCE_PX = 4;

type Pt = { readonly x: number; readonly y: number };

export type RightClickPicker = {
  readonly down: (p: Pt) => void;
  readonly move: (p: Pt) => void;
  readonly up: (p: Pt) => void;
  /** contextmenu。地点にするなら onPick を呼ぶ（すぐ、または mouseup のとき）。 */
  readonly contextmenu: (p: Pt) => void;
};

export const createRightClickPicker = (options: {
  readonly onPick: (p: Pt) => void;
  readonly tolerancePx?: number;
}): RightClickPicker => {
  const tol = options.tolerancePx ?? RIGHT_CLICK_TOLERANCE_PX;
  let origin: Pt | null = null;
  let held = false;
  let moved = false;
  let pending: Pt | null = null;
  const far = (p: Pt) => origin !== null && Math.hypot(p.x - origin.x, p.y - origin.y) >= tol;

  return {
    down: (p) => {
      origin = p;
      held = true;
      moved = false;
      pending = null;
    },
    move: (p) => {
      if (held && far(p)) moved = true;
    },
    up: (p) => {
      if (!held) return;
      held = false;
      if (far(p)) moved = true;
      if (pending) {
        const at = pending;
        pending = null;
        origin = null;
        if (!moved) options.onPick(at);
      }
    },
    contextmenu: (p) => {
      if (origin === null) {
        // 押した位置が分からない（キーボードのメニューキー等）：その位置で指定する
        options.onPick(p);
        return;
      }
      if (held) {
        pending = p; // mouseup で動いたかどうかを見て決める
        return;
      }
      if (!moved && !far(p)) options.onPick(p);
      origin = null;
    },
  };
};
