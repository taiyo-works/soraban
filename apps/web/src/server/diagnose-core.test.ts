// Sprint 12a 契約 1（単体）：`runDiagnosis` を切り出した後も、/api/diagnose の応答が切り出す前と JSON として完全に一致する。
// 基準は __fixtures__/sprint12a-diagnose-baseline.json（切り出す前の handleDiagnosePost の応答。固定の時計と固定のデータの読み込み口）。
//   - sprint11d-verdict-baseline.json の入力（地点 5 × 重量 4 × 飛行の方法 3 = 60 通り）は、応答全文の SHA-256 を比べる。
//   - 追加の入力（夜間・DID 内・空港周辺・緊急用務空域・許可入力・目的の例外ほか）は、応答の全文を保存して比べる。
// 基準の作り直し（応答を意図して変えたときだけ）：UPDATE_DIAGNOSE_BASELINE=1 pnpm vitest run apps/web/src/server/diagnose-core.test.ts
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FlightContext } from "@soraban/regulations";
import { runRegulationCheckWith } from "./check-core";
import { runDiagnosis, type DiagnosisRunInput } from "./diagnose-core";
import { handleDiagnosePost } from "./handlers";
import {
  BASELINE_FLAGS,
  BASELINE_LOCATIONS,
  BASELINE_NOW,
  BASELINE_WEIGHTS,
  baselineKey,
  baselineProvider,
} from "./sprint11e-baseline";

const FIXTURE = fileURLToPath(new URL("./__fixtures__/sprint12a-diagnose-baseline.json", import.meta.url));
const UPDATE = process.env["UPDATE_DIAGNOSE_BASELINE"] === "1";

type Loc = { readonly lat: number; readonly lng: number };
type Body = Readonly<Record<string, unknown>>;

const LOC = Object.fromEntries(BASELINE_LOCATIONS.map((l) => [l.name, l])) as Record<
  (typeof BASELINE_LOCATIONS)[number]["name"],
  (typeof BASELINE_LOCATIONS)[number]
>;

const runCheckFor = (muni: string) => (loc: Loc, ctx?: FlightContext, now: () => Date = BASELINE_NOW) =>
  runRegulationCheckWith(baselineProvider(muni), loc, ctx, now);

/** 切り出し後も変わらない入口（handleDiagnosePost）で応答の本文（文字列）を得る。 */
const diagnoseText = async (muni: string, body: Body): Promise<string> => {
  const res = await handleDiagnosePost(
    new Request("http://x/api/diagnose", { method: "POST", body: JSON.stringify(body) }),
    (loc, ctx) => runCheckFor(muni)(loc, ctx),
  );
  expect(res.status).toBe(200);
  return res.text();
};

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

// 追加の入力（名前 → 地点の市町村コードと本文）。
const EXTRAS: Readonly<Record<string, { readonly muni: string; readonly body: Body }>> = {
  "夜間（米子市役所・DID 内）": {
    muni: "31202",
    body: { ...LOC["米子市役所"].loc, droneWeightG: 900, flags: ["method_night"], plannedDate: "2027-01-14" },
  },
  "DID 内・重量なし": { muni: "31202", body: { ...LOC["米子市役所"].loc } },
  "空港周辺（出雲縁結び空港）": {
    muni: "32203",
    body: { ...LOC["出雲縁結び空港の周辺"].loc, droneWeightG: 1500, plannedDate: "2027-01-14" },
  },
  "空港の敷地内": { muni: "32203", body: { ...LOC["出雲縁結び空港の敷地内"].loc, droneWeightG: 1500 } },
  "基地の周辺（飛行禁止法）": { muni: "31204", body: { ...LOC["美保基地の周辺"].loc, droneWeightG: 900, plannedDate: "2027-01-14" } },
  "緊急用務空域": {
    muni: "31202",
    body: { ...LOC["米子市役所"].loc, droneWeightG: 900, flags: ["airspace_emergency"] },
  },
  "許可入力（DID・夜間）": {
    muni: "31202",
    body: {
      ...LOC["米子市役所"].loc,
      droneWeightG: 900,
      flags: ["method_night", "airspace_150m"],
      pilotPermits: ["mlit:did", "mlit:night", "mlit:150m"],
      plannedDate: "2027-01-14",
    },
  },
  "目的の例外（緊急）": {
    muni: "31202",
    body: { ...LOC["米子市役所"].loc, droneWeightG: 900, purpose: "emergency", flags: ["method_night"] },
  },
  "目的の例外（公務）": {
    muni: "31202",
    body: { ...LOC["米子市役所"].loc, droneWeightG: 900, purpose: "public_duty", flags: ["method_bvlos"], bvlosWithObserver: true },
  },
  "立入管理・第三者上空": {
    muni: "31202",
    body: { ...LOC["米子市役所"].loc, droneWeightG: 900, flags: ["method_bvlos"], accessControl: true, thirdPartyOverflight: false },
  },
  "DID 非該当を確認済み（未収録の市町村）": {
    muni: "31390",
    body: { lat: 35.434238, lng: 133.380508, droneWeightG: 900, didConfirmedNotApplicable: true },
  },
  "工業専用地域": {
    muni: "31201",
    body: { ...LOC["鳥取市の工業専用地域"].loc, droneWeightG: 900, flags: ["method_night"] },
  },
  "100g 未満": { muni: "31202", body: { ...LOC["米子市役所"].loc, droneWeightG: 50, flags: ["method_night"] } },
};

