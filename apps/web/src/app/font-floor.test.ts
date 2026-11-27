import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Sprint 16-B（K-2・B-1・B-2）：画面の文字の大きさの下限を、ファイルを読んで固定する。
//   - Tailwind の `text-xs`・`text-[10〜13px]`（rem なら 0.875rem 未満）が `apps/web/src` に 0
//   - CSS の font-size は 14px（0.875rem）以上。px の直書きは使わず rem（1rem = 16px。端末の文字の設定・200% に追随する）か var(--…)
//   - 旧層の --fs-aux・--text-aux は 14px（0.875rem）以上、--fs-body・--text-body は 16px（1rem）以上
// 例外は PDF の部品（*-pdf.tsx・pdf-*.tsx。紙の大きさで、Sprint 17 で扱う）。テストファイルも対象外。

const SRC = new URL("../", import.meta.url).pathname;
const FLOOR_PX = 14;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

const isPdf = (p: string) => /(^|\/)(pdf-[^/]*|[^/]*-pdf)\.tsx?$/.test(p);
const files = walk(SRC).filter((p) => !/\.test\.tsx?$/.test(p) && !isPdf(p));
const code = files.filter((p) => /\.(tsx|ts)$/.test(p));
const css = files.filter((p) => /\.css$/.test(p));
const rel = (p: string) => p.slice(SRC.length);
const stripCssComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

const toPx = (value: number, unit: string): number => (unit === "rem" ? value * 16 : value);

describe("K-2 文字の大きさの下限（14px）", () => {
  it("TSX・TS に text-xs がない", () => {
    const hits = code.filter((p) => /(^|[^\w-])text-xs(?![\w-])/.test(readFileSync(p, "utf8"))).map(rel);
    expect(hits).toEqual([]);
  });

  it("TSX・TS の text-[…px|rem] が 14px 未満でなく、px の指定でもない（rem にする）", () => {
    const small: string[] = [];
    const pxUsed: string[] = [];
    for (const p of code) {
      const s = readFileSync(p, "utf8");
      for (const m of s.matchAll(/text-\[(\d+(?:\.\d+)?)(px|rem)\]/g)) {
        if (toPx(Number(m[1]), m[2]!) < FLOOR_PX) small.push(`${rel(p)}: ${m[0]}`);
        if (m[2] === "px") pxUsed.push(`${rel(p)}: ${m[0]}`);
      }
    }
    expect(small).toEqual([]);
    expect(pxUsed).toEqual([]);
  });

  it("CSS の font-size は 14px 以上で、px の直書きがない（rem か var）", () => {
    const small: string[] = [];
    const pxUsed: string[] = [];
    for (const p of css) {
      const s = stripCssComments(readFileSync(p, "utf8"));
      for (const m of s.matchAll(/font-size:\s*(\d+(?:\.\d+)?)(px|rem)\b/g)) {
        if (toPx(Number(m[1]), m[2]!) < FLOOR_PX) small.push(`${rel(p)}: ${m[0]}`);
        if (m[2] === "px") pxUsed.push(`${rel(p)}: ${m[0]}`);
      }
      for (const m of s.matchAll(/font-size:\s*(?:max|min|clamp)\(([^;]*)\)/g)) {
        for (const n of m[1]!.matchAll(/(\d+(?:\.\d+)?)(px|rem)\b/g)) {
          if (toPx(Number(n[1]), n[2]!) < FLOOR_PX) small.push(`${rel(p)}: ${m[0]}`);
        }
      }
    }
    expect(small).toEqual([]);
    expect(pxUsed).toEqual([]);
  });

  it("文字の大きさのトークン（--sb-fs-*・旧層の --fs-*・--text-*）が下限を満たす", () => {
    const bad: string[] = [];
    for (const p of css) {
      const s = stripCssComments(readFileSync(p, "utf8"));
      for (const m of s.matchAll(/(--(?:sb-fs|fs|text)-(note|aux|body|table|state|h)):\s*(?:var\([^,)]+,\s*)?(\d+(?:\.\d+)?)(px|rem)/g)) {
        const kind = m[2]!;
        const px = toPx(Number(m[3]), m[4]!);
        const floor = kind === "body" ? 16 : kind === "h" ? 16 : FLOOR_PX;
        // 1024px 以上・現場の上書きも同じ下限
        if (px < floor) bad.push(`${rel(p)}: ${m[0]}`);
        if (m[4] === "px") bad.push(`${rel(p)}: ${m[0]}（px でなく rem）`);
      }
    }
    expect(bad).toEqual([]);
  });
});
