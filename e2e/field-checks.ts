import { expect, type Locator, type Page } from "@playwright/test";

// 現場モードの見た目の基準（Sprint 12c 契約 15）を検査する補助。ブラウザで計算した色・寸法から、WCAG の式で比を求める。
// 明るい配色と暗い配色は、呼び出し側が page.emulateMedia({ colorScheme }) で切り替えてから呼ぶ。

export type Rgb = readonly [number, number, number];

/** WCAG 2.x の相対輝度。 */
export const relativeLuminance = ([r, g, b]: Rgb): number => {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** 2 色のコントラスト比（1〜21）。 */
export const contrastRatio = (a: Rgb, b: Rgb): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

export type TextSample = {
  readonly text: string;
  readonly testId: string | null;
  readonly tag: string;
  readonly fg: Rgb;
  readonly bg: Rgb;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly disabled: boolean;
  readonly ratio: number;
};

/**
 * root の中の、文字を持つ要素ごとに、計算された文字色と背景色（祖先の背景を重ねて求める）・文字の大きさを集める。
 * 色の形式（rgb・oklch・color-mix など）に依らないよう、キャンバスで 8 ビットの RGBA に直す。
 */
export const collectTextSamples = async (page: Page, rootSelector: string): Promise<TextSample[]> => {
  const raw = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [];
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
    const over = (top: [number, number, number, number], under: [number, number, number]): [number, number, number] => [
      top[0] * top[3] + under[0] * (1 - top[3]),
      top[1] * top[3] + under[1] * (1 - top[3]),
      top[2] * top[3] + under[2] * (1 - top[3]),
    ];
    const effectiveBg = (el: Element): [number, number, number] => {
      const chain: Element[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e);
      let bg: [number, number, number] = [255, 255, 255];
      for (const e of chain) bg = over(rgba(getComputedStyle(e).backgroundColor), bg);
      return bg;
    };
    const out: {
      text: string;
      testId: string | null;
      tag: string;
      fg: [number, number, number];
      bg: [number, number, number];
      fontSize: number;
      fontWeight: number;
      disabled: boolean;
    }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const seen = new Set<Element>();
    for (let n = walker.currentNode as Element | null; n; n = walker.nextNode() as Element | null) {
      const el = n as HTMLElement;
      if (seen.has(el)) continue;
      seen.add(el);
      const own = Array.from(el.childNodes)
        .filter((c) => c.nodeType === Node.TEXT_NODE)
        .map((c) => (c.textContent ?? "").trim())
        .join("");
      if (own.length === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const bg = effectiveBg(el);
      const fgRaw = rgba(cs.color);
      const fg = over(fgRaw, bg);
      out.push({
        text: own.slice(0, 40),
        testId: el.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
        tag: el.tagName.toLowerCase(),
        fg,
        bg,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
        disabled: Boolean(el.closest("button:disabled, [aria-disabled='true'], select:disabled")),
      });
    }
    return out;
  }, rootSelector);
  return raw.map((s) => ({ ...s, ratio: contrastRatio(s.fg, s.bg) }));
};

/** 文字と背景の比が min 以上であること（無効のボタンは除く）。 */
export const expectContrast = async (page: Page, rootSelector: string, min: number, label: string): Promise<void> => {
  const samples = await collectTextSamples(page, rootSelector);
  expect(samples.length, `${label}: 文字を持つ要素がない`).toBeGreaterThan(0);
  if (process.env["CONTRAST_DEBUG"]) {
    const lowest = [...samples].filter((s) => !s.disabled).sort((a, b) => a.ratio - b.ratio).slice(0, 3);
    console.log(`[contrast] ${label}: ${samples.length} 件、最小 ${lowest.map((s) => `${s.testId ?? s.tag}「${s.text}」${s.ratio.toFixed(2)}`).join(" / ")}`);
  }
  const bad = samples.filter((s) => !s.disabled && s.ratio < min).map((s) => `${s.testId ?? s.tag}「${s.text}」 ${s.ratio.toFixed(2)}`);
  expect(bad, `${label}: 比が ${min} 未満`).toEqual([]);
};

/** 文字の大きさが min px 以上であること。 */
export const expectFontSize = async (page: Page, rootSelector: string, min: number, label: string): Promise<void> => {
  const samples = await collectTextSamples(page, rootSelector);
  const bad = samples.filter((s) => s.fontSize < min).map((s) => `${s.testId ?? s.tag}「${s.text}」 ${s.fontSize}px`);
  expect(bad, `${label}: ${min}px 未満の文字`).toEqual([]);
};

export type TapTarget = { readonly testId: string | null; readonly text: string; readonly left: number; readonly top: number; readonly width: number; readonly height: number };

