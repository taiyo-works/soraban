import { describe, expect, it } from "vitest";
import { ADDRESS_BUNDLE } from "../data-bundle/address-bundle";
import { arabicToKanjiNumber } from "./normalize";
import { prepareAddressIndex, searchBundledAddress } from "./search";

// Sprint 9 契約 2：同梱索引から無作為に抽出した 30 件（乱数種を固定）を、表記揺れ 3 種
// （都道府県名の省略、算用数字→漢数字、「番地」→「-」）に変換して検索すると、元の地点が 1 位に来る割合が 90% 以上。
// 町字までしか合わない入力は階層 machiaza を返す。
//
// 同梱索引が空（アドレス・ベース・レジストリを取得できていない）間は、この検証はスキップになる。
// 空であることは README（data/address/README.md）に明記し、apps/web/src/server/address-index-state.test.ts で README と一致させる。

const entries = Object.values(ADDRESS_BUNDLE);
const EMPTY = entries.length === 0;

const mulberry32 = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Sample = {
  readonly kind: "machiaza" | "block" | "residence" | "parcel";
  readonly pref: string;
  readonly rest: string; // 都道府県名の後ろ（郡・市区町村・町字）
  readonly nums: readonly string[];
  readonly lat: number;
  readonly lng: number;
};

const buildSamples = (): Sample[] => {
  const all: Sample[] = [];
  for (const { index, parcels } of entries) {
    const townName = (ti: number) => {
      const t = index.towns[ti]!;
      const c = index.cities[t[0]]!;
      return `${c[1]}${c[2]}${c[3]}${t[2]}${t[3]}${t[4]}`;
    };
    index.towns.forEach((t, ti) => {
      if (t[5] !== null && t[6] !== null) all.push({ kind: "machiaza", pref: index.pref, rest: townName(ti), nums: [], lat: t[5], lng: t[6] });
    });
    index.blocks.forEach((b) => {
      if (b[2] !== null && b[3] !== null) all.push({ kind: "block", pref: index.pref, rest: townName(b[0]), nums: [b[1]], lat: b[2], lng: b[3] });
    });
    for (const r of index.residences) {
      const b = index.blocks[r[0]]!;
      all.push({ kind: "residence", pref: index.pref, rest: townName(b[0]), nums: [b[1], r[1], ...(r[2] ? [r[2]] : [])], lat: r[3], lng: r[4] });
    }
    for (const p of parcels?.parcels ?? []) {
      all.push({ kind: "parcel", pref: index.pref, rest: townName(p[0]), nums: p[1].split("-"), lat: p[2], lng: p[3] });
    }
  }
  // 種類ごとに偏らないよう、種類ごとに同数ずつ（乱数種固定）抜き出す
  const rand = mulberry32(20261019);
  const kinds = ["machiaza", "block", "residence", "parcel"] as const;
  const present = kinds.filter((k) => all.some((s) => s.kind === k));
  const out: Sample[] = [];
  let i = 0;
  while (out.length < 30 && present.length > 0) {
    const pool = all.filter((s) => s.kind === present[i % present.length]);
    out.push(pool[Math.floor(rand() * pool.length)]!);
    i++;
  }
  return out;
};

/** 標準の表記（番地は「123番地4」、住居表示は「12番5号」）。 */
const numberPart = (s: Sample, kanji: boolean, hyphen: boolean): string => {
  const n = s.nums.map((x) => (kanji && /^\d+$/.test(x) ? arabicToKanjiNumber(Number(x)) : x));
  if (n.length === 0) return "";
  if (s.kind === "parcel") return hyphen ? n.join("-") : `${n[0]}番地${n.slice(1).join("-")}`;
  if (s.kind === "block") return `${n[0]}番`;
  return hyphen ? n.join("-") : `${n[0]}番${n[1]}号${n[2] ? `-${n[2]}` : ""}`;
};

describe("同梱索引（アドレス・ベース・レジストリ）での照合精度", () => {
  it.skipIf(EMPTY)("30 件 × 表記揺れ 3 種で、元の地点が 1 位に来る割合が 90% 以上", () => {
    const prepared = prepareAddressIndex(ADDRESS_BUNDLE);
    const samples = buildSamples();
    expect(samples).toHaveLength(30);
    let ok = 0;
    let total = 0;
    const misses: string[] = [];
    for (const s of samples) {
      const variants = [
        `${s.rest}${numberPart(s, false, false)}`, // 都道府県名の省略
        `${s.pref}${s.rest}${numberPart(s, true, false)}`, // 算用数字→漢数字
        `${s.pref}${s.rest}${numberPart(s, false, true)}`, // 「番地」→「-」
      ];
      for (const q of variants) {
        total++;
        const top = searchBundledAddress(q, prepared)[0];
        if (top && Math.abs(top.lat - s.lat) < 1e-6 && Math.abs(top.lng - s.lng) < 1e-6) ok++;
        else misses.push(`${q} → ${top ? `${top.level} ${top.title}` : "なし"}`);
      }
    }
    expect(ok / total, misses.join("\n")).toBeGreaterThanOrEqual(0.9);
  });

  it.skipIf(EMPTY)("町字までしか合わない入力は machiaza を返す", () => {
    const prepared = prepareAddressIndex(ADDRESS_BUNDLE);
    const s = buildSamples().find((x) => x.kind === "machiaza")!;
    expect(searchBundledAddress(`${s.pref}${s.rest}`, prepared)[0]?.level).toBe("machiaza");
  });
});
