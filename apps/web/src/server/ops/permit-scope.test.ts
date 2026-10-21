// Sprint 12d 契約 17（grep）：登録・照合の新しいファイルは、DIPS・FPA・外部への通信を足していない（自分のサーバーの DB だけ）。
// 禁止語・条番号の直書きは sprint11g.test.ts が apps/web/src 全体を走査して確かめる（新しいファイルもその対象）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = new URL("./", import.meta.url).pathname;
const FILES = ["permit-logic.ts", "permit-match.ts", "permits.ts", "validate-permit.ts"];

describe("許可・承認の登録のコードは外部に通信しない", () => {
  for (const f of FILES) {
    it(`${f}：fetch・http・WebSocket・DIPS の送信口を使わない`, () => {
      const src = readFileSync(join(DIR, f), "utf8");
      expect(src).not.toMatch(/\bfetch\s*\(|node:https?|XMLHttpRequest|WebSocket|axios|undici/);
      expect(src).not.toMatch(/from\s+["']@soraban\/dips["']/);
      expect(src).not.toMatch(/NotificationGateway|DIPS_REPORT_ADAPTER|runJudge|regulation-check/);
    });
  }

  it("照合の純粋関数は DB・時計に触れない（permit-logic.ts は store・Date.now・new Date() を使わない）", () => {
    const src = readFileSync(join(DIR, "permit-logic.ts"), "utf8");
    expect(src).not.toMatch(/\.\/store|Date\.now\(|new Date\(\)|process\.env/);
  });
});
