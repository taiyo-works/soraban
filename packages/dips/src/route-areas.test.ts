// Sprint 19-1c：飛行範囲（多角形・円・複数）の DIPS の形式への変換と、通報の整形。
// 仕様の根拠は docs/references/dips-flyroute-polygon-check.md（ガイドライン 1.10 版 項番 23、p56〜58）。ネットワークは使わない。
import { MAX_AREA_VERTICES } from "@soraban/geo";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockGateway } from "./adapters/mock";
import { ManualGateway } from "./adapters/manual";
import { REPORT_FIELDS, type ReportFieldsData } from "./fields";
import { fingerprintOf } from "./fingerprint";
import { PREPARE_WARNING_MESSAGE } from "./messages";
import { buildCircleGeoJson, buildPolygonGeoJson, prepareReport } from "./prepare";
import { basePlan } from "./test-fixtures";
import type { FingerprintArea, PlanForReport, PreparedItem, PreparedReport } from "./types";

const item = (p: PreparedReport, key: string): PreparedItem => {
  const i = p.items.find((x) => x.key === key);
  if (!i) throw new Error(`項目がありません: ${key}`);
  return i;
};
const route = (plan: PlanForReport, fields?: ReportFieldsData): PreparedItem => item(prepareReport(plan, "new", fields), "route");

const TRI: [number, number][] = [
  [133.33, 35.42],
  [133.34, 35.42],
  [133.335, 35.43],
];
const poly = (vertices: [number, number][] = TRI): FingerprintArea => ({ kind: "polygon", vertices });
const circleArea: FingerprintArea = { kind: "circle", center: [133.2, 35.1], radiusM: 150 };

/** 読み戻す（往復の検査用）。 */
const readPolygon = (text: string): [number, number][] => {
  const g = JSON.parse(text);
  expect(g.type).toBe("FeatureCollection");
  expect(g.features).toHaveLength(1);
  expect(g.features[0].geometry.type).toBe("Polygon");
  return g.features[0].geometry.coordinates[0];
};

describe("C1-1 buildPolygonGeoJson の形", () => {
  it("FeatureCollection・Feature・properties は空・Polygon・coordinates は [[[経度,緯度],…]]。固定の文字列", () => {
    expect(buildPolygonGeoJson(TRI)).toBe(
      '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[133.33,35.42],[133.34,35.42],[133.335,35.43]]]}}]}',
    );
  });

  it("座標は小数 6 桁に丸める（そらばんの設計の選択）", () => {
    const s = buildPolygonGeoJson([
      [133.3300004, 35.4200006],
      [133.34, 35.42],
      [133.335, 35.43],
    ]);
    expect(readPolygon(s)[0]).toEqual([133.33, 35.420001]);
  });
});

describe("C1-2 設定 routeFormat（polygonRing・multiArea）", () => {
  it("既定は open・single_only。first_only は設けない。注記に ※要再確認（検証環境）と出典（項番 23、p56〜58）", () => {
    const f = REPORT_FIELDS.routeFormat;
    expect(f.polygonRing).toBe("open");
    expect(f.multiArea).toBe("single_only");
    expect(f.circleRadiusPlacement).toBe("properties");
    expect(f.polygonRingNote).toContain("※要再確認（検証環境）");
    expect(f.polygonRingNote).toContain("項番 23");
    expect(f.polygonRingNote).toContain("p56〜58");
    expect(f.polygonRingNote).toContain("記載なし");
    // 「閉じて送れる」「受理される」と読める断定を書かない
    expect(f.polygonRingNote).not.toMatch(/閉じて送れる|受理される$/);
    expect(JSON.stringify(f)).not.toContain("first_only");
    expect(f.multiAreaNote).toContain("※要再確認（検証環境）");
    expect(f.coordinateNote).toContain("設計の選択");
  });

  it("open（既定）は始点を末尾に繰り返さない。closed は始点が最後に繰り返される", () => {
    expect(readPolygon(buildPolygonGeoJson(TRI, "open"))).toEqual(TRI);
    expect(readPolygon(buildPolygonGeoJson(TRI))).toEqual(TRI);
    const closed = readPolygon(buildPolygonGeoJson(TRI, "closed"));
    expect(closed).toEqual([...TRI, TRI[0]]);
  });

  it("対応表の polygonRing が prepare に効く（closed の表を渡すと閉じる）", () => {
    const fields: ReportFieldsData = { ...REPORT_FIELDS, routeFormat: { ...REPORT_FIELDS.routeFormat, polygonRing: "closed" } };
    const plan = basePlan({ areas: [poly()] });
    expect(readPolygon(route(plan, fields).apiValue!)).toHaveLength(4);
    expect(readPolygon(route(plan).apiValue!)).toHaveLength(3);
  });
});

