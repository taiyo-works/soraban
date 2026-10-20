// Sprint 11g 契約 1〜13（単体・grep）：100g 未満の機体（模型航空機）の手続きの表示を「許可または通報」にそろえる。
// 判定の段・証跡 ID・evidence_log・100g 以上の判定は c4f13ee と同じ（固定した出力 __fixtures__/sprint11g-c4f13ee-baseline.json と比べる）。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIPS_PERMIT_KINDS,
  dipsPermitValue,
  ENGINE_VERSION,
  MODEL_AIRCRAFT_CATEGORY_NOTE,
  MODEL_AIRCRAFT_DEADLINE_LABEL,
  MODEL_AIRCRAFT_REFERENCES,
  MODEL_AIRCRAFT_WEIGHT_NOTE,
  modelAircraftManualOverride,
  type FlightContext,
  type FlightVerdict,
  type SpecificFlightFlag,
} from "@soraban/regulations";
import { runRegulationCheckWith } from "./check-core";
import { toEvidenceLogInsert } from "./evidence-log";
import { handleDiagnosePost } from "./handlers";
import {
  BASELINE_FLAGS,
  BASELINE_LOCATIONS,
  BASELINE_NOW,
  BASELINE_WEIGHTS,
  baselineCtx,
  baselineKey,
  baselineProvider,
} from "./sprint11e-baseline";

type Loc = { readonly lat: number; readonly lng: number };
const LOC = Object.fromEntries(BASELINE_LOCATIONS.map((l) => [l.name, l])) as Record<
  (typeof BASELINE_LOCATIONS)[number]["name"],
  (typeof BASELINE_LOCATIONS)[number]
>;

type DiagnoseBody = { droneWeightG?: number; flags?: SpecificFlightFlag[]; plannedDate?: string; pilotPermits?: string[] };
type Diag = { verdict: FlightVerdict; evidenceId: string; category: string };

const diagnose = async (l: { loc: Loc; muni: string }, body: DiagnoseBody): Promise<Diag> => {
  const p = baselineProvider(l.muni);
  const run = (loc: Loc, ctx?: FlightContext) => runRegulationCheckWith(p, loc, ctx, BASELINE_NOW);
  const res = await handleDiagnosePost(
    new Request("http://x/api/diagnose", { method: "POST", body: JSON.stringify({ lat: l.loc.lat, lng: l.loc.lng, ...body }) }),
    run,
  );
  return (await res.json()) as Diag;
};

const item = (v: FlightVerdict, id: string) => {
  const it = v.items.find((i) => i.id === id);
  if (!it) throw new Error(`item ${id} がない`);
  return it;
};
const ALL_DIPS = DIPS_PERMIT_KINDS.map(dipsPermitValue);

const OLD_NOTE = "空港の敷地内は飛行できません（許可・同意を入力しても変わりません）。";
const NEW_NOTE = "空港の敷地内は飛行できません（安全側の判定。空港の管理者への確認が要り、許可・同意・機体重量を入力しても変わりません）。";
const RULE_WORDS = ["管制圏・情報圏・高度変更禁止空域・特別管制空域の内側", "許可", "外側", "通報"];

type Baseline = Record<
  string,
  { checkEvidenceId: string; diagnosisEvidenceId: string; category: string; evidenceLog: unknown; verdict: FlightVerdict }
>;
const baseline = JSON.parse(
  readFileSync(new URL("./__fixtures__/sprint11g-c4f13ee-baseline.json", import.meta.url), "utf8"),
) as Baseline;

