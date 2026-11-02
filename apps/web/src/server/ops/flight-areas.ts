// 飛行範囲（多角形／円）の API 入力の検査と、保存の形（版の data の flight_areas）との変換（Sprint 19-1b）。純粋関数。
// - 入力（camelCase）: { id?, kind: "polygon"|"circle", name?, vertices?: [[経度, 緯度], …]（閉じない）, center?: [経度, 緯度], radiusM? }
// - 保存（snake_case）: { id, kind, name?, vertices? , center?, radius_m? }（座標は [経度, 緯度]、小数 6 桁）
// - 計画の latitude・longitude・radius_m は、範囲から `coveringCircle` の結果だけで求める（中心と半径を別々に出さない）。
//   許可の照合（circleContains）は「代表点＋半径の円」で見るので、範囲より狭く見ない側に働く。
// - 端末に出さない。サーバー側だけで使う。
import {
  coveringCircle,
  latLngToPosition,
  MAX_AREA_RADIUS_M,
  MAX_AREA_VERTICES,
  positionToLatLng,
  validateFlightArea,
  type AreaInvalidReason,
  type FlightArea,
} from "@soraban/geo";

/** 1 計画の範囲の件数の上限（暫定・※要再確認）。DB の flight_areas_valid（0018）と同じ値。 */
export const MAX_FLIGHT_AREAS = 20;
/** 範囲の名前（任意）の長さの上限。 */
export const MAX_AREA_NAME = 50;

/** 範囲の保存の形（版の data と flight_plans.flight_areas）。 */
export type StoredArea =
  | { readonly id: string; readonly kind: "polygon"; readonly name?: string; readonly vertices: readonly (readonly [number, number])[] }
  | { readonly id: string; readonly kind: "circle"; readonly name?: string; readonly center: readonly [number, number]; readonly radius_m: number };

/** API が返す範囲の形（camelCase）。 */
export type AreaDto =
  | { readonly id: string; readonly kind: "polygon"; readonly name: string | null; readonly vertices: readonly (readonly [number, number])[] }
  | { readonly id: string; readonly kind: "circle"; readonly name: string | null; readonly center: readonly [number, number]; readonly radiusM: number };

export type AreaRejectReason =
  | AreaInvalidReason
  | "areas_not_array"
  | "areas_empty"
  | "areas_too_many"
  | "area_id_invalid"
  | "area_id_duplicate"
  | "area_name_invalid"
  | "area_too_large"
  | "areas_present";

export type AreasParsed =
  | { readonly ok: true; readonly stored: readonly StoredArea[]; readonly latitude: number; readonly longitude: number; readonly radiusM: number }
  | { readonly ok: false; readonly reason: AreaRejectReason; readonly message: string; readonly index?: number; readonly vertexIndex?: number };

const REASON_MESSAGE: Readonly<Record<AreaRejectReason, string>> = {
  shape_invalid: "飛行範囲の形が正しくありません",
  kind_unknown: "飛行範囲の種類は 多角形（polygon）か円（circle）です",
  vertices_too_few: "多角形の頂点は 3 つ以上にしてください",
  vertices_too_many: `多角形の頂点は ${MAX_AREA_VERTICES} 以下にしてください`,
  coordinate_not_finite: "座標が数値ではありません",
  lat_out_of_range: "緯度は -90〜90 の範囲です（座標は [経度, 緯度] の順）",
  lng_out_of_range: "経度は -180〜180 の範囲です（座標は [経度, 緯度] の順）",
  coordinate_too_precise: "座標は小数 6 桁までです",
  radius_out_of_range: `円の半径は 1〜${MAX_AREA_RADIUS_M} m の範囲です`,
  radius_not_integer: "円の半径は整数（m）です",
  antimeridian_crossing: "日付変更線をまたぐ範囲は扱えません",
  ring_closed: "多角形の最後の頂点を最初と同じにしないでください（閉じる必要はありません）",
  vertex_duplicate: "隣り合う頂点が同じ位置です",
  area_degenerate: "多角形の面積が 0 です（頂点が一直線上にあります）",
  areas_not_array: "飛行範囲は配列で指定してください",
  areas_empty: "飛行範囲が空です",
  areas_too_many: `飛行範囲は ${MAX_FLIGHT_AREAS} 件以下にしてください`,
  area_id_invalid: "範囲の識別子が正しくありません",
  area_id_duplicate: "範囲の識別子が重複しています",
  area_name_invalid: `範囲の名前は ${MAX_AREA_NAME} 文字以内の文字にしてください`,
  areas_present: "範囲がある計画は、範囲で直してください",
  area_too_large: `範囲全体を覆う円の半径が ${MAX_AREA_RADIUS_M} m を超えます。計画を分けてください`,
};

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const fail = (reason: AreaRejectReason, index?: number, vertexIndex?: number): AreasParsed => ({
  ok: false,
  reason,
  message: `${REASON_MESSAGE[reason]}${index === undefined ? "" : `（${index + 1} 件目${vertexIndex === undefined ? "" : `・頂点 ${vertexIndex + 1}`}）`}`,
  ...(index === undefined ? {} : { index }),
  ...(vertexIndex === undefined ? {} : { vertexIndex }),
});

