import { expect, test, type Locator, type Page } from "@playwright/test";

// 現場モードの見た目の基準（Sprint 12c 契約 15）を検査する補助。ブラウザで計算した色・寸法から、WCAG の式で比を求める。
// 明るい配色と暗い配色は、呼び出し側が page.emulateMedia({ colorScheme }) で切り替えてから呼ぶ。

/**
 * 色の遷移（transition・animation）が終わるのを待つ。途中の色を測ると比がぶれるため、色を測る前に呼ぶ。
 * 無限の動き（読み込み中の回転など）で待ち続けないよう、上限（既定 3 秒）を置く。上限に達したら、そのまま測る（検査は弱めない）。
 */
export const waitForSettledStyles = async (page: Page, timeoutMs = 3000): Promise<void> => {
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.effect?.getTiming().iterations === Infinity), undefined, { timeout: timeoutMs })
    .catch(() => undefined);
};

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
  await waitForSettledStyles(page);
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

export type FontSizeOptions = {
  /**
   * 本文の検査（Sprint 16-B 差し戻し 1、契約 R1-3）。本文の最小の大きさ（通常 16、現場 18）。省略したときは、従来どおり min px の検査だけ。
   * 印 `data-note` のない p・li・dd（と、その中の文字を持つ子孫）は body px 以上・行の高さ 1.7（誤差 0.01）以上、
   * 印のあるものは 14px 以上・1.5（誤差 0.01）以上。`data-note` が許された要素以外に付いていれば失敗にする。
   */
  readonly body?: number;
};

/** 補足（`data-note`）の下限。契約 R1-1・R1-3。 */
export const NOTE_FONT_MIN = 14;
/** 行の高さ（計算された line-height ÷ font-size）の下限。測定の誤差 0.01 を引いた値。 */
export const BODY_LINE_RATIO_MIN = 1.7 - 0.01;
export const NOTE_LINE_RATIO_MIN = 1.5 - 0.01;
/** 大きな文字（本文の基準より LARGE_TEXT_GAP px 以上大きい p・li・dd と子孫。見出し・表示の役割）は、行の高さ 1.25（誤差 0.01）以上だけを求める（2026-11-23 オーケストレーターの決定）。 */
export const LARGE_TEXT_GAP = 2;
export const LARGE_LINE_RATIO_MIN = 1.25 - 0.01;
/** `data-note` を付けてよい要素（契約 R1-2）。div・section・main・カードの外枠には付けない。 */
export const DATA_NOTE_ALLOWED_TAGS = ["p", "li", "dd", "ul", "ol", "dl", "span", "time", "small"] as const;

export type BodyTextReport = {
  /** 検査した p・li・dd の数（見えているもの） */
  readonly checked: number;
  /** 本文の検査・補足の検査に落ちたもの（testid・文の先頭・大きさ・行の高さ） */
  readonly bad: string[];
  /** `data-note` が許された要素以外に付いているもの */
  readonly misplaced: string[];
  /** 印の付いた要素の data-testid（なければタグ名）ごとの件数 */
  readonly marked: Record<string, number>;
};

