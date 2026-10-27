// 実行: node docs/design/warm-final/dark/src/build-dark.mjs
// 暗の見本 3 画面（判定トップ・結果 3 状態・運航ホーム）を作る。
// 明の見本（../../top.html など）は build.mjs が tokens-v2 の全トークン（暗を含む）を埋め込んでいる。ここでは <html> に data-theme="dark"（強制の暗）を足すだけ。
// つまり暗の見た目は、明と同じ HTML・同じ CSS に、トークンの暗の値が当たったもの（部品ごとの暗用の上書きは書いていない）。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const wf = path.join(here, "../..");
const out = path.join(here, "..");
for (const id of ["top", "result", "home"]) {
  let s = fs.readFileSync(path.join(wf, `${id}.html`), "utf8");
  if (!/<html lang="ja">/.test(s)) throw new Error(`${id}.html の <html> が想定と違う`);
  s = s.replace('<html lang="ja">', '<html lang="ja" data-theme="dark">').replace(/<title>(.*?)<\/title>/, "<title>$1（暗）</title>");
  s = s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="color-scheme" content="dark light">');
  fs.writeFileSync(path.join(out, `${id}.html`), s);
}
console.log("built dark top / result / home");
