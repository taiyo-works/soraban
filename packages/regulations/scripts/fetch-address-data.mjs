// アドレス・ベース・レジストリ（デジタル庁）の鳥取県（31）・島根県（32）分を取得し、住所検索の同梱索引に変換する（Sprint 9）。
//
//   node packages/regulations/scripts/fetch-address-data.mjs [--prefs "31 32"]
//   （または pnpm --filter @soraban/regulations fetch:address）
//
// 必要な環境：Node.js 22 以上（fetch を使う）と unzip コマンド（macOS・Linux に標準で入っている）。
// bash の版・GNU coreutils には依存しない（macOS 標準の bash 3.2 でも入口の .sh から動く）。
//
// 配布元（data.address-br.digital.go.jp）は日本国外からの接続を拒否する（CloudFront の国別制限。
// 2026-10-19 に GitHub ホストのランナーで確認）。日本国内のネットワークで実行する。
//
// - ダウンロード URL は推測しない。デジタル庁の DCAT フィード（abr-geocoder が使うものと同じ）に載っている
//   配布ファイル（.csv.zip）の URL だけを使う（選定は select-address-files.mjs）。
// - 変換は build-address-index.mjs。件数・容量の計測結果と取得元 URL・最終更新日（版）を
//   data/address/stats.json と data/address/README.md に書く。
// - 作業ディレクトリ（既定 data/.fetch-work-address。環境変数 WORK_DIR で変更）に summary.md を残す。
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(SCRIPT_DIR, "..");
const WORK = process.env["WORK_DIR"] || path.join(PKG_DIR, "data", ".fetch-work-address");
const FEED_URL =
  process.env["ABR_FEED_URL"] || "https://dataset.address-br.digital.go.jp/api/feed/dcat-us/1.1.json";
const TODAY = new Date().toISOString().slice(0, 10);
const UA = "Mozilla/5.0 (compatible; soraban-fetch-address/1.0)";

let prefs = "31 32";
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--prefs") prefs = argv[++i] ?? prefs;
  else {
    console.error(`unknown arg ${argv[i]}`);
    process.exit(2);
  }
}

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`Node.js 22 以上が必要です（現在 ${process.versions.node}）`);
  process.exit(2);
}
try {
  execFileSync("unzip", ["-v"], { stdio: "ignore" });
} catch {
  console.error("unzip コマンドが見つかりません");
  process.exit(2);
}

mkdirSync(WORK, { recursive: true });
const SUMMARY = path.join(WORK, "summary.md");
writeFileSync(SUMMARY, "");
const md = (s) => appendFileSync(SUMMARY, s + "\n");
const log = (s) => {
  console.error(s);
  md(`- ${s}`);
};

const download = async (url, out) => {
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok) {
        writeFileSync(out, buf);
        return { ok: true };
      }
      const text = buf.toString("utf8").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 600);
      // 4xx は再試行しても変わらない
      if (res.status < 500) return { ok: false, status: res.status, text };
      lastErr = `HTTP ${res.status} ${text}`;
    } catch (e) {
      lastErr = String(e?.cause?.message ?? e?.message ?? e);
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  return { ok: false, status: 0, text: lastErr };
};

const dirBytes = (dir) =>
  existsSync(dir) ? readdirSync(dir).reduce((s, f) => s + statSync(path.join(dir, f)).size, 0) : 0;

/** ZIP を展開し、中の ZIP も展開して、CSV を csvDir に集める。 */
const extractCsv = (zipFile, tmpDir, csvDir) => {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  execFileSync("unzip", ["-qo", zipFile, "-d", tmpDir]);
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
    );
  for (let round = 0; round < 3; round++) {
    const inner = walk(tmpDir).filter((f) => f.toLowerCase().endsWith(".zip"));
    if (inner.length === 0) break;
    for (const z of inner) {
      execFileSync("unzip", ["-qo", z, "-d", path.dirname(z)]);
      rmSync(z);
    }
  }
  for (const f of walk(tmpDir).filter((f) => f.toLowerCase().endsWith(".csv"))) {
    renameSync(f, path.join(csvDir, path.basename(f)));
  }
  rmSync(tmpDir, { recursive: true, force: true });
};