describe("C1-3 円の出力は 1 文字も変わらない（固定）", () => {
  const P = '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"radius":150},"geometry":{"type":"Circle","center":[133.2,35.1]}}]}';
  const G = '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Circle","center":[133.2,35.1],"radius":150}}]}';
  const B = '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"radius":150},"geometry":{"type":"Circle","center":[133.2,35.1],"radius":150}}]}';

  it("3 つの置き場所それぞれ", () => {
    expect(buildCircleGeoJson(35.1, 133.2, 150, "properties")).toBe(P);
    expect(buildCircleGeoJson(35.1, 133.2, 150, "geometry")).toBe(G);
    expect(buildCircleGeoJson(35.1, 133.2, 150, "both")).toBe(B);
    expect(buildCircleGeoJson(35.1, 133.2, 150)).toBe(P);
  });

  it("prepare の経路（areas 無し・円 1 つ）は従来の文字列と値。半径なしは警告だけ", () => {
    for (const areas of [undefined, null, [circleArea]] as const) {
      const r = route(basePlan({ latitude: 35.1, longitude: 133.2, radiusM: 150, ...(areas === undefined ? {} : { areas }) }));
      expect(r.apiValue).toBe(P);
      expect(r.value).toBe("中心 経度 133.2・緯度 35.1・半径 150 m");
      expect(r.warnings).toEqual([]);
    }
    const none = route(basePlan({ radiusM: null }));
    expect(none.apiValue).toBeNull();
    expect(none.warnings.map((w) => w.code)).toEqual(["radius_missing"]);
  });

  it("円 1 つの計画の指紋は、areas を渡しても渡さなくても同じ", () => {
    const b = basePlan({ latitude: 35.1, longitude: 133.2, radiusM: 150 });
    expect(prepareReport({ ...b, areas: [circleArea] }, "new").fingerprint).toBe(prepareReport(b, "new").fingerprint);
  });
});

describe("C1-4 往復", () => {
  it("変換した文字列を読み戻すと、元の頂点と一致する（丸め以内）。円も中心・半径", () => {
    const vs: [number, number][] = [
      [133.123457, 35.654321],
      [133.2, 35.7],
      [133.15, 35.69],
      [133.1, 35.61],
    ];
    for (const ring of ["open", "closed"] as const) {
      const back = readPolygon(buildPolygonGeoJson(vs, ring));
      const open = ring === "closed" ? back.slice(0, -1) : back;
      expect(open).toHaveLength(vs.length);
      open.forEach((p, i) => {
        expect(Math.abs(p[0] - vs[i]![0])).toBeLessThanOrEqual(5e-7);
        expect(Math.abs(p[1] - vs[i]![1])).toBeLessThanOrEqual(5e-7);
      });
    }
    const rough: [number, number][] = [[133.1234567891, 35.1], [133.2, 35.2], [133.3, 35.1]];
    expect(readPolygon(buildPolygonGeoJson(rough))[0]![0]).toBe(133.123457);
    const c = JSON.parse(buildCircleGeoJson(35.1, 133.2, 150, "properties")).features[0];
    expect([c.geometry.center, c.properties.radius]).toEqual([[133.2, 35.1], 150]);
  });
});