type Fixture = {
  readonly baseline: Readonly<Record<string, string>>;
  readonly extras: Readonly<Record<string, { readonly request: Body; readonly muni: string; readonly response: unknown }>>;
};

const baselineInputs = (): { key: string; muni: string; body: Body }[] => {
  const out: { key: string; muni: string; body: Body }[] = [];
  for (const l of BASELINE_LOCATIONS) {
    for (const w of BASELINE_WEIGHTS) {
      for (const flags of BASELINE_FLAGS) {
        out.push({
          key: baselineKey(l.name, w, flags),
          muni: l.muni,
          body: { lat: l.loc.lat, lng: l.loc.lng, ...(w !== undefined ? { droneWeightG: w } : {}), flags },
        });
      }
    }
  }
  return out;
};

if (UPDATE) {
  it("基準を作り直す（UPDATE_DIAGNOSE_BASELINE=1）", async () => {
    const baseline: Record<string, string> = {};
    for (const i of baselineInputs()) baseline[i.key] = sha(await diagnoseText(i.muni, i.body));
    const extras: Record<string, { request: Body; muni: string; response: unknown }> = {};
    for (const [name, e] of Object.entries(EXTRAS)) {
      extras[name] = { request: e.body, muni: e.muni, response: JSON.parse(await diagnoseText(e.muni, e.body)) };
    }
    writeFileSync(FIXTURE, `${JSON.stringify({ baseline, extras }, null, 1)}\n`);
  });
} else {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;

  describe("契約 1：/api/diagnose の応答が切り出す前と完全に一致する", () => {
    it("基準の入力は 60 通り、追加の入力は 8 件以上（夜間・DID 内・空港周辺・緊急用務空域・許可入力・目的の例外を含む）", () => {
      expect(Object.keys(fixture.baseline)).toHaveLength(60);
      expect(Object.keys(fixture.baseline)).toEqual(baselineInputs().map((i) => i.key));
      expect(Object.keys(fixture.extras).length).toBeGreaterThanOrEqual(8);
      expect(Object.keys(fixture.extras)).toEqual(Object.keys(EXTRAS));
    });

    for (const i of baselineInputs()) {
      it(`基準 ${i.key}：応答全文（バイト列）が一致する`, async () => {
        expect(sha(await diagnoseText(i.muni, i.body))).toBe(fixture.baseline[i.key]);
      });
    }

    for (const [name, e] of Object.entries(EXTRAS)) {
      it(`追加 ${name}：応答の JSON が完全に一致する`, async () => {
        const text = await diagnoseText(e.muni, e.body);
        expect(JSON.parse(text)).toEqual(fixture.extras[name]!.response);
        // バイト列としても同じ（キーの順序を含む）
        expect(text).toBe(JSON.stringify(fixture.extras[name]!.response));
      });

      it(`追加 ${name}：runDiagnosis の応答も /api/diagnose の応答と同じ`, async () => {
        const b = e.body as Record<string, unknown>;
        const input: DiagnosisRunInput = {
          lat: b["lat"] as number,
          lng: b["lng"] as number,
          ...(typeof b["droneWeightG"] === "number" ? { droneWeightG: b["droneWeightG"] } : {}),
          flags: (b["flags"] as DiagnosisRunInput["flags"] | undefined) ?? [],
          ...(typeof b["plannedDate"] === "string" ? { plannedDate: b["plannedDate"] } : {}),
          ...(typeof b["accessControl"] === "boolean" ? { accessControl: b["accessControl"] } : {}),
          ...(typeof b["thirdPartyOverflight"] === "boolean" ? { thirdPartyOverflight: b["thirdPartyOverflight"] } : {}),
          ...(typeof b["bvlosWithObserver"] === "boolean" ? { bvlosWithObserver: b["bvlosWithObserver"] } : {}),
          didConfirmedNotApplicable: b["didConfirmedNotApplicable"] === true,
          ...(Array.isArray(b["pilotPermits"]) ? { pilotPermits: b["pilotPermits"] as string[] } : {}),
          ...(typeof b["purpose"] === "string" ? { purpose: b["purpose"] } : {}),
        };
        const { response } = await runDiagnosis(input, runCheckFor(e.muni));
        expect(JSON.stringify(response)).toBe(JSON.stringify(fixture.extras[name]!.response));
      });
    }

    it("runDiagnosis は時計（now）を判定地点の検査へ渡す", async () => {
      const at = new Date("2027-01-05T03:00:00.000Z");
      const { response, check } = await runDiagnosis(
        { lat: 35.4278, lng: 133.3314, droneWeightG: 900, flags: [], didConfirmedNotApplicable: false },
        runCheckFor("31202"),
        () => at,
      );
      expect(response.checkedAt).toBe(at.toISOString());
      expect(check.checkedAt).toBe(at.toISOString());
      expect(check.evidenceId).toBe(response.checkEvidenceId);
    });
  });
}
