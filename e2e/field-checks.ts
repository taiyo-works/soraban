import { expect, type Locator, type Page } from "@playwright/test";

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

/** 文字 200%・320 幅の検査（Sprint 16-B）で使う幅。 */
export const TEXT_ZOOM_WIDTHS = [390, 430] as const;

export type TextZoomReport = {
  readonly width: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  /** 文字を持つのに、overflow が hidden/clip で内容が切れている要素 */
  readonly clipped: string[];
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
    const baseline = await page.evaluate(() => {
      const out: number[] = [];
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) out.push(parseFloat(getComputedStyle(el).fontSize));
      return out;
    });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    return await page.evaluate(
      ({ w, base }) => {
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
        all.forEach((el, i) => {
          if (!hasOwnText(el) || !visible(el) || isSr(el)) return;
          textCount++;
          const cs = getComputedStyle(el);
          if (!isThirdParty(el)) {
            const before = base[i] ?? 0;
            const after = parseFloat(cs.fontSize);
            if (before > 0 && after < before * 1.9) unscaled.push(`${describe(el)} ${before}px→${after}px`);
          }
          const clips = (v: string) => v === "hidden" || v === "clip";
          if ((clips(cs.overflowX) || clips(cs.overflowY)) && !isThirdParty(el)) {
            if (el.scrollHeight > el.clientHeight + 1 && clips(cs.overflowY)) clipped.push(`${describe(el)} 高さ ${el.clientHeight}<${el.scrollHeight}`);
            else if (el.scrollWidth > el.clientWidth + 1 && clips(cs.overflowX)) clipped.push(`${describe(el)} 幅 ${el.clientWidth}<${el.scrollWidth}`);
          }
        });
        const navEl = document.querySelector<HTMLElement>('[data-testid="ops-bottom-nav"]');
        const nav = navEl && visible(navEl) && getComputedStyle(navEl).position === "fixed" ? navEl : null;
        const reaches = (el: HTMLElement): boolean => {
          el.scrollIntoView({ block: "center" });
          const r = el.getBoundingClientRect();
          if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) return false;
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && (hit === el || el.contains(hit));
        };
        const unreachablePrimary = Array.from(document.querySelectorAll<HTMLElement>('.opx-btn-primary, .sb-pill-primary, [data-variant="primary"]'))
          .filter((el) => visible(el) && !(el as HTMLButtonElement).disabled && !el.closest("dialog:not([open])"))
          .filter((el) => !reaches(el))
          .map(describe);
        window.scrollTo(0, document.documentElement.scrollHeight);
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
        window.scrollTo(0, 0);
        return {
          width: w,
          scrollWidth: de.scrollWidth,
          clientWidth: de.clientWidth,
          clipped,
          unscaled,
          unreachablePrimary,
          navCoversLast,
          textCount,
        };
      },
      { w: width, base: baseline },
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
    expect(r.textCount, `${l}: 文字を持つ要素がない`).toBeGreaterThan(0);
    expect(r.scrollWidth, `${l}: 横スクロールがある`).toBeLessThanOrEqual(r.clientWidth);
    expect(r.clipped, `${l}: 文字の切れ`).toEqual([]);
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
