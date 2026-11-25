import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DatasetRecord } from "@soraban/regulations";
import { describe, expect, it } from "vitest";
import { datasetInfo } from "@/lib/judgement-datasets";
import { JudgementTiles, LEDGER_UPDATED_NOTE, VERIFIED_UNREADABLE, type TileDataset, type TileItem } from "./judgement-tiles";

// 16-H2 再レビュー N-b：判定の画面の根拠（シート）を実際に描いて、台帳が判定の後に更新されたときの扱いを確かめる。
// シートは開いたタイルの分だけ描くので、initialOpenId で最初から開いて描く。

const item: TileItem = {
  id: "i1",
  title: "夜間飛行",
  verdict: "needs_procedure",
  verdictLabel: "要手続き",
  baseLabel: "原則禁止",
  tierLabel: "法令",
  reason: "夜間の飛行です",
  refs: [],
  appliedPermits: [],
  conditions: [],
  procedures: [],
};

const render = (datasets: readonly TileDataset[], stale = false): string =>
  renderToStaticMarkup(createElement(JudgementTiles, { items: [item], datasets, fetchedAt: "2026-11-25 10:00", fetchedAtIso: "2026-11-25T01:00:00.000Z", stale, initialOpenId: "i1" }));

const count = (h: string, s: string): number => h.split(s).length - 1;

const LEDGER: DatasetRecord = { id: "d1", name: "台帳の名称", provider: "台帳の提供元", version: "台帳の版 9", url: "https://example.test/src", verifiedAt: "2026-11-20" } as unknown as DatasetRecord;
const lookup = (): DatasetRecord => LEDGER;

describe("JudgementTiles の根拠（台帳との一致）", () => {
  it("基準：保存した確認日が台帳と一致するとき、提供元・版・出典を開くを出す（下の「一致しない」との対比）", () => {
    const d = datasetInfo({ id: "d1", name: "保存した名称", baseYear: 2024, verifiedAt: "2026-11-20" }, false, lookup);
    const h = render([d]);
    expect(h).toContain("提供元：台帳の提供元");
    expect(h).toContain("版 台帳の版 9");
    expect(count(h, "出典を開く")).toBe(1);
    expect(h).not.toContain('data-testid="judgement-sheet-dataset-ledger-updated"');
  });

  it("N-b：台帳と一致しない値のとき、「版」「提供元」「出典を開く」は 0 件、judgement-sheet-dataset-ledger-updated は 1 件。保存した名称・確認日は残る", () => {
    const d = datasetInfo({ id: "d1", name: "保存した名称", baseYear: 2024, verifiedAt: "2026-10-01" }, false, lookup);
    const h = render([d]);
    expect(count(h, "版 ")).toBe(0);
    expect(count(h, "提供元")).toBe(0);
    expect(count(h, "出典を開く")).toBe(0);
    expect(count(h, 'data-testid="judgement-sheet-dataset-ledger-updated"')).toBe(1);
    expect(h).toContain(LEDGER_UPDATED_NOTE);
    expect(h).toContain("保存した名称");
    expect(h).toContain("確認日 2026-10-01");
    expect(h).not.toContain("台帳の版");
    expect(h).not.toContain("example.test");
  });

  it("N-b：確認日を読めないとき、「確認日を読めません」が出て、「90 日超」は出ない。読めて古いときは「90 日超」", () => {
    const bad = datasetInfo({ id: "d1", name: "保存した名称", baseYear: null, verifiedAt: "不明" }, true, () => {
      throw new Error("no ledger");
    });
    const h = render([bad], true);
    expect(h).toContain(`（${VERIFIED_UNREADABLE}）`);
    expect(h).not.toContain("90 日超");
    const old = datasetInfo({ id: "d1", name: "保存した名称", baseYear: null, verifiedAt: "2026-01-01" }, true, lookup);
    const h2 = render([old], true);
    expect(h2).toContain("90 日超");
    expect(h2).not.toContain(VERIFIED_UNREADABLE);
  });
});
