// Sprint 18-3 契約 3-9・§6.5：禁止語・限定語の単体の走査。画面に出る定数の文字列を、E2E の走査と同じ規則（lib/wording-policy.ts）で検査する。
// 判定エンジン（packages/regulations の verdict・index・procedures.json など）は対象外（sprint-18.md §4.6：判定の領域の印の中は E2E で扱う）。
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as DIPS from "@soraban/dips";
import { PLAN_JUDGEMENT_DISCLAIMER, REPORT_FIXED_NOTE } from "@soraban/regulations";
import { describe, expect, it } from "vitest";
import * as BOUNDARY from "./boundary";
import * as DISCLAIMERS from "./disclaimers";
import { PROVIDER } from "./provider-info";
import * as PROVIDER_MOD from "./provider-info";
import * as INCIDENT from "./ops-incident";
import * as OPS_FIELD from "./ops-field";
import * as PLAN_MAIN from "./plan-main";
import * as VERDICT_DISPLAY from "./verdict-display";
import { pwaManifest } from "./pwa";
import { LICENSE_RENEWAL_LABEL } from "../server/ops/license";
import { LICENSE_STATUS_LABEL } from "../server/ops/deadlines-logic";
import {
  ALLOWED_SENTENCES,
  FORBIDDEN_ALL_WORDS,
  LIMITED_WORDS,
  OFFICIAL_PROCEDURE_NOTE_TEXT,
  OLD_NAMES,
  SCOPE_ALLOWED_TESTIDS,
  JUDGEMENT_OWN_HEADINGS,
  PLACEHOLDER_WORDS,
  classifyLimited,
  findForbidden,
  findLimited,
} from "./wording-policy";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(SRC, "..", "..", "..");