const toStored = (area: FlightArea, id: string, name: string | undefined): StoredArea =>
  area.kind === "polygon"
    ? { id, kind: "polygon", ...(name ? { name } : {}), vertices: area.vertices.map((v) => latLngToPosition(v) as [number, number]) }
    : { id, kind: "circle", ...(name ? { name } : {}), center: latLngToPosition(area.center) as [number, number], radius_m: area.radiusM };

const fromStored = (a: StoredArea): FlightArea =>
  a.kind === "polygon"
    ? { kind: "polygon", vertices: a.vertices.map((p) => positionToLatLng(p)!) }
    : { kind: "circle", center: positionToLatLng(a.center)!, radiusM: a.radius_m };

/** 保存の形の範囲から、全体を覆う円（中心と半径は coveringCircle の 1 つの結果）を求める。 */
export const coveringOfStored = (stored: readonly StoredArea[]): { latitude: number; longitude: number; radiusM: number } | null => {
  const c = coveringCircle(stored.map(fromStored));
  return c ? { latitude: c.center.lat, longitude: c.center.lng, radiusM: c.radiusM } : null;
};

/**
 * API の `areas` を検査し、保存の形と、全体を覆う円（緯度・経度・半径）を返す。
 * 座標の順は [経度, 緯度]。位置の形が違う頂点は shape_invalid。外接半径が 10000 m を超えると area_too_large。
 */
/** 範囲 1 件に許す鍵。 */
const ALLOWED_AREA_KEYS: ReadonlySet<string> = new Set(["id", "name", "kind", "vertices", "center", "radiusM"]);

export const parseAreasInput = (raw: unknown): AreasParsed => {
  if (!Array.isArray(raw)) return fail("areas_not_array");
  if (raw.length === 0) return fail("areas_empty");
  if (raw.length > MAX_FLIGHT_AREAS) return fail("areas_too_many");
  const stored: StoredArea[] = [];
  const areas: FlightArea[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!isRecord(item)) return fail("shape_invalid", i);
    // 未知の鍵（evil・altitude など）は受けない（DB の検査も拒否する。ここで 422 にして理由を返す）
    if (Object.keys(item).some((k) => !ALLOWED_AREA_KEYS.has(k))) return fail("shape_invalid", i);
    const id = item["id"] === undefined || item["id"] === null ? `a${i + 1}` : item["id"];
    if (typeof id !== "string" || !ID_RE.test(id)) return fail("area_id_invalid", i);
    if (ids.has(id)) return fail("area_id_duplicate", i);
    ids.add(id);
    const nameRaw = item["name"];
    let name: string | undefined;
    if (nameRaw !== undefined && nameRaw !== null) {
      if (typeof nameRaw !== "string" || nameRaw.trim().length > MAX_AREA_NAME || /[\u0000-\u001f\u007f-\u009f]/.test(nameRaw)) return fail("area_name_invalid", i);
      name = nameRaw.trim() || undefined;
    }
    let candidate: unknown;
    if (item["kind"] === "polygon") {
      const vs = item["vertices"];
      if (!Array.isArray(vs)) return fail("shape_invalid", i);
      const verts: unknown[] = [];
      for (let j = 0; j < vs.length; j++) {
        const p = positionToLatLng(vs[j]);
        if (!p || (vs[j] as unknown[]).length !== 2) return fail("shape_invalid", i, j);
        verts.push(p);
      }
      candidate = { kind: "polygon", vertices: verts };
    } else if (item["kind"] === "circle") {
      const c = positionToLatLng(item["center"]);
      if (!c || (item["center"] as unknown[]).length !== 2) return fail("shape_invalid", i);
      candidate = { kind: "circle", center: c, radiusM: item["radiusM"] };
    } else {
      return fail("kind_unknown", i);
    }
    const v = validateFlightArea(candidate);
    if (!v.ok) return fail(v.reason, i, v.vertexIndex);
    areas.push(v.area);
    stored.push(toStored(v.area, id, name));
  }
  const cover = coveringCircle(areas)!;
  if (cover.radiusM > MAX_AREA_RADIUS_M) return fail("area_too_large");
  return { ok: true, stored, latitude: cover.center.lat, longitude: cover.center.lng, radiusM: cover.radiusM };
};

