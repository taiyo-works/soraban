// Sprint 12e 契約 4・16（単体）：事象の類型の版つきのデータ・目安（2 段）・固定の文言。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as m from "./ops-incident";
import {
  EVENT_TYPE_NONE,
  EVENT_TYPE_UNKNOWN,
  eventTypeKeysOf,
  eventTypeLabel,
  eventTypeOptions,
  guidanceRevisionOf,
  INCIDENT_GUIDANCE_REVISION,
  INCIDENT_GUIDANCE_REVISION_1,
  INCIDENT_GUIDANCE_REVISIONS,
  INCIDENT_KINDS,
  incidentGuidance,
  incidentGuidanceNote,
  type IncidentGuidanceRevisionData,
} from "./ops-incident";
import { INCIDENT_FORBIDDEN, INCIDENT_NO_FAULT_PHRASE, NUMERIC_DEADLINE } from "./incident-words.test-helpers";

const strings = (o: unknown, out: string[] = []): string[] => {
  if (typeof o === "string") out.push(o);
  else if (Array.isArray(o)) for (const x of o) strings(x, out);
  else if (o && typeof o === "object") for (const v of Object.values(o as Record<string, unknown>)) strings(v, out);
  else if (typeof o === "function") {
    /* 関数は呼んだ結果を別に検査する */
  }
  return out;
};

const POSSIBLE_TYPES = INCIDENT_GUIDANCE_REVISION_1.eventTypes.filter((t) => t.guidance === "possible").map((t) => t.key);
const FACT_ONLY_TYPES = INCIDENT_GUIDANCE_REVISION_1.eventTypes.filter((t) => t.guidance === "fact_only").map((t) => t.key);
const ALL_TYPES = INCIDENT_GUIDANCE_REVISION_1.eventTypes.map((t) => t.key);

describe("事象の類型のデータ（版 1）", () => {
  it("8 類型（possible に倒す 7 と、単独では倒さない事実の類型 1）＋排他の 2 つ。版 1 は原本照合済み", () => {
    expect(INCIDENT_GUIDANCE_REVISION).toBe(1);
    expect(ALL_TYPES).toEqual([
      "death_or_serious_injury",
      "minor_injury",
      "property_damage",
      "aircraft_collision",
      "near_collision",
      "loss_of_control_malfunction",
      "fire_in_flight",
      "loss_by_operation",
    ]);
    expect(POSSIBLE_TYPES).toHaveLength(7);
    expect(FACT_ONLY_TYPES).toEqual(["loss_by_operation"]);
    expect(eventTypeKeysOf()).toEqual([...ALL_TYPES, EVENT_TYPE_NONE, EVENT_TYPE_UNKNOWN]);
    const rev = guidanceRevisionOf(1);
    expect(rev.status).toBe("confirmed");
    expect(rev.source).toBe("国土交通省航空局『無人航空機の事故及び重大インシデントの報告要領』（令和4年11月4日制定）。2026-10-22 原本照合");
    expect(rev.confirmedOn).toBe("2026-10-22");
  });

  it("名称と説明（選択肢の下に出す）が契約の文と一致する。照合済みの版では「※要確認」を付けない", () => {
    const byKey = Object.fromEntries(eventTypeOptions().map((o) => [o.key, o]));
    const expected: Record<string, [string, string]> = {
      death_or_serious_injury: [
        "人の死傷（重傷以上）",
        "操縦者や関係者のけがも含みます。悪天候など、操縦者に過失がない場合も含みます。けがの重さが分からないときは、この類型か『人の負傷（軽傷）』のうち重い方を選んでください。",
      ],
      minor_injury: ["人の負傷（軽傷）", "重傷以上を除くけがです。地上で待機・移動しているときのけが（回転中のプロペラに触れたなど）も含みます。"],
      property_damage: [
        "第三者の物件の損壊（軽微なものも含む）",
        "他人が所有する物（建物・車・設備など）を傷つけた場合です。瓦のひび割れや壁の傷などの軽微なものも含みます。他人が所有する無人航空機とぶつかった場合も含みます。",
      ],
      aircraft_collision: ["航空機との衝突・接触（機体に損傷）", "航空機と衝突・接触し、どちらかまたは両方の機体に損傷が確認できる場合です。"],
      near_collision: [
        "航空機との衝突・接触のおそれ（回避の措置をとったもの）",
        "航空機との衝突・接触のおそれがあり、無人航空機を地上に降ろすなどの回避の措置をとった場合です。",
      ],
      loss_of_control_malfunction: [
        "機体の不具合による制御不能（これによる紛失を含む）",
        "通信の障害（通信できる範囲から出た場合を除く）、想定しないバッテリー切れ、機体や装備品の機能の不良などで、飛行中に制御できなくなった場合です。これにより機体を紛失した場合も含みます。",
      ],
      fire_in_flight: ["飛行中の発火（推進装置が動いている間）", "飛行のために推進装置が動いている間に発火した場合です。保管中のバッテリーの発火は含みません。"],
      loss_by_operation: [
        "操縦ミスなどによる操縦不能・機体の紛失（機体の不具合によらないもの）",
        "国土交通省の報告要領では、操縦ミス（通信できる範囲から出た、バッテリー残量の確認不足、急な旋回による失速、気象の確認不足で風にあおられた など）による操縦不能は、制御不能には当たらないとされています。機体の不具合かどうか分からないときは『機体の不具合による制御不能』か『まだ分からない』を選んでください。けがや物の損壊、発火があったときは、その類型も選んでください。",
      ],
      [EVENT_TYPE_UNKNOWN]: ["まだ分からない", "起きたことがまだはっきりしないときに選んでください。分かったら訂正で類型を選び直せます。"],
      [EVENT_TYPE_NONE]: ["どれにも当たらない（ヒヤリハットなど）", "けが・物の損壊・航空機との接近・制御不能・発火のどれもなかったときに選んでください。"],
    };
    expect(Object.keys(byKey).sort()).toEqual(Object.keys(expected).sort());
    for (const [key, [label, description]] of Object.entries(expected)) {
      expect(byKey[key]!.label, key).toBe(label);
      expect(byKey[key]!.description, key).toBe(description);
      expect(byKey[key]!.unconfirmed, key).toBe(false);
      expect(eventTypeLabel(key)).toBe(label);
      expect(m.eventTypeDescription(key)).toBe(description);
    }
    expect(eventTypeOptions().slice(-2).map((o) => [o.key, o.exclusive])).toEqual([
      [EVENT_TYPE_NONE, true],
      [EVENT_TYPE_UNKNOWN, true],
    ]);
  });
});

