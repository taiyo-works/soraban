import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_DATASETS, SMALL_DRONE_LAW_REG_ID } from "@soraban/regulations";
import { BASE_ZONE_LAYER_IDS } from "./regulation-map-zones";
import { LAYER_DEFS, LAYER_GROUP_ORDER, NO_LAYER_ROWS, layerStatusFor } from "./regulation-map-layers";

// Sprint 12h PR ②（Q-25）：層の一覧の行 ↔ 地図の層 ID ↔ 判定の規則 の対応を固定する。層を足す・消すと、この表を直すまで落ちる。
// 一覧は DIPS と同じ群（航空法／小型無人機等飛行禁止法／そらばん追加）。「準備中」の行は、チェックも層 ID も判定の規則も持たない。

const MAP_SOURCE = readFileSync(new URL("./regulation-map.tsx", import.meta.url), "utf8");
const INDEX_SOURCE = readFileSync(new URL("../../../../packages/regulations/src/index.ts", import.meta.url), "utf8");

/** 一覧の行 ↔ 地図の層 ID ↔ 判定の規則（固定する表）。 */
const EXPECTED = {
  airports: { group: "航空法", layerIds: ["airports-fill", "airports-outline"], rule: "aviation-law-airport" },
  did: { group: "航空法", layerIds: ["did-fill", "did-outline"], rule: "aviation-law-did" },
  industrial: { group: "航空法", layerIds: ["industrial-fill", "industrial-outline"], rule: "aviation-law-did" },
  base: { group: "小型無人機等飛行禁止法", layerIds: [...BASE_ZONE_LAYER_IDS], rule: SMALL_DRONE_LAW_REG_ID },
  parks: { group: "そらばん追加", layerIds: ["parks-fill", "parks-outline"], rule: "park-ordinance" },
  heritage: { group: "そらばん追加", layerIds: ["heritage-fill", "heritage-outline"], rule: "heritage-protection" },
  sensitive: { group: "そらばん追加", layerIds: ["sensitive-fill", "sensitive-outline"], rule: "pref-nuisance-prevention" },
} as const;

describe("地図の層の一覧（Q-25）", () => {
  it("一覧は 7 行で、行 ↔ 地図の層 ID ↔ 判定の規則 の対応が表のとおり", () => {
    expect(LAYER_DEFS.map((l) => l.key).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const l of LAYER_DEFS) {
      const e = EXPECTED[l.key];
      expect(l.group, l.key).toBe(e.group);
      expect([...l.layerIds], l.key).toEqual(e.layerIds);
      expect(l.ruleId, l.key).toBe(e.rule);
    }
  });

  it("群は DIPS と同じ並びで、一覧のどの行もいずれかの群に入る", () => {
    expect([...LAYER_GROUP_ORDER]).toEqual(["航空法", "小型無人機等飛行禁止法", "その他", "そらばん追加"]);
    for (const l of LAYER_DEFS) expect(LAYER_GROUP_ORDER, l.key).toContain(l.group);
  });

  it("各層の MapLibre の層 ID は、地図のコードが実際に作る層（addLayer の id）と一致する。層 ID は重ならない", () => {
    const all = LAYER_DEFS.flatMap((l) => [...l.layerIds]);
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) {
      const inMap = MAP_SOURCE.includes(`id: "${id}"`) || BASE_ZONE_LAYER_IDS.includes(id as (typeof BASE_ZONE_LAYER_IDS)[number]);
      expect(inMap, `地図のコードに ${id} がない`).toBe(true);
    }
  });

  it("判定の規則の id は、規制の定義（packages/regulations）に実在する。市町村・県ごとの規則は接尾辞で引く", () => {
    for (const l of LAYER_DEFS) {
      if (l.ruleId === SMALL_DRONE_LAW_REG_ID) continue;
      expect(INDEX_SOURCE.includes(l.ruleId), `${l.key}: ${l.ruleId}`).toBe(true);
    }
  });

  it("状態の語は台帳から出す：DID は公式データ、空港・飛行禁止法・公園・史跡・密集地は概算。判定に使っている層を「準備中」と書かない", () => {
    const status = Object.fromEntries(LAYER_DEFS.map((l) => [l.key, l.status]));
    expect(status["did"]).toBe("公式データ");
    expect(status["airports"]).toBe("概算");
    expect(status["base"]).toBe("概算");
    expect(status["parks"]).toBe("概算");
    expect(status["heritage"]).toBe("概算");
    expect(status["sensitive"]).toBe("概算");
    for (const l of LAYER_DEFS) {
      expect(l.status, l.key).not.toBe("準備中");
      // 台帳に実在し、確認日がある
      expect(ALL_DATASETS.some((d) => d.id === l.dataset), `${l.key} の台帳 ${l.dataset}`).toBe(true);
      expect(l.source, l.key).toMatch(/確認日 \d{4}-\d{2}-\d{2}|条例/);
    }
    // 台帳に「概算」と書かれたデータは概算、同梱されていないデータは準備中
    expect(layerStatusFor("airports-seed")).toBe("概算");
    expect(layerStatusFor("abr-address")).toBe("準備中");
  });

  it("地図に出さない行（緊急用務空域）は、層 ID・判定の規則・チェックを持たず、使っていない旨を書く", () => {
    expect(NO_LAYER_ROWS.map((r) => r.label)).toEqual(["緊急用務空域"]);
    for (const r of NO_LAYER_ROWS) {
      expect(Object.keys(r).sort()).toEqual(["group", "label", "note"]);
      expect(r.note).toContain("地図には出しません");
      expect(r.note).not.toContain("準備中");
    }
  });
});

describe("#35 の再発防止（regulation-map.tsx 以外で once(\"load\" を呼ばない）", () => {
  it("apps/web/src の他のファイルに once(\"load\" がない", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = new URL("../", import.meta.url).pathname;
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.endsWith("components/regulation-map.tsx")) {
          if (/once\(\s*["']load["']/.test(readFileSync(p, "utf8"))) hits.push(p);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
