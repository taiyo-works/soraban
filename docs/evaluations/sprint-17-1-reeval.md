# Sprint 17-1 再評価レポート（evaluator、2026-11-01）

対象: ブランチ `claude/vigilant-fermi-g54nho` のコミット `07f8058`（差し戻し 1 回目の修正後）。前回: `docs/evaluations/sprint-17-1-eval.md`（1d82cd1、条件付き合格）。
環境: 作業ツリーは使わず、`git worktree`（scratchpad の `wt-17-1r`、07f8058）で評価。空の DB `ev171r`（全体の E2E）と `ev171m`（手動シナリオ用）、PostgreSQL 16、`next start` は 3410〜3412 / 3420、Chromium `/opt/pw-browsers/chromium`。CI は run 41271304026（07f8058、4 ジョブすべて success を `gh run view` で確認）。

## 0. 結論

**総合判定: 条件付き合格**（前回の指摘 5 件はすべて解消を確認。新しい小さな不具合 1 件が `HashScroll` にあり、数行の修正が要る）。

| # | 前回の指摘 | 判定 | 根拠 |
|---|---|---|---|
| 1 | CI が赤（`tapSize` の `boundingBox()` が null） | ✅ 解消 | CI run 41271304026 の 4 ジョブ成功。ローカル空 DB の `pnpm test:e2e:ops` 全体は **158 件すべて成功（18.9 分、失敗 0・未実行 0）**。前回は 148 成功・2 失敗・8 未実行。 |
| 2 | 旧アンカー／「次にやること」の後にスクロールされない | ✅ 解消（実ブラウザで測定、§2） | 375×812・1280×800、3 状態の計画で、旧アンカー 8 本と「次にやること」のクリック（クライアント遷移）の全件で、対象の上端が `top=64px`（上バーの下・画面内）に着く。 |
| 3 | 「無い語が無い」検査が 1 画面に狭まった | ✅ 解消 | `onAllPlanScreens` が主画面・`/overview`・`/judgement`・`/journal` を順に検査。12a・12b・12d の 11 か所に適用（§1）。`/report` は対象外（17-1 の `sprint17-db` 側で走査済み）。 |
| 4 | v2 の見た目の走査が新しい 3 画面を対象にしていない | ✅ 解消 | `sprint12h-pr3b1`（SCREENS。文字・押す部品・はみ出し・角丸と影の各テスト）と `pr3b2b`（`ready: "plan-tabs"`）に `/overview`・`/judgement`・`/journal` を追加。pr3b1 は `main h1` の可視を待つので、ストリーミング前の空振りにならない。全体実行で成功。 |
| 5 | 識別子の差分検査の固定 | ✅ 解消 | `--write` は `--reason` 無しで終了コード 2（実行して確認）。基準ファイルは 1d82cd1 から無変更（sha256 `84d11a87…` が単体テストの値と一致、1,996 件以上）。`--check` は「消えた識別子は 0」。 |

### 要修正（1 件、差し戻し先: generator）

**R-1（小）`HashScroll` が、壊れた % 表記の hash で画面ごとクラッシュさせる。**
- 再現（`ev171m`、375×812）: ログイン済みで `/ops/plans/{id}/overview#%zz` または `#%E0%A4%A` を新しいタブで開く → 「This page couldn't load / Reload / Back」（`URIError: URI malformed`）。主画面・`/judgement`・`/journal` も同じ（`PlanFrame` に置いたため全画面）。`#a%20b` と `#` は正常。
- 原因: `hash-scroll.tsx` の `decodeURIComponent(window.location.hash.slice(1))` が `useEffect` の中で例外を投げ、エラー境界に落ちる。`hashchange` のハンドラ（`run`）も同じ。
- 影響: 1d82cd1 以前には無かった退行。URL を手で書き換えた／途中で切れたリンク（末尾が `%`）を開いただけで、計画の画面が使えなくなる。通常の操作で踏む確率は低いが、画面全体が落ちる。
- 修正の方向: `decodeURIComponent` を `try { … } catch { return; }`（失敗したら何もしない。または生の hash でそのまま探す）で囲む。E2E（`sprint17-db`）に `#%zz` で画面が出ることの 1 件を足す。

### 条件の外の観察（要修正ではない。17-2 以降で扱うか、ユーザー判断）