/** 保存の形 → API の入力の形（訂正の合成用）。 */
export const storedToInput = (stored: unknown): Record<string, unknown>[] | null => {
  if (!Array.isArray(stored)) return null;
  return (stored as StoredArea[]).map((a) =>
    a.kind === "polygon"
      ? { id: a.id, kind: "polygon", ...(a.name ? { name: a.name } : {}), vertices: a.vertices }
      : { id: a.id, kind: "circle", ...(a.name ? { name: a.name } : {}), center: a.center, radiusM: a.radius_m },
  );
};

/** 保存の形 → API が返す形。 */
export const storedToDto = (stored: readonly StoredArea[]): AreaDto[] =>
  stored.map((a) =>
    a.kind === "polygon"
      ? { id: a.id, kind: "polygon", name: a.name ?? null, vertices: a.vertices }
      : { id: a.id, kind: "circle", name: a.name ?? null, center: a.center, radiusM: a.radius_m },
  );

/** 範囲の読み出し方。areas＝範囲あり／circle＝範囲なし・半径あり（円 1 つ）／point＝範囲なし・半径なし（点だけ）。 */
export type AreaState = "areas" | "circle" | "point";

/** 既存の計画の読み替え。DB の行は書き換えない。半径が無い計画は「点」であって円ではない。 */
export const areasOfPlanRow = (r: {
  readonly flight_areas: unknown;
  readonly latitude: string | number;
  readonly longitude: string | number;
  readonly radius_m: number | null;
}): { readonly state: AreaState; readonly areas: AreaDto[] } => {
  if (Array.isArray(r.flight_areas) && r.flight_areas.length > 0) return { state: "areas", areas: storedToDto(r.flight_areas as StoredArea[]) };
  if (r.radius_m === null) return { state: "point", areas: [] };
  return {
    state: "circle",
    areas: [{ id: "plan-circle", kind: "circle", name: null, center: [Number(r.longitude), Number(r.latitude)], radiusM: r.radius_m }],
  };
};

/** 範囲がある計画への、緯度・経度・半径だけの訂正を拒むときの文（422 areas_present）。 */
export const AREAS_PRESENT_MESSAGE = REASON_MESSAGE.areas_present;

/** 判定の範囲の注記（画面への表示は 19-2b）。判定は代表点だけで行う。 */
export const JUDGEMENT_AREA_NOTE = "判定は範囲の中の 1 か所（代表点）で行っています。範囲の全体は確認していません。";

/** 計画の行（flight_areas）から、通報の指紋に渡す範囲を作る。範囲が無ければ undefined。 */
export const fingerprintAreasOfRow = (r: { readonly flight_areas: unknown }): import("@soraban/dips").FingerprintArea[] | undefined => {
  if (!Array.isArray(r.flight_areas) || r.flight_areas.length === 0) return undefined;
  return (r.flight_areas as StoredArea[]).map((a) =>
    a.kind === "polygon" ? { kind: "polygon", vertices: a.vertices } : { kind: "circle", center: a.center, radiusM: a.radius_m },
  );
};

/** 判定が見る範囲。判定は代表点だけで行う（範囲があるとき、画面は JUDGEMENT_AREA_NOTE を必ず出す。表示は 19-2a/2b）。 */
export const JUDGEMENT_SCOPE = "representative_point" as const;

/** DB の 23514（flight_areas_*）を写す専用コード。 */
export const FLIGHT_AREAS_DB_REASONS = ["flight_areas_invalid", "flight_areas_not_covered"] as const;
