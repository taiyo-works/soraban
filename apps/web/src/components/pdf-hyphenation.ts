import { Font } from "@react-pdf/renderer";

// react-pdf の既定の分綴（英語パターン）は日本語の文字列にも効き、行末に「-」を差し込む。
// 代わりに、改行してよい位置を「幅 0 の区切り（空文字の音節）」で示す。
// textkit は空文字の音節を glue（空白扱い）として扱い、そこでの改行には「-」を付けない。
//   - 英数字の連続（例：1,000m、2026-07-14、URL）は分割しない
//   - 閉じ括弧・句読点は直前の文字に、開き括弧は直後の文字に付けて、行頭・行末に残さない
//
// 半角スペースは textkit が伸縮する空白として扱うため、行内に空白が 2 つ以上あると、
// 文字間（伸縮しない区切り）より空白での改行が優先され、行末が大きく空く。
// 和文の地の文は keepSpaces() でスペースをノーブレークスペースに置き換え、
// 文字間と同じ区切りとして扱う（見た目の空きは変わらない）。
const CLOSING = new Set("、。，．・：；）」』】〕〉》！？ー…％");
const OPENING = new Set("（「『【〔〈《");
const NBSP = "\u00a0";
const ASCII_RUN = /^[\x21-\x7e]+$/;

const splitJapanese = (word: string): string[] => {
  if (ASCII_RUN.test(word)) return [word];
  const units: string[] = [];
  let ascii = "";
  for (const ch of Array.from(word)) {
    if (ch.charCodeAt(0) <= 0x7e) {
      ascii += ch;
      continue;
    }
    if (ascii) {
      units.push(ascii);
      ascii = "";
    }
    units.push(ch);
  }
  if (ascii) units.push(ascii);

  const merged: string[] = [];
  let pendingOpen = "";
  for (const u of units) {
    if (OPENING.has(u)) {
      pendingOpen += u;
      continue;
    }
    if ((CLOSING.has(u) || u === NBSP) && merged.length > 0 && pendingOpen === "") {
      merged[merged.length - 1] += u;
      continue;
    }
    merged.push(pendingOpen + u);
    pendingOpen = "";
  }
  if (pendingOpen) merged.push(pendingOpen);

  // 単位の間に空文字を挟む（改行可能・ハイフンなし）。
  return merged.flatMap((m, i) => (i < merged.length - 1 ? [m, ""] : [m]));
};

let registered = false;

export const registerJapaneseLineBreaking = (): void => {
  if (registered) return;
  Font.registerHyphenationCallback(splitJapanese);
  registered = true;
};

/** 和文の地の文の半角スペースをノーブレークスペースにする（PDF 専用。表示上の空きは同じ） */
export const keepSpaces = (text: string): string => text.replace(/ /g, NBSP);
