# Sprint 16-N2 レビュー（範囲 44d3266..9391582）

reviewer の報告をオーケストレーターが保存したもの。合否: **条件付き合格**（R-1〜R-3 を直せば合格）。検査の実質的な緩和、K-11 の逸脱は無い。

## 問題なしと確かめた観点
- K-11: server の差分は `ops/prep-card-logic.ts` の注釈 1 行だけ。`Q-L1[6-9]` は 0。
- 許可リストから外した行の文は `regulation-map-layers.ts:195` から来て、`regulation-map.tsx` の 2 か所で描かれる。どちらも `tidyEngineText` を通る。PDF はこの文を読まない。
- 外した識別子 27 件は、基準のコミットでも、消した部品の外からの参照が 0。
- 消した CSS・変数・旧い名前に参照は残っていない。`.field` は基準でも付けていない。暗の休眠は保たれている。
- `design-tokens`・`ui-parts`・`icons`・`wording-policy` のテストの置き換えは、正当な撤去に伴うもの。`--sb-*` のコントラストは P1-6・P1-7 が守っている。

## 要修正
- **R-1（中・generator）** `e2e/ops-db/sprint16-n2-db.spec.ts:149`: 判定の札の色の比較が、重なる段が 0 のとき 0 回で通る。重なる段の数が 1 以上であることを確かめ、比べる段を名指しで固定する。
- **R-2（低・generator）**
  - `docs/evaluations/sprint-16N2-removed-testids.txt` に 27 件の一覧が無い（見出しだけ）。
  - `sprint-16-test-changes.md:813` のログアウトのボタンの高さ「56」は誤り。実際は 48 で、前後で変わっていない。
- **R-3（低）** `ops-client.tsx:948`: `signout-send` が `.opx-btn-primary` なのに `data-variant="primary"` が無い。16-C の C-6（`sprint16-c-db.spec.ts:148`）の規約に反する。

## 申し送り
- **N-1（planner）**: N2-3 の「`data-testid` を消さない」と、N-1 の「参照 0 の部品を消す」が食い違う。描かれたことのない識別子の扱いを明示する。
- **N-2（generator）**: `legacy-sweep.test.ts:24-35` の例外がファイル単位で広い（`verdict-display.ts` の `VERDICT_TONE` まで除外される）。PDF の部分に絞る。
- **N-3（generator）**: 検査の対象に、消した名前の一部が抜けている（`text-h1`・`text-h3`・`text-stat`・`text-state`・`font-display`・`--tap`・`--fs-h1`・`--hairline`・`--sheet-h`）。
- **N-4（evaluator）**: 送信待ちがあるときのログアウトの確認の 4 つのボタン（特に `signout-discard`）と、ログイン済みの `/` の下メニューを、撤去の前後で撮影して比べる。
- **N-5（generator・任意）**: `journal-ui.tsx:15` のコメントが、消した `ui/primitives` を参照している。