describe("A. 文言", () => {
  it("1. 出雲縁結び空港の周辺 50g：許可または通報の手続き。id・出す先・期限・legalTier は c4f13ee と同じ", async () => {
    const { verdict } = await diagnose(LOC["出雲縁結び空港の周辺"], { droneWeightG: 50, plannedDate: "2026-12-10" });
    const m = item(verdict, "model-aircraft-airport");
    expect(m.verdict).toBe("needs_procedure");
    expect(m.title).toBe("模型航空機の空港等の周辺での飛行（航空法第134条の3。許可または通報）");
    const proc = verdict.procedures.find((p) => p.itemId === "model-aircraft-airport")!;
    expect(proc.id).toBe("verdict-model-aircraft-airport");
    expect(proc.title).toBe("航空法第134条の3 に基づく飛行の許可または通報（模型航空機・空港等の周辺）");
    expect(proc.submitTo).toContain("国土交通大臣");
    expect(proc.deadline.label).toBe("事前に（参照先で確認）");
    expect(proc.deadline.label).toBe(MODEL_AIRCRAFT_DEADLINE_LABEL);
    expect(proc.deadline.date).toBeUndefined();
    expect(proc.legalTier).toBe(1);
    for (const w of RULE_WORDS) expect(proc.reason).toContain(w);
    expect(proc.reason).toContain("該当の可能性（要確認）");
    expect(proc.reason).toContain("管制圏・情報圏・高度変更禁止空域・特別管制空域を収録していない");
    expect(proc.reason).toContain("許可か通報かを決められず");
    // 許可だけ・通報だけと断定しない
    expect(proc.reason).not.toMatch(/許可が要ります。DIPS|通報が要ります。DIPS|通報で足ります|許可だけ/);
  });

  it("2. 米子市役所 50g＋150m 以上：許可または通報。夜間・目視外は対象外（模型航空機）のまま", async () => {
    const { verdict } = await diagnose(LOC["米子市役所"], {
      droneWeightG: 50,
      flags: ["airspace_150m", "method_night", "method_bvlos"],
    });
    const high = item(verdict, "airspace_150m");
    expect(high.verdict).toBe("needs_procedure");
    for (const w of ["150m", "250m", "航空路の地理データを持たない", ...RULE_WORDS]) expect(high.reason).toContain(w);
    const proc = verdict.procedures.find((p) => p.itemId === "airspace_150m")!;
    expect(proc.id).toBe("verdict-model-aircraft-high");
    expect(proc.title).toBe("航空法第134条の3 に基づく飛行の許可または通報（模型航空機・高い空域）");
    for (const id of ["method_night", "method_bvlos"]) {
      expect(item(verdict, id).verdict).toBe("no_procedure");
      expect(item(verdict, id).reason).toContain("対象外（模型航空機）");
    }
  });

  it("3. 空域「空港等周辺」を選ぶと 1 と同じ手続きが 1 件。DIPS の全種類でも要手続き", async () => {
    const near = await diagnose(LOC["出雲縁結び空港の周辺"], { droneWeightG: 50, flags: ["airspace_airport"] });
    expect(near.verdict.procedures.filter((p) => p.id === "verdict-model-aircraft-airport")).toHaveLength(1);
    const far = await diagnose(LOC["米子市役所"], { droneWeightG: 50, flags: ["airspace_airport"] });
    const procs = far.verdict.procedures.filter((p) => p.id === "verdict-model-aircraft-airport");
    expect(procs).toHaveLength(1);
    expect(procs[0]!.title).toContain("許可または通報");
    const all = await diagnose(LOC["出雲縁結び空港の周辺"], {
      droneWeightG: 50,
      flags: ["airspace_150m", "airspace_airport"],
      pilotPermits: ALL_DIPS,
    });
    expect(item(all.verdict, "model-aircraft-airport").verdict).toBe("needs_procedure");
    expect(item(all.verdict, "airspace_150m").verdict).toBe("needs_procedure");
  });

  it("4. 飛行の前後に必ず行うこと：許可か通報かの確認 1 件（50g）。100g 以上・未指定では出ない", async () => {
    const { verdict } = await diagnose(LOC["米子市役所"], { droneWeightG: 50 });
    const ds = verdict.perFlightDuties.filter((d) => d.id === "model-aircraft-control-zone-check");
    expect(ds).toHaveLength(1);
    expect(ds[0]!.title).toBe("許可か通報かの確認（管制圏・情報圏・高度変更禁止空域・特別管制空域の内か外か）");
    for (const w of ["内側", "許可", "外側", "通報", "空港事務所・管制機関・空港管理者"]) expect(ds[0]!.detail).toContain(w);
    for (const w of [900, 100, undefined]) {
      const r = await diagnose(LOC["米子市役所"], w !== undefined ? { droneWeightG: w } : {});
      expect(r.verdict.perFlightDuties.map((d) => d.id)).not.toContain("model-aircraft-control-zone-check");
    }
  });

  it("5. 重さの欄の補足・カテゴリーの注記・飛行マニュアル骨子が「許可または通報」。airspace_emergency は null", () => {
    for (const t of [MODEL_AIRCRAFT_WEIGHT_NOTE, MODEL_AIRCRAFT_CATEGORY_NOTE]) {
      expect(t).toContain("許可または通報（管制圏等の内側は許可、外側は通報）");
      expect(t).not.toContain("許可・通報が要ります");
    }
    for (const f of ["airspace_150m", "airspace_airport"]) {
      const o = modelAircraftManualOverride(f)!;
      const all = `${o.outline}${o.points.join("")}${o.legalBasis}`;
      expect(all).toContain("許可または通報");
      for (const w of ["内側", "許可", "外側", "通報"]) expect(all).toContain(w);
      expect(o.legalBasis).toContain("航空法施行規則第239条の3");
    }
    expect(modelAircraftManualOverride("airspace_emergency")).toBeNull();
  });

  it("6. 空港の敷地内：重量・許可・同意・DIPS・150m に関係なく飛行不可。新しい note。「航空法に基づき」「主要 8 空港」を含まない", async () => {
    const l = LOC["出雲縁結び空港の敷地内"];
    const variants: DiagnoseBody[] = [
      { droneWeightG: 50 },
      { droneWeightG: 900 },
      {},
      { droneWeightG: 50, flags: ["airspace_150m", "airspace_airport"], pilotPermits: ALL_DIPS },
    ];
    for (const body of variants) {
      const { verdict } = await diagnose(l, body);
      expect(verdict.level).toBe("no_fly");
    }
    for (const w of [50, 900, undefined]) {
      const check = await runRegulationCheckWith(baselineProvider(l.muni), l.loc, baselineCtx(w), BASELINE_NOW);
      const ap = check.regulations.find((r) => r.id === "aviation-law-airport")!;
      expect(ap.noFlyCategory).toBe(true);
      expect(ap.status).toBe("red");
      expect(ap.note).toContain(NEW_NOTE);
      expect(ap.note).toContain("安全側の判定");
      expect(ap.note).toContain("空港の管理者への確認");
      expect(ap.note).not.toMatch(/航空法に基づき|主要 ?8 ?空港/);
      const { verdict } = await diagnose(l, w !== undefined ? { droneWeightG: w } : {});
      const reasons = verdict.items.map((i) => i.reason).join("\n");
      expect(reasons).toContain("安全側の判定");
      expect(reasons).not.toMatch(/航空法に基づき|主要 ?8 ?空港/);
    }
    for (const w of [50, 900]) {
      const { verdict } = await diagnose(LOC["米子市役所"], { droneWeightG: w, flags: ["airspace_emergency"] });
      expect(verdict.level).toBe("no_fly");
    }
  });

  it("7. 参照先 9 件：[1]〜[6] は c4f13ee と同じ、[7]〜[9] の URL、題名はすべて異なる", () => {
    const refs = MODEL_AIRCRAFT_REFERENCES;
    expect(refs).toHaveLength(9);
    expect(refs.slice(0, 6).map((r) => [r.title, r.url])).toEqual([
      ["e-Gov 法令検索 航空法（航空法第134条の3）", "https://laws.e-gov.go.jp/law/327AC0000000231"],
      ["e-Gov 法令検索 航空法施行規則（航空法施行規則第239条の2）", "https://laws.e-gov.go.jp/law/327M50000800056"],
      ["国土交通省「レーザー照射や凧揚げの規制について」", "https://www.mlit.go.jp/koku/koku_tk1_000048.html"],
      ["国土交通省「航空機の飛行に影響を及ぼすおそれのある行為（気球、花火、凧揚げ等）」", "https://www.mlit.go.jp/common/001708524.pdf"],
      ["国土交通省「無人航空機の飛行の安全に関する教則」第5版", "https://www.mlit.go.jp/common/002010809.pdf"],
      ["警察庁「小型無人機等飛行禁止法関係」", "https://www.npa.go.jp/bureau/security/kogatamujinki/index.html"],
    ]);
    expect(refs.slice(6).map((r) => r.url)).toEqual([
      "https://www.mlit.go.jp/koku/koku_fr10_000040.html",
      "https://www.mlit.go.jp/koku/content/001407133.pdf",
      "https://www.mlit.go.jp/koku/koku_fr10_000042.html",
    ]);
    expect(new Set(refs.map((r) => r.title)).size).toBe(9);
  });
});

