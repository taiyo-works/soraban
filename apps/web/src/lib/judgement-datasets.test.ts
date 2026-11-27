import { describe, expect, it } from "vitest";
import type { DatasetRecord } from "@soraban/regulations";
import { datasetInfo } from "./judgement-datasets";

const ledger = (over: Partial<DatasetRecord>): DatasetRecord =>
  ({ id: "d1", name: "台帳の名称", provider: "提供元A", version: "v9", url: "https://example.test/a", baseYear: 2025, verifiedAt: "2026-11-01", ...over }) as DatasetRecord;
const saved = { id: "d1", name: "保存した名称", baseYear: 2020 as number | null, verifiedAt: "2026-10-01" };

describe("datasetInfo（R-3）", () => {
  it("確認日が一致：保存した名称・基準年・確認日に、台帳の提供元・版・URL を足す", () => {
    const t = datasetInfo({ ...saved, verifiedAt: "2026-11-01" }, false, () => ledger({}));
    expect(t).toMatchObject({ name: "保存した名称", baseYear: 2020, verifiedAt: "2026-11-01", provider: "提供元A", version: "v9", url: "https://example.test/a" });
    expect(t.ledgerUpdated).toBeUndefined();
  });
  it("確認日が不一致：台帳の名称・提供元・版・URL は使わず、台帳が後で更新された印を付ける", () => {
    const t = datasetInfo(saved, false, () => ledger({}));
    expect(t).toMatchObject({ name: "保存した名称", baseYear: 2020, verifiedAt: "2026-10-01", ledgerUpdated: true });
    expect(t.provider).toBeUndefined();
    expect(t.version).toBeUndefined();
    expect(t.url).toBeUndefined();
  });
  it("台帳に無い：保存した値だけ（印も付けない）", () => {
    const t = datasetInfo(saved, false, () => {
      throw new Error("無い");
    });
    expect(t).toMatchObject({ name: "保存した名称", verifiedAt: "2026-10-01" });
    expect(t.ledgerUpdated).toBeUndefined();
    expect(t.provider).toBeUndefined();
  });
  it("確認日を読めない：古いときだけ unreadable", () => {
    const bad = { ...saved, verifiedAt: "不明" };
    expect(datasetInfo(bad, true, () => ledger({ verifiedAt: "不明" })).unreadable).toBe(true);
    expect(datasetInfo(saved, true, () => ledger({})).unreadable).toBeUndefined();
  });
});