describe("C1-5 prepare の経路（多角形・複数・頂点数）", () => {
  it("多角形 1 つ：value は「多角形・頂点 N」、apiValue は多角形。コピー対象でない。警告なし", () => {
    const r = route(basePlan({ areas: [poly()] }));
    expect(r.status).toBe("route");
    expect(r.value).toBe("多角形・頂点 3");
    expect(r.apiValue).toBe(buildPolygonGeoJson(TRI));
    expect(r.copyable).toBe(false);
    expect(r.copyText).toBeNull();
    expect(r.warnings).toEqual([]);
  });

  it("範囲が 2 つ以上は 1 つ目だけを出さない：apiValue は null で、警告 route_multiple_areas（案内と「確認していません」）", () => {
    for (const areas of [[poly(), circleArea], [circleArea, circleArea], [poly(), poly(), circleArea]]) {
      const r = route(basePlan({ areas }));
      expect(r.apiValue).toBeNull();
      expect(r.copyable).toBe(false);
      expect(r.warnings.map((w) => w.code)).toEqual(["route_multiple_areas"]);
      expect(r.warnings[0]!.message).toContain("DIPS に出す範囲は 1 つです");
      expect(r.warnings[0]!.message).toContain("計画を分けるか、1 つにまとめてください");
      expect(r.warnings[0]!.message).toContain("複数を出せるかは確認していません");
      expect(r.value).toContain(`範囲 ${areas.length} 件`);
    }
    // 全体の警告にも出る
    expect(prepareReport(basePlan({ areas: [poly(), circleArea] }), "new").warnings.map((w) => w.code)).toContain("route_multiple_areas");
  });

  it("頂点数が MAX_AREA_VERTICES 以下なら警告なし、超えると route_too_many_vertices（DIPS の値でないと明記）", () => {
    const ring = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [133 + Math.cos((2 * Math.PI * i) / n) * 0.01, 35 + Math.sin((2 * Math.PI * i) / n) * 0.01] as [number, number]);
    expect(route(basePlan({ areas: [poly(ring(MAX_AREA_VERTICES))] })).warnings).toEqual([]);
    const over = route(basePlan({ areas: [poly(ring(MAX_AREA_VERTICES + 1))] }));
    expect(over.warnings.map((w) => w.code)).toEqual(["route_too_many_vertices"]);
    expect(over.warnings[0]!.message).toContain("DIPS の値ではありません");
    expect(over.warnings[0]!.message).toContain(String(MAX_AREA_VERTICES));
    expect(over.value).toBe(`多角形・頂点 ${MAX_AREA_VERTICES + 1}`);
  });

  it("文言に禁止語がない", () => {
    for (const m of [PREPARE_WARNING_MESSAGE.route_multiple_areas, PREPARE_WARNING_MESSAGE.route_too_many_vertices]) {
      for (const w of ["完璧", "保証", "必ず", "代行", "代理", "申請", "通報不要", "問題なし"]) expect(m).not.toContain(w);
    }
  });

  it("多角形の計画の指紋は、頂点を動かすと変わる。円・点の指紋は変わらない（FINGERPRINT_VERSION は上げない）", () => {
    const a = prepareReport(basePlan({ areas: [poly()] }), "new").fingerprint;
    const moved = prepareReport(basePlan({ areas: [poly([[133.33, 35.42], [133.340001, 35.42], [133.335, 35.43]])] }), "new").fingerprint;
    expect(moved).not.toBe(a);
    expect(a).toBe(fingerprintOf(basePlan({ areas: [poly()] })));
  });
});

describe("C1-7 ネットワークを呼ばない", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("多角形・複数の計画の整形と、手動・模擬の prepare は fetch を呼ばない", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network call");
    });
    vi.stubGlobal("fetch", fetchSpy);
    for (const areas of [[poly()], [poly(), circleArea]]) {
      const plan = basePlan({ areas });
      prepareReport(plan, "new");
      new ManualGateway().prepare(plan, "new");
      new MockGateway().prepare(plan, "new");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