/** root の中の、押す部品（button・a[href]・select・summary・role=radio/button）の寸法。 */
export const collectTapTargets = async (page: Page, rootSelector: string): Promise<TapTarget[]> =>
  page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [];
    const out: { testId: string | null; text: string; left: number; top: number; width: number; height: number }[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("button, a[href], select, summary, [role='radio'], [role='button']"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push({
        testId: el.getAttribute("data-testid"),
        text: (el.textContent ?? "").trim().slice(0, 24),
        left: r.left,
        top: r.top + window.scrollY,
        width: r.width,
        height: r.height,
      });
    }
    return out;
  }, rootSelector);

/** 押す部品の高さの下限（離陸・着陸のボタンは 80px、ほかは 56px）、隣り合う間の下限（12px）を検査する。 */
export const expectTapTargets = async (page: Page, rootSelector: string, label: string, opts: { bigTestId?: string } = {}): Promise<void> => {
  const targets = await collectTapTargets(page, rootSelector);
  expect(targets.length, `${label}: 押す部品がない`).toBeGreaterThan(0);
  const tooShort = targets
    .filter((t) => t.height < (t.testId === opts.bigTestId ? 80 : 56) - 0.5)
    .map((t) => `${t.testId ?? t.text} 高さ ${t.height.toFixed(1)}`);
  expect(tooShort, `${label}: 高さが足りない押す部品`).toEqual([]);
  const tight: string[] = [];
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i]!;
      const b = targets[j]!;
      const dx = Math.max(0, b.left - (a.left + a.width), a.left - (b.left + b.width));
      const dy = Math.max(0, b.top - (a.top + a.height), a.top - (b.top + b.height));
      const nested = (p: TapTarget, q: TapTarget): boolean =>
        p.left <= q.left + 0.5 && p.top <= q.top + 0.5 && p.left + p.width >= q.left + q.width - 0.5 && p.top + p.height >= q.top + q.height - 0.5;
      if (nested(a, b) || nested(b, a)) continue;
      if (Math.hypot(dx, dy) < 12 - 0.5) tight.push(`${a.testId ?? a.text} と ${b.testId ?? b.text}（${Math.hypot(dx, dy).toFixed(1)}px）`);
    }
  }
  expect(tight, `${label}: 間が 12px 未満の押す部品`).toEqual([]);
};

/** 横スクロールがないこと。 */
export const expectNoHorizontalScroll = async (page: Page, label: string): Promise<void> => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: 横スクロールがある`).toBeLessThanOrEqual(clientWidth);
};

/**
 * 折りたたみ（`<details>`）を開く。すでに開いていれば何もしない。
 * 判定画面 `/` は、規制カードの「根拠の詳細」・申請支援の「申請の準備」・収録の一覧を、見出しだけ見せて畳んでいる（Sprint 12h PR ②）。
 * 畳まれた中の部品は画面に見えず押せないので、見る・押す前に開く。文字の内容を読むだけの検査（toContainText）は、開かなくてもよい。
 */
export const openDetails = async (details: Locator): Promise<void> => {
  const open = await details.evaluate((e) => (e as HTMLDetailsElement).open);
  if (!open) await details.locator("> summary").first().click();
  await expect(details).toHaveAttribute("open", "");
};

/**
 * 申請支援（Sprint 18-1）：フラグ APPLICATION_SUPPORT_ENABLED が無効（既定・本番）では、公開の `/` に出ない語と部品。
 * 以前の「申請の準備」を開く補助（openDiagnosis）は、この検査に置き換えた（docs/evaluations/sprint-18-test-changes.md）。
 */
export const APPLICATION_SUPPORT_WORDS = [
  "申請支援",
  "申請の準備",
  "必要手続きチェックリスト",
  "提出期限",
  "プリフィル",
  "束ね PDF",
  "飛行マニュアル",
  "書類の下書き",
  "カテゴリー切り分け",
  "下書きまでを手伝います",
] as const;
export const APPLICATION_SUPPORT_TESTIDS = [
  "diagnosis-details",
  "diagnosis-category-headline",
  "diagnosis-did-status",
  "procedure-card",
] as const;

/** 申請支援が画面に無いこと（本文 textContent に語が 0 件、部品が 0 個）。畳み・非表示の中も含めて調べる。 */
export const expectNoApplicationSupport = async (page: Page, label = "公開の /"): Promise<void> => {
  const text = await page.evaluate(() => document.body.textContent ?? "");
  for (const w of APPLICATION_SUPPORT_WORDS) expect(text, `${label}: 「${w}」が残っている`).not.toContain(w);
  for (const id of APPLICATION_SUPPORT_TESTIDS) await expect(page.getByTestId(id), `${label}: ${id}`).toHaveCount(0);
  await expect(page.getByRole("button", { name: /束ね PDF/ }), `${label}: 束ね PDF のボタン`).toHaveCount(0);
};
