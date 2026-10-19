import { describe, expect, it, vi } from "vitest";
import { createLongPressDetector } from "./long-press";

// Sprint 9 契約 11：長押しの判定が、押している間の 20px の移動、2 本目の指、地図の移動のそれぞれで取り消される。
describe("長押しの判定（createLongPressDetector）", () => {
  const setup = () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const d = createLongPressDetector({ onLongPress });
    return { d, onLongPress };
  };

  it("指 1 本で 600ms 押すと押し始めの位置で成立する", () => {
    const { d, onLongPress } = setup();
    d.start([{ x: 100, y: 100 }]);
    vi.advanceTimersByTime(600);
    expect(onLongPress).toHaveBeenCalledWith({ x: 100, y: 100 });
    vi.useRealTimers();
  });

  it("300ms で離すと成立しない", () => {
    const { d, onLongPress } = setup();
    d.start([{ x: 100, y: 100 }]);
    vi.advanceTimersByTime(300);
    d.end();
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("10px 以内の揺れでは取り消さない", () => {
    const { d, onLongPress } = setup();
    d.start([{ x: 100, y: 100 }]);
    d.move([{ x: 106, y: 106 }]);
    vi.advanceTimersByTime(600);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("押している間に 20px 動かすと取り消される", () => {
    const { d, onLongPress } = setup();
    d.start([{ x: 100, y: 100 }]);
    vi.advanceTimersByTime(200);
    d.move([{ x: 120, y: 100 }]);
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(d.pending()).toBe(false);
    vi.useRealTimers();
  });

  it("2 本目の指が触れると取り消される（touchstart・touchmove のどちらで知っても）", () => {
    const { d, onLongPress } = setup();
    d.start([{ x: 100, y: 100 }]);
    vi.advanceTimersByTime(200);
    d.start([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();

    d.start([{ x: 100, y: 100 }]);
    d.move([
      { x: 100, y: 100 },
      { x: 150, y: 150 },
    ]);
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("地図が動くと取り消される", () => {
    const { d, onLongPress } = setup();
    d.start([{ x: 100, y: 100 }]);
    vi.advanceTimersByTime(200);
    d.mapMoved();
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