- **O-1 戻る・進むで再実行される**: `/overview#procedures` で手で 120px までスクロール → 「日誌」へ → 「戻る」で、ブラウザが復元するはずの 120px ではなく `#procedures`（`sy=1411`）に戻る。`HashScroll` が画面のマウントごとに走るため。hash のある URL に戻ったのでその節に着く、というのは悪い挙動ではないが、ブラウザの戻るの位置の復元とは違う。375・1280 とも同じ。
- **O-2 フォーカスを動かさない**: スクロール後の `document.activeElement` は常に `BODY`。移動先の `#confirm`・`#procedures` などは `div`（`tabindex` なし、見出しとの `aria-labelledby` なし）なので、キーボードの次の Tab は画面の先頭から始まり、スクリーンリーダーには「節に着いた」ことが伝わらない（ネイティブの hash 遷移はフォーカスの起点を移す）。見える位置への移動という契約の趣旨は満たす。改善案（節に `tabIndex={-1}` を付けて `focus({ preventScroll: true })`）は generator/designer の判断。
- **O-3 `prefers-reduced-motion`**: `scrollTo({ top })` は `behavior` 指定なしで、`html` の `scroll-behavior` は `auto`（実測）。常に瞬時で、アニメーションは無い。reduced-motion でも `top=64` に着く（実測）。問題なし。
- **O-4 手でスクロール中に動かさない**: 対象が無い場合（確認依頼済みの `#request-confirmation`、下書きの `#confirm`）は、6 秒の待機中も何もスクロールしない。0.8 秒ごとに 300px 手でスクロールし続けても、9 回の位置が +300 ずつで乱れない（375・1280）。対象があるときは、同じ塊で DOM に既にあり、1 回の `requestAnimationFrame` の後に 1 度だけスクロールする（コードと実測）。待機が長引くのは対象が後から現れる場合に限り、その間に手で動かしていると 1 度引き戻されうる（実測せず。コードの読み）。
- **O-5 P3a-4 の押し直し**: `sprint12h-pr3-db` の点検の行のクリックは、最大 3 回押し直し、それでも遷移しなければ `goto(href)` に切り替える。成功時の期待は同じだが、「クリックで遷移する」挙動が壊れても、`href` が正しければテストは通る。既知の不安定のためのもので、`tapAndWait`（リポジトリ内の同じ作法）と揃っている。クリックの遷移が本当に不安定な原因（未特定）は残る。今回の全体実行では成功。
- **O-6 小さな点**: `expectInViewport` の下限は `y >= 0`（1280 の sticky ヘッダ 56px の下かは見ていない）。実測は全件 64px なので現状は問題なし。`#sec-report` の検査は、主画面の上部で元からビューポート内に入りうるので弱い（以前の `toHaveCount(1)` よりは強い）。`sprint-17-testids-baseline-log.txt` の最初の行の日時は手書き（`…T00:00:00.000Z`）で、記録そのものは強制力を持たない（実体はハッシュの固定）。

## 1. `git diff 1d82cd1..07f8058 -- e2e apps/**/*.test.ts scripts` の精査（穴を隠していないか）

| 変更 | 判定 | 所見 |
|---|---|---|
| `tapSize` に `toBeVisible()` | ✅ | 期待値（高さ 43.5 以上など）は不変。待ちを足しただけ。本来の失敗（要素が無い）は `toBeVisible()` が 30 秒で失敗として出す。隠していない。 |
| `goto` → `gotoPlan`（約 70 か所） | ✅ | 待つのは可視の `plan-tabs`（`PlanFrame` は本文と同じ非同期の塊なので、タブが見えれば本文も DOM に在る。pr3b1 の `main h1` 待ちとも整合）。`toHaveCount(0)` 系の偽の成功を防ぐ方向。 |
| `onAllPlanScreens` | ✅ | 検査範囲が **広がった**（1 画面 → 4 画面）。12b の「許可済み」は `bodyText` の `not.toContain` を 4 画面で回す。検査後に元の URL に戻る。`/report` は含まない（前述）。 |
| `SCREENS` への 3 画面追加（pr3b1・pr3b2b・非 DB の 404） | ✅ | 基準は不変。範囲が広がった。pr3b1 の計画は `flags: []` の下書き 1 件（状態の多様さは限定的）。 |
| `expectInViewport`（S-6 と次にやること） | ✅（O-6 の限界あり） | URL と存在だけだった検査に、可視と上端のビューポート内を追加。`#request-confirmation` は専用の下書きの計画で検査（仕様どおり、確認依頼済みでは要素が無い）。 |
| `testids.mjs`／単体テスト | ✅ | コメントを除いて収集（収集が減る側の変更なので、「消えた」判定は厳しくなる）。基準の固定は有効。 |
| 期待値の削除・緩和 | なし | 文言・件数・寸法・比・`data-*` の期待を弱めた差分は見つからなかった。 |
| `permit-ui.tsx` の根拠の計画の行き先を `/judgement` に | ✅ | 契約の趣旨（判定の情報は判定の画面）と合う。既存の E2E は行き先を検査していない（作業記録に明記あり）。 |

禁止領域: `packages/**`・`apps/web/src/app/api/**`・マイグレーション・`ENGINE_VERSION`・証跡 ID に差分なし（`git diff 1d82cd1..07f8058 --stat` の 20 ファイルに含まれない）。

## 2. スクロールの実測（手動シナリオ、実ブラウザ）

方法: `ev171m` に下書き・確認待ち・判定が古い計画（機体の最大離陸重量を訂正）を作り、ログイン済みの Chromium で `goto("/ops/plans/{id}#旧アンカー")` し、最終 URL が移動先に着いてから `getBoundingClientRect().top` を 150ms ごとに測る（上バー: 375 では非 sticky、1280 では sticky 56px。下タブは 375 で固定）。

