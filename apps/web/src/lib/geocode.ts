import type { GeocodeHit, GeocodeLevel, GeocodeSource } from "@soraban/regulations";

export type GeocodeResult = GeocodeHit;

/** 出典の表示名。 */
export const GEOCODE_SOURCE_LABEL: Readonly<Record<GeocodeSource, string>> = {
  abr: "アドレス・ベース・レジストリ",
  gsi: "国土地理院",
};

/** 町字の代表点などで、地図での指定を促す文言（契約 B・D と同じ文言）。 */
export const MACHIAZA_NOTE = "町字の代表点。実際の飛行地点は地図で指定してください";

/** 一致した階層ごとの精度の説明。 */
export const GEOCODE_LEVEL_NOTE: Readonly<Record<GeocodeLevel, string>> = {
  parcel: "地番の代表点（登記所備付地図）。敷地の広さに応じて実際の地点とずれることがあります",
  residence: "住居表示（住居）の代表点",
  block: "住居表示の街区の代表点。実際の地点とずれる場合は地図で指定してください",
  machiaza: MACHIAZA_NOTE,
  city: "市区町村の代表点。実際の飛行地点は地図で指定してください",
  prefecture: "都道府県の代表点。実際の飛行地点は地図で指定してください",
  unknown: "精度（一致した階層）は不明。地図で位置を確かめてください",
};

export const searchAddress = async (query: string): Promise<readonly GeocodeResult[]> => {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`);
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  const data = (await res.json()) as { results?: readonly GeocodeResult[] };
  return data.results ?? [];
};