/** オブジェクトの中の文字列を、パスつきで集める（関数・数値は無視）。 */
const strings = (v: unknown, p: string, out: [string, string][] = []): [string, string][] => {
  if (typeof v === "string") out.push([p, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${p}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) strings(x, `${p}.${k}`, out);
  return out;
};

/**
 * 申請支援のフラグ（APPLICATION_SUPPORT_ENABLED）が有効なときだけ画面に出る表示。無効（既定・本番）では出ない（Sprint 18-2）。
 * ここだけ限定語の検査から外す。増やすときは理由を書く。
 */
const FLAG_ENABLED_ONLY: readonly string[] = [
  "dips.PROCEDURE_RECORD_KIND_LABEL.dips_permit",
  "dips.PROCEDURE_RECORD_DONE_LABEL.dips_permit",
  "dips.PROCEDURE_CHECK_LABEL.applicationCompleted",
  "dips.NEXT_ACTION_LABEL.apply_permit",
];

/**
 * 判定の領域の印（data-wording-scope="judgement"）の中にだけ出る、判定の見出し。限定語の検査から外す（印の中は検査しない：sprint-18.md §6.1）。
 * 判定エンジン由来の文言と同じ扱いで、docs/legal/screen-wording-inventory.md に記録する。
 */
const JUDGEMENT_SCOPE_ONLY: readonly string[] = ["verdict-display.VERDICT_SECTION_TITLE.duties"];

const collected = (): [string, string][] => {
  const all: [string, string][] = [];
  strings(DIPS, "dips", all);
  strings(BOUNDARY, "boundary", all);
  strings(DISCLAIMERS, "disclaimers", all);
  strings(PROVIDER_MOD, "provider", all);
  strings(INCIDENT, "incident", all);
  strings(OPS_FIELD, "ops-field", all);
  strings(PLAN_MAIN, "plan-main", all);
  strings(VERDICT_DISPLAY, "verdict-display", all);
  strings(LICENSE_RENEWAL_LABEL, "license.LICENSE_RENEWAL_LABEL", all);
  strings(LICENSE_STATUS_LABEL, "deadlines.LICENSE_STATUS_LABEL", all);
  strings({ PLAN_JUDGEMENT_DISCLAIMER, REPORT_FIXED_NOTE }, "regulations", all);
  strings(pwaManifest(), "manifest", all);
  return all;
};

describe("語の一覧（lib/wording-policy.ts）", () => {
  it("限定語は 申請・保証・必ず。許可リストの各文は、その限定語を含み、出どころが書いてある", () => {
    expect([...LIMITED_WORDS]).toEqual(["申請", "保証", "必ず"]);
    for (const a of ALLOWED_SENTENCES) {
      expect(a.sentence, a.source).toContain(a.word);
      expect(a.source.length).toBeGreaterThan(0);
    }
  });
  it("公式の手続きの文は packages/dips の OFFICIAL_PROCEDURE_NOTE と同じ", () => {
    expect(OFFICIAL_PROCEDURE_NOTE_TEXT).toBe(DIPS.OFFICIAL_PROCEDURE_NOTE);
  });
  it("許可リストの文が、ソースの定数・凡例の文に実在する（定数が変わったら許可リストも直す）", () => {
    expect(BOUNDARY.BOUNDARY_SHORT).toBe(ALLOWED_SENTENCES.find((a) => a.source.includes("BOUNDARY_SHORT"))!.sentence);
    expect(DISCLAIMERS.DISCLAIMER_JUDGEMENT).toContain("制度の最新性・正確性は保証しません");
    expect(INCIDENT.INCIDENT_GUIDANCE_NOTICE_BASE).toContain("報告が必要かどうかを判断するものでも、保証するものでもありません");
    // 16-N2：地図の凡例の注記の「必ず」は表示の側で外す（tidyEngineText）ので、許可リストに文はない。描く側が整えていることを確かめる
    expect(ALLOWED_SENTENCES.filter((a) => a.word === "必ず")).toEqual([]);
    const map = readFileSync(path.join(SRC, "components", "regulation-map.tsx"), "utf8");
    expect(map).toMatch(/tidyEngineText\(n\.note\)/);
    expect(map).toMatch(/tidyEngineText\(z\.note\)/);
  });
  it("検査の関数：全面禁止語は許可リストの文の中でも検出し、限定語は許可リストの文の外だけ検出する", () => {
    expect(findForbidden("この計画は問題ありません").map((h) => h.word)).toEqual(["問題ありません"]);
    expect(findForbidden("申請の代行はしません").map((h) => h.word)).toEqual(["代行"]);
    expect(findForbidden(BOUNDARY.BOUNDARY_FULL)).toEqual([]);
    expect(findLimited(`${BOUNDARY.BOUNDARY_SHORT} ${DISCLAIMERS.DISCLAIMER_JUDGEMENT}`)).toEqual([]);
    expect(findLimited("許可を申請します").map((h) => h.word)).toEqual(["申請"]);
    expect(findLimited("必ず確認").map((h) => h.word)).toEqual(["必ず"]);
    expect(findLimited("必ず確認").map((h) => h.context)).toEqual(["必ず確認"]);
  });
  it("classifyLimited：許可リストの文の中の出現は allowed、外は other（joined から 1 文を取る）", () => {
    const text = `許可を申請します${BOUNDARY.BOUNDARY_SHORT}`;
    const joined = `許可を申請します\n${BOUNDARY.BOUNDARY_SHORT}`;
    const r = classifyLimited(text, joined);
    expect(r.filter((x) => x.kind === "other").map((x) => [x.word, x.sentence])).toEqual([["申請", "許可を申請します"]]);
    expect(r.filter((x) => x.kind === "allowed").every((x) => x.sentence === BOUNDARY.BOUNDARY_SHORT)).toBe(true);
    expect(r.filter((x) => x.kind === "allowed").length).toBe(2);
  });
  it("全面禁止語に 代行・代理・問題ありません・大丈夫 が入っている（契約 §6.1）", () => {
    for (const w of ["代行", "代理", "問題なし", "問題ありません", "大丈夫", "完璧", "通報不要", "保証します"]) expect(FORBIDDEN_ALL_WORDS).toContain(w);
  });
});

describe("判定の領域の印（契約 §6.1）", () => {
  it("印（data-wording-scope=\"judgement\"）を付けた箇所は、許可された 6 か所だけ（コードの検索）", () => {
    const files = walk(SRC).filter((f) => /\.tsx$/.test(f) && !isTest(f));
    const found: string[] = [];
    for (const f of files) {
      const t = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      for (const m of t.matchAll(/data-wording-scope="judgement"/g)) found.push(`${path.relative(SRC, f)}@${m.index}`);
    }
    expect(found.length).toBe(6);
    expect(SCOPE_ALLOWED_TESTIDS.length).toBe(6);
  });
  it("自前の見出しは verdict-display の VERDICT_SECTION_TITLE.duties と同じ", () => {
    expect(JUDGEMENT_OWN_HEADINGS).toContain(VERDICT_DISPLAY.VERDICT_SECTION_TITLE.duties);
  });
});

describe("定数の走査（契約 3-9・§6.5）", () => {
  const all = collected();
  it("走査の対象が空でない（import の取りこぼしを防ぐ）", () => {
    expect(all.length).toBeGreaterThan(150);
    for (const needle of ["boundary.BOUNDARY_FULL", "dips.NEXT_ACTION_LABEL.register_permit", "manifest.description", "disclaimers.DISCLAIMER_INSPECTION"]) {
      expect(all.map(([p]) => p), needle).toContain(needle);
    }
  });
  it("全面禁止語が 0 件", () => {
    const hits = all.flatMap(([p, s]) => findForbidden(s).map((h) => `${p}: 「${h.word}」…${h.context}…`));
    expect(hits).toEqual([]);
  });
  it("限定語が許可リストの文の外に 0 件（フラグ有効のときだけ出る表示を除く）", () => {
    const hits = all
      .filter(([p]) => !FLAG_ENABLED_ONLY.includes(p) && !JUDGEMENT_SCOPE_ONLY.includes(p))
      .flatMap(([p, s]) => findLimited(s).map((h) => `${p}: 「${h.word}」…${h.context}…`));
    expect(hits).toEqual([]);
  });
  it("フラグ有効のときだけ出る表示の除外は、実在するキーだけ（古い除外が残らない）", () => {
    const paths = all.map(([p]) => p);
    for (const k of [...FLAG_ENABLED_ONLY, ...JUDGEMENT_SCOPE_ONLY]) expect(paths, k).toContain(k);
  });
  it("提供元・境界・免責・マニフェストに、載せない語（未定・準備中・TBD・要記入・xxx・ダミー・example・法人番号・適格請求書）がない", () => {
    const targets = all.filter(([p]) => /^(provider|boundary|disclaimers|manifest)\./.test(p));
    const hits = targets.flatMap(([p, s]) => hitsOf(p, s, PLACEHOLDER_WORDS));
    expect(hits).toEqual([]);
  });
  it("マニフェスト・提供元の文に、受付の曜日・祝日を示す語が受付時間の近く（30 文字以内）にない", () => {
    const text = `${PROVIDER.hours} ${pwaManifest().description}`;
    expect(text).not.toMatch(/(平日|土日|祝日|曜日)/);
  });
});

const hitsOf = (p: string, s: string, words: readonly string[]): string[] => words.filter((w) => s.includes(w)).map((w) => `${p}: 「${w}」`);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n === ".next" ? [] : walk(p);
    return [p];
  });