describe("B. 判定・証跡（c4f13ee と同じ）", () => {
  const keys: { name: string; w: number | undefined; f: readonly SpecificFlightFlag[]; l: (typeof BASELINE_LOCATIONS)[number] }[] = [];
  for (const l of BASELINE_LOCATIONS) for (const w of BASELINE_WEIGHTS) for (const f of BASELINE_FLAGS) {
    keys.push({ name: baselineKey(l.name, w, f), w, f, l });
  }

  for (const { name, w, f, l } of keys) {
    it(`8〜11. ${name}`, async () => {
      const exp = baseline[name]!;
      const p = baselineProvider(l.muni);
      const run = (loc: Loc, ctx?: FlightContext) => runRegulationCheckWith(p, loc, ctx, BASELINE_NOW);
      const check = await run(l.loc, baselineCtx(w));
      const d = await diagnose(l, {
        ...(w !== undefined ? { droneWeightG: w } : {}),
        flags: [...f],
        plannedDate: "2026-12-10",
      });
      // 10・11：証跡 ID・evidence_log の値（敷地内の note を変えても同じ）
      expect(check.evidenceId).toBe(exp.checkEvidenceId);
      expect(d.evidenceId).toBe(exp.diagnosisEvidenceId);
      expect(d.category).toBe(exp.category);
      expect(JSON.parse(JSON.stringify(toEvidenceLogInsert(check, l.loc)))).toEqual(exp.evidenceLog);

      if (w === undefined || w >= 100) {
        // 8：判定の中身全体が c4f13ee と同じ（敷地内の note の新旧の置き換えだけを許す）
        const actual = JSON.parse(JSON.stringify(d.verdict).replaceAll(NEW_NOTE, OLD_NOTE));
        expect(actual).toEqual(exp.verdict);
      } else {
        // 9：50g は段・項目・段取りの構造が同じ。変わるのは文言と参照先の件数だけ
        const v = d.verdict;
        const e = exp.verdict;
        expect(v.level).toBe(e.level);
        expect(v.items.map((i) => [i.id, i.verdict, i.baseStatus, i.legalTier])).toEqual(
          e.items.map((i) => [i.id, i.verdict, i.baseStatus, i.legalTier]),
        );
        expect(v.procedures.map((x) => [x.id, x.itemId, x.legalTier, x.deadline])).toEqual(
          e.procedures.map((x) => [x.id, x.itemId, x.legalTier, x.deadline]),
        );
        expect(v.perFlightDuties.map((x) => x.id)).toEqual(e.perFlightDuties.map((x) => x.id));
        expect(v.permits).toEqual(e.permits);
      }
    });
  }

  it("10. ENGINE_VERSION は 0.4.0 のまま", () => {
    expect(ENGINE_VERSION).toBe("soraban-0.4.0-verdict-2026-10");
  });

  it("11. 出雲縁結び空港の敷地内の証跡 ID は c4f13ee と同じ（note は入力に含まれない）", async () => {
    const l = LOC["出雲縁結び空港の敷地内"];
    for (const w of [50, 900, undefined]) {
      const check = await runRegulationCheckWith(baselineProvider(l.muni), l.loc, baselineCtx(w), BASELINE_NOW);
      expect(check.evidenceId).toBe(baseline[baselineKey(l.name, w, [])]!.checkEvidenceId);
    }
  });
});

