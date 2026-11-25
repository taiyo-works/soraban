import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VERDICT_HELP, type FlightVerdict, type VerdictLevel } from "@soraban/regulations";
import { describe, expect, it } from "vitest";
import { tidyEngineText } from "@/lib/field-message";
import { hidesVerdictHelp } from "@/lib/verdict-display";
import { VerdictSummary } from "./verdict-summary";
import { PdfVerdictConclusion } from "./pdf-verdict";

// 16-N1（Q-L29）：判定不能を含む、または総合が unknown のとき、結論の下の説明（VERDICT_HELP）を描かない。
// 判定不能を含まないときは今のまま。画面（VerdictSummary）と判定の PDF（PdfVerdictConclusion）で同じ。

const item = (verdict: string) => ({ id: `i-${verdict}`, kind: "regulation", verdict }) as unknown as FlightVerdict["items"][number];
const mk = (level: VerdictLevel, verdicts: readonly string[], unknownCount?: number): FlightVerdict =>
  ({
    level,
    unknownCount: unknownCount ?? verdicts.filter((v) => v === "unknown").length,
    items: verdicts.map(item),
    noFly: [],
    procedures: [],
    done: [],
    perFlightDuties: [],
    permits: [],
  }) as FlightVerdict;

const screen = (verdict: FlightVerdict, totalKey?: string): string =>
  renderToStaticMarkup(
    createElement(VerdictSummary, {
      verdict,
      pending: false,
      part: "conclusion",
      ...(totalKey
        ? { total: { key: totalKey, sign: "unknown", text: "総合", stale: false, count: 0 } as never }
        : {}),
    }),
  );

const texts = (n: ReactNode, out: string[] = []): string[] => {
  if (typeof n === "string") out.push(n);
  else if (Array.isArray(n)) n.forEach((c) => texts(c, out));
  else if (isValidElement(n)) texts((n.props as { children?: ReactNode }).children, out);
  return out;
};
const pdf = (verdict: FlightVerdict): string => texts(PdfVerdictConclusion({ verdict })).join("");

const help = (l: VerdictLevel): string => tidyEngineText(VERDICT_HELP[l]);
const cases: ReadonlyArray<[string, FlightVerdict, string | undefined, boolean]> = [
  ["判定不能 1 件＋要手続き", mk("needs_procedure", ["needs_procedure", "unknown"]), undefined, true],
  ["判定不能だけ", mk("needs_procedure", ["unknown"]), undefined, true],
  ["項目 0 件（総合 unknown）", mk("needs_procedure", [], 0), "unknown", true],
  ["項目 0 件（total なし。PDF・スナップショット）", mk("needs_procedure", [], 0), undefined, true],
  ["過去の判定（total なし）で unknownCount>0", mk("needs_procedure", ["needs_procedure"], 1), undefined, true],
  ["no_fly", mk("no_fly", ["no_fly"]), undefined, false],
  ["needs_procedure（判定不能なし）", mk("needs_procedure", ["needs_procedure"]), "needs_procedure", false],
  ["procedure_done", mk("procedure_done", ["procedure_done"]), undefined, false],
  ["no_procedure", mk("no_procedure", ["no_procedure"]), undefined, false],
];

describe("16-N1 判定不能のときの説明文", () => {
  for (const [name, v, tk, hidden] of cases) {
    it(`画面：${name}`, () => {
      const h = screen(v, tk);
      expect(hidesVerdictHelp(v, tk)).toBe(hidden);
      if (hidden) {
        expect(h).not.toContain(help(v.level));
        expect(h).not.toContain(help("needs_procedure"));
        expect(h).not.toContain("飛べ");
      } else {
        expect(h).toContain(help(v.level));
      }
    });
    it(`PDF：${name}`, () => {
      const t = pdf(v);
      if (hidden) {
        expect(t).not.toContain("飛べ");
        expect(t).not.toContain(help(v.level).replace(/\s/g, ""));
      } else expect(t).toContain(help(v.level).replace(/\s/g, ""));
    });
  }
});
