// Sprint 12b 契約 7・12・15：有効な通報（effectiveReport）と通報の状況（reportStatus）。
import { describe, expect, it } from "vitest";
import { REPORT_STATUS_LABEL } from "./messages";
import { cancelGeneration, effectiveReport, latestLiveReport, reportStatus, timeKey, type ReportRowLite } from "./status";
import { REPORT_KINDS, REPORT_STATES, type ReportKind, type ReportState, type RequirementKind } from "./types";

const T0 = Date.parse("2027-01-05T03:00:00Z");
const row = (i: number, kind: ReportKind, status: ReportState, over: Partial<ReportRowLite> = {}): ReportRowLite => ({
  id: `r${String(i).padStart(3, "0")}`,
  kind,
  status,
  channel: status === "reported_manual" || status === "retracted" ? "manual" : "mock",
  createdAt: new Date(T0 + i * 1000),
  updatedAt: new Date(T0 + i * 1000),
  fingerprint: "fp-1",
  reportedAt: "2027-01-05T11:30",
  dipsNumber: `N${i}`,
  ...over,
});

const COMPLETED: ReportState[] = ["reported_manual", "submitted_api"];

/** 参照実装：行を順に見て、完了した新規・変更で有効な通報が替わり、完了した取消で無くなる。 */
const oracle = (rows: readonly ReportRowLite[]): string | null => {
  let active: string | null = null;
  for (const r of rows) {
    if (!COMPLETED.includes(r.status)) continue;
    active = r.kind === "cancel" ? null : r.id;
  }
  return active;
};

describe("effectiveReport", () => {
  it("行なしは無し", () => {
    expect(effectiveReport([])).toBeNull();
  });

  it("新規・変更・取消の完了と、取り下げ・失敗・結果不明・準備中の全組合せ（長さ 3 まで）で参照実装と一致する", () => {
    const cells = REPORT_KINDS.flatMap((k) => REPORT_STATES.map((s) => [k, s] as const));
    expect(cells).toHaveLength(18);
    let n = 0;
    const seqs: (readonly (readonly [ReportKind, ReportState])[])[] = [[]];
    for (const a of cells) {
      seqs.push([a]);
      for (const b of cells) {
        seqs.push([a, b]);
        for (const c of cells) seqs.push([a, b, c]);
      }
    }
    for (const seq of seqs) {
      const rows = seq.map(([k, s], i) => row(i, k, s));
      expect(effectiveReport(rows)?.id ?? null, seq.map((x) => x.join(":")).join(" > ")).toBe(oracle(rows));
      // 行の並び（配列の順）に依らない
      expect(effectiveReport([...rows].reverse())?.id ?? null).toBe(oracle(rows));
      n++;
    }
    expect(n).toBe(1 + 18 + 18 ** 2 + 18 ** 3);
  });

  it("代表的な流れ", () => {
    const A = row(1, "new", "reported_manual");
    const B = row(2, "change", "reported_manual");
    const C = row(3, "cancel", "reported_manual");
    const D = row(4, "new", "reported_manual");
    expect(effectiveReport([A])?.id).toBe("r001");
    expect(effectiveReport([A, B])?.id).toBe("r002");
    expect(effectiveReport([A, B, C])).toBeNull();
    expect(effectiveReport([A, B, C, D])?.id).toBe("r004");
    // 変更を取り下げると、前の通報が有効に戻る
    expect(effectiveReport([A, { ...B, status: "retracted" }])?.id).toBe("r001");
    // 取消を取り下げると、通報が有効に戻る
    expect(effectiveReport([A, B, { ...C, status: "retracted" }])?.id).toBe("r002");
    // 失敗・結果不明・準備中の新規は有効にならない
    for (const s of ["failed", "unknown", "prepared"] as const) expect(effectiveReport([row(1, "new", s)]), s).toBeNull();
    // 模擬の送信済みも有効（submitted_api）
    expect(effectiveReport([row(1, "new", "submitted_api")])?.id).toBe("r001");
    // 取消の送信が失敗しても、通報は有効のまま
    expect(effectiveReport([A, row(2, "cancel", "failed")])?.id).toBe("r001");
  });

  it("マイクロ秒の差・同時刻（ID の順）でも順序が決まる", () => {
    const a = row(1, "new", "reported_manual", { createdAt: "2027-01-05T03:00:00.000100Z" });
    const c = row(2, "cancel", "reported_manual", { createdAt: "2027-01-05T03:00:00.000200Z" });
    expect(effectiveReport([a, c])).toBeNull();
    expect(effectiveReport([{ ...a, createdAt: "2027-01-05T03:00:00.000300Z" }, c])?.id).toBe("r001");
    // ミリ秒までの Date と、マイクロ秒の文字列を混ぜても正しく並ぶ
    expect(timeKey(new Date("2027-01-05T03:00:00.123Z"))).toBe("2027-01-05T03:00:00.123000Z");
    expect(timeKey("2027-01-05T03:00:00.12Z")).toBe("2027-01-05T03:00:00.120000Z");
    expect(timeKey("2027-01-05T03:00:00Z")).toBe("2027-01-05T03:00:00.000000Z");
    expect(timeKey("2027-01-05T12:00:00.000001+09:00")).toBe("2027-01-05T03:00:00.000000Z");
  });

  it("完了した取消の件数（世代）。取り下げ・失敗した取消は数えない", () => {
    expect(cancelGeneration([])).toBe(0);
    expect(
      cancelGeneration([
        row(1, "new", "reported_manual"),
        row(2, "cancel", "reported_manual"),
        row(3, "new", "reported_manual"),
        row(4, "cancel", "retracted"),
        row(5, "cancel", "failed"),
        row(6, "cancel", "submitted_api"),
      ]),
    ).toBe(2);
  });

  it("latestLiveReport は取り下げた行を除いた最新", () => {
    expect(latestLiveReport([row(1, "new", "reported_manual"), row(2, "change", "retracted")])?.id).toBe("r001");
    expect(latestLiveReport([row(1, "new", "retracted")])).toBeNull();
  });
});

