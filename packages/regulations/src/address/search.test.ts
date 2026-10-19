import { describe, expect, it } from "vitest";
import { arabicToKanjiNumber, kanjiNumberToArabic, normalizeAddress } from "./normalize";
import { prepareAddressIndex, searchBundledAddress } from "./search";
import type { AddressBundleEntry } from "./types";

// 照合ロジックの単体テスト（架空の小さな索引。実在の住所・座標ではない）。
// 同梱索引（実データ）での精度の検証は bundled.test.ts。

const FIXTURE: Record<string, AddressBundleEntry> = {
  "31": {
    index: {
      format: 1,
      prefCode: "31",
      pref: "鳥取県",
      datasetId: "abr-address",
      source: "test",
      license: "test",
      feed: "test",
      acquiredAt: "2026-10-19",
      version: "test",
      cities: [
        ["312029", "", "米子市", "", 35.4, 133.3],
        ["313866", "西伯郡", "日吉津村", "", 35.44, 133.38],
      ],
      towns: [
        [0, "0001001", "加茂町", "一丁目", "", 35.41, 133.31, 1],
        [0, "0001002", "加茂町", "二丁目", "", 35.42, 133.32, 1],
        [0, "0002000", "大字一ノ谷", "", "", 35.43, 133.33, 0],
        [1, "0001000", "大字日吉津", "", "", 35.441, 133.381, 0],
        [1, "0001001", "大字日吉津", "", "字東", 35.442, 133.382, 0],
      ],
      blocks: [
        [1, "12", 35.421, 133.321],
        [1, "3", 35.422, 133.322],
      ],
      residences: [[0, "5", "", 35.4211, 133.3211]],
    },
    parcels: {
      format: 1,
      prefCode: "31",
      parcels: [
        [3, "45-3", 35.4415, 133.3815],
        [2, "100", 35.4301, 133.3301],
      ],
    },
  },
};

const P = prepareAddressIndex(FIXTURE);
const search = (q: string) => searchBundledAddress(q, P);

describe("正規化", () => {
  it("漢数字と算用数字", () => {
    expect(kanjiNumberToArabic("二十三")).toBe("23");
    expect(kanjiNumberToArabic("百五")).toBe("105");
    expect(kanjiNumberToArabic("一〇二")).toBe("102");
    expect(arabicToKanjiNumber(12)).toBe("十二");
    expect(arabicToKanjiNumber(2345)).toBe("二千三百四十五");
    for (const n of [1, 9, 10, 11, 20, 99, 100, 101, 999, 1000, 4321]) {
      expect(kanjiNumberToArabic(arabicToKanjiNumber(n))).toBe(String(n));
    }
  });
  it("丁目・番地・番・号・の・全角・大字・字の揺れを吸収する", () => {
    const a = normalizeAddress("米子市加茂町二丁目１２番５号");
    expect(a).toBe(normalizeAddress("米子市加茂町2-12-5"));
    expect(normalizeAddress("日吉津村大字日吉津45番地の3")).toBe(normalizeAddress("日吉津村日吉津45-3"));
    expect(normalizeAddress("日吉津村字東")).toBe(normalizeAddress("日吉津村東"));
  });
});

describe("同梱索引の検索（架空の索引）", () => {
  it("住居表示：住居番号まで一致すれば residence、街区までなら block", () => {
    expect(search("鳥取県米子市加茂町二丁目十二番五号")[0]).toMatchObject({ level: "residence", lat: 35.4211, source: "abr" });
    expect(search("米子市加茂町2-12-5")[0]?.level).toBe("residence");
    expect(search("米子市加茂町２丁目３番")[0]).toMatchObject({ level: "block", lat: 35.422 });
    expect(search("米子市加茂町2丁目3-9")[0]).toMatchObject({ level: "block", lat: 35.422 });
  });

  it("町字までしか合わない入力は machiaza", () => {
    expect(search("米子市加茂町一丁目")[0]).toMatchObject({ level: "machiaza", lat: 35.41 });
    expect(search("米子市加茂町1丁目99番")[0]).toMatchObject({ level: "machiaza", lat: 35.41 });
    // 「加茂町1」は「加茂町12…」に一致しない（数字の途中で切らない）
    expect(search("米子市加茂町12")[0]?.level).toBe("city");
  });

  it("地番：郡・大字の省略、番地の表記揺れ", () => {
    for (const q of [
      "鳥取県西伯郡日吉津村大字日吉津45番地3",
      "西伯郡日吉津村日吉津45-3",
      "日吉津村日吉津四十五番地三",
      "鳥取県日吉津村大字日吉津４５－３",
    ]) {
      expect(search(q)[0], q).toMatchObject({ level: "parcel", lat: 35.4415 });
    }
    // 町名の一部の漢数字（一ノ谷）も一致する
    expect(search("米子市一の谷100番地")[0]).toMatchObject({ level: "parcel", lat: 35.4301 });
  });

  it("小字付きの町字は最長一致", () => {
    expect(search("日吉津村大字日吉津字東")[0]).toMatchObject({ level: "machiaza", lat: 35.442 });
    expect(search("日吉津村大字日吉津")[0]).toMatchObject({ level: "machiaza", lat: 35.441 });
  });

  it("市区町村だけなら city、未収録は空", () => {
    expect(search("米子市")[0]).toMatchObject({ level: "city", lat: 35.4 });
    expect(search("東京都千代田区")).toEqual([]);
    expect(search("")).toEqual([]);
  });
});
