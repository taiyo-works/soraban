import { describe, expect, it } from "vitest";
import {
  BASE_ZONE_COLORS,
  BASE_ZONE_LAYER_IDS,
  BASE_ZONE_LEGEND,
  makeHatchImage,
} from "./regulation-map-zones";

describe("飛行禁止法 対象施設レイヤーの塗り分け", () => {
  it("要確認帯のレイヤーは、赤・黄のレイヤーと別 ID で存在する", () => {
    const ids: readonly string[] = BASE_ZONE_LAYER_IDS;
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.startsWith("base-check"))).toBe(true);
    expect(ids.some((id) => id.startsWith("base-yellow"))).toBe(true);
    expect(ids.some((id) => id.startsWith("base-red"))).toBe(true);
    // 要確認帯は塗りなし（輪郭のみ）。黄・赤と取り違えない。
    expect(ids).not.toContain("base-check-fill");
  });

  it("赤・黄・要確認帯の色がすべて異なり、要確認帯は灰色（黄・赤系ではない）", () => {
    const { red, yellow, check } = BASE_ZONE_COLORS;
    expect(new Set([red, yellow, check]).size).toBe(3);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(check.slice(i, i + 2), 16)) as [number, number, number];
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(24);
  });

  it("凡例のスウォッチに『敷地・区域』『周辺地域』『要確認帯』の文字ラベルが 3 種類ある", () => {
    expect(BASE_ZONE_LEGEND.map((z) => z.label)).toEqual(["敷地・区域", "周辺地域", "要確認帯"]);
    const swatches = BASE_ZONE_LEGEND.map((z) => z.swatch);
    expect(new Set(swatches).size).toBe(3);
  });

  it("凡例の説明：赤・黄はどちらも原則飛行禁止、要確認帯は法定ではない", () => {
    const [site, around, check] = BASE_ZONE_LEGEND;
    expect(site.note).toContain("レッドゾーン");
    expect(site.note).toContain("原則飛行禁止");
    expect(around.note).toContain("イエローゾーン");
    expect(around.note).toContain("おおむね 1,000m");
    expect(around.note).toContain("原則飛行禁止");
    expect(check.note).toBe("法定の範囲ではありません");
    // 旧距離（独自の帯の幅）を画面に出さない（e2e/sprint7.spec.ts と同じ方針）
    for (const z of BASE_ZONE_LEGEND) expect(z.note).not.toContain("300m");
  });

  it("斜線パターンの画像は、透明な画素と斜線の画素の両方を持つ", () => {
    const { width, height, data } = makeHatchImage(8);
    expect(data.length).toBe(width * height * 4);
    const alphas = Array.from({ length: width * height }, (_, i) => data[i * 4 + 3]!);
    expect(alphas.some((a) => a === 0)).toBe(true);
    expect(alphas.some((a) => a > 0)).toBe(true);
  });
});
