// /api/geocode の処理本体（Sprint 9）。
//
// 検索の順序：①同梱索引（アドレス・ベース・レジストリ。外部通信なし）→ ②国土地理院の住所検索。
//   - ②は、①で結果がないか、①が町字・市区町村止まり（街区より浅い）のときだけ呼ぶ。
//   - ②がエラー・タイムアウト（既定 3 秒）でも①の結果は返す。
// 応答の各結果は 出典（source）・一致した階層（level）・表示名（title）・緯度経度 を持つ。
// 出典の値は @soraban/regulations の GEOCODE_SOURCES（1 か所で定義）に従う。
import { searchBundledAddress, type GeocodeHit } from "@soraban/regulations/address";

export const GSI_ADDRESS_SEARCH_ENDPOINT = "https://msearch.gsi.go.jp/address-search/AddressSearch";
export const GSI_TIMEOUT_MS = 3000;
const MAX_RESULTS = 5;

type GsiFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { title?: string };
};

export type GeocodeDeps = {
  readonly fetch?: typeof fetch;
  /** 国土地理院の住所検索の呼び出し先（テスト用に差し替え。既定は GSI_ADDRESS_SEARCH_ENDPOINT）。 */
  readonly gsiEndpoint?: string;
  readonly gsiTimeoutMs?: number;
  /** 同梱索引の検索（テスト用に差し替え）。 */
  readonly searchBundled?: (q: string) => GeocodeHit[];
};

/** 同梱索引の結果が街区以上（街区・住居・地番）なら国土地理院を呼ばない。 */
const DEEP_LEVELS: ReadonlySet<GeocodeHit["level"]> = new Set(["parcel", "residence", "block"]);

export const needsGsi = (bundled: readonly GeocodeHit[]): boolean =>
  !bundled.some((h) => DEEP_LEVELS.has(h.level));

export const searchGsi = async (q: string, deps: GeocodeDeps = {}): Promise<GeocodeHit[]> => {
  const f = deps.fetch ?? fetch;
  const endpoint = deps.gsiEndpoint ?? process.env["GSI_ADDRESS_SEARCH_ENDPOINT"] ?? GSI_ADDRESS_SEARCH_ENDPOINT;
  const controller = new AbortController();
  const timeout = deps.gsiTimeoutMs ?? GSI_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      f(`${endpoint}?q=${encodeURIComponent(q)}`, {
        headers: { "User-Agent": "soraban-geocoder/0.0.0" },
        signal: controller.signal,
        next: { revalidate: 3600 },
      } as RequestInit),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("gsi timeout"));
        }, timeout);
      }),
    ]);
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return (data as GsiFeature[])
      .filter(
        (d) =>
          typeof d.properties?.title === "string" &&
          Array.isArray(d.geometry?.coordinates) &&
          Number.isFinite(d.geometry.coordinates[0]) &&
          Number.isFinite(d.geometry.coordinates[1]),
      )
      .slice(0, MAX_RESULTS)
      .map((d) => ({
        source: "gsi" as const,
        // 国土地理院の住所検索は一致した階層を返さない
        level: "unknown" as const,
        title: d.properties!.title!,
        lng: d.geometry!.coordinates![0],
        lat: d.geometry!.coordinates![1],
      }));
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export type GeocodeResponse = {
  readonly results: readonly GeocodeHit[];
};

export const geocode = async (q: string, deps: GeocodeDeps = {}): Promise<GeocodeResponse> => {
  const search = deps.searchBundled ?? searchBundledAddress;
  let bundled: GeocodeHit[] = [];
  try {
    bundled = search(q);
  } catch {
    bundled = [];
  }
  if (!needsGsi(bundled)) return { results: bundled.slice(0, MAX_RESULTS) };
  const gsi = await searchGsi(q, deps);
  // 同じ地点（小数 6 桁で一致）の重複は同梱索引の結果を残す
  const seen = new Set(bundled.map((h) => `${h.lat.toFixed(6)},${h.lng.toFixed(6)}`));
  const merged = [...bundled, ...gsi.filter((h) => !seen.has(`${h.lat.toFixed(6)},${h.lng.toFixed(6)}`))];
  return { results: merged.slice(0, MAX_RESULTS) };
};
