# Sprint 12h PR ③b2a 変えたテストの一覧（理由つき）

> 対象：`feat/12h-pr3b2a-register-v2`（運航管理 `/ops` の登録系の画面の v2 化）。基準は `origin/main`（500dc35）。契約は `docs/sprints/sprint-12h-pr3b2.md` §7・§8（T-1〜T-8）。
> 既存の E2E の期待値は 1 つも変えていない（弱めた箇所もない）。変えたのは単体試験の対象の追加と、新しい検査の追加だけ。

## A. 契約 §8 の一覧にあった変更

| 契約 | テスト | 変更 | 理由・弱めない根拠 |
|---|---|---|---|
| T-2 | `apps/web/src/app/ops/ops-v2-conventions.test.ts` | `B2A_FILES`（登録系 20 ファイル：機体・操縦者・許可・承認・地点（新規・詳細を含む）・利用者・登録の入口・サインイン・アクセス権なし・`permits-client`・`permit-ui`・`license-renewal`）を旧トークン 0・色の直書き 0 の検査に**足した**。③b1 の 24 ファイルは残した | 対象が増える。厳しくなる |
| T-3 | 同ファイル「ops-v2*.css に色・角丸 px・時間・影の直書きがない」 | 変更なし（この PR で足した CSS にも効く。通る） | 回帰 |
| T-4 | `sprint12c-db` 現場の 7:1・`field-back` | 変更なし（現場の画面は b2b） | — |
| T-5 | `sprint12e`・`sprint12d`・`sprint12b`・`sprint12g-1b-fix`（M-6・M-7・M-11） | 変更なし（通ることを確認。結果は PR の報告） | 回帰 |
| T-6 | `sprint12g-1a-db` 4 | 変更なし（`OPS_CONTENT_CLASS` を変えていない） | 回帰 |
| T-7 | 追加 `e2e/ops-db/sprint12h-pr3b2a-db.spec.ts`（7 件） | `P3b2a-1` 文字（12px 以上・4.5:1。明・暗。16 画面）、`-2` 押す部品 43.5px 以上（375・360。登録の入口は 56px）、`-3` はみ出し 0（360〜1440 × 明・暗。長い記号・氏名・住所・番号）、`-4` 形（角丸は 16・8・4・ピル・円だけ、影は `--sb-shadow` だけ）、`-5` 旧い部品なし・主ボタンは橙・`?includeVoided=1` の切り替えは `<a>`（Q-12）、`-6` 期限の札が判定色を使わない（Q-10。決めること 4）、`-7` 現場の値（`data-mode=field`：56／64px・動きなし・影なし） | 契約の目安（b2a は 6〜8 件）の 7 件 |
| T-8 | 色・角丸・影の値で固定する試験 | 追加の変更なし（grep で確かめた：`sprint12g-1a-db`・`pr3b1`・`pr3` のみ） | — |

## B. 契約の一覧に無かった変更

なし。

## C. 新しい単体試験（`ops-v2-conventions.test.ts` に追加）

| テスト | 内容 |
|---|---|
| ③b2a：登録系の画面に旧い部品の名前が 0 | `ui/primitives`（旧い部品）・`font-display`・`font-mono`・`font-light`・`text-aux`・`text-body`・`text-table`・左の線の枠（`border-l-2/4`）の参照が 0（`/ops/more` が `ui/primitives` の `PageHeader`・`SectionTitle` を使っていたのを、v2 の `ui.tsx`・`sb-sec-head` に替えた） |
| ③b2a：期限の札は判定色を使わない | `VALIDITY_TONE`（許可・承認の有効性）と `STAGE_TONE`（技能証明の更新）に `red`／`amber` が 0。`.opx-badge-alert` は `--sb-inverse-bg`（墨の面）、`.opx-badge-soon` は `--sb-orange-hover`（薄い橙）で、`--sb-v-*`（判定色）を使わない |

## D. 実装の判断（契約との関係）

1. **期限の札**：`PermitValidityBadge` は、サーバーの文言（「× 期限切れ」など。`server/ops/permit-logic.ts`。変えない）の先頭の印だけを別の要素にし、墨の面の札（期限切れ・失効・取消）では CSS で見た目を「！」にした（`::before { content: "！" / "" }`。代替テキストは空）。**テキストと読み上げは「× 期限切れ」のまま**なので、`sprint12d-db` の `toHaveText("× 期限切れ")` などは変えずに通る。期限間近＝薄い橙の面。技能証明の更新（`license-renewal.tsx`）は、申請期間＝薄い橙、期限超過・期限切れ＝墨の面＋実在の「！」。一覧の「失効日」の札も墨の面＋「！」。
   - 取消済みの札（`<Badge tone="red">取消済み</Badge>`）は、期限の札ではないので③b1 の規則（赤い枠）のままにした。
2. **表**：機体・操縦者・許可・承認の一覧は、640px 以上で外枠が角丸 16 の白い面（影は `--sb-shadow`）、見出し行はくぼみ、行は罫線だけ・角丸なし（契約の第一案）。640px 未満は行ごとの白いカード（③b1 の `.opx-row` のまま）。表が丸すぎるかは、撮影した画面でのりさんに確認してもらう。
3. **許可・承認の照合・根拠・版の履歴の行**：左の色の線（`border-l-*`）をやめ、くぼみの面の行にした。確認が要るもの（適用されない・未登録・版が一致しない）は破線の墨の枠、強調する版（`?version=N`）は実線の墨の枠。`data-testid`・DOM の順・文言は変えていない。
4. `components/ops/ui.tsx`：`Badge` に `tone="alert"`・`tone="soon"` と、先頭の印（`mark`）を足した（既存の呼び出しは変わらない）。
