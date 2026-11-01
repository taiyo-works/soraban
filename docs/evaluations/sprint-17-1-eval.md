# Sprint 17-1 評価レポート（evaluator、2026-11-01）

対象: PR #49（ブランチ `claude/vigilant-fermi-g54nho`）のコミット `1d82cd1`（Sprint 17-1 を含む）。契約: `docs/sprints/sprint-17.md`（17-1 に該当する S / J / T）。
環境: ローカルは PostgreSQL 16 + 空の DB（`ev171a`。マイグレーション＋`db:seed:ops-test`）、Chromium `/opt/pw-browsers/chromium`、`next start`（`pnpm build` 直後）。CI は GitHub Actions（run 41260671901 と run 41264239463）。

## 0. 結論（先頭）

### A. CI の失敗の切り分け

**差し戻し先: generator（テストの不備。実装の機能不備ではない）。環境差でも既知の不安定でもない。**

| 項目 | 内容 |
|---|---|
| 失敗したテスト（1d82cd1 の CI） | `e2e/ops-db/sprint12a-db.spec.ts:214` 「11・16・17・20. 計画をフォームで作る → 確認を依頼 → 確認（自己確認）→ 訂正すると『前の版への確認』」 |
| エラー | `Error: plan-request-confirmation / expect(received).not.toBeNull() / Received: null`（`tapSize`、`sprint12a-db.spec.ts:152`、呼び出し 267 行）。run 41264239463 の E2E-DB は 1 失敗・8 未実行・149 成功（16.8 分）。 |
| 未実行の 8 件 | 同じ describe が `serial` のため、上の失敗の後ろの 12a の 8 件（16・9・13/14・17・17・18・認可・20）が走らない。ローカルでこのテストを除いて単独実行すると 9 件（未実行だった 8 件＋テスト 2）全て成功（`--grep-invert "11・16・17・20"`）。 |
| ローカルで再現するか | **する**。1d82cd1 の全体実行（空の DB）で同じテストが失敗。単独の `--repeat-each=3` で 2/3 が失敗（失敗する要素は `plan-basis-link`（/judgement）または `plan-request-confirmation`（/overview）で、回ごとに変わる）。 |
| 原因 | 17-1 でテストに足した `page.goto(".../judgement")` と `page.goto(".../overview")` の直後の `tapSize`。新しい画面は Suspense でストリーミングされ、描画の直後は本文が `<div id="S:n" hidden>` の中にあり、DOM には在るが `display:none`。`expect(...).toContainText("下書き")` は非表示の要素でも通るため待ちにならず、続く `tapSize` の `boundingBox()` が `null`（非表示）になる。実測: 失敗時の祖先の連鎖は `BUTTON(0) > ... > DIV#S:3[hidden]:none`。成功時は同じ要素が 48px で可視。 |
| 実装の不備か | いいえ。画面は最終的に正しく描画される（下の修正で 4/4 成功）。ただし、旧い計画の詳細ページでは起きなかった（初出の要素が同期描画だった）ため、17-1 のテストの移し方（URL だけ変えて待ちを足していない）の不備。 |
| 修正の方向 | `e2e/ops-db/sprint12a-db.spec.ts` の `tapSize` の先頭に `await expect(page.getByTestId(testId).first()).toBeVisible();` を足す（`boundingBox()` の前）。検証: そのコピーを `--repeat-each=4` で実行し 4/4 成功（後半の「訂正 → 再確認」まで通る）。他にも `goto` 直後に `boundingBox`／`toHaveCount` だけで待つ箇所が 65 か所（`e2e/ops-db/*`）あるので、新しい `goto` の直後は可視の assertion を置くこと。期待値は弱めない（待ちを足すだけ）。 |
| fd2c82e の CI（run 41260671901）との関係 | 7 失敗・31 未実行。**失敗 1〜5（12a・12b・12c・12d・12e）は、`a0a77cf` で画面を移したのに、そのコミットまでの E2E の URL がまだ旧いまま**（URL の移動は次の `6bfe73a` 以降）だったため（例: `plan-confirmation-status` が `/ops/plans/[id]` に無い）。1d82cd1 では解消。失敗 6（12g-1b A7 の縦位置 911 > 752）と 7（12h-pr3 P3a-5 の `waitForURL` タイムアウト）は **1d82cd1 の CI では成功**、ローカルでも成功。fd2c82e の環境（12a が途中で止まり、後続のデータの状態が違う）に依存した可能性があるが、原因は特定できていない（再現せず）。P3a-5 は既知の不安定な 12h-pr3 P3a-4 と同系統の可能性。 |
| 環境差 | PostgreSQL 18（CI）でも `pnpm test:db` は成功。CPU が遅いランナーはタイミングを悪化させるが、ローカル（PostgreSQL 16）でも 2/3 で再現するので、原因は環境ではない。 |

