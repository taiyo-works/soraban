import { appendFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";

// 判定画面の操作数の計測（docs/design/ux-judge-compare.md の元の数字）。
// 台本ごとに「いちばん自然な最短の経路」を 1 つずつ押し、押した回数と、押す部品・読みたい部分を見える位置へ動かすために
// スクロールした量（px。画面の高さの何枚分か）を数える。スクロールはブラウザの自動スクロールに任せず、数えられる形で自分で行う。
// UX_COUNTS_FILE を指定すると、1 行 1 件の JSON で書き出す。

export type Measure = {
  readonly target: string;
  readonly viewport: string;
  readonly script: string;
  /** 押した回数（文字の入力は 1 回と数える）。 */
  readonly taps: number;
  /** 見える位置へ動かしたスクロールの合計（px）。 */
  readonly scrollPx: number;
  /** 画面の高さ何枚分か。 */
  readonly screens: number;
  /** 終わった時点で、地図が画面の 20% 以上見えているか。 */
  readonly mapVisible: boolean;
  /** 終わった時点で、答え（結論）が見えているか。 */
  readonly answerVisible: boolean;
  /** 地図と答えが同時に見えているか。 */
  readonly together: boolean;
  readonly mapShare: number;
};

export const record = (m: Measure): void => {
  const file = process.env["UX_COUNTS_FILE"];
  if (file) appendFileSync(file, `${JSON.stringify(m)}\n`);
};

// ページ内の補助。スクロールできる祖先（と window）を順に、最小の量だけ動かす。
const INIT = `
(() => {
  const inset = () => {
    // 画面の上に固定されている帯（結論の帯）があれば、その下に出す。
    const band = document.querySelector('[data-testid="sp-band"]');
    if (!band) return 0;
    const cs = getComputedStyle(band);
    return cs.position === 'sticky' || cs.position === 'fixed' ? band.getBoundingClientRect().height : 0;
  };
  const scrollers = (el) => {
    const out = [];
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) out.push(n);
    }
    return out;
  };
  window.__m = {
    reveal(el, strip) {
      let total = 0;
      const margin = 8;
      const rect = () => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: Math.min(r.bottom, r.top + strip) }; };
      for (const c of scrollers(el)) {
        const cr = c.getBoundingClientRect();
        const r = rect();
        let d = 0;
        if (r.top < cr.top + margin) d = r.top - (cr.top + margin);
        else if (r.bottom > cr.bottom - margin) d = r.bottom - (cr.bottom - margin);
        if (d) { const before = c.scrollTop; c.scrollTo({ top: before + d, behavior: 'instant' }); total += Math.abs(c.scrollTop - before); }
      }
      const r = rect();
      const top = inset() + margin;
      const vh = window.innerHeight;
      let d = 0;
      if (r.top < top) d = r.top - top;
      else if (r.bottom > vh - margin) d = r.bottom - (vh - margin);
      if (d) { const before = window.scrollY; window.scrollTo({ top: before + d, behavior: 'instant' }); total += Math.abs(window.scrollY - before); }
      return total;
    },
    // 要素が画面の中で他に隠されずに見えている面積（px2）。格子点で当たり判定する。
    visibleArea(el) {
      const r = el.getBoundingClientRect();
      const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, window.innerWidth);
      const y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, window.innerHeight);
      if (x1 <= x0 || y1 <= y0) return 0;
      const step = 12;
      let hit = 0;
      for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) {
        const t = document.elementFromPoint(x, y);
        if (t && (t === el || el.contains(t))) hit += step * step;
      }
      return hit;
    },
    // 上から strip px の帯が、画面の中で隠されずに見えているか。
    stripVisible(el, strip) {
      const r = el.getBoundingClientRect();
      const h = Math.min(r.height, strip);
      const top = Math.max(inset(), 0);
      if (r.top < top - 0.5 || r.top + h > window.innerHeight + 0.5) return false;
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + h / 2);
      return !!t && (t === el || el.contains(t));
    },
    viewportArea() { return window.innerWidth * window.innerHeight; },
  };
})();
`;

export class Meter {
  taps = 0;
  scrollPx = 0;

  constructor(private readonly page: Page) {}

  static async install(page: Page): Promise<void> {
    await page.addInitScript(INIT);
  }

  /** 見える位置まで動かす（動かした px を数える）。 */
  async reveal(loc: Locator, strip = 80): Promise<void> {
    const px = await loc.evaluate((el, s) => (window as unknown as { __m: { reveal: (e: Element, s: number) => number } }).__m.reveal(el, s), strip);
    this.scrollPx += px;
  }

  async click(loc: Locator): Promise<void> {
    await this.reveal(loc, 44);
    await loc.click();
    this.taps += 1;
    // シートの高さなどの移り変わりが終わってから、次の操作の位置を測る（途中の位置でスクロール量を数えない）。
    await this.page.waitForTimeout(350);
  }

  async fill(loc: Locator, text: string): Promise<void> {
    await this.reveal(loc, 44);
    await loc.fill(text);
    this.taps += 1;
  }

  async finish(target: string, viewport: string, script: string, map: Locator, answer: Locator, readStrip = 80, revealAnswer = true): Promise<Measure> {
    // 答えを読める位置まで動かす（台本の最後に読む部分）。層の切り替えのように答えを読む必要がない台本では動かさず、見えているかだけを見る。
    if (revealAnswer) await this.reveal(answer, readStrip);
    const vh = this.page.viewportSize()!.height;
    const { share, answerVisible } = await this.page.evaluate(
      async ([mapSel, ansSel, strip]) => {
        const m = (window as unknown as { __m: { visibleArea: (e: Element) => number; stripVisible: (e: Element, s: number) => boolean; viewportArea: () => number } }).__m;
        const me = document.querySelector(mapSel as string)!;
        const ae = document.querySelector(ansSel as string)!;
        return { share: m.visibleArea(me) / m.viewportArea(), answerVisible: m.stripVisible(ae, strip as number) };
      },
      [await selectorOf(map), await selectorOf(answer), readStrip] as const,
    );
    const mapVisible = share >= 0.2;
    const out: Measure = {
      target,
      viewport,
      script,
      taps: this.taps,
      scrollPx: Math.round(this.scrollPx),
      screens: Math.round((this.scrollPx / vh) * 10) / 10,
      mapVisible,
      answerVisible,
      together: mapVisible && answerVisible,
      mapShare: Math.round(share * 100) / 100,
    };
    record(out);
    return out;
  }
}

/** ロケーターが指す要素に一時的な属性を付け、CSS セレクターにして返す（page.evaluate へ渡すため）。 */
async function selectorOf(loc: Locator): Promise<string> {
  const id = `m${Math.random().toString(36).slice(2, 8)}`;
  await loc.first().evaluate((el, v) => el.setAttribute("data-measure", v), id);
  return `[data-measure="${id}"]`;
}
