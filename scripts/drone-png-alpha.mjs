// public/drone-01.png の白地を alpha=0 に焼き込み、線画だけを残す。
// 元ファイルは public/drone-01.original.png に退避する（再実行用）。
//
// 仕様:
//   - 各ピクセルの輝度 lum = (R+G+B)/3
//   - alpha = 255 - lum (線形): 白→0、黒→255、中間→部分α
//   - RGB は (0, 0, 0) に統一: 線は pure black、anti-alias 端は α 経由で表現
//   - 出力 PNG は alpha 付き、blend-mode 非依存（dark mode でも独立に色制御可）
//
// 使い方:
//   node scripts/drone-png-alpha.mjs

import sharp from "sharp";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "apps", "web", "public");
const SRC = path.join(PUBLIC_DIR, "drone-01.png");
const BACKUP = path.join(PUBLIC_DIR, "drone-01.original.png");

async function main() {
  // バックアップ (上書き安全側: 存在しなければコピー)
  try {
    await copyFile(SRC, BACKUP, /* COPYFILE_EXCL */ 1);
    console.log(`backed up: ${BACKUP}`);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    console.log(`backup already exists at ${BACKUP}, skipping`);
  }

  // PNG を raw RGBA に展開
  const img = sharp(BACKUP);
  const { data, info } = await img
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // ピクセルごとに RGB→0, alpha←255-luminance を適用
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = (r + g + b) / 3;
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = Math.max(0, Math.min(255, 255 - lum));
  }

  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toFile(SRC);

  console.log(`wrote ${SRC} (${info.width}×${info.height}, alpha baked)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
