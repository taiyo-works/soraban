import {
  buildPrefillFields,
  buildFlightManualDraft,
  formatManualDraftText,
  STANDARD_MANUAL_REFERENCE,
  ALL_MANUAL_BASE_SECTIONS,
  ALL_MANUAL_METHOD_SECTIONS,
  PREFILL_DID_UNVERIFIED_LABEL,
  type PrefillField,
} from "./prefill";
import { deriveDiagnosis, type SpecificFlightFlag } from "./diagnosis";

// 米子市役所の座標（DID 内）。spec の中核ケースに合わせる。
const YONAGO = { lat: 35.4278, lng: 133.3314 };

const valueOf = (
  fields: readonly PrefillField[],
  label: string,
): string | undefined => fields.find((f) => f.dipsFieldLabel === label)?.value;

describe("buildPrefillFields — 米子市役所＋夜間＋目視外（DID 内・900g）", () => {
  const flags: SpecificFlightFlag[] = ["airspace_did", "method_night", "method_bvlos"];
  const fields = buildPrefillFields({
    lat: YONAGO.lat,
    lng: YONAGO.lng,
    resolvedAddress: "鳥取県米子市加茂町一丁目1番地",
    flags,
    droneWeightG: 900,
    plannedDate: "2026-07-31",
    accessControl: true,
    bvlosWithObserver: true,
  });

  it("各行が dipsFieldLabel・value・source・system の 4 情報を持つ（空でない）", () => {
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect(f.dipsFieldLabel.length).toBeGreaterThan(0);
      expect(f.value.length).toBeGreaterThan(0);
      expect(f.source.length).toBeGreaterThan(0);
      expect(["DIPS 2.0", "DRS"]).toContain(f.system);
    }
  });

  it("座標（緯度・経度）が十進度の実値で入る（空ダミーでない）", () => {
    expect(valueOf(fields, "飛行範囲の緯度（十進度）")).toBe("35.427800");
    expect(valueOf(fields, "飛行範囲の経度（十進度）")).toBe("133.331400");
  });

  it("住所が解決済みならその住所が入る", () => {
    expect(valueOf(fields, "飛行範囲（住所・地名）")).toBe("鳥取県米子市加茂町一丁目1番地");
  });

  it("飛行の種類に夜間・目視外・DID が反映される", () => {
    const v = valueOf(fields, "飛行の種類（特定飛行の区分）") ?? "";
    expect(v).toContain("夜間");
    expect(v).toContain("目視外");
    expect(v).toContain("DID");
  });

  it("機体重量が反映され、DRS（機体登録）行として区別される", () => {
    const weightField = fields.find(
      (f) => f.dipsFieldLabel === "機体の重量区分（DRS 登録要否）",
    );
    expect(weightField?.value).toContain("900");
    expect(weightField?.system).toBe("DRS");
  });

  it("飛行範囲（座標）は DIPS 2.0 行として区別される（DRS と別導線）", () => {
    const latField = fields.find((f) => f.dipsFieldLabel === "飛行範囲の緯度（十進度）");
    expect(latField?.system).toBe("DIPS 2.0");
  });

  it("DRS 行と DIPS 2.0 行の両方が存在する（別導線）", () => {
    expect(fields.some((f) => f.system === "DRS")).toBe(true);
    expect(fields.some((f) => f.system === "DIPS 2.0")).toBe(true);
  });

  it("目視外を選ぶと補助者配置の行が出る", () => {
    expect(valueOf(fields, "目視外飛行の補助者配置")).toBe("補助者あり");
  });

  it("飛行予定日が反映される", () => {
    expect(valueOf(fields, "飛行予定日（飛行期間の開始日）")).toBe("2026-07-31");
  });
});

describe("buildPrefillFields — 機体重量未指定はフェイルセーフで登録対象扱い", () => {
  const fields = buildPrefillFields({
    lat: YONAGO.lat,
    lng: YONAGO.lng,
    flags: ["method_night"],
  });
  it("重量未指定でも登録対象として扱う旨が入る", () => {
    const v = valueOf(fields, "機体の重量区分（DRS 登録要否）") ?? "";
    expect(v).toContain("登録対象");
  });
  it("住所未解決なら座標から補完した値が入る（空にしない）", () => {
    const v = valueOf(fields, "飛行範囲（住所・地名）") ?? "";
    expect(v.length).toBeGreaterThan(0);
    expect(v).toContain("緯度");
  });
});

describe("buildPrefillFields — 100g 未満は非該当が明示される", () => {
  const fields = buildPrefillFields({
    lat: YONAGO.lat,
    lng: YONAGO.lng,
    flags: ["method_night"],
    droneWeightG: 80,
  });
  it("100g 未満は航空法上の無人航空機に非該当と示す", () => {
    const v = valueOf(fields, "機体の重量区分（DRS 登録要否）") ?? "";
    expect(v).toContain("80");
    expect(v).toContain("非該当");
  });
});