// ---- DCAT フィード ----
log(`DCAT フィード: ${FEED_URL}（取得日 ${TODAY}）`);
const feedFile = path.join(WORK, "feed.json");
const feedRes = await download(FEED_URL, feedFile);
if (!feedRes.ok) {
  log(`失敗: DCAT フィードを取得できない（${feedRes.status} ${feedRes.text}）`);
  process.exit(1);
}
log(`フィードの容量: ${statSync(feedFile).size} bytes`);

const manifestFile = path.join(WORK, "manifest.tsv");
const sel = spawnSync(
  process.execPath,
  [path.join(SCRIPT_DIR, "select-address-files.mjs"), feedFile, prefs, manifestFile],
  { encoding: "utf8" },
);
md(sel.stdout ?? "");
if (sel.status !== 0 || !existsSync(manifestFile) || statSync(manifestFile).size === 0) {
  log(`失敗: 対象の配布ファイルがフィードに見つからない ${sel.stderr ?? ""}`);
  process.exit(1);
}
const manifest = readFileSync(manifestFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const [category, url, modified, file] = l.split("\t");
    return { category, url, modified, file };
  });
log(`対象ファイル数: ${manifest.length}`);

// ---- 取得と展開 ----
let fail = false;
let loggedFailure = false;
for (const [i, m] of manifest.entries()) {
  const zdir = path.join(WORK, "zip", m.category);
  const cdir = path.join(WORK, "csv", m.category);
  mkdirSync(zdir, { recursive: true });
  mkdirSync(cdir, { recursive: true });
  const zip = path.join(zdir, m.file);
  console.error(`(${i + 1}/${manifest.length}) ${m.url}`);
  const r = await download(m.url, zip);
  if (!r.ok) {
    if (/block access from your country/.test(r.text ?? "")) {
      log(
        "中止: 配布元（data.address-br.digital.go.jp）が接続元の国からの取得を拒否した（CloudFront の国別制限）。日本国内のネットワークから実行すること",
      );
      process.exit(5);
    }
    if (!loggedFailure) {
      loggedFailure = true;
      md(`  - 取得できない（HTTP ${r.status}）${m.url}\n\n\`\`\`\n${r.text}\n\`\`\``);
    }
    log(`失敗: ダウンロード ${m.url}`);
    fail = true;
    continue;
  }
  try {
    extractCsv(zip, path.join(WORK, "x", m.category, m.file.replace(/\.zip$/, "")), cdir);
  } catch (e) {
    log(`失敗: ZIP として読めない ${m.url}（${e?.message ?? e}）`);
    fail = true;
  }
}

// ---- 展開結果の記録 ----
md("\n### 展開した CSV（種類ごとのファイル数・容量）\n\n```");
const csvRoot = path.join(WORK, "csv");
const categories = existsSync(csvRoot) ? readdirSync(csvRoot).sort() : [];
for (const c of categories) {
  const d = path.join(csvRoot, c);
  md(`${c}\t${readdirSync(d).filter((f) => f.endsWith(".csv")).length} files\t${dirBytes(d)} bytes`);
}
md("```\n\n### 各種類の先頭ファイルの先頭 3 行（列の確認用）\n");
for (const c of categories) {
  const d = path.join(csvRoot, c);
  const f = readdirSync(d).filter((x) => x.endsWith(".csv")).sort()[0];
  if (!f) continue;
  const head = readFileSync(path.join(d, f), "utf8").split("\n").slice(0, 3).map((l) => l.slice(0, 600));
  md(`- ${c}/${f}\n\`\`\`\n${head.join("\n")}\n\`\`\``);
}

// ---- 索引の生成 ----
const build = spawnSync(
  process.execPath,
  [
    path.join(SCRIPT_DIR, "build-address-index.mjs"),
    "--work", WORK,
    "--manifest", manifestFile,
    "--out", path.join(PKG_DIR, "data", "address"),
    "--bundle", path.join(PKG_DIR, "src", "data-bundle", "address-bundle.ts"),
    "--acquired", TODAY,
    "--feed", FEED_URL,
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
md((build.stdout ?? "") + (build.stderr ?? ""));
process.stderr.write((build.stdout ?? "") + (build.stderr ?? ""));
if (build.status !== 0) {
  log(`失敗: build-address-index.mjs（終了コード ${build.status}）`);
  process.exit(build.status ?? 1);
}
if (fail) log("注意: 一部のファイルを取得できなかった（上記）");
console.error(`完了。記録：${SUMMARY}`);