describe("incidentGuidance（目安。2 段）", () => {
  it("全数：8 類型の部分集合（256 通り）と排他の none・unknown。possible 類型を 1 つでも選ぶか unknown なら possible、それ以外は none_selected", () => {
    let n = 0;
    for (let mask = 0; mask < 1 << ALL_TYPES.length; mask++) {
      const sel = ALL_TYPES.filter((_, i) => mask & (1 << i));
      const g = incidentGuidance(sel);
      const expectPossible = sel.length === 0 || sel.some((k) => POSSIBLE_TYPES.includes(k));
      expect(g.level, sel.join(",")).toBe(expectPossible ? "possible" : "none_selected");
      expect(g.reasons).toEqual(sel.filter((k) => POSSIBLE_TYPES.includes(k)));
      n++;
    }
    expect(n).toBe(256);
    // 排他の値（単独）
    expect(incidentGuidance([EVENT_TYPE_NONE]).level).toBe("none_selected");
    expect(incidentGuidance([EVENT_TYPE_NONE]).reasons).toEqual([]);
    expect(incidentGuidance([EVENT_TYPE_UNKNOWN]).level).toBe("possible");
    expect(incidentGuidance([EVENT_TYPE_UNKNOWN]).reasons).toEqual([EVENT_TYPE_UNKNOWN]);
    // 事実の類型だけは none_selected（単独では倒さない）
    expect(incidentGuidance(["loss_by_operation"]).level).toBe("none_selected");
    // 版にないキーは分からないものとして possible の側
    expect(incidentGuidance(["future_type"]).level).toBe("possible");
  });

  it("区分（事故・ヒヤリハット・まだ分からない）に依らない（類型だけで決める）", () => {
    for (const kind of INCIDENT_KINDS) {
      expect([kind, incidentGuidance([EVENT_TYPE_NONE]).level]).toEqual([kind, "none_selected"]);
      expect([kind, incidentGuidance(["minor_injury"]).level]).toEqual([kind, "possible"]);
    }
  });

  it("出力に版・状態・出典・案内の文が含まれ、possible の文が決められたとおり（照合済みの版は「※要確認」なし）", () => {
    const p = incidentGuidance(["minor_injury"]);
    expect(p).toMatchObject({ revision: 1, status: "confirmed", source: guidanceRevisionOf(1).source });
    expect(p.text).toBe(
      "報告の対象になる可能性があります。報告は、DIPS 2.0 の『事故等の報告』から、操縦者が速やかに行います（そらばんは送信しません）。DIPS 2.0 で報告できないやむを得ない場合は、国土交通省の報告要領に定める方法（様式による電話・電子メール）で報告できます。",
    );
    const n = incidentGuidance([EVENT_TYPE_NONE]);
    expect(n.text).toBe("入力の範囲では、報告の対象になりうる事象は選ばれていません。報告が必要かどうかは、念のため国土交通省の報告要領で確認してください。");
    expect(incidentGuidanceNote()).toBe(
      "この目安は、選んだ事象の類型から機械的に示すものです。報告が必要かどうかを判断するものでも、保証するものでもありません。類型は国土交通省の報告要領（令和4年11月4日制定）に基づきます。",
    );
  });

  it("出力に、報告の要否を断定する語も、法令上の区分（事故・重大インシデント）も含まれない", () => {
    const outs = [...ALL_TYPES.map((k) => incidentGuidance([k])), incidentGuidance([EVENT_TYPE_NONE]), incidentGuidance([EVENT_TYPE_UNKNOWN])];
    for (const g of outs) {
      const text = JSON.stringify({ level: g.level, reasons: g.reasons, text: g.text, status: g.status });
      for (const w of INCIDENT_FORBIDDEN) expect(text, w).not.toContain(w);
      expect(text).not.toContain("重大インシデント");
      // 「事故」は DIPS 2.0 の手続きの名称（『事故等の報告』）としてだけ現れる
      expect(g.text.replaceAll("『事故等の報告』", "")).not.toContain("事故");
      expect(text).not.toMatch(/accident|serious_incident|対象外/);
      expect(["possible", "none_selected"]).toContain(g.level);
    }
  });

  it("テスト用の版 2（未照合）を与えると、型・DB を変えずに名称と「※要確認」が変わり、版 1 で保存した記録は版 1 の名称で読める", () => {
    const rev2: IncidentGuidanceRevisionData = {
      ...INCIDENT_GUIDANCE_REVISION_1,
      revision: 2,
      status: "unconfirmed",
      source: "テスト用の出典（原本照合前）",
      confirmedOn: null,
      confirmedBy: null,
      eventTypes: INCIDENT_GUIDANCE_REVISION_1.eventTypes.map((t) => (t.key === "loss_by_operation" ? { ...t, label: "操縦不能・機体の紛失（テスト用の名称）" } : t)),
    };
    const table = [...INCIDENT_GUIDANCE_REVISIONS, rev2];
    expect(eventTypeLabel("loss_by_operation", 2, table)).toBe("操縦不能・機体の紛失（テスト用の名称）");
    // 「※要確認」は、未照合の版のとき目安・N4・類型の説明に付く
    expect(eventTypeOptions(2, table).every((o) => o.description!.endsWith("※要確認") && o.unconfirmed)).toBe(true);
    expect(incidentGuidance(["minor_injury"], 2, table).text.endsWith("※要確認")).toBe(true);
    expect(incidentGuidance([EVENT_TYPE_NONE], 2, table).text.endsWith("※要確認")).toBe(true);
    expect(incidentGuidance(["minor_injury"], 2, table)).toMatchObject({ revision: 2, status: "unconfirmed", source: "テスト用の出典（原本照合前）" });
    expect(incidentGuidanceNote(2, table).endsWith("に基づきます。※要確認")).toBe(true);
    // 版 1 で保存した記録（guidance_revision = 1）は、版 2 があっても版 1 の名称で読め、「※要確認」は付かない
    expect(eventTypeLabel("loss_by_operation", 1, table)).toBe("操縦ミスなどによる操縦不能・機体の紛失（機体の不具合によらないもの）");
    expect(incidentGuidance(["minor_injury"], 1, table).text).not.toContain("※要確認");
    expect(eventTypeOptions(1, table).some((o) => (o.description ?? "").includes("※要確認"))).toBe(false);
    // 類型が個別に未照合なら、照合済みの版でもその説明に印が付く
    const rev3: IncidentGuidanceRevisionData = { ...INCIDENT_GUIDANCE_REVISION_1, revision: 3, eventTypes: [{ key: "x", label: "テスト", description: "説明。", guidance: "possible", unconfirmed: true }] };
    expect(m.eventTypeDescription("x", 3, [rev3])).toBe("説明。※要確認");
    expect(() => guidanceRevisionOf(9)).toThrow();
  });
});