// 12・13：条番号・URL は model-aircraft.ts だけ。旧番号・禁止語・罰則が無い。
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
};
const ROOT = new URL("../../../../", import.meta.url).pathname;
const sources = [...walk(join(ROOT, "apps/web/src")), ...walk(join(ROOT, "packages/regulations/src"))];
const MODEL_FILE = join(ROOT, "packages/regulations/src/model-aircraft.ts");

describe("C. 定数と文言（grep）", () => {
  it("12. 条番号・URL は model-aircraft.ts にだけある。旧番号は 0 件。確認日・※要確認・9 件の URL が残る", () => {
    const re =
      /第134条の3|第239条の2|第239条の3|laws\.e-gov\.go\.jp\/law\/327AC0000000231|laws\.e-gov\.go\.jp\/law\/327M50000800056|koku_tk1_000048|001708524|koku_fr10_000040|001407133|koku_fr10_000042/;
    const hits = sources.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(hits).toEqual(["packages/regulations/src/model-aircraft.ts"]);
    for (const f of sources) expect(readFileSync(f, "utf8")).not.toMatch(/第99条の2|第209条の3/);
    const src = readFileSync(MODEL_FILE, "utf8");
    expect(src).toContain("2026-10-20");
    expect(src).toContain("※要確認：一次資料未取得");
    for (const r of MODEL_AIRCRAFT_REFERENCES) expect(src).toContain(r.url);
  });

  it("13. 禁止語が 0 件。model-aircraft.ts に罰則の記載がない", () => {
    const re = /通報不要|飛行可能|要確認・要許可|ロックーン|おおむね ?300m|特許|出願/;
    for (const f of sources) expect(readFileSync(f, "utf8"), relative(ROOT, f)).not.toMatch(re);
    expect(readFileSync(MODEL_FILE, "utf8")).not.toMatch(/懲役|罰金|過料/);
  });
});