describe("buildPrefillFields — DID が未確認のときの「飛行の種類」（安全側）", () => {
  const KIND = "飛行の種類（特定飛行の区分）";
  const base = { lat: YONAGO.lat, lng: YONAGO.lng, droneWeightG: 900 };

  it("飛行方法なし・DID 未確認：「特定飛行に非該当」とせず要確認を出し、診断のカテゴリーも要確認", () => {
    const v = valueOf(buildPrefillFields({ ...base, flags: [], didStatus: "unverified" }), KIND) ?? "";
    expect(v).toBe(PREFILL_DID_UNVERIFIED_LABEL);
    expect(v).toContain("要確認");
    expect(v).not.toContain("非該当（許可・承認の対象なし）");
    expect(deriveDiagnosis({ flags: [], droneWeightG: 900, didStatus: "unverified" }).category).toBe(
      "needs_verification",
    );
  });

  it("飛行方法あり・DID 未確認：選んだ飛行方法に DID の要確認を併記する", () => {
    const v =
      valueOf(buildPrefillFields({ ...base, flags: ["method_night"], didStatus: "unverified" }), KIND) ?? "";
    expect(v).toContain("夜間");
    expect(v).toContain(PREFILL_DID_UNVERIFIED_LABEL);
  });

  it("DID 非該当（確定）なら従来どおり「特定飛行に非該当」", () => {
    const v = valueOf(buildPrefillFields({ ...base, flags: [], didStatus: "not_applicable" }), KIND);
    expect(v).toBe("特定飛行に非該当（許可・承認の対象なし）");
  });

  it("DID フラグが立っている（該当）なら要確認を出さない", () => {
    const v =
      valueOf(buildPrefillFields({ ...base, flags: ["airspace_did"], didStatus: "unverified" }), KIND) ?? "";
    expect(v).not.toContain("要確認");
  });

  it("100g 未満は航空法上の無人航空機に当たらないため、未確認でも要確認にしない", () => {
    const v = valueOf(
      buildPrefillFields({ ...base, droneWeightG: 80, flags: [], didStatus: "unverified" }),
      KIND,
    );
    expect(v).toBe("特定飛行に非該当（許可・承認の対象なし）");
  });
});

describe("buildFlightManualDraft — 標準マニュアルを使う", () => {
  const draft = buildFlightManualDraft({
    choice: "standard",
    flags: ["method_night", "method_bvlos"],
  });
  it("標準選択では本文・骨子を出さない（baseSections / methodSections は空）", () => {
    expect(draft.choice).toBe("standard");
    expect(draft.baseSections).toHaveLength(0);
    expect(draft.methodSections).toHaveLength(0);
  });
  it("標準を使用する旨と参照先（出典 URL）を持つ", () => {
    expect(draft.standardNotice.length).toBeGreaterThan(0);
    expect(draft.standardReference.sourceUrl.length).toBeGreaterThan(0);
  });
  it("整形テキストに『標準マニュアルを使用』が含まれる", () => {
    const text = formatManualDraftText(draft);
    expect(text).toContain("標準マニュアル");
    expect(text).toContain("使用");
  });
});

describe("buildFlightManualDraft — 独自マニュアルを作る", () => {
  const draft = buildFlightManualDraft({
    choice: "custom",
    flags: ["method_night", "method_bvlos"],
  });
  it("基本章が出る", () => {
    expect(draft.baseSections.length).toBeGreaterThan(0);
  });
  it("選択した飛行方法（夜間・目視外）に対応する追記観点が含まれる", () => {
    const flagsInDraft = draft.methodSections.map((m) => m.flag);
    expect(flagsInDraft).toContain("method_night");
    expect(flagsInDraft).toContain("method_bvlos");
  });
  it("各追記観点が legalBasis と sourceUrl を持つ", () => {
    for (const m of draft.methodSections) {
      expect(m.legalBasis.length).toBeGreaterThan(0);
      expect(m.sourceUrl.length).toBeGreaterThan(0);
      expect(m.points.length).toBeGreaterThan(0);
    }
  });
  it("夜間を選ぶと夜間に対応する記述（灯火等）が骨子に含まれる", () => {
    const night = draft.methodSections.find((m) => m.flag === "method_night");
    const joined = (night?.points ?? []).join("");
    expect(joined).toContain("灯火");
  });
  it("整形テキストに標準マニュアル本文の転載がない旨が含まれる", () => {
    const text = formatManualDraftText(draft);
    expect(text).toContain("本文は含みません");
  });
  it("選択した飛行方法が無い場合は基本章のみで追記観点は空", () => {
    const empty = buildFlightManualDraft({ choice: "custom", flags: [] });
    expect(empty.baseSections.length).toBeGreaterThan(0);
    expect(empty.methodSections).toHaveLength(0);
  });
});

describe("マニュアルテンプレデータの健全性", () => {
  it("基本章はコード直書きでなくデータから読み込まれている", () => {
    expect(ALL_MANUAL_BASE_SECTIONS.length).toBeGreaterThan(0);
  });
  it("飛行方法ごとの追記観点はすべて出典 URL を持つ", () => {
    for (const m of ALL_MANUAL_METHOD_SECTIONS) {
      expect(m.sourceUrl.length).toBeGreaterThan(0);
      expect(m.legalBasis.length).toBeGreaterThan(0);
    }
  });
  it("標準マニュアル参照は出典 URL を持つ", () => {
    expect(STANDARD_MANUAL_REFERENCE.sourceUrl.length).toBeGreaterThan(0);
  });
});
