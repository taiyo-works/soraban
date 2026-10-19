import { describe, expect, it } from "vitest";
import { shortUrl, splitInlineSource } from "./inline-source";

describe("splitInlineSource（表示専用：文中の出典 URL を本文から切り分ける）", () => {
  it("注記の末尾の（出典: URL ）を取り除き、URL を返す", () => {
    const r = splitInlineSource("承認は不要です。飛行日誌は引き続き必要です。（出典: https://www.mlit.go.jp/common/001990796.pdf ）");
    expect(r.text).toBe("承認は不要です。飛行日誌は引き続き必要です。");
    expect(r.urls).toEqual(["https://www.mlit.go.jp/common/001990796.pdf"]);
  });

  it("括弧書きの中の「。URL」を取り除き、括弧書きは残す", () => {
    const r = splitInlineSource("航空局の飛行マニュアル（令和8年5月29日版。https://www.mlit.go.jp/common/002004613.pdf ）に従う。");
    expect(r.text).toBe("航空局の飛行マニュアル（令和8年5月29日版）に従う。");
    expect(r.urls).toEqual(["https://www.mlit.go.jp/common/002004613.pdf"]);
  });

  it("URL がなければそのまま返す", () => {
    expect(splitInlineSource("緊急用務空域の指定中は飛行しない。")).toEqual({ text: "緊急用務空域の指定中は飛行しない。", urls: [] });
  });

  it("短い表記はプロトコルと www. を除く", () => {
    expect(shortUrl("https://www.mlit.go.jp/common/001990796.pdf")).toBe("mlit.go.jp/common/001990796.pdf");
  });
});
