// 飛行禁止法の規制カードの文言（ゾーンの呼び名）と、判定ロジックの不変を確かめる。
import { offsetMeters } from "@soraban/geo";
import { evaluateSmallDroneLaw, MIHO_AIRBASE_CENTER, SMALL_DRONE_LAW_FACILITIES } from "./index";

const miho = SMALL_DRONE_LAW_FACILITIES.find((f) => f.id === "jasdf-miho")!;
// 美保基地の中心から東へ、推定敷地の境界を起点に extraM だけ進んだ地点を判定する。
const at = (extraM: number) => {
  const r = miho.geometry.type === "center" ? miho.geometry.estimatedSiteRadiusM : 0;
  return evaluateSmallDroneLaw(offsetMeters(MIHO_AIRBASE_CENTER, r + extraM, 0));
};

describe("規制カードの文言：赤＝敷地・区域、黄＝周辺地域、灰の点線＝要確認帯", () => {
  const { summary } = at(0);

  it("赤はレッドゾーン、黄はイエローゾーン（周辺地域）、どちらも原則飛行禁止と書く", () => {
    expect(summary).toContain("敷地・区域を赤（レッドゾーン）");
    expect(summary).toContain("周辺地域を黄（イエローゾーン）");
    expect(summary).toContain("どちらも原則飛行禁止");
  });

  it("地図の黄はゾーンの呼び名で、結論の色ではないと書く", () => {
    expect(summary).toContain("判定結果の色は周辺地域でも「飛行禁止」の赤のまま");
    expect(summary).toContain("地図の黄はゾーンの呼び名であり、結論の色ではありません");
  });

  it("要確認帯は独自で法定の範囲ではないと書き、旧距離（幅）と旧文言は書かない", () => {
    expect(summary).toContain("要確認帯");
    expect(summary).toContain("法定の範囲ではありません");
    expect(summary).not.toContain("300m");
    expect(summary).not.toContain("敷地とあわせて赤で示します");
  });
});

describe("判定ロジックは変えない（周辺地域でも結論は red）", () => {
  it("敷地内・周辺地域（境界から 900m）は red、要確認帯（1,100m）は yellow、その外は green", () => {
    expect(at(-100).status).toBe("red");
    expect(at(900).status).toBe("red");
    expect(at(1100).status).toBe("yellow");
    expect(at(1400).status).toBe("green");
  });
});
