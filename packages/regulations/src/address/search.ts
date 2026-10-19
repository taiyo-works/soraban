// 同梱索引（アドレス・ベース・レジストリ、鳥取県・島根県）による住所検索（Sprint 9）。
//
// 外部へは一切通信しない（索引は静的 import の同梱データだけ）。照合の手順：
//   1. 検索語を normalizeAddress で正規化する（索引側の名前にも同じ処理をかける）
//   2. 先頭を市区町村に照合する（都道府県名・郡名は省略可。長いキーから順に試す）
//   3. 残りを町字（大字・町＋丁目＋小字）に照合する（最長一致。数字の途中で切れる一致は採らない）
//   4. 残りの数字列を、住居表示の町字なら 街区（-住居番号（-住居番号2））、それ以外なら地番として照合する
// 一致した最も深い階層の 1 件を返す（地番・住居 → 街区 → 町字 → 市区町村）。
import { ADDRESS_BUNDLE } from "../data-bundle/address-bundle";
import { normalizeAddress } from "./normalize";
import type { AddressBundleEntry, GeocodeHit, GeocodeLevel } from "./types";

type LatLngPair = readonly [number, number];

type PreparedTown = {
  readonly key: string;
  readonly name: string;
  readonly pos: LatLngPair | null;
  readonly rsdt: boolean;
  /** 街区符号 → { pos, residences: "住居番号-住居番号2" → pos } */
  readonly blocks: Map<string, { pos: LatLngPair | null; residences: Map<string, LatLngPair> }>;
  /** 地番（"123-4"）→ pos */
  readonly parcels: Map<string, LatLngPair>;
};

type PreparedCity = {
  readonly name: string;
  readonly pos: LatLngPair | null;
  /** 町字キーの長い順 */
  readonly towns: PreparedTown[];
};

type Prepared = {
  /** [市区町村キー, 市区町村] をキーの長い順に */
  readonly cityKeys: readonly (readonly [string, PreparedCity])[];
  readonly parcelsBundled: boolean;
};

const pair = (lat: number | null, lng: number | null): LatLngPair | null =>
  lat === null || lng === null ? null : [lat, lng];

/** 数字の表記を揃える（"005" → "5"）。数字でなければそのまま。 */
const num = (s: string): string => (/^\d+$/.test(s) ? String(Number(s)) : s);

export const prepareAddressIndex = (
  bundle: Readonly<Record<string, AddressBundleEntry>>,
): Prepared => {
  const cityKeys: [string, PreparedCity][] = [];
  let parcelsBundled = false;
  for (const { index, parcels } of Object.values(bundle)) {
    const cities: PreparedCity[] = index.cities.map(([, county, city, ward, lat, lng]) => ({
      name: `${index.pref}${county}${city}${ward}`,
      pos: pair(lat, lng),
      towns: [],
    }));
    index.cities.forEach(([, county, city, ward], i) => {
      const c = cities[i]!;
      const keys = new Set(
        [
          `${index.pref}${county}${city}${ward}`,
          `${index.pref}${city}${ward}`,
          `${county}${city}${ward}`,
          `${city}${ward}`,
        ].map(normalizeAddress),
      );
      for (const k of keys) if (k.length > 0) cityKeys.push([k, c]);
    });
    const towns: PreparedTown[] = index.towns.map(([ci, , oaza, chome, koaza, lat, lng, rsdt]) => {
      const t: PreparedTown = {
        key: normalizeAddress(`${oaza}${chome}${koaza}`),
        name: `${cities[ci]!.name}${oaza}${chome}${koaza}`,
        pos: pair(lat, lng),
        rsdt: rsdt === 1,
        blocks: new Map(),
        parcels: new Map(),
      };
      cities[ci]!.towns.push(t);
      return t;
    });
    const blockRefs = index.blocks.map(([ti, blk, lat, lng]) => {
      const b = { pos: pair(lat, lng), residences: new Map<string, LatLngPair>() };
      towns[ti]!.blocks.set(num(blk), b);
      return b;
    });
    for (const [bi, n1, n2, lat, lng] of index.residences) {
      const key = [num(n1), n2 ? num(n2) : ""].filter(Boolean).join("-");
      blockRefs[bi]!.residences.set(key, [lat, lng]);
    }
    if (parcels) {
      parcelsBundled = true;
      for (const [ti, p, lat, lng] of parcels.parcels) {
        towns[ti]!.parcels.set(p.split("-").map(num).join("-"), [lat, lng]);
      }
    }
    for (const c of cities) c.towns.sort((a, b) => b.key.length - a.key.length);
  }
  cityKeys.sort((a, b) => b[0].length - a[0].length);
  return { cityKeys, parcelsBundled };
};

