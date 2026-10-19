// 手書きの行型（types.ts）の列名が、マイグレーションの create table・alter table と一致することを確かめる。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OPS_TABLES, TABLE_COLUMNS } from "./types";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, "");

// 括弧の深さを見て、最上位のカンマで分割する。
const splitTopLevel = (body: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
};

const CONSTRAINT_WORDS = new Set(["constraint", "primary", "unique", "check", "foreign", "exclude"]);

/** マイグレーションを番号順に読み、表ごとの列名（宣言順）を返す。 */
const columnsFromMigrations = (sqls: readonly string[]): Map<string, string[]> => {
  const tables = new Map<string, string[]>();
  for (const raw of sqls) {
    const sql = stripComments(raw);
    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = createRe.exec(sql))) {
      // 対応する閉じ括弧までを本体とする。
      let depth = 1;
      let i = createRe.lastIndex;
      for (; i < sql.length && depth > 0; i++) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")") depth--;
      }
      const body = sql.slice(createRe.lastIndex, i - 1);
      const cols = splitTopLevel(body)
        .map((item) => item.trim().split(/\s+/)[0]!.toLowerCase())
        .filter((w) => w && !CONSTRAINT_WORDS.has(w));
      tables.set(m[1]!.toLowerCase(), cols);
    }
    const alterRe =
      /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?(\w+)\s+(add|drop)\s+column\s+(?:if\s+(?:not\s+)?exists\s+)?(\w+)/gi;
    while ((m = alterRe.exec(sql))) {
      const t = m[1]!.toLowerCase();
      const cols = tables.get(t) ?? [];
      const col = m[3]!.toLowerCase();
      if (m[2]!.toLowerCase() === "add") cols.push(col);
      else cols.splice(cols.indexOf(col), 1);
      tables.set(t, cols);
    }
  }
  return tables;
};

const migrationSqls = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"));

describe("行型とマイグレーションの列名", () => {
  const fromSql = columnsFromMigrations(migrationSqls);

  for (const [table, cols] of Object.entries(TABLE_COLUMNS)) {
    it(`${table} の列名が一致する`, () => {
      expect(fromSql.has(table)).toBe(true);
      expect([...cols].sort()).toEqual([...(fromSql.get(table) ?? [])].sort());
    });
  }

  it("evidence_log に 0003 で datasets が追加されている", () => {
    expect(fromSql.get("evidence_log")).toContain("datasets");
  });

  // Sprint 10 契約 19：運航管理の表に、保存しない個人情報（生年月日・住所・電話・画像・マイナンバー）に当たる列がない。
  // 判定の証跡（evidence_log.resolved_address：判定地点の住所）は利用者の個人情報ではないため対象外。
  // Sprint 11 契約 20：加えて、位置の連続した軌跡（track）・端末の識別子（device）に当たる列もない。
  it("運航管理の表に、生年月日・住所・電話・画像・マイナンバー・軌跡・端末の識別子に当たる列がない", () => {
    const forbidden = /birth|address|phone|tel|image|photo|avatar|my_?number|track|device/i;
    for (const table of OPS_TABLES) {
      const cols = fromSql.get(table);
      expect(cols, table).toBeDefined();
      for (const c of cols ?? []) expect(c, `${table}.${c}`).not.toMatch(forbidden);
    }
    // 運航管理のマイグレーション（0004 以降）の本文全体にも、禁止語の列を作る記述がない。
    const opsSql = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql") && Number(f.slice(0, 4)) >= 4)
      .map((f) => stripComments(readFileSync(path.join(MIGRATIONS, f), "utf8")))
      .join("\n");
    expect(opsSql).not.toMatch(
      /\b\w*(birth|address|phone|image|photo|avatar|my_?number|track|device)\w*\s+(text|date|bytea|varchar|integer|jsonb|numeric|uuid|boolean|timestamptz)/i,
    );
  });

  it("パーサーは制約行を列として数えない", () => {
    const t = columnsFromMigrations([
      "create table x (a int, b numeric(10, 2), constraint c check (a > 0), primary key (a)); alter table x add column c text;",
    ]);
    expect(t.get("x")).toEqual(["a", "b", "c"]);
  });
});