describe("固定の文言（設計 A）", () => {
  it("G1・N1〜N7 が決められたとおり", () => {
    expect(m.INCIDENT_SAFETY_FIRST_LINES).toEqual([
      "まず、飛行を中止し（速やかに着陸させ）、けがをした人の救護と危険の防止を最優先にしてください。必要に応じて 119 番（救急・消防）・110 番（警察）へ連絡してください。",
      "機体やバッテリーから煙や熱が出ているときは、近づかず、無理に触れないでください。周囲の人が近づかないようにしてください。",
      "記録は、安全を確保したあとで構いません。",
    ]);
    expect(m.INCIDENT_SAFETY_FIRST).toBe(m.INCIDENT_SAFETY_FIRST_LINES.join(""));
    expect(m.INCIDENT_SAFETY_FIRST.startsWith("まず、飛行を中止し")).toBe(true);
    expect(m.INCIDENT_SAFETY_FIRST).toContain("119 番");
    expect(m.INCIDENT_SAFETY_FIRST).toContain("110 番");
    expect(m.INCIDENT_FACT_NOTICE).toBe(
      "この記録は、起きたことの事実を残すためのものです。国への報告が済んだこと、報告の義務があるかどうか、責任の所在を示すものではありません。",
    );
    expect(m.INCIDENT_OFFICIAL_PROCEDURE_NOTICE).toBe("そらばんは国への報告を送信しません。報告が必要かどうかと報告の方法は、国土交通省の報告要領と DIPS 2.0 で確認してください。");
    expect(m.INCIDENT_REPORT_RECORD_NOTICE).toBe("報告の記録は、利用者の申告です。そらばんが報告の完了を確認したものではありません。");
    expect(m.INCIDENT_GUIDANCE_NOTICE_BASE).toBe(
      "この目安は、選んだ事象の類型から機械的に示すものです。報告が必要かどうかを判断するものでも、保証するものでもありません。",
    );
    expect(m.INCIDENT_PERSONAL_INFO_NOTICE).toBe("氏名・連絡先・病状の詳細など、個人が特定される情報は書かないでください。");
    expect(m.INCIDENT_KIND_NOTICE).toBe("この区分は記録を整理するためのもので、法令上の区分ではありません。迷うときは『まだ分からない』を選んでください。");
    expect(m.INCIDENT_EVENT_TYPE_NOTICE).toBe(
      "当てはまるものをすべて選んでください。各類型の説明は、国土交通省の報告要領に基づきます。けがの重さ（重傷か軽傷か）の境目は報告要領に定めがなく、そらばんは判定しません。迷うときは重い方か『まだ分からない』を選んでください。",
    );
    // 固定の文言（G1・N1〜N3・N5〜N7）には「※要確認」を付けない
    for (const t of [m.INCIDENT_SAFETY_FIRST, m.INCIDENT_FACT_NOTICE, m.INCIDENT_OFFICIAL_PROCEDURE_NOTICE, m.INCIDENT_REPORT_RECORD_NOTICE, m.INCIDENT_PERSONAL_INFO_NOTICE, m.INCIDENT_KIND_NOTICE, m.INCIDENT_EVENT_TYPE_NOTICE]) {
      expect(t).not.toContain("※要確認");
    }
  });

  it("定数・データ・関数の出力に禁止語・数値の期限の表現がない。「責任」は N1 の中だけ", () => {
    const all = [
      ...strings(m),
      ...ALL_TYPES.map((k) => eventTypeLabel(k)),
      ...eventTypeOptions().flatMap((o) => [o.label, o.description ?? ""]),
      incidentGuidanceNote(),
      incidentGuidance([EVENT_TYPE_UNKNOWN]).text,
      incidentGuidance([EVENT_TYPE_NONE]).text,
      ...Object.keys(m.INCIDENT_ERROR_MESSAGE).map((k) => m.incidentErrorMessage(k)),
    ];
    // 契約の説明文（人の死傷）にある「操縦者に過失がない場合も含みます」は、非難ではなく対象の範囲を示す文のため除く（契約の文のまま）
    const joined = all.join("\n").replaceAll(INCIDENT_NO_FAULT_PHRASE, "");
    for (const w of INCIDENT_FORBIDDEN) expect(joined, w).not.toContain(w);
    expect(joined).not.toMatch(NUMERIC_DEADLINE);
    expect(all.filter((s) => s.includes("責任"))).toEqual([m.INCIDENT_FACT_NOTICE]);
  });

  it("ソースに URL・条番号・電話番号の直書き・外部への通信がない", () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ops-incident.ts"), "utf8");
    expect(src).not.toMatch(/https?:\/\//);
    expect(src).not.toMatch(/第[0-9０-９一二三四五六七八九十百]+条/);
    expect(src).not.toMatch(/\d{2,4}-\d{2,4}-\d{4}/);
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket/);
    expect(src).not.toMatch(/万円|円以下/);
  });

  it("経路と端末の保存のキー（soraban:ops-draft: の配下）", () => {
    expect(m.incidentHref("abc")).toBe("/ops/incidents/abc");
    expect(m.incidentHref("abc", "report")).toBe("/ops/incidents/abc#report");
    expect(m.incidentNewHref({ planId: "p", summary: "羽が当たった" })).toBe(`/ops/incidents/new?planId=p&summary=${encodeURIComponent("羽が当たった").replace(/%20/g, "+")}`);
    expect(m.incidentNewHref()).toBe("/ops/incidents/new");
    expect(m.incidentQuickHref("p")).toBe("/ops/plans/p/field/incident");
    expect(m.incidentOutboxKey("p", "u")).toBe("soraban:ops-draft:incident-p:u");
    expect(m.INCIDENT_OUTBOX_KEY_PREFIX.startsWith("soraban:ops-draft:")).toBe(true);
  });
});