/** root の中の本文・補足の大きさと行の高さを集める（expectFontSize の { body } 用）。 */
export const collectBodyTextReport = async (page: Page, rootSelector: string, body: number): Promise<BodyTextReport> => {
  await waitForSettledStyles(page);
  return page.evaluate(
    ({ sel, bodyMin, noteMin, bodyLh, noteLh, largeGap, largeLh, allowed }) => {
      const root = document.querySelector(sel);
      const empty = { checked: 0, bad: [] as string[], misplaced: [] as string[], marked: {} as Record<string, number> };
      if (!root) return empty;
      const idOf = (el: Element): string => el.closest("[data-testid]")?.getAttribute("data-testid") ?? el.tagName.toLowerCase();
      const visible = (el: HTMLElement): boolean => {
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return false;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") return false;
        if (el.closest(".sb-sr, .sr-only")) return false;
        return el.checkVisibility?.({ checkVisibilityCSS: true, contentVisibilityAuto: true }) ?? true;
      };
      const SKIP_DESC = "button, a, summary, label, [role='tab'], [role='button']";
      const out = empty;
      const measure = (el: Element, sizeMin: number, lhMin: number, kind: string): void => {
        const cs = getComputedStyle(el);
        const fs = parseFloat(cs.fontSize);
        const lhPx = parseFloat(cs.lineHeight);
        const ratio = lhPx / fs;
        // 大きな文字（本文の基準より 2px 以上大きい。見出し・表示の役割）は、行の高さ 1.25 以上だけを求める。
        const large = kind === "本文" && fs >= bodyMin + largeGap;
        const needLh = large ? largeLh : lhMin;
        const lhOk = cs.lineHeight !== "normal" && Number.isFinite(ratio) && ratio >= needLh;
        if (fs >= sizeMin && lhOk) return;
        const t = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 20);
        out.bad.push(`${large ? "大きな文字" : kind} ${el.tagName.toLowerCase()}[${idOf(el)}]「${t}」 ${fs}px / 行の高さ ${cs.lineHeight === "normal" ? "normal" : ratio.toFixed(2)}（${sizeMin}px・${(needLh + 0.01).toFixed(2)} 以上が必要）`);
      };
      const hasOwnText = (el: Element): boolean => Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0);
      // ③ data-note の置き場所
      const marks = [...(root.matches("[data-note]") ? [root] : []), ...Array.from(root.querySelectorAll("[data-note]"))];
      for (const m of marks) {
        if (!allowed.includes(m.tagName.toLowerCase())) out.misplaced.push(`${m.tagName.toLowerCase()}[${idOf(m)}]`);
      }
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("p, li, dd"))) {
        if (!visible(el) || (el.textContent ?? "").trim().length === 0) continue;
        if (el.closest("nav, .maplibregl-ctrl")) continue;
        out.checked++;
        const isNote = el.hasAttribute("data-note") || !!el.parentElement?.closest("ul, ol, dl")?.hasAttribute("data-note");
        const [sizeMin, lhMin, kind] = isNote ? [noteMin, noteLh, "補足"] : [bodyMin, bodyLh, "本文"];
        if (isNote) out.marked[idOf(el)] = (out.marked[idOf(el)] ?? 0) + 1;
        measure(el, sizeMin, lhMin, kind);
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
        for (let n = walker.nextNode() as HTMLElement | null; n; n = walker.nextNode() as HTMLElement | null) {
          if (!hasOwnText(n) || !visible(n)) continue;
          const mk = n.closest("[data-note]");
          if (mk && el.contains(mk) && mk !== el) continue;
          const skip = n.closest(SKIP_DESC);
          if (skip && el.contains(skip) && skip !== el) continue;
          measure(n, sizeMin, lhMin, kind);
        }
      }
      return out;
    },
    { sel: rootSelector, bodyMin: body, noteMin: NOTE_FONT_MIN, bodyLh: BODY_LINE_RATIO_MIN, noteLh: NOTE_LINE_RATIO_MIN, largeGap: LARGE_TEXT_GAP, largeLh: LARGE_LINE_RATIO_MIN, allowed: [...DATA_NOTE_ALLOWED_TAGS] as string[] },
  );
};

/**
 * 文字の大きさが min px 以上であること。
 * opts.body を渡すと、本文（印のない p・li・dd）と補足（`data-note`）の大きさ・行の高さも確かめる（契約 R1-3）。省略したときは従来の動作のまま。
 */
