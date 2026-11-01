// data-testid の一覧の保存と差分検査（Sprint 17 契約 T-1）。
//   node scripts/testids.mjs --write --reason "理由"   … apps/web/src の識別子を docs/evaluations/sprint-17-testids-baseline.txt に書く
//   node scripts/testids.mjs --check   … 基準の一覧から消えたものがあれば終了コード 1
// 静的な文字列は値そのもの、動的な式（{...}）と props（testId="..." など）は "式: ..." / "prop: ..." として一覧に残す。
import { appendFileSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE = join(root, "docs/evaluations/sprint-17-testids-baseline.txt");

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

export function collect(srcDir = join(root, "apps/web/src")) {
  const ids = new Set();
  for (const f of walk(srcDir, [])) {
    // コメントの中の識別子は数えない（コメントアウトで「消えた」ものが残って見えるのを防ぐ）
    const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of text.matchAll(/data-testid=(?:"([^"]+)"|\{`([^`]*)`\}|\{"([^"]+)"\}|\{([^}]+)\})/g)) {
      if (m[1] !== undefined) ids.add(m[1]);
      else if (m[2] !== undefined) ids.add(`式: \`${m[2]}\``);
      else if (m[3] !== undefined) ids.add(m[3]);
      else ids.add(`式: ${m[4].trim()}`);
    }
    for (const m of text.matchAll(/\b(?:testId|testid|"data-testid")\s*[:=]\s*"([^"]+)"/g)) ids.add(`prop: ${m[1]}`);
  }
  return [...ids].sort();
}

export function readBaseline() {
  return readFileSync(BASELINE, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
}

export function missing(now = collect()) {
  const set = new Set(now);
  return readBaseline().filter((id) => !set.has(id));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--write")) {
    // 基準の一覧は黙って書き直せない：理由が要る。理由は記録に残り、単体テストが一覧の件数とハッシュを固定している
    const at = process.argv.indexOf("--reason");
    const reason = at >= 0 ? (process.argv[at + 1] ?? "").trim() : "";
    if (reason === "" || reason.startsWith("--")) {
      console.error('基準の一覧を書き直すには --reason "理由" が要ります。書き直したら testids-baseline.test.ts の件数とハッシュも更新します。');
      process.exit(2);
    }
    const ids = collect();
    appendFileSync(join(root, "docs/evaluations/sprint-17-testids-baseline-log.txt"), `${new Date().toISOString()}\t${ids.length}\t${reason}\n`);
    writeFileSync(BASELINE, `# Sprint 17 着手時の data-testid の一覧（apps/web/src。node scripts/testids.mjs --write で生成）。消さない・名前を変えない。\n${ids.join("\n")}\n`);
    console.log(`wrote ${ids.length}`);
  } else {
    const m = missing();
    if (m.length > 0) {
      console.error(`基準の一覧から消えた識別子: ${m.length}\n${m.join("\n")}`);
      process.exit(1);
    }
    console.log("消えた識別子は 0");
  }
}
