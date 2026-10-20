import { describe, expect, it } from "vitest";
// /api/check・/api/diagnose の統合テスト（Sprint 7）。
//
// 山陰の実データでは「DID 内かつ工業専用地域内」の地点を用意できない（DID・工業専用地域とも
// 本体データ未同梱。data/did/README.md・data/industrial-exclusive/README.md）。そのため契約 C の
// 「DID 内かつ工専内 → green・非該当（工業専用地域）・告示第435号の出典リンク」は、データの
// 読み込み口をテスト用フィクスチャ（e2e/fixtures、実在の区域ではない）に差し替えた
// ハンドラの統合テストで確かめる。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createIndustrialSource,
  didBundleToDataset,
  industrialBundleToZones,
  type DidBundleFile,
  type IndustrialBundleFile,
  type IndustrialCoverageEntry,
  type RegulationCheckResult,
} from "@soraban/regulations";
import {
  computeCheckEvidenceId,
  runRegulationCheckWith,
  type RegulationDataProvider,
} from "./check-core";
import { handleCheckPost, handleDiagnosePost, type RunCheck } from "./handlers";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../e2e/fixtures");
const readJson = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(FIXTURES, rel), "utf8")) as T;

const didFile = readJson<DidBundleFile>("did/pref-31.json");
const coverage = readJson<{ municipalities: IndustrialCoverageEntry[] }>("industrial/coverage.json");
const sakaiZones = readJson<IndustrialBundleFile>("industrial/by-muni/31204.json");

const POINTS = {
  inIndustrial: { lat: 35.5447, lng: 133.2269 },
  inDidOutsideIndustrial: { lat: 35.5447, lng: 133.237953 },
  inDidNotRecorded: { lat: 35.4278, lng: 133.3314 },
  mihoCenter: { lat: 35.4936, lng: 133.2361 },
  farGreen: { lat: 35.434238, lng: 133.380508 },
};

const provider = (geocodeMuni?: string): RegulationDataProvider => ({
  loadDid: async (pref) => (pref === "31" ? didBundleToDataset(didFile) : null),
  didPrefCodes: async () => ["31"],
  industrial: createIndustrialSource({
    coverage: coverage.municipalities,
    zonesByMuni: { "31204": industrialBundleToZones(sakaiZones) },
    insideMarginM: 10,
  }),
  reverseGeocode: async () => (geocodeMuni ? { muniCode: geocodeMuni } : {}),
});

const runCheckWith =
  (geocodeMuni?: string): RunCheck =>
  (loc, ctx) =>
    runRegulationCheckWith(provider(geocodeMuni), loc, ctx);

const post = (body: unknown): Request =>
  new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const didOf = (r: RegulationCheckResult) => r.regulations.find((x) => x.id === "aviation-law-did")!;

