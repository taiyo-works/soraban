# 画面デザインの方針（案内）

> **注（Sprint 16-N2、2026-11-26）：橙を主役とする記述は置き換え済み。** 主色は空色 `#1F5FE0` の 1 色で、橙はロゴだけ（`docs/design/design-direction-2026-11.md`）。Sprint 12g の色の層（紙・墨・藍の `--bg-*`・`--fg-*`・`--accent*`、暗、`.field`）は 16-N2 で `globals.css` から撤去した。この文書は案内だけで、決定の正は `design-system.md`。

デザインの決定・色・文字・形・部品・レイアウト・動き・移行計画は、すべて **`docs/design/design-system.md`** にある。この文書は案内だけを置く。以前の記述（「航空日誌の紙面」・藍・角丸 5px・スタイル 6 案など）は、`git log -- docs/design/ui-direction.md` で読める。

| 知りたいこと | 見る所 |
|---|---|
| 決定の記録・色・文字・部品・動き・移行計画 | `docs/design/design-system.md`（唯一の正） |
| トークンの値 | `apps/web/src/app/soraban-tokens.css` |
| コントラストの検査 | `node docs/design/tokens/check-contrast.mjs` |
| 全体の見本 | `docs/design/system-sheet.png` |
| 過去の比較の記録（形・世界観） | `docs/design/shape-compare/`、`docs/design/world-board/` |
| 6 パレットの実測（旧案） | `docs/design/palettes.md` |