追加の観察（要注意）: ローカルの全体実行では、上の 1 件に加えて `sprint12h-pr3b2b-db.spec.ts:226` P3b2b-6（`router.push("/ops/incidents")` の後 `incident-list-page` が出ない）が 1 回失敗。単独 `--repeat-each=4` は 4/4 成功、CI の 2 回（fd2c82e・1d82cd1）は成功。**不安定（原因未特定）。`local-verification.md` の既知の不安定なテストに候補として足してよい。** 1d82cd1 の変更は 12h の画面に触れていない。

### B. Sprint 17-1 の総合判定: **条件付き合格**

要修正は 2 件（いずれも generator）。

1. **【CI が赤】** 上記 A の `tapSize` の競合（テストの修正。数行）。
2. **【機能】旧アンカーの移送・「次にやること」の移動の後に、目的の位置までスクロールされない。** 下の「不具合 1」。

それ以外の契約項目は満たす（詳細は §2）。

## 1. 契約項目ごとの判定（17-1 の範囲）

| # | 判定 | 根拠 |
|---|---|---|
| S-1 | ✅ | 5 画面（主・`/report`・`/overview`・`/journal`・`/judgement`）に `plan-tabs`（`aria-label="計画の画面"`）。現在に `aria-current="page"`（`/report` は「通報」、`/judgement` はどれにも付かない）。`/field` は直接開くと 0 件。タブは 81×48px（375×812、1280×800 とも高さ 48）。順は計画｜通報｜当日｜日誌。 |
| S-2 | ✅ | 主画面と `/report` に `plan-judgement`・`plan-snapshot-seq`・`plan-permit-*`・`plan-rejudge` 等が 0（`sprint17-db` S-1 系、CI 通過）。判定の本体は `/judgement` だけ。 |
| S-3 | ✅ | 主画面に確認の一覧・版・概要・飛行記録・手続きが無い。移動先にある（CI 通過）。 |
| S-5 | ✅（ただし不具合 1） | `planHref` の行き先は新しい画面。一覧の行・保存直後は主画面。行き先の URL は正しい。 |
| S-6 | ✅（ただし不具合 1） | 旧アンカー 8 本を 375 と 1280 で実ブラウザで確認。7 本は `/judgement` または `/overview` に hash を引き継いで移る。`#sec-report` は主画面のまま。履歴は `location.replace` なので「戻る」でループしない。`#request-confirmation` は確認依頼済みの計画では要素自体が無い（仕様どおり）。 |
| J-1（暫定） | ✅ | 判定の 1 行（`plan-judge-line`）が常にある。ラベル「判定（補助）」＋結論の段＋判定不能の件数＋「判定が古い」。「判定を見る」→ `/judgement`。 |
| J-2（17-1 範囲） | ✅ | `sprint17-db` の J-2（判定の画面・snapshots を一度も開かず、確認の依頼 → 確認 → 通報の記録（新規）→ 変更 → 取消）が、ローカルと CI で成功。`request` の監視で `/judgement`・`/snapshots` への遷移が 0。 |
| J-3 | ✅（一部検証不能） | 判定が古い計画で通報の記録フォームが有効（CI 通過）。「判定を読み込めない（失敗の模擬）」は未検証（17-2 の範囲）。 |
| J-4 | ✅ | 禁止語（通報不要・通報は不要・通報の必要はありません・通報しなくて・問題なし・大丈夫・`OK`）を、7 状態（下書き・確認待ち・確認済み相当・判定が古い・中止・通報記録待ち・判定不能 4 件）×5 画面×2 幅で走査し、主画面・`/report`・`/overview`・`/journal` は 0 件。`/judgement` にだけ「手続き不要」（判定の段の語。§5.3 が判定の画面の中では従来どおりとしている）。判定が古い計画の 1 行は「要手続き ! 判定が古い」、判定不能の計画は「要手続き（判定不能 4 件（データ未整備））」で、安全側に読める語は無い。 |
| T-1 | ✅ | `node scripts/testids.mjs --check` → 消えた識別子 0。CI の単体テストも成功。 |
| T-2 | ✅（精査済み） | `git diff fd2c82e..1d82cd1 -- e2e` と `8381ca7..1d82cd1` の単体テストを精査。変更は `page.goto` の URL、移動先の追加、`#procedures$` → `/overview#procedures$`（より厳密）、`plan-report-reasons` の検査位置の入れ替えだけ。期待値（文言・件数・寸法・比・`data-*`）の削除・緩和は無い。`toHaveCount(0)` は実際に出る画面へ移してあり、弱まっていない。 |
| T-3 | ✅ | `packages/**`・`apps/web/src/app/api/**`・マイグレーション・`ENGINE_VERSION`・証跡 ID に差分なし。`server/**` は `report-logic.ts` の `planHref` の 4 行と、その単体テスト 1 行だけ。 |
| T-4 | ✅ | 免責（`plan-disclaimer`）は主画面と `/judgement` に出る。文言の定数は変えていない。 |
| T-5 | ✅（CI） | 公開側 `pnpm test:e2e`（OPS 無効）は 1d82cd1 の CI で成功。 |
| T-6 | ❌（CI の E2E-DB が赤） | typecheck・lint・test・build・`test:db`（PostgreSQL 18）・公開側 e2e は CI で成功。E2E-DB は上記 A の 1 件で失敗。ローカルの全体: 148 成功・2 失敗（A の 1 件と不安定な P3b2b-6）・8 未実行。 |
| D-2 / D-3 | ✅（部分） | タブ 48px。全画面で横スクロール 0（`scrollWidth ≤ clientWidth`、7 状態×5 画面×2 幅）。 |
| L（長さ） | 17-2 の範囲（参考値） | 375×812 の主画面: 下書き 2,098・確認待ち 2,074・判定が古い 2,177・中止 1,474px（L-1 の 2,600 以下を満たす）。`/judgement` 4,931px（L-4 の目標 4,600 を超える）、`/overview` 4,057px（目標 3,000 を超える）、`/journal` 1,069px。17-1 では中身を移しただけなので、17-2 で詰める。 |

