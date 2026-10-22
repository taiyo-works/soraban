// Sprint 12e 契約 16（単体・grep）：事故・ヒヤリハットの新しい画面のソースに、禁止語・数値の期限の表現・条番号・URL・
// 電話番号・メールアドレス・「※要確認」の直書き・外部への通信がない。固定の文言は lib/ops-incident.ts の定数を使い、画面で書き換えない。
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INCIDENT_FORBIDDEN, NUMERIC_DEADLINE } from "@/lib/incident-words.test-helpers";

const WEB_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const SCREEN_SOURCES = [
  path.join(WEB_SRC, "components", "ops", "incident-ui.tsx"),
  path.join(WEB_SRC, "components", "ops", "incident-client.tsx"),
  path.join(WEB_SRC, "components", "ops", "incident-quick-client.tsx"),
  path.join(WEB_SRC, "components", "ops", "incident-outbox.ts"),
  path.join(WEB_SRC, "lib", "incident-outbox.ts"),
  path.join(WEB_SRC, "server", "ops", "incident-page.ts"),
  ...walk(path.join(WEB_SRC, "app", "ops", "incidents")),
  path.join(WEB_SRC, "app", "ops", "plans", "[id]", "field", "incident", "page.tsx"),
];

describe("事故・ヒヤリハットの画面のソース（契約 16）", () => {
  it("禁止語・数値の期限・条番号・URL・電話番号・メールアドレス・「責任」・「※要確認」の直書きがない", () => {
    expect(SCREEN_SOURCES.length).toBeGreaterThanOrEqual(10);
    for (const f of SCREEN_SOURCES) {
      const text = readFileSync(f, "utf8");
      const rel = path.relative(WEB_SRC, f);
      for (const w of INCIDENT_FORBIDDEN) expect(text, `${rel}: ${w}`).not.toContain(w);
      expect(text, rel).not.toMatch(NUMERIC_DEADLINE);
      expect(text, rel).not.toMatch(/https?:\/\//);
      expect(text, rel).not.toMatch(/第[0-9０-９一二三四五六七八九十百]+条/);
      expect(text, rel).not.toMatch(/\b0\d{1,4}-\d{1,4}-\d{3,4}\b/);
      expect(text, rel).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(text, rel).not.toContain("責任");
      expect(text, rel).not.toContain("※要確認");
      // 固定の文言（G1・N1〜N7）を画面に直書きしない（定数を使う）
      expect(text, rel).not.toContain("けがをした人の救護と危険の防止");
      expect(text, rel).not.toContain("起きたことの事実を残すためのものです");
    }
  });

  it("外部への通信を足していない：fetch は送信待ちのモジュールだけで、送り先は自分のサーバーの API（相対パス）だけ", () => {
    for (const f of SCREEN_SOURCES) {
      const text = readFileSync(f, "utf8");
      const rel = path.relative(WEB_SRC, f);
      expect(text, rel).not.toMatch(/XMLHttpRequest|WebSocket|node:https?|from "undici"|sendBeacon/);
      if (rel === path.join("components", "ops", "incident-outbox.ts")) {
        expect(text).toContain('INCIDENTS_API = "/api/ops/incidents"');
        expect(text.match(/fetch\(/g)).toHaveLength(1);
        expect(text).toContain("fetch(INCIDENTS_API,");
      } else {
        expect(text, rel).not.toMatch(/\bfetch\(/);
      }
    }
  });
});
