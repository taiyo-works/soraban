import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMIT_VALUE_LABEL, SPECIFIC_FLIGHT_FLAG_LABEL } from "@soraban/regulations";
import {
  buildPlanHandoffHref,
  EMPTY_HANDOFF,
  parsePlanHandoff,
  PLAN_FLAG_CHOICES,
  PLAN_PERMIT_CHOICES,
} from "./plan-options";

// 飛行計画のフォームの選択肢と、判定画面からの入力の引き継ぎ（Sprint 12a 設計 F・J）。

const source = {
  lat: "35.4278",
  lng: "133.3314",
  weightG: "900",
  flags: ["method_night", "airspace_emergency"],
  permits: ["mlit:night", "facility_manager"],
  plannedDate: "2027-01-20",
  purpose: "general",
  access: "yes",
  observer: "",
};

describe("計画のフォームの選択肢", () => {
  it("DID・空港等周辺は選ばせない（判定が導出する）。文言は @soraban/regulations の定数と同じ", () => {
    const values = PLAN_FLAG_CHOICES.map((c) => c.value);
    expect(values).not.toContain("airspace_did");
    expect(values).not.toContain("airspace_airport");
    expect(values).toContain("method_night");
    for (const c of PLAN_FLAG_CHOICES) expect(c.label).toBe(SPECIFIC_FLIGHT_FLAG_LABEL[c.value]);
  });

  it("許可・承認の選択肢の文言は定数と同じで、旧版の値（mlit）は選ばせない", () => {
    expect(PLAN_PERMIT_CHOICES.map((c) => c.value)).not.toContain("mlit");
    for (const c of PLAN_PERMIT_CHOICES) expect(c.label).toBe(PERMIT_VALUE_LABEL[c.value]);
  });
});

describe("判定画面からの入力の引き継ぎ", () => {
  it("入力（座標・重量・フラグ・許可・予定日）だけをリンクに載せ、結果らしい値は載せない", () => {
    const href = buildPlanHandoffHref(source);
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/ops/plans/new");
    expect([...url.searchParams.keys()].sort()).toEqual(["access", "date", "flags", "lat", "lng", "permits", "weightG"]);
    expect(href).not.toMatch(/ev_|verdict|evidence|level/);
  });

  it("リンクから読み戻すと、同じ入力になる。通常運航の目的は載せない", () => {
    const url = new URL(buildPlanHandoffHref(source), "http://x");
    const back = parsePlanHandoff(Object.fromEntries(url.searchParams));
    expect(back).toMatchObject({
      lat: "35.4278",
      lng: "133.3314",
      weightG: "900",
      flags: ["airspace_emergency", "method_night"],
      // Sprint 12d：DIPS の許可・承認（mlit:night）は引き継がない
      permits: ["facility_manager"],
      plannedDate: "2027-01-20",
      purpose: "",
      access: "yes",
      observer: "",
    });
  });

  it("知らない値・形の違う値は捨てる", () => {
    const back = parsePlanHandoff({
      lat: "abc",
      lng: "133.3314999999",
      weightG: "-1",
      flags: "method_night,airspace_did,unknown",
      permits: "mlit,mlit:night,park_manager,unknown",
      date: "2027/01/20",
      purpose: "nope",
      access: "maybe",
      observer: "x",
    });
    expect(back.lat).toBeUndefined();
    expect(back.lng).toBeUndefined();
    expect(back.weightG).toBeUndefined();
    expect(back.flags).toEqual(["method_night"]);
    // Sprint 12d：mlit・mlit:night はどちらも引き継がない（DIPS の許可は登録から照合する）
    expect(back.permits).toEqual(["park_manager"]);
    expect(back.plannedDate).toBeUndefined();
    expect(back).toMatchObject({ purpose: "", access: "", observer: "" });
  });

  it("何も無いときは空の引き継ぎ", () => {
    expect(parsePlanHandoff({})).toEqual(EMPTY_HANDOFF);
    expect(buildPlanHandoffHref({ ...source, lat: "", lng: "", weightG: "", flags: [], permits: [], plannedDate: "", purpose: "general", access: "", observer: "" })).toBe(
      "/ops/plans/new",
    );
  });
});

describe("計画・地点の画面の文言", () => {
  const roots = ["app/ops/plans", "app/ops/places", "components/ops/plans-client.tsx", "components/ops/plan-ui.tsx", "components/ops-home-entry.tsx"];
  const files = (p: string): string[] => {
    const abs = path.join(__dirname, "..", p);
    if (statSync(abs).isFile()) return [abs];
    return readdirSync(abs, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
      .map((e) => path.join(e.parentPath, e.name));
  };
  const all = roots.flatMap(files);

  it("通報が要らないと読める言い回しを画面の文言に書かない", () => {
    expect(all.length).toBeGreaterThan(8);
    for (const f of all) {
      const text = readFileSync(f, "utf8");
      for (const p of ["通報不要", "通報は不要", "通報の必要はありません", "通報しなくて"]) {
        expect(text, `${f} に「${p}」`).not.toContain(p);
      }
    }
  });

  it("条文番号（第134条の3）は画面のファイルに直書きしない（model-aircraft.ts の定数だけ）", () => {
    for (const f of all) expect(readFileSync(f, "utf8"), f).not.toMatch(/134条の3/);
  });
});