describe("reportStatus", () => {
  const NOW = new Date(T0 + 3600 * 1000);
  const st = (
    rows: ReportRowLite[],
    over: { requirementKind?: RequirementKind; currentFingerprint?: string; planVoided?: boolean; now?: Date } = {},
  ) =>
    reportStatus({
      requirementKind: "required",
      rows,
      currentFingerprint: "fp-1",
      planVoided: false,
      now: NOW,
      ...over,
    });

  it("記録がなければ「記録なし」（要・要確認・推奨のいずれでも「通報済み」と出さない）", () => {
    for (const k of ["required", "confirm", "recommended"] as const) {
      const s = st([], { requirementKind: k });
      expect(s.code).toBe("no_record");
      expect(s.label).toBe("通報の記録がありません");
      expect(s.label).not.toContain("通報済み");
      expect(s.needsAttention).toBe(true);
    }
  });

  it("模型航空機は対象外", () => {
    const s = st([row(1, "new", "reported_manual")], { requirementKind: "not_applicable_model" });
    expect(s.code).toBe("not_applicable_model");
    expect(s.label).toBe(REPORT_STATUS_LABEL.not_applicable_model);
    expect(s.needsAttention).toBe(false);
  });

  it("有効な通報があり指紋が一致：通報済み（手動記録）。日時・番号を併記", () => {
    const s = st([row(1, "new", "reported_manual")]);
    expect(s.code).toBe("reported");
    expect(s.label).toBe("DIPS で通報済み（利用者の申告・手動記録）：2027-01-05 11:30・番号 N1");
    expect(s.detail).toBe("2027-01-05 11:30・番号 N1");
    expect(s.effectiveId).toBe("r001");
    expect(s.needsAttention).toBe(false);
  });

  it("番号なしの宣言は「番号なし（表示されなかった）」と併記する", () => {
    const s = st([row(1, "new", "reported_manual", { dipsNumber: null, numberUnavailable: true })]);
    expect(s.detail).toBe("2027-01-05 11:30・番号なし（表示されなかった）");
  });

  it("模擬の送信済みは「送信済み（模擬・開発用）」で、手動の言い回しにならない", () => {
    const s = st([row(1, "new", "submitted_api")]);
    expect(s.code).toBe("reported");
    expect(s.label).toContain("送信済み（模擬・開発用）");
    expect(s.label).not.toContain("利用者の申告");
  });

  it("指紋が変わった：変更通報の要否を確認", () => {
    const s = st([row(1, "new", "reported_manual")], { currentFingerprint: "fp-2" });
    expect(s.code).toBe("change_review");
    expect(s.label).toContain("計画が通報時から変わっています");
    expect(s.needsAttention).toBe(true);
  });

  it("変更通報を記録すると、新しい指紋で通報済みに戻る", () => {
    const rows = [row(1, "new", "reported_manual"), row(2, "change", "reported_manual", { fingerprint: "fp-2" })];
    expect(st(rows, { currentFingerprint: "fp-2" }).code).toBe("reported");
    expect(st(rows, { currentFingerprint: "fp-1" }).code).toBe("change_review");
  });

  it("計画が中止された：取消が必要（指紋の違いより優先）", () => {
    const s = st([row(1, "new", "reported_manual")], { planVoided: true, currentFingerprint: "fp-2" });
    expect(s.code).toBe("cancel_needed");
    expect(s.label).toContain("DIPS で通報を取り消し");
  });

  it("最新が完了した取消：取消済み。取消のあとに新規を記録すると通報済み", () => {
    const rows = [row(1, "new", "reported_manual"), row(2, "cancel", "reported_manual")];
    expect(st(rows, { planVoided: true }).code).toBe("cancelled");
    expect(st([...rows, row(3, "new", "reported_manual")]).code).toBe("reported");
  });

  it("結果不明・失敗・送信中", () => {
    expect(st([row(1, "new", "unknown")]).code).toBe("unknown");
    expect(st([row(1, "new", "failed")]).code).toBe("failed");
    expect(st([row(1, "new", "failed")]).label).toBe("失敗しました。再送できます");
    // 準備中：5 分以内は送信中、超えたら結果不明（自動で再送しない）
    const prepared = row(1, "new", "prepared", { updatedAt: new Date(NOW.getTime() - 60 * 1000) });
    expect(st([prepared]).code).toBe("sending");
    const stale = row(1, "new", "prepared", { updatedAt: new Date(NOW.getTime() - 6 * 60 * 1000) });
    expect(st([stale]).code).toBe("unknown");
    expect(st([stale]).label).toContain("途中で止まった可能性");
  });

  it("通報済みのあとに、変更の送信が結果不明になったら「結果不明」を優先する（二重通報を避ける）", () => {
    const rows = [row(1, "new", "reported_manual"), row(2, "change", "unknown", { fingerprint: "fp-2" })];
    expect(st(rows, { currentFingerprint: "fp-2" }).code).toBe("unknown");
  });

  it("取り下げた行は無いものとして扱う", () => {
    expect(st([row(1, "new", "retracted")]).code).toBe("no_record");
    expect(st([row(1, "new", "reported_manual"), row(2, "change", "retracted", { fingerprint: "fp-2" })]).code).toBe("reported");
  });

  it("記録（reported_manual・submitted_api）が無いうちは、どの状況の文言にも「通報済み」が出ない", () => {
    const sets: ReportRowLite[][] = [
      [],
      [row(1, "new", "failed")],
      [row(1, "new", "unknown")],
      [row(1, "new", "prepared")],
      [row(1, "new", "retracted")],
    ];
    for (const rows of sets) {
      for (const k of ["required", "confirm", "recommended"] as const) {
        const s = st(rows, { requirementKind: k });
        expect(s.label, `${rows.map((r) => r.status)} ${k}`).not.toContain("通報済み");
        expect(s.detail).toBeNull();
      }
    }
  });
});
