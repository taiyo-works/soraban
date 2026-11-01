// Sprint 18-3 契約 3-1・3-2：提供元の定数が docs/provider-info.md の確認済みの値と一致し、未確認の項目を持たない。
// 値の直書きが lib/provider-info.ts 以外に無い（apps/web/src を検索）。
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROVIDER, PROVIDER_ROWS } from "./provider-info";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(SRC, "..", "..", "..");

/** docs/provider-info.md の最初の表（| 項目 | 内容 | 出典 |）を {項目: 内容} にする。 */
const readTable = (): Map<string, string> => {
  const text = readFileSync(path.join(ROOT, "docs", "provider-info.md"), "utf8");
  const rows = new Map<string, string>();
  let inTable = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("| 項目 | 内容 | 出典 |")) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.startsWith("|")) break;
    if (/^\|[-\s|]+\|$/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length >= 2) rows.set(cells[0]!, cells[1]!);
  }
  return rows;
};

describe("提供元の定数（契約 3-1）", () => {
  const t = readTable();
  it("確認済みの 6 項目が docs/provider-info.md の表の値と一致する", () => {
    expect(PROVIDER.name).toBe(t.get("正式名称"));
    expect(PROVIDER.postalCode).toBe(t.get("郵便番号"));
    expect(PROVIDER.address).toBe(t.get("所在地"));
    expect(PROVIDER.phone).toBe(t.get("電話番号"));
    expect(PROVIDER.representative).toBe(t.get("代表者"));
    expect(PROVIDER.email).toBe(t.get("問い合わせメール"));
    // 受付時間：表の値は「9:00〜17:00」。括弧の注記や曜日・祝日を含めない
    expect(PROVIDER.hours).toBe(t.get("受付時間"));
    expect(PROVIDER.hours).toBe("9:00〜17:00");
  });
  it("キーは 6 項目だけ。未確認の項目（曜日・祝日・ロゴ・事業者番号・法人番号・設立・色）のキーが無い", () => {
    expect(Object.keys(PROVIDER).sort()).toEqual(["address", "email", "hours", "name", "phone", "postalCode", "representative"].sort());
    for (const k of Object.keys(PROVIDER)) expect(k).not.toMatch(/holiday|weekday|logo|invoice|corporate|founded|color|colour/i);
  });
  it("表示の行は 名称・代表者・所在地・電話・メール・受付時間 の 6 行で、受付時間に曜日・祝日を示す語がない", () => {
    expect(PROVIDER_ROWS.map((r) => r.testId)).toEqual(["provider-name", "provider-representative", "provider-address", "provider-phone", "provider-email", "provider-hours"]);
    const hours = PROVIDER_ROWS.find((r) => r.key === "hours")!;
    expect(hours.value).not.toMatch(/平日|土日|祝|曜/);
    expect(PROVIDER_ROWS.find((r) => r.key === "location")!.value).toBe(`〒${PROVIDER.postalCode} ${PROVIDER.address}`);
  });
});

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n === ".next" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });

describe("提供元の値の直書きがない（契約 3-2）", () => {
  const files = walk(SRC).filter((f) => !/\.test\.tsx?$/.test(f) && !f.endsWith("test-helpers.ts") && !f.endsWith(`${path.sep}provider-info.ts`));
  const values: [string, string][] = [
    ["名称", PROVIDER.name],
    ["郵便番号", PROVIDER.postalCode],
    ["所在地", PROVIDER.address],
    ["電話", PROVIDER.phone],
    ["代表者", PROVIDER.representative],
    ["メール", PROVIDER.email],
    ["受付時間", PROVIDER.hours],
  ];
  it("画面・PDF・マニフェストのコードに、提供元の値が provider-info.ts 以外にない（コメントを除く）", () => {
    const hits: string[] = [];
    for (const f of files) {
      // コメント行（// と /* */ の中、JSX の {/* */}）は表示されないので除く
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n").replace(/\/\/.*$/gm, "");
      for (const [label, v] of values) if (code.includes(v)) hits.push(`${path.relative(SRC, f)}: ${label}「${v}」`);
    }
    expect(hits).toEqual([]);
  });
});