## 2. 見つけた不具合

### 不具合 1（要修正・機能）: 旧アンカーの移送と「次にやること」の移動の後、目的のセクションまでスクロールされない

- 再現（375×812 と 1280×800 の両方、実ブラウザ。確認待ちの計画）:
  1. `/ops/plans/{id}#procedures` を開く → `/ops/plans/{id}/overview#procedures` に移るが、`scrollY=0`（`#procedures` は上から 1,475px / 1,215px の位置。見えない）。`#confirm`（2,901 / 2,338px）、`#permits`（3,134 / 2,024px）も同じ。**旧アンカー経由 6 通りのうち 0 通りでスクロールされない**。
  2. 主画面の「次にやること」の先頭（許可・承認 → `/overview#procedures`）を押す（クライアント遷移）→ `scrollY=0`、見出し位置は 1,475 / 1,215px。375px では確認の操作（`#confirm`、2,901px）が最初の画面の外のまま。
  3. 比較: 直接 `goto("/overview#procedures")` は `scrollY` が合う（要素が先に在る場合）。`#confirm`・`#permits` は 375px で合わない回もあり、**不安定**。
- 影響: 契約 §5.1「次にやること（planHref）の行き先」と §5.2「旧いアンカーを新しい場所へ移す」の趣旨（目的のセクションに着く）を満たさない。主画面から「確認する」を押しても、計画タブの先頭に着くだけで、確認の操作を探してスクロールさせる（L-6 の「1 回の押下で移れる」の意図に反する）。E2E は URL と要素の存在しか見ていないので通っている。
- 原因（未特定、見立て）: 移動先の本文が Suspense のストリーミング（`hidden` の `div#S:n`）の中に入った後に挿入され、ブラウザ／Next の hash へのスクロールが空振りしている。
- 修正の方向: 移動先（`/overview`・`/judgement`）に小さな client 部品を置き、マウント後（表示された後）に `location.hash` の要素へ `scrollIntoView` する（`PlanAnchorCompat` の置換後にも効く）。または確認の操作を `/overview` の先頭に置く。E2E に「移動後に対象の要素の `boundingBox().y` が画面内」の検査を足す。

### 不具合 2（要修正・CI）: `tapSize` の競合（A の通り）

### 観察（要修正ではない）

