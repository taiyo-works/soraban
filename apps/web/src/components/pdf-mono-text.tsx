"use client";

import { StyleSheet, Text } from "@react-pdf/renderer";
import type { ReactNode } from "react";

// @react-pdf/types は apps/web の直接依存ではない（@react-pdf/renderer 経由の
// 推移依存）ため、直 import は避ける。代わりに、既に import 済みの
// @react-pdf/renderer の StyleSheet.create が返すスタイル型を流用して型安全を保つ。
// （<Text> の style 型は SVG 版とのユニオンになり扱いづらいため、こちらを使う。）
type SheetStyle = ReturnType<typeof StyleSheet.create>[string];
// 既存 PDF コンポーネントと同じく、単一スタイルか配列を受け取れるようにする。
type TextStyle = SheetStyle | SheetStyle[];

// ── PDF の等幅（IBM Plex Mono）スパンに日本語（CJK）を載せると壊れる問題への対策 ──
//
// 背景:
//   @react-pdf/renderer は単一 fontFamily 指定では CJK 自動フォールバックをしない。
//   そのため fontFamily:"IBM Plex Mono" を当てた <Text> に日本語が混ざると、
//   登録済みの Noto Sans JP ではなく Helvetica にフォールバックして CJK グリフを失い、
//   描画で脱落／文字化けする（pdfjs 警告: getPathGenerator ... Helvetica_path...）。
//
// 対策（approach (a)・最小変更）:
//   等幅スパンの文字列を「CJK の連なり」と「非 CJK（英数・記号・URL）の連なり」に分割し、
//   CJK の部分だけ Noto Sans JP の入れ子 <Text> に振り分ける。英数・記号は親の mono のまま。
//   これで mono の質感（座標・ID・URL の等幅）を保ちつつ、日本語を確実に描画できる。
//
// このモジュールは描画（フォントの振り分け）のみを担当し、
// テキスト内容・データ・フォント登録には一切手を入れない。

// 日本語フォントを当てるべき文字（CJK 統合漢字・かな・全角記号・全角空白など）。
// ASCII 英数・半角記号・半角空白は等幅（mono）のまま残す。
//
// 範囲:
//   - U+3000–U+303F  CJK 記号・句読点（「」、・全角空白 等）
//   - U+3040–U+30FF  ひらがな・カタカナ
//   - U+31F0–U+31FF  カタカナ拡張
//   - U+3400–U+4DBF  CJK 統合漢字拡張A
//   - U+4E00–U+9FFF  CJK 統合漢字
//   - U+F900–U+FAFF  CJK 互換漢字
//   - U+FF00–U+FFEF  半角・全角形（全角英数・全角記号・「°」等の全角形）
const CJK_RE =
  /[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿＀-￯]/;

const isCjk = (ch: string): boolean => CJK_RE.test(ch);

/**
 * 文字列を「非 CJK」「CJK」の連なりに分割する。
 * 返り値は出現順の配列。各要素はそのまま等幅 or Noto Sans JP に振り分けられる。
 */
const splitByScript = (
  text: string,
): readonly { readonly cjk: boolean; readonly text: string }[] => {
  const runs: { cjk: boolean; text: string }[] = [];
  for (const ch of text) {
    const cjk = isCjk(ch);
    const last = runs[runs.length - 1];
    if (last && last.cjk === cjk) {
      last.text += ch;
    } else {
      runs.push({ cjk, text: ch });
    }
  }
  return runs;
};

// 入れ子で当てる日本語フォント。親（mono）の fontSize / color などは継承される。
const JA_STYLE: SheetStyle = { fontFamily: "Noto Sans JP" };

/**
 * 等幅（mono）スパン用のテキストレンダラ。
 *
 * children に渡された文字列を CJK / 非 CJK に分割し、CJK 部分だけ Noto Sans JP の
 * 入れ子 <Text> に振り分けて描画する（mono への CJK フォールバック＝文字化けを防ぐ）。
 *
 * 使い方:
 *   <MonoText style={styles.th}>系統</MonoText>
 *   <MonoText style={styles.procLinks}>手続き（DIPS 2.0）: {url}</MonoText>
 *
 * children は文字列（または文字列に評価される ReactNode の連なり）を想定する。
 * 文字列以外（要素）はそのまま素通しする（既存のネスト Text 等を壊さないため）。
 */
export const MonoText = ({
  children,
  style,
  fixed,
}: {
  readonly children?: ReactNode;
  readonly style?: TextStyle;
  /** @react-pdf の固定要素フラグ（フッタ等の全ページ固定に使う） */
  readonly fixed?: boolean;
}) => {
  return (
    <Text style={style} fixed={fixed}>
      {renderMonoChildren(children)}
    </Text>
  );
};

// children（文字列・数値・配列・要素の混在）を走査し、文字列だけ CJK 分割する。
let monoKeySeq = 0;
const renderMonoChildren = (children: ReactNode): ReactNode => {
  const flat = Array.isArray(children) ? children : [children];
  return flat.map((child) => {
    if (typeof child === "string" || typeof child === "number") {
      return renderText(String(child));
    }
    // 要素・null・boolean 等はそのまま（既存のネスト構造を壊さない）。
    return child;
  });
};

// 1 つの文字列を CJK/非 CJK に分割して Text 断片の配列にする。
const renderText = (text: string): ReactNode => {
  if (text.length === 0) return text;
  const runs = splitByScript(text);
  // 全部が非 CJK（mono のまま）なら、入れ子を増やさず素のまま返す。
  if (runs.every((r) => !r.cjk)) return text;
  return runs.map((r) => {
    const key = `mt-${monoKeySeq++}`;
    return r.cjk ? (
      <Text key={key} style={JA_STYLE}>
        {r.text}
      </Text>
    ) : (
      <Text key={key}>{r.text}</Text>
    );
  });
};
