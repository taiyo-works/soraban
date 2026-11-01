// Sprint 18-3 契約 3-10：禁止語・限定語の走査の出力（test-results/wording/*.json。e2e/wording-scan.ts が書く）から
// docs/legal/screen-wording-inventory.md を作る。手で書き足さない。
// 使い方: node scripts/wording-inventory.mjs [入力ディレクトリ] [出力ファイル]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? "test-results/wording";
const out = process.argv[3] ?? "docs/legal/screen-wording-inventory.md";
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const records = files.flatMap((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")).map((r) => ({ ...r, file: f })));

const group = (kind) => {
  const m = new Map();
  for (const r of records.filter((x) => x.kind === kind)) {
    const key = `${r.word}\u0000${r.sentence}`;
    const e = m.get(key) ?? { word: r.word, sentence: r.sentence, source: r.source, routes: new Set() };
    e.routes.add(r.route);
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => a.word.localeCompare(b.word) || a.sentence.localeCompare(b.sentence));
};
const esc = (s) => s.replace(/\|/g, "\\|");
const table = (rows, withSource) =>
  rows.length === 0
    ? "（なし）\n"
    : ["| 語 | 文 | ルート |" + (withSource ? " 許可リストの出どころ |" : ""), "|---|---|---|" + (withSource ? "---|" : "")]
        .concat(rows.map((e) => `| ${e.word} | ${esc(e.sentence)} | ${[...e.routes].map((r) => `\`${r}\``).join("<br>")} |` + (withSource ? ` ${esc(e.source ?? "")} |` : "")))
        .join("\n") + "\n";

const judgement = group("judgement");
const allowed = group("allowed");
const violation = group("violation").concat(group("forbidden"));
const engineShinsei = judgement.filter((e) => e.word === "申請");

const text = `# 画面の文言の棚卸し（禁止語・限定語の走査）

> Sprint 18-3 契約 3-10。**\`scripts/wording-inventory.mjs\` が、E2E の走査の出力（\`test-results/wording/*.json\`）から作る。手で書き足さない。**
> 走査の仕様は \`docs/sprints/sprint-18.md\` §6、語の一覧は \`apps/web/src/lib/wording-policy.ts\`。専門家確認（\`legal-info-plan.md\` Q-L1・Q-L2）の資料。
> 入力: ${files.join("、")}（記録 ${records.length} 件）。

## 1. 違反（全面禁止語・許可リストの外の限定語）

${table(violation, false)}
## 2. 分類「許可リスト」（印の外・印の中で、許可リストの文として出たもの）

${table(allowed, true)}
## 3. 分類「判定エンジン由来」（判定の領域の印 \`data-wording-scope="judgement"\` の中で出た限定語。文言は変えていない）

${table(judgement, false)}
## 4. 判定エンジン由来の「申請」の文の一覧（専門家確認の資料）

${table(engineShinsei, false)}
直すかどうかは専門家の回答の後（§4.6）。直す場合は \`packages/regulations\` の文言の変更になり、判定の基準のテスト（\`sprint11d-verdict-baseline.json\`・\`diagnose-core.test.ts\`）の作り直しが要る。
`;
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, text);
console.log(`wrote ${out}: 違反 ${violation.length}、許可リスト ${allowed.length}、判定エンジン由来 ${judgement.length}`);