export const expectFontSize = async (page: Page, rootSelector: string, min: number, label: string, opts: FontSizeOptions = {}): Promise<void> => {
  const samples = await collectTextSamples(page, rootSelector);
  const bad = samples.filter((s) => s.fontSize < min).map((s) => `${s.testId ?? s.tag}「${s.text}」 ${s.fontSize}px`);
  expect(bad, `${label}: ${min}px 未満の文字`).toEqual([]);
  if (opts.body === undefined) return;
  const rep = await collectBodyTextReport(page, rootSelector, opts.body);
  try {
    const ids = Object.entries(rep.marked).map(([k, v]) => `${k}×${v}`).join(", ");
    test.info().annotations.push({ type: "data-note", description: `${label}: 印の付いた p・li・dd ${Object.values(rep.marked).reduce((a, b) => a + b, 0)} 件（検査した p・li・dd ${rep.checked} 件）${ids ? ` ${ids}` : ""}` });
  } catch {
    // test の外（単体の呼び出し）では注記しない
  }
  expect(rep.checked, `${label}: 本文の検査の対象（p・li・dd）がない`).toBeGreaterThan(0);
  expect(rep.misplaced, `${label}: data-note は p・li・dd・ul・ol・dl・span・time・small だけに付ける`).toEqual([]);
  expect(rep.bad, `${label}: 本文 ${opts.body}px・行の高さ 1.7（補足 14px・1.5）に足りない p・li・dd（${rep.bad.length} 件）`).toEqual([]);
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

/** 入れ物の切れの検査から外す要素（意図して切っているもの）。理由を必ず書く。足すときは理由と、画面の全文が別に得られることを PR に書く。 */
export const CLIP_CONTAINER_EXCLUDES: ReadonlyArray<{ readonly selector: string; readonly reason: string }> = [
  { selector: ".sb-sr, .sr-only", reason: "視覚的に隠した読み上げ専用の文（1px の枠で切るのが目的）" },
  { selector: ".maplibregl-map, .maplibregl-ctrl, .leaflet-container", reason: "地図（第三者の部品。ドラッグで動かす枠で、枠の外は地図の続き）" },
  { selector: ".sb-hero", reason: "`/` の挿絵（文字を持たない線画の背景。枠で切る意匠）" },
];

/** 文字 200%・320 幅の検査（Sprint 16-B）で使う幅。 */
export const TEXT_ZOOM_WIDTHS = [390, 430] as const;

export type TextZoomReport = {
  readonly width: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  /** 文字を持つのに、overflow が hidden/clip で内容が切れている要素 */
  readonly clipped: string[];
  /**
   * 入れ物の切れ（16-D 追加 1）：overflow-x/y が hidden・clip の要素（文字を持つかどうかを問わない）で scrollWidth > clientWidth + 1 のもの。
   * `clipped` は「直接の文字を持つ要素」しか見ないので、子だけを持つ入れ物（nav・グリッドなど）の切れを見逃す（16-C の評価で plan-digest が該当）。
   * 意図して切っている要素は CLIP_CONTAINER_EXCLUDES と、省略表示（text-overflow: ellipsis で全文が title にあるもの）だけ除く。
   */
  readonly clippedContainers: string[];
  /** 除外した入れ物（理由つきの記録。テストの注記に出す） */
  readonly excludedContainers: string[];
  /** 200% にしても文字の大きさが（ほぼ）2 倍にならなかった要素（px 固定の指定が残っている） */
  readonly unscaled: string[];
  /** 主ボタンで、スクロールしても画面の中に入らない・固定の下部ナビに隠れるもの */
  readonly unreachablePrimary: string[];
  /** 固定の下部ナビが、ページの最後の要素を隠しているか（隠れた分の px。隠れていなければ 0） */
  readonly navCoversLast: number;
  readonly textCount: number;
};

/**
 * 文字 200%（K-5）。`html` の文字の大きさを 32px（既定の 200%）にして、各幅（既定 390・430）で次を確かめる。
 * - 横スクロールがない
 * - 文字を持つ要素の切れ（overflow が hidden/clip で scrollHeight/scrollWidth が clientHeight/clientWidth を超える）が 0
 * - 文字を持つ要素の計算された大きさが、基準（16px）の 2 倍になる（rem・em だけで書かれていること）。地図の部品（`.maplibregl-*`・`.leaflet-*`）は第三者の部品なので除く
 * - 主ボタン（`.opx-btn-primary`・`.sb-pill-primary`・`[data-variant="primary"]`）にスクロールで届き、固定の下部ナビに隠れない
 * - 固定の下部ナビが、最後の要素を隠さない（最後までスクロールしたとき）
 * 検査のあと、幅と文字の大きさを元に戻す。端末の文字の設定がウェブにどう効くかは実機で確かめる（G-2）。
 */
export const measureTextZoom = async (page: Page, width: number): Promise<TextZoomReport> => {
  const original = page.viewportSize();
  await page.setViewportSize({ width, height: original?.height ?? 844 });
  await waitForSettledStyles(page);
  try {
    // 基準の大きさは要素そのものに結び付けて持つ（番号で突き合わせると、測っている間に DOM に要素が増減したとき、別の要素と比べて誤検出する。
    // 14795fa でも、同じ DB で繰り返すと 24 回中 11 回「16px→28px」の誤検出が出た）。基準のない（後から増えた）要素は 2 倍の検査から外す。
    await page.evaluate(() => {
      const m = new WeakMap<Element, number>();
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) m.set(el, parseFloat(getComputedStyle(el).fontSize));
      (window as unknown as { __zoomBase?: WeakMap<Element, number> }).__zoomBase = m;
    });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    return await page.evaluate(
      ({ w, excludes }) => {
        const de = document.documentElement;
        const all = Array.from(document.body.querySelectorAll<HTMLElement>("*"));
        const describe = (el: Element): string => {
          const id = el.getAttribute("data-testid");
          const t = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 20);
          return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ""}「${t}」`;
        };
        const visible = (el: HTMLElement): boolean => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const shown = el.checkVisibility?.({ checkVisibilityCSS: true, contentVisibilityAuto: true }) ?? true;
          return shown && r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
        };
        const hasOwnText = (el: HTMLElement): boolean => Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0);
        const isSr = (el: HTMLElement): boolean => !!el.closest(".sb-sr, .sr-only");
        const isThirdParty = (el: HTMLElement): boolean => !!el.closest(".maplibregl-map, .maplibregl-ctrl, .leaflet-container");
        const clipped: string[] = [];
        const unscaled: string[] = [];
        let textCount = 0;
        all.forEach((el) => {
          if (!hasOwnText(el) || !visible(el) || isSr(el)) return;
          textCount++;
          const cs = getComputedStyle(el);
          if (!isThirdParty(el)) {
            const before = (window as unknown as { __zoomBase?: WeakMap<Element, number> }).__zoomBase?.get(el) ?? 0;
            const after = parseFloat(cs.fontSize);
            if (before > 0 && after < before * 1.9) unscaled.push(`${describe(el)} ${before}px→${after}px`);
          }
          const clips = (v: string) => v === "hidden" || v === "clip";
          if ((clips(cs.overflowX) || clips(cs.overflowY)) && !isThirdParty(el)) {
            if (el.scrollHeight > el.clientHeight + 1 && clips(cs.overflowY)) clipped.push(`${describe(el)} 高さ ${el.clientHeight}<${el.scrollHeight}`);
            else if (el.scrollWidth > el.clientWidth + 1 && clips(cs.overflowX)) clipped.push(`${describe(el)} 幅 ${el.clientWidth}<${el.scrollWidth}`);
          }
        });
        // 入れ物の切れ（文字の有無を問わない）。除外は CLIP_CONTAINER_EXCLUDES と、全文が title にある省略表示だけ
        const clippedContainers: string[] = [];
        const excludedContainers: string[] = [];
        const clipsV = (v: string) => v === "hidden" || v === "clip";
        for (const el of all) {
          const cs = getComputedStyle(el);
          if (!clipsV(cs.overflowX) && !clipsV(cs.overflowY)) continue;
          if (!visible(el)) continue;
          if (!(clipsV(cs.overflowX) && el.scrollWidth > el.clientWidth + 1)) continue;
          const label = `${describe(el)} 幅 ${el.clientWidth}<${el.scrollWidth}`;
          const hit = excludes.find((x) => el.matches(x.selector) || !!el.closest(x.selector));
          if (hit) {
            excludedContainers.push(`${label}（除外：${hit.reason}）`);
            continue;
          }
          if (cs.textOverflow === "ellipsis" && (el.hasAttribute("title") || !!el.closest("[title]"))) {
            excludedContainers.push(`${label}（除外：省略表示。全文は title にある）`);
            continue;
          }
          clippedContainers.push(label);
        }
        const navEl = document.querySelector<HTMLElement>('[data-testid="ops-bottom-nav"]');
        const nav = navEl && visible(navEl) && getComputedStyle(navEl).position === "fixed" ? navEl : null;
        const reaches = (el: HTMLElement): boolean => {
          el.scrollIntoView({ block: "center", behavior: "instant" });
          const r = el.getBoundingClientRect();
          if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) return false;
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && (hit === el || el.contains(hit));
        };
        const unreachablePrimary = Array.from(document.querySelectorAll<HTMLElement>('.opx-btn-primary, .sb-pill-primary, [data-variant="primary"]'))
          .filter((el) => visible(el) && !(el as HTMLButtonElement).disabled && !el.closest("dialog:not([open])"))
          .filter((el) => !reaches(el))
          .map(describe);
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
        let navCoversLast = 0;
        if (nav) {
          const nr = nav.getBoundingClientRect();
          const main = document.querySelector<HTMLElement>("main") ?? document.body;
          let last: HTMLElement | null = null;
          let bottom = -1;
          for (const el of Array.from(main.querySelectorAll<HTMLElement>("*"))) {
            if (nav.contains(el) || !visible(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.height === 0) continue;
            if (r.bottom > bottom) {
              bottom = r.bottom;
              last = el;
            }
          }
          if (last && bottom > nr.top + 1) navCoversLast = Math.round(bottom - nr.top);
        }
        window.scrollTo({ top: 0, behavior: "instant" });
        return {
          width: w,
          scrollWidth: de.scrollWidth,
          clientWidth: de.clientWidth,
          clipped,
          clippedContainers,
          excludedContainers,
          unscaled,
          unreachablePrimary,
          navCoversLast,
          textCount,
        };
      },
      { w: width, excludes: CLIP_CONTAINER_EXCLUDES.map((x) => ({ ...x })) },
    );
  } finally {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    if (original) await page.setViewportSize(original);
  }
};

export const expectTextZoom = async (page: Page, label: string, widths: readonly number[] = TEXT_ZOOM_WIDTHS): Promise<void> => {
  for (const w of widths) {
    const r = await measureTextZoom(page, w);
    const l = `${label} 文字 200%・${w}px`;
    if (r.excludedContainers.length > 0) test.info().annotations.push({ type: "clip-excluded", description: `${l}: 入れ物の切れの検査から除外 ${r.excludedContainers.join(" / ")}` });
    expect(r.textCount, `${l}: 文字を持つ要素がない`).toBeGreaterThan(0);
    expect(r.scrollWidth, `${l}: 横スクロールがある`).toBeLessThanOrEqual(r.clientWidth);
    expect(r.clipped, `${l}: 文字の切れ`).toEqual([]);
    expect(r.clippedContainers, `${l}: 入れ物の切れ（overflow が hidden・clip の要素の scrollWidth が clientWidth を超える）`).toEqual([]);
    expect(r.unscaled, `${l}: 200% にしても大きくならない文字（rem・em にする）`).toEqual([]);
    expect(r.unreachablePrimary, `${l}: スクロールで届かない・下部ナビに隠れる主ボタン`).toEqual([]);
    expect(r.navCoversLast, `${l}: 固定の下部ナビが最後の要素を隠している（px）`).toBe(0);
  }
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
  "起算日",
  "開庁日以上前までに提出",
  "提出期限の目安",
  "DIPS／DRS 入力",
  "マニュアル骨子",
  "手続き窓口",
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


/**
 * 入力欄の検査（Sprint 16-D D-1）。root の中の見えている入力欄（input・select・textarea。hidden・submit・button・checkbox・radio・file・range を除く）について:
 * - 見えるラベルがある（`<label for>`・包む `<label>`・`aria-labelledby` のどれかが、見えていて空でない文字を持つ。`aria-label` だけは不可。プレースホルダーはラベルではない）
 * - ラベルの文字は入力欄の上にある（文字の下端 ≤ 入力欄の上端 + 2px）
 * - 高さは 52px 以上（現場 56px 以上）・角丸 12px
 * - `aria-invalid="true"` の入力欄は、`aria-describedby` が見えて空でない文字を持つ要素を指し、その要素は role="alert" でなく、記号（SVG か aria-hidden の印）を持つ
 */
export type FieldReport = { readonly count: number; readonly noLabel: string[]; readonly notAbove: string[]; readonly badSize: string[]; readonly badError: string[]; readonly invalid: number };

export const collectFieldReport = async (page: Page, rootSelector: string, field: boolean): Promise<FieldReport> =>
  page.evaluate(
    ({ root, field }) => {
      const rootEl = document.querySelector(root) ?? document.body;
      const describe = (el: Element): string => {
        const ty = el.getAttribute("type");
        const near = (el.closest("div, label, fieldset, section")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
        return `${el.tagName.toLowerCase()}${ty ? `[type=${ty}]` : ""}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : el.id ? `#${el.id}` : el.getAttribute("name") ? `[name=${el.getAttribute("name")}]` : ""}「${near}」`;
      };
      const shown = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest(".sb-sr, .sr-only");
      };
      const textNodeRect = (host: Element, control: Element): DOMRect | null => {
        const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!(n.textContent ?? "").trim()) continue;
          if (control.contains(n)) continue;
          const par = (n as Text).parentElement;
          if (par && (par.closest(".sb-sr, .sr-only") || getComputedStyle(par).display === "none")) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return rect;
        }
        return null;
      };
      const controls = Array.from(rootEl.querySelectorAll<HTMLInputElement>("input, select, textarea")).filter((el) => {
        if (el instanceof HTMLInputElement && ["hidden", "submit", "button", "checkbox", "radio", "file", "range", "reset", "image"].includes(el.type)) return false;
        return shown(el);
      });
      const noLabel: string[] = [];
      const notAbove: string[] = [];
      const badSize: string[] = [];
      const badError: string[] = [];
      let invalid = 0;
      for (const el of controls) {
        const hosts: Element[] = Array.from(el.labels ?? []);
        for (const id of (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)) {
          const t = document.getElementById(id);
          if (t) hosts.push(t);
        }
        const rects = hosts.filter(shown).map((h) => textNodeRect(h, el)).filter((r): r is DOMRect => r !== null);
        if (rects.length === 0) {
          noLabel.push(describe(el));
        } else {
          const er = el.getBoundingClientRect();
          if (!rects.some((r) => r.bottom <= er.top + 2)) notAbove.push(`${describe(el)}（ラベルの下端 ${Math.round(rects[0]!.bottom)} > 入力欄の上端 ${Math.round(er.top)}）`);
        }
        const cs = getComputedStyle(el);
        const h = el.getBoundingClientRect().height;
        const min = field ? 56 : 52;
        if (h < min - 0.5) badSize.push(`${describe(el)} 高さ ${h.toFixed(1)} < ${min}`);
        if (parseFloat(cs.borderTopLeftRadius) !== 12) badSize.push(`${describe(el)} 角丸 ${cs.borderTopLeftRadius}`);
        if (el.getAttribute("aria-invalid") === "true") {
          invalid++;
          const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
          const targets = ids.map((id) => document.getElementById(id)).filter((t): t is HTMLElement => !!t && shown(t) && (t.textContent ?? "").trim().length > 0);
          const ok = targets.some((t) => t.getAttribute("role") !== "alert" && !t.closest('[role="alert"]') && !!t.querySelector('svg, [aria-hidden="true"]'));
          if (!ok) badError.push(`${describe(el)}（aria-describedby=${el.getAttribute("aria-describedby") ?? "なし"}）`);
        }
      }
      return { count: controls.length, noLabel, notAbove, badSize, badError, invalid };
    },
    { root: rootSelector, field },
  );

export const expectFields = async (page: Page, rootSelector: string, label: string, opts: { field?: boolean; minCount?: number } = {}): Promise<FieldReport> => {
  const r = await collectFieldReport(page, rootSelector, opts.field ?? false);
  expect(r.count, `${label}: 入力欄がない`).toBeGreaterThanOrEqual(opts.minCount ?? 1);
  expect(r.noLabel, `${label}: 見えるラベルがない入力欄`).toEqual([]);
  expect(r.notAbove, `${label}: ラベルが入力欄の上にない`).toEqual([]);
  expect(r.badSize, `${label}: 入力欄の高さ・角丸`).toEqual([]);
  expect(r.badError, `${label}: エラーの関連付け（aria-describedby・alert でない・記号）`).toEqual([]);
  return r;
};
