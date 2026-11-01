// Sprint 12b 契約 1・15・20：文言に禁止語がなく、固定の文言が決められたとおりである。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as messages from "./messages";
import { REPORT_POLICY } from "./policy";
import { ManualGateway } from "./adapters/manual";
import { prepareReport } from "./prepare";
import { basePlan } from "./test-fixtures";

/** 通報が要らないと読める言い回し（12a 契約 15）＋ 特許・出願の表示。部品をつないで作る（このファイル自体が grep に掛からないように）。 */
const FORBIDDEN = [
  ["通報", "不要"].join(""),
  ["通報は", "不要"].join(""),
  ["通報の必要", "はありません"].join(""),
  ["通報", "しなくて"].join(""),
  ["特", "許"].join(""),
  ["出", "願"].join(""),
  ["飛行", "可能"].join(""),
];

const strings = (o: unknown, out: string[] = []): string[] => {
  if (typeof o === "string") out.push(o);
  else if (Array.isArray(o)) for (const x of o) strings(x, out);
  else if (o && typeof o === "object") for (const v of Object.values(o as Record<string, unknown>)) strings(v, out);
  return out;
};

describe("文言", () => {
  it("固定の文言（手動・模擬）が決められたとおり", () => {
    expect(messages.REPORT_NOTICE_MANUAL).toBe(
      "そらばんは DIPS に送信しません。この内容を DIPS 2.0 で通報し、通報した日時と番号をここに記録してください。記録するまで『通報済み』にはなりません。許可・承認の申請と飛行計画の通報は、利用者本人が DIPS 2.0 などの公式の手続きで行います。",
    );
    expect(messages.REPORT_NOTICE_MOCK).toBe("模擬（開発用）です。実際の DIPS には送信されません。");
    expect(messages.REPORT_CHANNEL_LABEL).toEqual({ manual: "手動（利用者の申告）", mock: "模擬（開発用）", api: "API" });
    expect(messages.MANUAL_CONFIRM_DIPS_DONE).toBe("DIPS 2.0 の画面で通報を完了した");
    expect(messages.MANUAL_CONFIRM_MATCHES_LATEST).toBe("通報した内容は、この計画の最新の版と一致している");
  });

  it("定数にも、データ（対応表・方針）にも、整形の出力にも、禁止語がない", () => {
    const all = [
      ...strings(messages),
      ...strings(REPORT_POLICY),
      ...strings(prepareReport(basePlan(), "new")),
      ...strings(new ManualGateway().prepare(basePlan({ inputs: {} }), "change")),
      ...(["reported_manual", "submitted_api", "failed", "unknown", "prepared", "retracted"] as const).flatMap((s) => [
        messages.reportStateLabel(s, "manual"),
        messages.reportStateLabel(s, "mock", true),
        messages.cancelStateLabel(s, true),
      ]),
      messages.externalStatusLabel("XYZ"),
      messages.deadlineUpcomingMessage(5),
    ].join("\n");
    for (const w of FORBIDDEN) expect(all, w).not.toContain(w);
  });

  it("記録が無いときの状況の文言に「通報済み」を含まない（記録の言い回しは記録があるときだけ）", () => {
    for (const code of ["no_record", "change_review", "cancel_needed", "unknown", "failed", "sending", "not_applicable_model", "cancelled"] as const) {
      expect(messages.REPORT_STATUS_LABEL[code], code).not.toContain("通報済み");
    }
    expect(messages.REPORT_STATUS_LABEL.reported).toContain("通報済み");
  });

  it("手続きの記録は「申請済み（利用者の申告）」で、「許可済み」とは出さない", () => {
    expect(messages.PROCEDURE_RECORD_DONE_LABEL.dips_permit).toBe("申請済み（利用者の申告）");
    expect(strings(messages).join("\n")).not.toContain("許可済み");
  });

  it("次にやることの表示名は動詞で終わる 1 行", () => {
    for (const label of Object.values(messages.NEXT_ACTION_LABEL)) {
      expect(label).not.toContain("\n");
      expect(label).toMatch(/する|直す|取り消す|記録する|申請する|通報する|変更する|確認する|やり直す|検討する（推奨）$/);
    }
  });

  it("どの出力にも法定の期限の日付・金額を作らない（目安は「社内の目安」と併記）", () => {
    expect(REPORT_POLICY.guideLeadHours).toBe(24);
    expect(messages.DEADLINE_GUIDE_DISCLAIMER).toContain("法定の期限ではありません");
    expect(REPORT_POLICY.penalty.uncheckedNote).toContain("※要確認");
    expect(JSON.stringify(REPORT_POLICY)).not.toMatch(/万円|円以下|\d+円/);
  });
});

describe("dips パッケージのソースにも禁止語がない", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(dir, { recursive: true, withFileTypes: false })
    .map(String)
    .filter((f) => /\.ts$/.test(f) && !/\.test\./.test(f) && !/fixture/.test(f) && !/test-fixtures/.test(f) && !/gateway-contract/.test(f));
  it("ソースを読む", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = readFileSync(path.join(dir, f), "utf8");
      for (const w of FORBIDDEN) expect(text, `${f}: ${w}`).not.toContain(w);
    }
  });
});
