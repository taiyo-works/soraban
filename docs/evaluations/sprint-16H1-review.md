# Sprint 16-H1 のレビュー（reviewer、`git diff 4385b1e..b3f5763`）

reviewer は読むだけの定義のため、本文はオーケストレーターが保存した（2026-11-24）。

## 結論

designer に進んでよい。必須（M）はなし。推奨 4・軽微 8。generator 向けの R-1・R-3 は evaluator の前に直す。

## 重点ごとの確認

1. 端末データ（H1-5・K-15）: 問題なし（確認範囲）。新しいストレージの呼び出しなし。`pushState(null, …)` で履歴の state に入力を載せない。URL は `step` と既存の引き継ぎのパラメータだけ。入力欄に `name` がなく、水和の前の送信でも値が URL に出ない。`PlaceSearchHelper` は部品の状態だけ。`setChangeFlash` は既存の挙動（固定の文言と計画のパスだけ）。
2. 保存の正しさ: `planBody` は旧 `body()` と同じ。引き継ぎは各段の初期値（機体は引き継がない）。422 の段への対応付けにすき間（N-2）。
3. 離脱の確認: 入力の途中だけ出る（`dirtyRef`・`savedRef`）。リスナーは外している。ブラウザの戻るの経路は出ない（R-4）。
4. K-11: 差分 0。
5. E2E の書き換え: 12a・12b・12d の期待値は同じ。helper は `goto` を使わない。書き換えていない既存の走査が段 ① しか見なくなった（R-1・R-3）。
6. 文言: 禁止語の追加なし。主ボタンは「次へ」「確認に戻る」「計画を保存」。
7. 訂正の画面（H1-8）: 変化なし。

## 指摘

| # | 重大度 | 差し戻し先 | 内容 | 直し方 |
|---|---|---|---|---|
| R-1 | 推奨（強め） | generator | `sprint18-3-wording-db:134`・`sprint18-2-db:151`・`sprint16-b-r1-db`・`sprint16-d-db:48,227` は `/ops/plans/new` を開いて走査するだけで、6 段にしてから段 ① しか見ない。段 ②〜⑤ の文言は禁止語・限定語（18-3 `violationsOf`）と 16-B の文字の検査にかからない。H1 の E2E は段 ⑤ の `BANNED` 8 語だけ | 段 ①〜⑤ を順に進め、各段で `violationsOf` と 16-B R1-3/R1-4 を走らせる。test-changes に記録 |
| R-2 | 推奨 | designer | `ops-v2-screens.css:627` の `.opx-wiz-row dd { line-height: 1.6 }` は 16-B R1-3（印のない p・li・dd は 16px・1.7 以上）を下回る | 1.7 にする。段 ⑤ を検査に入れる（R-1） |
| R-3 | 推奨 | generator | `sprint16-d-db:316-324` は段 ① の誤りだけを見て、`plan-flags`・`plan-permits` の fieldset への `aria-describedby` の結びを通らない。6 段では fieldset のエラーは 422 からしか出ない | `page.route` で 422（`flags`・`pilotPermits`）を返し、導線で ③・④ へ戻って結びと記号付きの 1 行を確かめる。検査名との食い違いを test-changes に記録 |
| R-4 | 推奨 | オーケストレーターの判断→generator | 段 ① からブラウザの戻るでアプリ内の前の画面へ戻ると、確認なしに入力が消える（`plan-wizard.tsx:219-242`） | 既知の限界として了承を記録するか、番兵の履歴＋popstate の `confirm` |
| N-1 | 軽微 | generator | 422 の後、直して「確認に戻る」でも下の `FormError` が残る（`:271`・`:535`） | 誤りが空になったときか `next()` で message を消す |
| N-2 | 軽微 | generator | `thirdPartyOverflight` が `STEP_OF_KEY` に無い。`savedPlaceId` のエラーが段 ① の地点の欄に出ない（`:57-80`・`:327-346`・`:434`） | 段 3 に対応付けて表示。地点の欄に `err("savedPlaceId")` |
| N-3 | 軽微 | generator | 履歴の移動で段の検証を飛ばして ⑤ に着ける（保存は 422 で止まる） | ⑤ に入るとき ①〜④ をまとめて `validateStep` |
| N-4 | 軽微 | generator | 保存の成功後、`setBusy(false)` から画面が移るまでの間に再び押せる（`:273-284`） | 成功時は busy を戻さない |
| N-5 | 軽微 | generator | H1-5 の E2E が URL と `history.state` を見ていない | 各段で URL のクエリと `history.state` に入力値が無いことを確かめる |
| N-6 | 軽微 | generator | `sprint16-h1-db:393` のコメント（入力するまで離脱の確認は出ない）が検査されていない | 入力前に beforeunload が取り消されないことを確かめる行を足す |
| N-7 | 疑い | generator | `/ops/plans/new` そのものへのリンクでは確認が出ず、段の表示と URL がずれうる（`:230`） | 該当のリンクの有無を確かめ、あれば扱う |
| N-8 | 記録 | G-2 | helper の押し直しは、実際の「最初の押下が効かない」不具合も隠す | 実機で確認 |
