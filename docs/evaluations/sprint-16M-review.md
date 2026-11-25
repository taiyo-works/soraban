# Sprint 16-M レビュー（c3dfe5e..afd2c4d）

reviewer の報告をオーケストレーターが保存した（2026-11-25）。読んだのは差分だけ。

## 結論: 合格（要修正なし。軽微・申し送り 7 件）

## 指摘一覧

| ID | 重さ | ファイル:行 | 根拠 | 差し戻し先 |
|---|---|---|---|---|
| N-1 | 低〜中（文書） | `screen-wording-inventory.md` §5.5、`legal-info-plan.md` 221-223、`sprint-16.md` §14 566-568・602 | Q-L16〜18 の番号が 2 つの文書で別の質問を指す。`legal-info-plan` §4 への追記が未了で番号が衝突する。 | オーケストレーター → planner |
| N-2 | 低（安全側の見た目） | `verdict-summary.tsx:259`、`app/ops/plans/[id]/snapshots/[sid]/page.tsx:63` | スナップショット画面（過去の判定）は `total`・`forStale` を渡さないため、手続き不要の結論に安全（緑）の面と帯が付く（16-M 前は面なし）。 | generator |
| N-3 | 低（質問票） | `sprint-16.md` §8.2・§14 Q-L16 | 「すべて手続き不要」の緑の面と帯という見た目の強さを、誤った安心の論点として質問票に含める。 | オーケストレーター → planner |
| N-4 | 低（疑い） | `soraban-ui.css:2119-2130` | maplibre-gl の既定 CSS の詳細度が勝ち、フォーカス中だけ地図の部品の円が角丸の四角になり、クリック後に縁が消えるおそれ。 | designer |
| N-5 | 低 | `regulation-pdf.tsx:596`・`:614` | PDF の許可・除外の条件に `tidyEngineText` が掛かっていない（画面は掛かっている）。今のデータでは出力は同じ。 | generator |
| N-6 | 低 | `verdict-summary.tsx:567` | 「PDF は VERDICT_SECTION_TITLE.duties のまま」のコメントが古い。 | generator |
| N-7 | 低 | `wording-policy.ts:71`、棚卸し §3a 26-27 | 描画されなくなった旧い文が許可リストと棚卸しに残る。 | オーケストレーター（16-N の棚卸し） |

## 観点ごとの結果（要約）

1. 安全側の表示: `VERDICT_STATE` は §8.2 と一致。判定不能・判定中・失敗・暫定・確認のための手続きは帯なし。safe のチェック印はどこにも付かない。5 段の言葉・形・順は不変。目盛りが消えるのは `total` を渡す `/` と ops の `/judgement` だけ（後者は 16-H2 から非表示）。
2. `regulation-base-status` を `StatusLabel` にしなかった判断は妥当（非該当にチェック印が付くと「問題なし」と読める）。
3. `tidyEngineText` は `/必ず(?!しも)/g` を消すだけで確認先・対象は残る。packages・server・api・保存データ・`ENGINE_VERSION`・証跡は差分 0。`application-pdf.tsx` 差分 0。
4. 申請支援: 分岐と `procedure-card.tsx` は差分 0。M-4a で確認。
5. 総合の語: 外部提供しない前提は §8.2・棚卸し §5.5・legal-info-plan に記録（番号は N-1）。
6. K-11 差分 0、端末ストレージの追加なし。
7. テストは弱めていない（`sprint12h-pr2` は強める方向、`sprint11d` 13 は旧い見出しが出ない確認を追加、`sprint18-3-wording` 差分 0 で 3-8 通過）。`sprint16-m`（30 件）は旧コードで 16 件落ちる意味のある検査。
8. 禁止語・主色・寸法・主ボタン 1 つ: 問題なし。