- **旧アンカー 8 本 × 3 状態 × 375・1280**: 要素があるもの（`#sec-verdict`・`#permits`・`#rejudge`・`#sec-confirm`・`#confirm`・`#procedures`・`#sec-report`、下書きでは `#request-confirmation`）は **全件 `top=64`**（例外: 1280 の `#request-confirmation` は 86、`#sec-report` は 178 = ページ末尾に達して動けない位置で、画面内）。前回は `scrollY=0`。375 では `scrollY` 400〜3,166px に着く。
- **要素が無い場合**: 下書きの `#confirm`、確認待ち・判定が古い計画の `#request-confirmation` は要素が無い（仕様どおり）。URL は移動先に着き、スクロールせず、エラーも無い。
- **低速（遅延 400ms・60KB/s・CPU 6 倍）**: 確認待ち・判定が古い計画の全件が `top=64` に着く（2.5〜3.4 秒）。最初のコールドな下書き 1 件（と 1280 の 1 件）だけ、20 秒の観察窓で移動先に着かなかった（JS の初回取得が遅いため）。別に 60 秒まで待つ単独の再測定（判定が古い計画の `#rejudge`、コールド・同じ低速）では **約 22 秒後に `/judgement` へ移り `top=64` に着いた**（375・1280 とも）。着くのが遅いのは回線の速さであり、スクロールの不具合ではない。
- **「次にやること」のクライアント遷移**（主画面で押す。下書き: 手続き・確認の依頼、確認待ち: 手続き・確認、判定が古い: 手続き・確認・再判定）: 375・1280 の全 14 件が `top=64`（1280 の下書きの確認の依頼は 86）。375 では前回「確認の操作が最初の画面の外」だった `#confirm` が `sy=2837` で最上部に着く。
- フォーカス: 全件 `BODY`（O-2）。`hashchange`（同じ画面で `location.hash` を変える）も `top=64`。

## 3. 実行したコマンドと結果

| 内容 | 結果 |
|---|---|
| CI run 41271304026（07f8058） | typecheck/lint/test/build・smoke・e2e（Playwright）・db の 4 ジョブすべて success |
| ローカル `pnpm typecheck` / `pnpm lint` / `pnpm test` | すべて exit 0 |
| ローカル `REQUIRE_DB_TESTS=1 pnpm test:db` | 9 ファイル 259 件成功 |
| ローカル `pnpm build`（07f8058） | ✅ |
| ローカル `pnpm test:e2e:ops`（空の DB `ev171r`、全体、ポート 3410〜3412・3498・3499） | **158 passed（18.9 分）**。失敗 0・未実行 0。既知の不安定（P3a-4・P3b2b-6・A7・P3a-5）も今回は成功。ログ: scratchpad の `reeval-full.log` |
| 手動シナリオ（§2）、HashScroll の副作用 | scratchpad の `manual-scroll.cjs`・`manual2.cjs`・`manual3.cjs`（リポジトリに差分なし）。ログ: `manual-scroll-out.log`・`manual2-out.log` |
| `node scripts/testids.mjs --check` / `--write`（理由なし） | 消えた識別子は 0 / 終了コード 2 |

CI の成功（1 回）とローカル全体（1 回）で、E2E-DB の根拠は 2 回分。

## 4. 検証できなかったこと

- 公開側 `pnpm test:e2e`（OPS 無効、`next start`）はローカルで再実行していない（CI で成功）。
- 対象が後から現れる場合に、手でスクロール中に 1 度引き戻されるかは実測していない（O-4、コードの読み）。
- 実際のスクリーンリーダーでの確認はしていない（O-2 は DOM の状態からの推論）。
- 確認済み・通報済みの計画での旧アンカー（`#request-confirmation` は要素なしで同じ扱い）は、確認待ちで代表した。
- 手動シナリオの 375 は `hasTouch: true` のみで、実機のタッチスクロールではない。

## 5. ユーザーの判断が要る点

- O-1（戻る・進むでの位置）と O-2（フォーカスの移動）を 17-2 の範囲で直すか、現状でよしとするか。R-1 だけを直して 17-1 を閉じるのが最小。
- 前回の「中止した計画（通報の記録なし）に『通報：要』と出る」点を 17-2 で扱うかの判断が残っている（今回は変更なし）。

## 6. 差し戻し（generator へ）

1. R-1: `hash-scroll.tsx` の `decodeURIComponent` を例外から守る。`sprint17-db` に「壊れた % の hash（`#%zz`）でも計画の画面が出る」検査を足す（`--repeat-each=3` 以上）。
2. 任意: O-2（節への `tabIndex={-1}` とフォーカスの移動）、O-1。
3. R-1 の修正後は、`sprint17-db` と `pnpm typecheck / lint / test` と CI の確認だけで再評価できる（全体の E2E の再実行までは要らない）。