const isTest = (f: string): boolean => /(\.test\.tsx?|test-helpers\.ts|\.spec\.ts)$/.test(f);

describe("旧名称・メールアドレス（契約 3-9）", () => {
  // 旧名称の一覧そのもの（lib/wording-policy.ts）は除く
  const srcFiles = walk(SRC).filter((f) => /\.(ts|tsx|css|json|md)$/.test(f) && !isTest(f) && !f.endsWith(`${path.sep}wording-policy.ts`));
  const publicDir = path.resolve(SRC, "..", "public");
  const publicFiles = walk(publicDir).filter((f) => /\.(js|json|html|txt|webmanifest|svg|css)$/.test(f));
  it("旧名称（AIさんいん・タイヨー通信群・メルドカルタ）が apps/web/src（テストを除く）と apps/web/public に 0 件", () => {
    const hits: string[] = [];
    for (const f of [...srcFiles, ...publicFiles]) {
      const t = readFileSync(f, "utf8");
      for (const w of OLD_NAMES) if (t.includes(w)) hits.push(`${path.relative(SRC, f)}: ${w}`);
    }
    expect(hits).toEqual([]);
  });
  it("メールアドレスの形の文字列は info@futuretec-jp.com だけ（テスト・フィクスチャを除く）", () => {
    const hits: string[] = [];
    for (const f of srcFiles) {
      const t = readFileSync(f, "utf8");
      for (const m of t.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
        if (m[0] === PROVIDER.email) continue;
        // npm のパッケージ名（@soraban/web など）はメールではない：スコープ名の形は @ が先頭なので上の正規表現に当たらない
        hits.push(`${path.relative(SRC, f)}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("シード・フィクスチャの文字列（契約 §6.2：モックのデータを走査の対象にしない）", () => {
  it("db:seed:ops-test のシードと E2E のフィクスチャの文字列に、全面禁止語・限定語がない", () => {
    const files = [path.join(ROOT, "packages", "db", "src", "ops-seed.ts")];
    for (const f of files) {
      const t = readFileSync(f, "utf8");
      // コメントを除く（seed の説明に「申請」が出ても画面に出ない）。文字列リテラルだけを見る
      const literals = [...t.matchAll(/"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g)].map((m) => m[1] ?? m[2] ?? "");
      const hits = literals.flatMap((s) => [...findForbidden(s), ...findLimited(s)].map((h) => `${path.basename(f)}: 「${h.word}」…${h.context}…`));
      expect(hits).toEqual([]);
    }
  });
});