let defaultPrepared: Prepared | null = null;
const getDefault = (): Prepared => (defaultPrepared ??= prepareAddressIndex(ADDRESS_BUNDLE));

/** 同梱索引に地番を収録しているか。 */
export const addressParcelsBundled = (): boolean => getDefault().parcelsBundled;

/** key の直後で切れてよいか（数字の途中で切れる一致は採らない）。 */
const boundaryOk = (text: string, key: string): boolean => {
  const next = text.charAt(key.length);
  if (next === "") return true;
  return !(/\d$/.test(key) && /\d/.test(next));
};

const hit = (level: GeocodeLevel, title: string, pos: LatLngPair): GeocodeHit => ({
  source: "abr",
  level,
  title,
  lat: pos[0],
  lng: pos[1],
});

/**
 * 同梱索引で住所を検索する。一致しなければ空配列。外部への通信はしない。
 * @param prepared 省略時は同梱索引（テストでは prepareAddressIndex で作った索引を渡せる）
 */
export const searchBundledAddress = (query: string, prepared?: Prepared): GeocodeHit[] => {
  const p = prepared ?? getDefault();
  const q = normalizeAddress(query);
  if (q.length === 0) return [];
  const cityHit = p.cityKeys.find(([k]) => q.startsWith(k) && boundaryOk(q, k));
  if (!cityHit) return [];
  const [cityKey, city] = cityHit;
  const rest = q.slice(cityKey.length).replace(/^-/, "");
  const town = city.towns.find((t) => t.key.length > 0 && rest.startsWith(t.key) && boundaryOk(rest, t.key));
  if (!town) {
    return city.pos ? [hit("city", city.name, city.pos)] : [];
  }
  const nums = rest
    .slice(town.key.length)
    .replace(/^-/, "")
    .split("-")
    .filter((s) => /^\d+$/.test(s))
    .map(num);
  // 数字以外が残る（町字の後ろに未知の名前が続く）場合も、町字までの一致として扱う。
  if (nums.length > 0) {
    if (town.rsdt) {
      const blk = town.blocks.get(nums[0]!);
      if (blk) {
        const rkey = nums.slice(1, 3).join("-");
        const r = rkey ? (blk.residences.get(rkey) ?? blk.residences.get(nums[1] ?? "")) : undefined;
        if (r) return [hit("residence", `${town.name}${nums[0]}番${nums.slice(1).join("-")}号`, r)];
        if (blk.pos) return [hit("block", `${town.name}${nums[0]}番`, blk.pos)];
      }
    }
    // 地番（"123-4-5" → 長いものから）
    for (let n = Math.min(nums.length, 3); n >= 1; n--) {
      const key = nums.slice(0, n).join("-");
      const pos = town.parcels.get(key);
      if (pos) {
        const [h, ...tail] = nums.slice(0, n);
        return [hit("parcel", `${town.name}${h}番地${tail.join("-")}`, pos)];
      }
    }
  }
  if (town.pos) return [hit("machiaza", town.name, town.pos)];
  return city.pos ? [hit("city", city.name, city.pos)] : [];
};
