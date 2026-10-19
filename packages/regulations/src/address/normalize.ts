// 住所文字列の正規化（Sprint 9）。同梱索引の名前と検索語の両方に同じ処理をかけ、表記揺れを吸収する。
//
// 吸収するもの：全角・半角（NFKC）、空白、漢数字と算用数字、「丁目」「番地」「番」「号」「-」「の」の揺れ、
// 「大字」「字」の有無、ヶ・ケ・が、ノ・の・之、ハイフンの字形。
// 町名の一部としての漢数字（例：一ノ谷）も数字にするが、索引側にも同じ処理をかけるので照合は一致する。

const KANJI_DIGITS: Readonly<Record<string, number>> = {
  〇: 0,
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const KANJI_UNITS: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 };

/** 漢数字の並び（例：二十三、百五、一〇二）を算用数字の文字列にする。 */
export const kanjiNumberToArabic = (s: string): string => {
  if (![...s].some((c) => c in KANJI_UNITS)) {
    return [...s].map((c) => String(KANJI_DIGITS[c] ?? c)).join("");
  }
  let total = 0;
  let digit = 0;
  for (const c of s) {
    if (c in KANJI_DIGITS) digit = KANJI_DIGITS[c]!;
    else {
      const unit = KANJI_UNITS[c]!;
      total += (digit === 0 ? 1 : digit) * unit;
      digit = 0;
    }
  }
  return String(total + digit);
};

/** 算用数字を漢数字にする（テスト用の表記揺れの生成にも使う）。例：12 → 十二、105 → 百五。 */
export const arabicToKanjiNumber = (n: number): string => {
  if (!Number.isInteger(n) || n < 0) return String(n);
  if (n === 0) return "〇";
  const d = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n >= 10000) return String(n).split("").map((c) => (c === "0" ? "〇" : d[Number(c)])).join("");
  let out = "";
  const units: readonly [number, string][] = [
    [1000, "千"],
    [100, "百"],
    [10, "十"],
  ];
  let rest = n;
  for (const [v, u] of units) {
    const q = Math.floor(rest / v);
    if (q > 0) out += (q === 1 ? "" : d[q]) + u;
    rest %= v;
  }
  return out + (rest > 0 ? d[rest] : "");
};

const KANJI_NUM_RUN = /[〇零一二三四五六七八九十百千]+/g;

/**
 * 名前（都道府県・市区町村・町字）用の正規化。番地の記号は変えない。
 */
export const normalizeName = (s: string): string =>
  s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[ヶヵケがガ]/g, "ケ")
    .replace(/[ノ之]/g, "の")
    .replace(/大字|字/g, "")
    .replace(KANJI_NUM_RUN, (m) => kanjiNumberToArabic(m));

/**
 * 検索語・索引キーの正規化。名前の正規化に加えて、番地の表記を「数字-数字-…」に揃える。
 *   三丁目四番五号 → 3-4-5、123番地の4 → 123-4、123番地4 → 123-4
 */
export const normalizeAddress = (s: string): string =>
  normalizeName(s)
    .replace(/[‐‑‒–—―−ｰ]/g, "-")
    .replace(/(\d)ー(?=\d)/g, "$1-")
    .replace(/(\d+)丁目/g, "$1-")
    .replace(/(\d+)番地/g, "$1-")
    .replace(/(\d+)番/g, "$1-")
    .replace(/(\d+)号/g, "$1-")
    .replace(/(\d)の(?=\d)/g, "$1-")
    .replace(/-の(?=\d)/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/, "");