- クライアント遷移（タブの切り替え）の後、前の画面の DOM が非表示（`display:none`）のまま残り、`plan-tabs` が 2 つ以上になる（例: 計画 → 通報 → 日誌 と押すと 3 つ。`/field` へ押して行くと `plan-tabs` が 2 件）。見た目・タブ移動・`aria-current` の可視側は正しい。ただし E2E で、クライアント遷移の後に `getByTestId("plan-tabs")`／`plan-tab-report` を strict で使うと「2 要素」で失敗する（`locator('nav:visible')` が必要）。`goto` で開く現在のテストには影響しないが、後続スプリントで注意。
- 中止した計画の状態の札は「中止」、通報の札は「通報：要」のまま、次にやることは「いまやることはありません」（通報の記録が無い中止の計画）。17-1 の移動で変えた挙動ではない。17-2 で扱うか、ユーザーに確認。
- 状態 5 種（下書き・確認待ち・判定が古い・中止・判定不能）の主画面を 375×812 と 1280×800 で撮影・目視。札は記号＋文字で区別され、色だけに頼っていない。固定の下タブは `fullPage` 撮影で本文に重なって写るが、実機の挙動ではない（撮影の都合）。

## 3. 実行したコマンドと結果

| 内容 | 結果 |
|---|---|
| CI run 41260671901（fd2c82e）E2E-DB | 7 失敗・31 未実行・115 成功（14.5 分）。上記 A の通り |
| CI run 41264239463（1d82cd1）typecheck / lint / test / build | ✅ |
| 同 `pnpm test:db`（PostgreSQL 18） | ✅ |
| 同 公開側 `pnpm test:e2e` | ✅ |
| 同 E2E-DB | ❌ 1 失敗・8 未実行・149 成功（16.8 分）。失敗は `sprint12a-db` 214 |
| ローカル `pnpm build`（1d82cd1） | ✅ |
| ローカル `pnpm test:e2e:ops`（空の DB `ev171a`、全体） | 2 失敗（12a の 214、12h-pr3b2b の P3b2b-6）・8 未実行・148 成功（14.6 分）。ログ: `…/scratchpad/ops-full.log` |
| 12a 214 の単独 `--repeat-each=3` | 1 成功・2 失敗（`plan-basis-link` / `plan-request-confirmation` が `boundingBox()==null`） |
| 同 `tapSize` に可視の待ちを足したコピー `--repeat-each=4` | 4/4 成功 |
| 12a の残り（214 を除く） | 9/9 成功 |
| 12h-pr3b2b P3b2b-6 `--repeat-each=4` | 4/4 成功 |
| 手動シナリオ（実ブラウザ、375×812・1280×800、7 状態×5 画面、タブのクリック、旧アンカー 8 本と「戻る」、禁止語の走査、スクロール位置の測定） | 上記 §1・§2。作業用の一時スペックは削除済み（リポジトリに差分なし）。スクリーンショットとログは `…/scratchpad/shots2/` |
| `node scripts/testids.mjs --check` | 消えた識別子 0 |

## 4. 検証できなかったこと

- 判定を読み込めない状態（失敗の模擬）の 1 行（J-3 の一部・J-5）。17-2 の範囲として未実施。
- 「確認済み」の状態の見え方は、確認の API で作成できたが（201）、撮影は「確認待ち」と同じ画面を確認した範囲に留まる（画面は確認の 1 行の札が違うだけ）。
- 通報済み・変更が必要・取消済みの主画面の各状態の目視は、`sprint17-db` J-2 が検査する `plan-report-status` の `data-code` の確認に留まる（撮影していない）。
- 不具合 1 の原因を特定していない。旧い（8381ca7）ビルドでの hash のスクロールとの比較は未実施（同一ページのアンカーなので動いていたはずだが、実測していない）。
- 手動の通報の記録の UI 操作（フォームへの入力）は E2E（J-2）で代替した。

## 5. ユーザーの判断が要る点

- 中止した計画（通報の記録なし）の主画面に「通報：要」と出る点を 17-2 で変えるか。
- 不具合 1 の修正を、確認の操作を `/overview` の先頭に置く（構成の変更）か、スクロールの補助（部品の追加）にするか。generator に任せてよい範囲の判断。

## 6. 差し戻し（generator へ）

1. `e2e/ops-db/sprint12a-db.spec.ts` の `tapSize` に可視の待ちを足す（A の修正の方向）。同ファイルほか、17-1 で足した `goto` の直後の `boundingBox` 系も確認。`--repeat-each=3` 以上で不安定さが無いことを確かめる。
2. 不具合 1: 移動先でのセクションまでのスクロール。E2E に位置の検査を足す。
3. CI の E2E-DB が緑になったら、評価を合格に更新する（再評価は、上の 2 点の確認だけ）。
