import { expect, type Page } from "@playwright/test";
import { waitForSettledStyles } from "./field-checks";

// Sprint 16 K-13：対象画面の要素の計算された色（文字・背景・縁・輪・下線・SVG の塗りと線・影）が、トークンが決める集合に入ること。
// 集合 = その画面で解決された `--sb-*` の色（地 3 段・文字 4 段＋無効・線・主色 4 つ・状態 5 種の印・面・文字・判定・未確認・挿絵・地図の固定色）。
// 明・現場・強制の暗のどれでも、その画面で効いている値で数える。トークンの 2 色の混ぜ合わせ（color-mix の薄い面）は、2 色を結ぶ線の上にあれば許す
// （16-C が部品を作り直すまでの、既存の薄い面）。この集合の外の色（橙・旧い藍など）は違反として返す。

type Violation = { readonly where: string; readonly prop: string; readonly color: string };

export const collectColorViolations = async (page: Page, rootSelector: string, exempt: readonly string[] = []): Promise<Violation[]> => {
  await waitForSettledStyles(page);
  return page.evaluate(([sel, ex]) => {
    const root = document.querySelector(sel);
    if (!root) return [{ where: sel, prop: "root", color: "見つからない" }];
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    type C = [number, number, number, number];
    const rgba = (css: string): C | null => {
      if (!css || css === "none" || css === "currentcolor") return null;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
    // 許可の集合：このページのスタイルシートにある --sb-* を、ルート要素で解決した値から作る
    const names = new Set<string>();
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      const walk = (list: CSSRuleList): void => {
        for (const r of Array.from(list)) {
          if (r instanceof CSSStyleRule) for (let i = 0; i < r.style.length; i++) { const n = r.style[i]!; if (n.startsWith("--sb-")) names.add(n); }
          else if ("cssRules" in r) walk((r as CSSGroupingRule).cssRules);
        }
      };
      walk(rules);
    }
    const rs = getComputedStyle(document.documentElement);
    const allowed: [number, number, number][] = [];
    for (const n of names) {
      const v = rs.getPropertyValue(n).trim();
      if (!/^(#[0-9a-f]{3,8}|rgba?\()/i.test(v)) continue;
      const c = rgba(v);
      if (c && c[3] > 0) allowed.push([c[0], c[1], c[2]]);
    }
    allowed.push([255, 255, 255]);
    const same = (a: number[], b: number[], tol = 1.5): boolean => Math.abs(a[0]! - b[0]!) <= tol && Math.abs(a[1]! - b[1]!) <= tol && Math.abs(a[2]! - b[2]!) <= tol;
    const onSegment = (c: number[]): boolean => {
      for (let i = 0; i < allowed.length; i++) for (let j = i + 1; j < allowed.length; j++) {
        const a = allowed[i]!, b = allowed[j]!;
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const len2 = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2;
        if (len2 === 0) continue;
        const t = ((c[0]! - a[0]) * d[0]! + (c[1]! - a[1]) * d[1]! + (c[2]! - a[2]) * d[2]!) / len2;
        if (t < -0.01 || t > 1.01) continue;
        const p = [a[0] + d[0]! * t, a[1] + d[1]! * t, a[2] + d[2]! * t];
        if (same(c, p, 2.5)) return true;
      }
      return false;
    };
    const ok = (c: C | null): boolean => {
      if (!c || c[3] === 0) return true;
      const rgb = [c[0], c[1], c[2]];
      return allowed.some((a) => same(rgb, a)) || onSegment(rgb);
    };
    const out: Violation[] = [];
    const seen = new Set<string>();
    const note = (el: Element, prop: string, css: string): void => {
      const c = rgba(css);
      if (ok(c)) return;
      const where = `${el.closest("[data-testid]")?.getAttribute("data-testid") ?? ""}<${el.tagName.toLowerCase()}${typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className ? "." + (el as HTMLElement).className.split(/\s+/)[0] : ""}>`;
      const key = `${where}|${prop}|${css}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ where, prop, color: css });
    };
    const all = [root, ...Array.from(root.querySelectorAll("*"))];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || (r.width === 0 && r.height === 0)) continue;
      if (el.closest("canvas, .maplibregl-map")) continue; // 地図の描画は別（地図の固定色）
      if (ex.length > 0 && el.closest(ex.join(", "))) continue; // 地図の凡例（地図の固定色）
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
      if (hasText) note(el, "color", cs.color);
      note(el, "background-color", cs.backgroundColor);
      for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
        const w = parseFloat(cs[`border${side}Width` as "borderTopWidth"]);
        const st = cs[`border${side}Style` as "borderTopStyle"];
        if (w > 0 && st !== "none" && st !== "hidden") note(el, `border-${side.toLowerCase()}`, cs[`border${side}Color` as "borderTopColor"]);
      }
      if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) note(el, "outline", cs.outlineColor);
      if (cs.textDecorationLine !== "none" && hasText) note(el, "text-decoration", cs.textDecorationColor);
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) {
        // 面積が 0 の図形（開いた 1 本の線の path など）は塗りが見えない。既定の黒の塗りは数えない
        const bb = el instanceof SVGGraphicsElement ? el.getBBox() : null;
        if (!bb || (bb.width > 0 && bb.height > 0)) note(el, "fill", cs.fill);
        if (cs.stroke !== "none") note(el, "stroke", cs.stroke);
      }
      if (cs.boxShadow !== "none") for (const m of cs.boxShadow.matchAll(/(rgba?\([^)]*\))/g)) note(el, "box-shadow", m[1]!);
    }
    return out;
  }, [rootSelector, exempt] as const);
};

/** exempt：地図の凡例など、地図の固定色（regulation-map-colors.ts）を使う部品のセレクタ（契約の「地図と挿絵の中」）。 */
export const expectColorsInTokenSet = async (page: Page, rootSelector: string, label: string, exempt: readonly string[] = []): Promise<void> => {
  const v = await collectColorViolations(page, rootSelector, exempt);
  expect(v.map((x) => `${x.where} ${x.prop} ${x.color}`), `${label}: 許可した集合の外の色（K-13）`).toEqual([]);
};
