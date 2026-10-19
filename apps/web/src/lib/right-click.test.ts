import { describe, expect, it, vi } from "vitest";
import { createRightClickPicker } from "./right-click";

describe("右クリックの判定（createRightClickPicker）", () => {
  it("押した位置で離せば指定する（contextmenu が mousedown 時に来る macOS・Linux）", () => {
    const onPick = vi.fn();
    const r = createRightClickPicker({ onPick });
    r.down({ x: 10, y: 10 });
    r.contextmenu({ x: 10, y: 10 });
    expect(onPick).not.toHaveBeenCalled(); // mouseup まで待つ
    r.up({ x: 11, y: 11 });
    expect(onPick).toHaveBeenCalledWith({ x: 10, y: 10 });
  });

  it("右ドラッグ（4px 以上の移動）で回転したときは指定しない", () => {
    const onPick = vi.fn();
    const r = createRightClickPicker({ onPick });
    r.down({ x: 10, y: 10 });
    r.contextmenu({ x: 10, y: 10 });
    r.move({ x: 30, y: 10 });
    r.up({ x: 30, y: 10 });
    expect(onPick).not.toHaveBeenCalled();
  });

  it("contextmenu が mouseup の後に来る（Windows）場合も、動いていなければ指定し、動いていれば指定しない", () => {
    const onPick = vi.fn();
    const r = createRightClickPicker({ onPick });
    r.down({ x: 10, y: 10 });
    r.up({ x: 12, y: 10 });
    r.contextmenu({ x: 12, y: 10 });
    expect(onPick).toHaveBeenCalledTimes(1);

    r.down({ x: 10, y: 10 });
    r.move({ x: 50, y: 50 });
    r.up({ x: 50, y: 50 });
    r.contextmenu({ x: 50, y: 50 });
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("3px の揺れは許容する", () => {
    const onPick = vi.fn();
    const r = createRightClickPicker({ onPick });
    r.down({ x: 10, y: 10 });
    r.contextmenu({ x: 10, y: 10 });
    r.move({ x: 13, y: 10 });
    r.up({ x: 13, y: 10 });
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
