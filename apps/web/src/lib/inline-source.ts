// 注記・マニュアル骨子の文中に埋め込まれた出典 URL を、本文から切り分けて表示するための補助（表示専用）。
// データ（注記の文字列）はそのまま持ち、画面では本文の下に控えめなリンク、PDF では「出典:」行の URL 文字列として出す。
// 例：「…承認は不要です（出典: https://… ）」→ 本文「…承認は不要です」＋ URL
//     「…（令和8年5月29日版。https://… ）に従う。」→ 本文「…（令和8年5月29日版）に従う。」＋ URL

const URL_RE = /https?:\/\/[^\s）)]+/;

export type InlineSource = { readonly text: string; readonly urls: readonly string[] };

export const splitInlineSource = (input: string): InlineSource => {
  let text = input;
  const urls: string[] = [];
  for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
    const url = m[0];
    urls.push(url);
    const before = text.slice(0, m.index).replace(/(出典[:：]\s*|。\s*|\s+)$/, "");
    const after = text.slice(m.index + url.length).replace(/^\s+/, "");
    text = (before + after).replace(/（\s*）/g, "");
  }
  return { text, urls };
};

/** 画面に出す URL の短い表記（プロトコルと www. を除く）。リンク先は元の URL のまま。 */
export const shortUrl = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, "");
