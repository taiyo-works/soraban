// Sprint 12g C8: new wording (labels, legends, (i) text, empty states, toasts) has no banned words, no blaming words and
// no patent/application wording. Scans the design-system sources and the catalog.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INCIDENT_FORBIDDEN } from "@/lib/incident-words.test-helpers";

const WEB_SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

const FILES = [
  ...walk(path.join(WEB_SRC, "components", "ui")),
  ...walk(path.join(WEB_SRC, "app", "ops", "design")),
  path.join(WEB_SRC, "lib", "design-catalog.ts"),
  path.join(WEB_SRC, "components", "ops", "ops-frame.tsx"),
].filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

// Parts are joined so this file does not match its own grep (and the repo-wide grep in sprint11g.test.ts).
const EXTRA = [
  ["飛行", "可能"],
  ["通報", "不要"],
  ["通報は", "不要"],
  ["通報の必要", "はありません"],
  ["通報", "しなくて"],
  ["要確認・", "要許可"],
  ["おおむね", "300m"],
].map((p) => p.join(""));
const NUMERIC_DEADLINE = /[0-9０-９]+\s*(日以内|時間以内|営業日|開庁日)/;

describe("新しい文言の禁止語（C8）", () => {
  it("対象のファイルがある", () => {
    expect(FILES.length).toBeGreaterThan(12);
  });
  it("12a〜12e の禁止語・責める語・特許・出願の表示・数値の期限の表現がない", () => {
    for (const f of FILES) {
      const text = readFileSync(f, "utf8");
      for (const w of [...INCIDENT_FORBIDDEN, ...EXTRA]) expect(text, `${path.relative(WEB_SRC, f)}: ${w}`).not.toContain(w);
      expect(text, path.relative(WEB_SRC, f)).not.toMatch(NUMERIC_DEADLINE);
    }
  });
});
