# Sprint 12h PR ③b2b 変えたテストの一覧（理由つき）

> 対象：`feat/12h-pr3b2b-field-v2`（運航管理 `/ops` の現場・事故・ヒヤリハット・通報・判定の履歴の v2 化）。基準は `origin/main`（848b946）。契約は `docs/sprints/sprint-12h-pr3b2.md` §7・§8（T-1〜T-8）。
> 既存の E2E の期待値は 1 つも変えていない（弱めた箇所もない）。変えたのは単体試験 1 件の反転（契約 T-1）と、対象の追加・新しい検査の追加だけ。

## A. 契約 §8 の一覧にあった変更

| 契約 | テスト | 変更 | 理由・弱めない根拠 |
|---|---|---|---|
| T-1 | `apps/web/src/app/ops/ops-v2-conventions.test.ts`「現場（…/field）には .ops-v2 の枠を当てない」 | **反転**。名前を「現場（…/field）にも .ops-v2 の枠を当て、現場の 2 画面だけが表示中の間 data-mode="field" を付ける」に変え、(1) `ops-frame.tsx` に `isField` がない・`ds ds-page ops-v2` を常に付ける、(2) 現場の 2 ページが `<FieldModeMark />` を置く、(3) `FieldModeMark` が `useLayoutEffect` と `removeAttribute`（離れたら外す）を持つ、(4) `globals.css`・`app/page.tsx`・`app/layout.tsx`・`app/ops/layout.tsx`・`ops-frame.tsx`・現場の 2 つのクライアント部品が `data-mode` を設定しない、を検査する | ③b1 のコメントが予告した意図した反転（決めること 2「推奨どおり」）。元の検査は「枠を当てない」ことの固定で、方針が変わったので置き換える。新しい検査は、印の付け外しと `/` へ漏れないことまで見るので、元より範囲が広い |
| T-2 | 同ファイル `B2B_FILES`（新設）と、旧トークン・色の直書き・旧い部品の名前の検査 | 対象に b2b の 16 ファイル（現場・簡易記録・事故 6・通報 3・判定の履歴 2・現場の 2 ページ・`field-mode-mark.tsx`・`ops-frame.tsx`）を**足した**。③b1 の 24、b2a の 19 は残した。「旧い部品の名前（ui/primitives・font-display・font-mono・左の線の枠）が 0」の検査も b2b に広げた | 検査の対象が増える。厳しくなる |
| T-3 | 同ファイル「ops-v2*.css に色の直書き・角丸の px・時間・影の直書きがない」 | 変更なし（この PR で足した CSS にも効く。通る） | 回帰 |
| T-4 | `sprint12c-db` 現場の文字 7:1（1168〜1201 行）、`field-back` 56px（435 行） | 変更なし | 現場の値を使う（`data-mode="field"`）ので通る。下限は 7 のまま |
| T-5 | `sprint12e`・`sprint12d`・`sprint12b`・`sprint12g-1b-fix`（M-6・M-7・M-11） | 変更なし（結果は PR の報告） | 回帰 |
| T-6 | `sprint12g-1a-db` 4 | 変更なし（`OPS_CONTENT_CLASS` を変えていない） | 回帰 |
| T-7 | 追加 `e2e/ops-db/sprint12h-pr3b2b-db.spec.ts`（6 件） | `P3b2b-1` 文字（12px 以上・4.5:1、現場は 14px 以上・7:1。明・暗。9 画面）、`-2` 押す部品（375・360。現場は 56px 以上、主ボタン 64px 以上）、`-3` はみ出し 0（360〜1440 × 明・暗）、`-4` 形（角丸は 16・8・4・ピル・円だけ、影は `--sb-shadow` だけ。現場は影なし・動きなし）、`-5` 旧い部品なし・主ボタンは橙・事故の一覧の「取消済みも含める」は `<a>`（Q-12）、`-6` 現場の印（Q-11：開いている間だけ付き、クライアントルーターで他の画面・`/` へ移ると外れる。3 回繰り返す。`/` には付かない。現場に `.ops-v2` があり、メニューが出ない） | 契約の目安（b2b は 6〜8 件）の 6 件 |
| T-8 | 色・角丸・影の値で固定する試験 | 追加の変更なし（`sprint12g-1a-db`・`pr3b1`・`pr3`・`pr3b2a` のみ） | — |

## B. 契約の一覧に無かった変更

なし。

## C. 実装の判断（契約との関係）

1. **現場の印**：`components/ops/field-mode-mark.tsx`（`FieldModeMark`）。`useLayoutEffect` で `<html data-mode="field">` を付け、cleanup で外す（自分が付けた値のときだけ）。Next.js のキャッシュ機能で隠れた経路は effect が止まるため外れる（P3b2b-6 で確認）。`/` が読む JS・CSS には入れていない。
2. **現場・簡易記録の枠**：旧い `rounded-sharp`・左の太線・藍の面を、`.opx-btn`（現場の値で 56／64px）と新しい `.opx-box`・`.opx-box-*`・`.opx-band`・`.opx-btn-flat`・`.opx-row-card`（`ops-v2-screens.css`）に置き換えた。済＝実線の墨、未＝破線、異常・警告＝太い赤の実線、注意＝破線の墨、緊急用務空域の「指定されている」＝6px の赤の実線（画面で最も目立つ）。意味は枠の形と記号・文字が担う。
3. **選択中・現在地の面**（`opx-btn-flat`）：橙の面で右端の丸と矢印は付けない（押すと進む意味に見えるため）。段階・同じ日の計画・区分・けがの有無の選択に使う。
4. **事故・ヒヤリハット**：最初の案内（G1）は `opx-notice`（破線の墨の枠）、N1〜N3 と注記は `opx-note`（くぼみの面）、目安・報告の記録・版は `opx-edge-row`（確認が要るものは破線、有効な記録は実線）。一覧は表（`opx-table`・`opx-row`）。文言・`data-testid`・DOM の順は変えていない（`incident-screens.test.ts`・`ui-copy.test.ts` は変更なしで通る）。
5. **通報**：固定の注意書き（`report-notice`）は `opx-notice`（warn）。項目の行・履歴の行は罫線とくぼみ。11px・10px の文字を 12px に上げた（Q-6）。「必須」は `opx-required`。
6. **判定の履歴**：一覧の行は `opx-row-card`（常にカード）。内容・ハッシュ・証跡 ID は変えず、等幅の数字（`sb-num`）。
7. 5.・6. のコントラストの修正：欠落項目の行の面を橙のくぼみ（`sb-hover`）から `sb-sunken` に、通報の行の項目名の色を `ink-3` から `ink-2` にした（橙の面の上の `ink-3` が 4.15:1 で 4.5:1 に届かなかったため。P3b2b-1 で検出）。
