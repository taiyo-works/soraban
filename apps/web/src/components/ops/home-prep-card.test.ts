import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomePrepCard } from "./home-prep-card";
import type { PrepInput } from "@/server/ops/prep-card-logic";

const render = (input: PrepInput): string => renderToStaticMarkup(createElement(HomePrepCard, { input, when: "1/5（火） 13:00〜14:00" }));

describe("ホームの準備カード（16-G HM-1 ②・HM-5）", () => {
  it("3 行（通報・飛行前点検・判定（参考））と、判定は参考情報である旨の注記を出す。各行に記号（svg）と文字", () => {
    const h = render({ report: "confirm", inspection: "missing", judgement: { kind: "counts", stale: false, counts: { noFly: 0, needs: 1, unknown: 0, done: 0, none: 0 } } });
    expect(h).toContain("次の飛行の準備");
    expect(h).toContain("DIPS に出す内容を確認する");
    expect(h).toContain("未記録");
    expect(h).toContain("手続きが要る項目があります（1 件）");
    expect(h).toContain("判定は参考情報です");
    expect(h.match(/<svg/g)).toHaveLength(3);
    expect(h).toContain('data-state="warn"');
  });

  it("HM-5：通信の失敗のとき、判定の行に「未確認」と「再読み込み」を出し、他の 2 行は出る。帯は灰（data-state なし）", () => {
    for (const judgement of [{ kind: "load_failed" } as const]) {
      const h = render({ report: "recorded", inspection: "recorded", judgement });
      expect(h).toContain("未確認（");
      expect(h).toContain("再読み込み");
      expect(h.match(/data-testid="home-prep-reload"/g)).toHaveLength(1);
      expect(h).not.toContain("home-prep-rejudge");
      expect(h).toContain("受付番号を記録済み");
      expect(h).toContain("記録済み");
      expect(h).not.toContain("data-state=");
      expect(h).toContain('data-tone="unknown"');
    }
  });

  it("差し戻し 1：判定の記録が無いときは「再読み込み」ではなく、判定の画面の再判定（#rejudge）へのリンク。他の 2 行は出る", () => {
    const h = renderToStaticMarkup(
      createElement(HomePrepCard, { planId: "p-1", when: "1/5（火） 13:00〜14:00", input: { report: "recorded", inspection: "recorded", judgement: { kind: "no_record", stale: false } } }),
    );
    expect(h).toContain("未確認（判定の記録がありません）");
    expect(h).toContain('data-testid="home-prep-rejudge"');
    expect(h).toContain('href="/ops/plans/p-1/judgement#rejudge"');
    expect(h).not.toContain("再読み込み");
    expect(h).not.toContain('data-testid="home-prep-reload"');
    expect(h).toContain("受付番号を記録済み");
    expect(h).toContain('data-tone="unknown"');
  });

  it("差し戻し 1：受付番号なしの記録は注意（△）、対象外（模型航空機）は未確認で補足なし。「受付番号を記録済み」とは出ない", () => {
    const a = render({ report: "recorded_no_number", inspection: "recorded", judgement: { kind: "counts", stale: false, counts: { noFly: 0, needs: 0, unknown: 0, done: 0, none: 2 } } });
    expect(a).toContain("記録あり（受付番号なし）");
    expect(a).not.toContain("受付番号を記録済み");
    expect(a).toContain('data-state="warn"');
    const b = render({ report: "not_applicable", inspection: "recorded", judgement: { kind: "counts", stale: false, counts: { noFly: 0, needs: 0, unknown: 0, done: 0, none: 2 } } });
    expect(b).toContain("対象外（模型航空機）");
    expect(b).not.toContain("必須としません");
    expect(b).not.toContain('data-testid="home-prep-report-note"');
    expect(b).toContain('data-tone="unknown"');
  });

  it("再読み込みのボタンは、判定の行が取れたときは出ない", () => {
    const h = render({ report: "recorded", inspection: "recorded", judgement: { kind: "counts", stale: false, counts: { noFly: 0, needs: 0, unknown: 0, done: 0, none: 2 } } });
    expect(h).not.toContain("再読み込み");
    expect(h).toContain("調べていない項目があります");
    expect(h).toContain('data-state="safe"');
  });

  it("判定不能があるとき、総合の語は「未確認」で、手続き済み・手続き不要の語にならない", () => {
    const h = render({ report: "recorded", inspection: "recorded", judgement: { kind: "counts", stale: false, counts: { noFly: 0, needs: 0, unknown: 2, done: 3, none: 5 } } });
    expect(h).toContain("未確認の項目があります（2 件）");
    expect(h).not.toContain("手続き済みです");
    expect(h).not.toContain("見つかりませんでした");
  });

  it("region の名前は見出し（aria-labelledby）。名前と中の文が 2 回読まれない（16-N3 N3-7）。端末に残すもの（氏名・座標・自由記述）は props に無い", () => {
    const h = render({ report: "cancelled", inspection: "abnormal", judgement: { kind: "counts", stale: false, counts: { noFly: 2, needs: 0, unknown: 0, done: 0, none: 0 } } });
    expect(h).not.toContain("aria-label=");
    const by = /aria-labelledby="([^"]+)"/.exec(h)?.[1];
    expect(by).toBeTruthy();
    expect(h).toContain(`<h2 id="${by}" class="home-prep-title" data-testid="home-prep-title">次の飛行の準備</h2>`);
    // 中の 3 行の文は、それぞれ 1 回だけ
    for (const t of ["取り消し済み", "異常あり", "飛行不可の項目があります（2 件）"]) expect(h.split(t).length - 1, t).toBe(1);
    expect(h).toContain('data-state="danger"');
  });
});