describe("/api/check（データ読み込み口を差し替えた統合テスト）", () => {
  it("DID 内かつ工専内：DID カードが green・非該当（工業専用地域）・告示第435号の出典リンクあり", async () => {
    const res = await handleCheckPost(post(POINTS.inIndustrial), runCheckWith("31204"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as RegulationCheckResult;
    const did = didOf(json);
    expect(did.status).toBe("green");
    expect(did.didDetail).toBe("industrial_exclusive");
    expect(did.note).toContain("非該当（工業専用地域）");
    const kokuji = did.amendments.find((a) => a.id === "mlit-kokuji-435");
    expect(kokuji?.url).toBe("https://www.mlit.go.jp/koku/koku_fr10_000041.html");
    expect(kokuji?.effectiveDate).toBe("2026-07-01");
  });

  it("DID 内かつ工専未収録：red・『工業専用地域の除外：未確認』。収録済み市町村の工専外では出ない", async () => {
    const unrec = (await (
      await handleCheckPost(post(POINTS.inDidNotRecorded), runCheckWith("31202"))
    ).json()) as RegulationCheckResult;
    expect(didOf(unrec).status).toBe("red");
    expect(didOf(unrec).note).toContain("工業専用地域の除外：未確認");

    const outside = (await (
      await handleCheckPost(post(POINTS.inDidOutsideIndustrial), runCheckWith("31204"))
    ).json()) as RegulationCheckResult;
    expect(didOf(outside).status).toBe("red");
    expect(didOf(outside).didDetail).toBe("in_did");
    expect(didOf(outside).note).not.toContain("工業専用地域の除外：未確認");
  });

  it("逆ジオコーディングに失敗しても、DID の当たりは同梱データから探し、当たらなければ未確認", async () => {
    const hit = (await (
      await handleCheckPost(post(POINTS.inDidNotRecorded), runCheckWith(undefined))
    ).json()) as RegulationCheckResult;
    expect(didOf(hit).status).toBe("red");
    const miss = (await (
      await handleCheckPost(post(POINTS.farGreen), runCheckWith(undefined))
    ).json()) as RegulationCheckResult;
    expect(didOf(miss).status).toBe("unknown");
  });

  it("すべての規制にデータセット参照があり、証跡 ID とエンジン版が返る", async () => {
    const json = (await (
      await handleCheckPost(post(POINTS.inIndustrial), runCheckWith("31204"))
    ).json()) as RegulationCheckResult;
    for (const r of json.regulations) expect(r.datasets.length).toBeGreaterThan(0);
    expect(json.evidenceId).toMatch(/^ev_[0-9a-f]{16}$/);
    expect(json.engineVersion).not.toBe("soraban-0.2.0-clausegraph");
  });
});

type DiagnoseJson = {
  category: string;
  didStatus: string;
  didDetail?: string;
  flags: string[];
  procedures: { id: string; sourceUrl: string }[];
  datasets: { id: string; verifiedAt: string }[];
  amendments: { id: string; effectiveDate: string }[];
};

describe("/api/diagnose（データ読み込み口を差し替えた統合テスト）", () => {
  it("DID 内かつ工専内：DID 三値は非該当（工業専用地域）・カテゴリー I。curated DID フラグも付かない", async () => {
    const res = await handleDiagnosePost(
      post({ ...POINTS.inIndustrial, droneWeightG: 900, flags: ["airspace_did"] }),
      runCheckWith("31204"),
    );
    const json = (await res.json()) as DiagnoseJson;
    expect(json.didStatus).toBe("not_applicable");
    expect(json.didDetail).toBe("industrial_exclusive");
    expect(json.flags).not.toContain("airspace_did");
    // Sprint 11d A8：この地点は空港等周辺の概算（6km）に入り yellow（該当の可能性）。以前は空域フラグに入らず
    // カテゴリー I と出ていた（見落とし）。空港等周辺の飛行許可が手続きに出るため IIA 相当になる。
    expect(json.flags).toContain("airspace_airport");
    expect(json.procedures.map((p) => p.id)).toContain("flight-permission-airport");
    expect(json.category).toBe("II_A");
    expect(json.amendments.map((a) => a.id)).toContain("mlit-kokuji-435");
    expect(json.datasets.map((d) => d.id)).toContain("did-r2");
  });

  it("飛行禁止法が red の地点では同意＋事前通報の手続きが出典付きで出る。green の地点では出ない", async () => {
    const red = (await (
      await handleDiagnosePost(post({ ...POINTS.mihoCenter, droneWeightG: 900 }), runCheckWith("31204"))
    ).json()) as DiagnoseJson;
    const proc = red.procedures.find((p) => p.id === "small-drone-law-consent-notice");
    expect(proc?.sourceUrl).toMatch(/^https:\/\/www\.npa\.go\.jp\//);

    const green = (await (
      await handleDiagnosePost(post({ ...POINTS.farGreen, droneWeightG: 900 }), runCheckWith("31390"))
    ).json()) as DiagnoseJson;
    expect(green.procedures.map((p) => p.id)).not.toContain("small-drone-law-consent-notice");
  });
});

describe("証跡 ID（データセットの確認日）", () => {
  it("同じ地点・同じ条件・同じ時刻でも、データセットの確認日を変えると証跡 ID が変わる", () => {
    const base = {
      lat: 35.4278,
      lng: 133.3314,
      checkedAt: "2026-11-02T00:00:00.000Z",
      regulationIds: ["aviation-law-did", "small-drone-law"],
      ctx: { droneWeightG: 900 },
    };
    const ds = (verifiedAt: string) => [
      { id: "did-r2", name: "DID", baseYear: 2020, verifiedAt },
    ];
    const a = computeCheckEvidenceId({ ...base, datasets: ds("2026-10-19") });
    const b = computeCheckEvidenceId({ ...base, datasets: ds("2026-12-01") });
    expect(a).toMatch(/^ev_[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
    expect(computeCheckEvidenceId({ ...base, datasets: ds("2026-10-19") })).toBe(a);
  });
});
