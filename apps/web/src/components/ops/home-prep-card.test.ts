import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomePrepCard } from "./home-prep-card";
import type { PrepInput } from "@/server/ops/prep-card-logic";

const render = (input: PrepInput): string => renderToStaticMarkup(createElement(HomePrepCard, { input, when: "1/5（火） 13:00〜14:00", place: "試験地点" }));

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

  it("HM-5：判定の行が取れないとき、その行に「未確認」と「再読み込み」を出し、他の 2 行は出る。帯は灰（data-state なし）", () => {
    for (const judgement of [{ kind: "load_failed" } as const, { kind: "no_record", stale: false } as const]) {
      const h = render({ report: "recorded", inspection: "recorded", judgement });
      expect(h).toContain("未確認（");
      expect(h).toContain("再読み込み");
      expect(h.match(/data-testid="home-prep-reload"/g)).toHaveLength(1);
      expect(h).toContain("受付番号を記録済み");
      expect(h).toContain("記録済み");
      expect(h).not.toContain("data-state=");
      expect(h).toContain('data-tone="unknown"');
    }
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

  it("読み上げの 1 文を region の名前にする。端末に残すもの（氏名・座標・自由記述）は props に無い", () => {
    const h = render({ report: "cancelled", inspection: "abnormal", judgement: { kind: "counts", stale: false, counts: { noFly: 2, needs: 0, unknown: 0, done: 0, none: 0 } } });
    expect(h).toContain('aria-label="次の飛行の準備。通報、取り消し済み。飛行前点検、異常あり。判定、飛行不可の項目が 2 件あります。"');
    expect(h).toContain('data-state="danger"');
  });
});
