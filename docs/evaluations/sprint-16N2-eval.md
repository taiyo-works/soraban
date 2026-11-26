# Sprint 16-N2 評価（evaluator、2026-11-26）旧い層の撤去・全体の検査・許可リストと棚卸しの整理

- 対象: HEAD `199ede6`（評価のコミットを除く。アプリ・テストの差分は評価中 0）、基準 `44d3266`。評価者はアプリのコードを変えていない。一時の計測用の変更（寸法の `console.log`、撮影・N-4 用の spec、R-1 の確認、旧コードの切り替え）はすべて元に戻し、作業ツリーの差分は 0（`git status` clean）。基準のビルドは `git worktree`（評価後に削除）で行い、メインの作業ツリーのコードは切り替えていない。
- 環境: 空の DB を実行ごとに新規作成（マイグレーション 18 件＋`db:seed:ops-test`）。`pnpm build` は HEAD（`APPLICATION_SUPPORT_ENABLED` 未設定）。E2E はフルの Chromium・`--no-sandbox`・1 ワーカー・`--retries=0`。公開側は CI と同じ `CI=1`・`next start`。
- **総合判定: 条件付き合格**（差し戻しなし。要確認 1 件はユーザー判断／designer の見解。§4.2）。契約の「全 PR 共通」、元の N-1〜N-4、N2-1〜N2-3、§17 の 28・29 を満たす。ただし、ログアウトの確認（送信待ちあり）の 4 つのボタンの見た目が、報告されていた「ログアウトのボタンだけ」より広く変わっている（レビュー N-4 の予想どおり）。機能・寸法・禁止語の違反ではない。

## 1. 機械の検証（ログ `docs/evaluations/logs/sprint-16N2-eval-*`）

| 項目 | 結果 | ログ |
|---|---|---|
| typecheck / lint | ✅ / ✅（警告 0） | `-typecheck.log`・`-lint.log` |
| `pnpm test` | ✅ 134 ファイル・3,098 件通過（15 skip） | `-unit.log` |
| `REQUIRE_DB_TESTS=1 pnpm test:db` | ✅ 10 ファイル・289 件 | `-test-db.log` |
| `pnpm build`（HEAD）／基準のビルド | ✅ ／ ✅ | `-build.log`・`-build-base.log` |
| コントラスト検査 | ✅ 満たさない 0（402 件＋日差し 194 件。日差し・現場の最小余裕 4.53／要 4.5） | `-contrast.log` |
| `testids --check` | ✅ 消えた識別子 0（ただし基準の一覧を 2,242→2,215 に書き直した結果。§1.2） | `-testids.log` |
| ops E2E 全体（空の DB `ev16n2_ops1`） | ✅ **439 通過・8 skip・失敗 0**（28.7 分） | `-ops-e2e.log` |
| 公開側 E2E 全体（CI と同条件） | ✅ **353 通過・失敗 0**（15.4 分。`sprint9` 306 も通過） | `-public-e2e.log` |

### 1.1 K-11・差分の点検（44d3266..HEAD）

- `packages`・`apps/web/src/server`・`apps/web/src/app/api`・マイグレーション・`package.json`・lockfile の差分: **`server/ops/prep-card-logic.ts` の 3 行目の注釈 1 行だけ**（`Q-L16〜Q-L18` → `Q-L24〜Q-L26`）。`ENGINE_VERSION`・証跡 ID・`evidence_log` は差分 0。✅
- 撤去した名前・部品への参照（`ui/primitives`・`overlays`・`forms`・`data`・`workspace`・`tabs`・`command-palette`・`journey-line`・`verdict-stamp`、`workspace-*`・`toast*`・`command-palette`・`shortcut-sheet`・`filter-count`）を `apps packages e2e scripts` で grep（`.next` 等を除く）: コード上の参照 0。残るのは、新しい `legacy-sweep.test.ts`・`ui-parts.test.ts`・`testids-baseline.test.ts`・`ops-v2-conventions.test.ts` の記述、`info-popover.tsx` と `ops-client.tsx` のコメント、`tsbuildinfo` の生成物だけ。✅
- `Q-L1[6-9]` の grep 0。✅
- 追加行の禁止語（完璧・保証・代行・代理・通報不要・問題なし・飛行可・申請）: 0。「必ず」は 3 行で、すべて新しいコメント・テストの文（許可リストから外したことの説明）で、画面の文言ではない。✅
- 既存の検査を弱めていないか: 書き換えは `design-tokens.test.ts`（12g の色の層そのものを撤去したため、その層だけの比の検査を撤去の確認に置換。`--sb-*` の全組のコントラストは P1-6・P1-7 とコントラスト検査 402 件が守る）、`ui-parts.test.ts`（削除した部品の検査）、`icons.test.ts`（`>10`→`>=8`。ファイル 16→8）、`testids-baseline.test.ts`、`wording-policy.test.ts`。いずれも撤去・外した行に直結し、理由が test-changes に書かれている。`sb-conventions`・`ops-v2-conventions`・E2E の既存の spec は差分 0（E2E は `sprint16-c-db` に +28 行の追加のみで、`-` 行 0）。✅

### 1.2 識別子の基準の書き直し

27 件（`workspace-*`・`toast`・`toast-region`・`command-palette`・`shortcut-sheet`・`filter-count` と、コード上の渡し方の記録 `prop:`・`式:`）を基準から外した。`docs/evaluations/sprint-16N2-removed-testids.txt` に 27 行がそろっている（レビュー R-2 の対応を確認）。どれも E2E・他のコードからの参照が 0（grep で確認）。K-9 の「実画面の識別子を消さない」に反しない。ただしレビュー N-1（N2-3 の「消さない」と N-1 の「参照 0 の部品を消す」の食い違い）は planner への申し送りのまま。

## 2. 失敗の切り分け・揺れの比較

- **ops 全体・公開側全体は失敗 0**。generator の実行で HEAD だけ 1 回落ちた `sprint16-h1-fix1-db` R-4 は、今回の全体実行では通過。
- **R-4（ファイル全体、新しい DB を毎回）**: HEAD 3/3（各 16/16）、基準 3/3（各 16/16）。再現せず。runbook の既知の不安定（クライアントルーターの遷移が完了しない）で、16-N2 の変更が原因とは言えない（`-r4-head-{1,2,3}.log`・`-r4-base-{1,2,3}.log`）。
- **`sprint9` 306（右クリック。単独 `--repeat-each=6 --timeout=30000`）**: HEAD 1/6 通過、基準 3/6 通過（`-head-s9-306.log`・`-base-s9-306.log`）。同じ待ち（地図の右クリック後の判定の応答）で落ちる。runbook の既知（基準でも 3/6）と過去の評価（HEAD 2/6・旧 1/6）の範囲。全体実行では通過。変更が原因とは言えない。

## 3. 契約項目

| # | 結果 | 根拠 |
|---|---|---|
| 共通 K-1〜K-16（機械で測れる分） | ✅ | §1。コントラスト・文字の下限・押す部品・識別子の検査が通る。新しい画面の文言・識別子の追加なし |
| K-11（判定エンジン・証跡・マイグレーションは不変） | ✅ | §1.1 |
| N-1 旧い層の撤去（grep 0・単体） | ✅ | §1.1。`globals.css`・`ops-v2.css`・`soraban-ui.css` から旧い色の層・`.field`・旧い Tailwind 名を撤去。`design-tokens.test.ts` の撤去の確認が通る。`ops-client.tsx`・`ops-nav.tsx` の旧い部品の読み込みを `.opx-btn`・`ui/info-popover.tsx` に替えた |
| N-2 検査の対象を `apps/web/src/**` 全体に | ✅ | `legacy-sweep.test.ts`（TS・TSX 100 ファイル以上、CSS 5 以上を検査。例外は理由つきの 3 表）。レビュー N-2 の例外の絞り込み（`verdict-display.ts` は `VERDICT_PDF_COLOR` の塊だけ）と N-3 の消した名前の追加（`text-h1`・`text-h3`・`text-stat`・`text-state`・`font-display`・`--tap`・`--fs-h1`・`--hairline`・`--sheet-h`）が入っているのを確認 |
| N-3 `/` と `/ops` の一貫性（E2E） | ✅ | `sprint16-n2-db` が通る（ops 全体で通過）。R-1 の対応: 判定の札の色の比較が 0 回で通らない（§5） |
| N-4 設計文書への注 | ✅ | `design-system-v2-draft.md`・`ui-direction.md`・`palettes.md`・`brand-visual-plan.md` に「置き換え済み」の注（本文は書き換えず、注の追加のみ。`git diff` で確認） |
| N2-1 許可リストの整理 | ✅ | §6 |
| N2-2 注釈の番号 | ✅ | §1.1 |
| N2-3 撤去で見た目を変えない | ⚠ 条件付き | §4。ホーム・計画作成の各段・点検の入力・日誌・現場・`/` は画素一致。差は利用者メニューのログアウトのボタン（意図）に加え、**送信待ちありのログアウトの確認の 4 つのボタン**（意図は未確認） |
| §17 の 28・29 | ✅ | 28（既存の検査を弱めない）は §1.1。29（余裕の薄い寸法）は §5 |
| `data-testid` を消さない | ✅ | `testids --check` 通過。実画面の識別子の消失 0（消えたのは参照 0 の 27 件。§1.2） |

## 4. 撤去で見た目が変わらないこと（N2-3・レビュー N-4）

撮影: `docs/evaluations/screenshots/sprint-16N2/eval/{before,after}`（基準 `44d3266`／HEAD、375×812・1280×800、ページ全体。`e2e/ops-db/sprint16-n2-shots.spec.ts` を同じ条件で両方に流した。ブラウザの時計は固定、外部の地図タイルは遮断）と `eval/n4-{before,after}`（N-4 用。スクリプトは `logs/sprint-16N2-eval-n4-spec.ts.txt`）。画素の差は PIL で、計算されたスタイルの差は全要素ダンプで比べた。

### 4.1 画素・スタイルの比較結果

| 画面 | 375 | 1280 |
|---|---|---|
| ホーム・計画の一覧・日誌・点検の一覧・点検の入力・飛行記録・このアプリについて・機体・事故・計画の主画面・判定・現場（離陸前）・計画作成 ①〜⑤ | **画素一致（差 0）** | **画素一致（差 0）** |
| 公開の `/`（`pub-top`） | 差は証跡 ID（乱数）と判定日時の文字だけ（目視で確認） | 同左 |
| ログイン済みの `/`（`pub-loggedin-*`） | 差は同様の動的な文字だけ。**下メニュー（`ops-bottom-nav`）の計算されたスタイルとタブの寸法（高さ 64・幅 83.8・14px）は前後で完全一致**（JSON の diff 空） | 下メニューは非表示（`lg:hidden`）で同じ |
| 利用者メニュー（開いた状態・ⓘ・ログアウトの確認なしの押下前） | ログアウトのボタンだけが差 | 同左 |

- 全要素の計算されたスタイルの差（`styles-before`/`after`）: 画素に出ない差は、行の遷移と利用者メニューの出現の `transition-duration` が 0.2s → 0.18s（`--dur` → `--sb-dur`）だけ（generator の報告どおり）。
- ログアウトのボタン（`signout`）: 面 `#F6F7F9`→`#EEF1F5`、角丸 8→12px、太さ 500→600、高さ 48 のまま。意図した差。✅

### 4.2 レビュー N-4 の確認：送信待ちがあるときのログアウトの確認（要確認）

a-pilot で圏外のまま離陸を押して端末に送信待ちを 1 件作り、`/ops/more` の利用者メニュー → ログアウトで警告を出した状態を、基準と HEAD で撮った（`eval/n4-before/signout-warning-375.png`・`eval/n4-after/signout-warning-375.png`、`signout-metrics-*.json`）。文言・ボタンの順・識別子は前後で同じ。差は次のとおり。

| ボタン | 基準 → HEAD |
|---|---|
| `signout-send`（主） | 面・文字・高さ 56 は同じ。角丸 8→12px、枠が主色になる |
| `signout-cancel`（やめる） | 面 `#F6F7F9`→`#EEF1F5`、角丸 8→12px、太さ 500→600、高さ 56 のまま |
| `signout-keep`（残してログアウト） | 同上の形の差。高さ 141→127px（上下の余白と行間が詰まる）。2 行目の説明が「…同じ／人がログインすると…」と、**文の途中で折り返す**（基準は「。」で折れていた） |
| `signout-discard`（送らずにログアウト） | **面が危険の薄い赤 `#FDE8E6`・枠が濃い赤 `#8A1A12` → 他の副ボタンと同じ `#EEF1F5`・灰色の枠**（文字色の濃い赤 `#8A1A12` と「（記録を捨てる）」の文は残る）。高さ 72→59px。角丸 8→12px |
| 警告の面（`signout-warning`） | 高さ 443→415px（-28px） |

- 原因: `.opx-btn-danger` は 16-C の定義（`ops-v2.css`）で「副の形で文字だけ危険の文字色」。旧い `ui/primitives` の `danger` は面と枠も赤かった。**新しい共通のボタンの定義どおりで、実装の不具合ではない**。`/ops` の他の危険のボタン（現場・事故）と見た目がそろう側の変化。
- 守られていること: 押す部品はすべて 56px 以上（`signout` は 48）。文字 16px。「記録を捨てる」は文字で示され、色だけに頼らない。主ボタンは 1 つ（C-6 の追加の E2E が通る）。禁止語なし。
- 気になる点（軽微・差し戻しにはしない）: ①記録を捨てる操作の面の赤みが無くなり、他の副ボタンとの見分けが文字色と文だけになる ②`signout-keep` の説明文が文の途中で折れて読みにくい ③契約の N2-3 の「差はログアウトのボタンだけ」とは、この画面で食い違う。**ユーザー（または designer）の判断**: このまま（`/ops` の危険のボタンの定義にそろえる）で受け入れるか、`signout-discard` の面・枠だけ旧来の赤みを残すか。受け入れるなら test-changes の「撮影の差」にこの 4 つのボタンの差を追記する（generator の記録は「ログアウトのボタンだけ」になっている）。
- designer の撮影 `docs/evaluations/screenshots/sprint-16N2/design/` は参考にした。designer の実測の値（`signout-metrics-*.json`）は、HEAD の私の実測と同じ。

## 5. 余裕の薄い寸法（HEAD と基準を同じ手順で測定。ログ `-head-ops-dims-instr.log`・`-base-ops-dims-instr.log`・`-head-pub-dims.log`・`-base-pub-dims.log`）

| 検査 | 基準 | HEAD | 上限 | 判定 |
|---|---|---|---|---|
| `sprint12h-pr2` Q-20 ③（375×812） | 2 枚分（スクロール 1,640px 相当） | 同じ | 1,664px | ✅（`[画面] Q-20` の全 8 行が一致） |
| 同 B2（`/` 375 の全体） | 11,646px | 11,646px | 12,000px | ✅ |
| `sprint17-2-db` 作業台（長い計画 375） | 10,385px | 10,385px | 10,400px（余裕 15px） | ✅ |
| 同 voidedRecorded の最初の画面（`plan-report-status` の下端） | 738.45px | 738.45px | 748px | ✅ |
| 同 主画面の長さ（draft／pending／reported／change／voidedNone／voidedRecorded） | 2,055／2,055／1,847／2,023／1,351／1,613px | 同じ | 各上限 | ✅ |
| `sprint16-l-db` E-5（360×740） | 663.95／ナビ上端 667 | 663.95／667 | 同じ（約 3px） | ✅ |
| ホームの A7 | 411.89px | 411.89px | 752px | ✅ |

`[寸法]` の出力は、コミット済みの spec に無い一部（A7・E-5・最初の画面の下端）を、評価者が `console.log` を一時的に足して取り、検査後に `git checkout` で戻した（差分 0）。全 44 件が基準・HEAD の両方で通過し、値は完全に一致。

## 6. 許可リスト（N2-1）

- 外した 1 行（`「飛行の前に必ず DIPS でご確認ください」`。地図の凡例の注記）:
  - 公開 `/`：畳んだ `details` をすべて開いた状態で、`innerText`・`textContent` とも「必ず」が 0。注記は「**緊急用務空域：動的な情報のため、地図には出しません。この判定にも反映していません。飛行の前に DIPS でご確認ください**」（「必ず」なし）で描かれている（`-note-check.log`）。
  - `sprint18-3-wording`（公開）の走査（緊急用務空域を手で選んだ状態と、地点判定の PDF を含む）の記録に「必ず」が 0、`wording-policy` の違反 0（`-wording-pub.log`、WORDING_SCAN_OUT の JSON で確認）。ops 側の走査（A〜D の 4 件）でも 0（`-wording-ops.log`）。
  - 判定の PDF はこの注記を読まない（reviewer の確認どおり。地点判定の PDF の文字列に「必ず」0）。✅
- 残した 5 行は、走査の「許可した文」の記録に実在（描画されている）: `BOUNDARY_SHORT`（`/` の結論の直下）、`BOUNDARY_FULL`（`/` と `/ops/about`）、`DISCLAIMER_JUDGEMENT`（`/` と `/ops/about`）、`OFFICIAL_PROCEDURE_NOTE_TEXT`（`/ops`・`/ops/plans`・`/ops/plans/[id]` ほか 10 ルート）、事故・ヒヤリハットの目安（`/ops/incidents/[id]`）。✅
- `wording-policy` のテストの書き換え（行が無いことと、描く側が `tidyEngineText` で整えていること）は、外す方向（検査が強くなる）で、足す・緩めるはない。✅

## 7. 新しい検査の強さ（旧コードで落ちる確認）

基準 `44d3266` のコードを別の worktree でビルドし、HEAD の検査だけを持ち込んで実行（`-old-unit.log`・`-old-e2e.log`）。

| 検査 | 基準のコード | HEAD |
|---|---|---|
| `legacy-sweep.test.ts` | ❌ 3 件落ちる（旧い Tailwind 名・旧い変数 19 件、色の直書き、CSS の旧い層。`plan-ui.tsx`・`versions.tsx`・旧 `ui/*` を名指し） | ✅ |
| `wording-policy.test.ts`（許可リストに「必ず」の行が無い） | ❌ 1 件落ちる | ✅ |
| `sprint16-n2-db` N-3「`/` と `/ops` の一貫性」 | ❌ 副ボタンの面（`#F6F7F9` と `#EEF1F5`）・角丸（8 と 12px）が食い違う | ✅ |
| `sprint16-n2-db` N-3 現場の形 | ✅（旧コードの違いに感度がない検査。HEAD でも通る） | ✅ |
| `sprint16-c-db` C-6 の追加（ログアウトの確認で主ボタン 1 つ・`data-variant`） | ❌ `signout-send` に `data-variant="primary"` がなく、シートの主ボタン 0 | ✅ |

R-1（判定の札の色の比較が 0 回で通る）の確認（`-r1-fixed-guard.log`・`-r1-prefix-vacuous.log`）: 重なる段を無理に空にする改変を、修正前の spec（`d549ec8^`）に入れると**通ってしまう**（空振り）。修正後の spec では「比べる段 needs が両方にある」で**落ちる**。✅（確認後、spec は `git checkout` で戻した）

## 8. デザイン 4 基準の採点

| 基準 | 結果 |
|---|---|
| 主色 1 色（`#1F5FE0`）、飾りの色・影なし | ✅ 主ボタンは主色の面に白の文字。有彩色は主色と状態色（危険の文字色）だけ。影なし（`box-shadow:none`、検査 K-3 通過）。暗い表示なし。**橙はロゴ以外に無い**（コントラスト検査・Q-9 通過）。ただしログアウトの確認の危険のボタンの面は §4.2 のとおり赤みが消えた（状態色の用い方の後退で、規約違反ではない） |
| 押す部品の寸法 | ✅ ログアウトのボタン 48px、確認の 4 つは 56px 以上（`signout-keep`・`signout-discard` は 59・127px）。下部ナビのタブ 64px。375・1280 とも前後で同じ |
| 本文の大きさ | ✅ ボタンの文字 16px。下部ナビのタブの文字は 14px（基準と同じ値。契約の範囲内の既存の仕様） |
| 状態の記号と文字 | ✅ 「（記録を捨てる）」「未送信 1 件があります」は文字、警告は⚠の記号つき。色だけに頼らない。禁止語 0 |

## 9. 不具合・申し送り

要修正（差し戻し）: なし。

1. **（要判断）** ログアウトの確認（送信待ちあり）の 4 つのボタンの見た目の差（§4.2）。受け入れる場合は generator が test-changes の撮影の差に追記する（記録の訂正）。
2. レビュー N-1（planner）: N2-3 の「`data-testid` を消さない」と N-1 の「参照 0 の部品を消す」の食い違いの明示。今回は参照 0 の 27 件を理由つきで外す扱いで通した。
3. 公開側の `sprint9` 306 と ops の R-4 は、runbook の既知の不安定として引き続き出る。今回の全体では出なかった。
4. 単体のテスト数は 3,122（16-N1）→ 3,098。削除した部品の検査と置き換えた検査による減少で、検査の弱体化ではない（§1.1）。
5. 検証できなかったこと: 実機（Safari・屋外）は G-2 の範囲。
6. 計測の補助に使った一時の DB（`ev16n2_*`）がローカルの PostgreSQL に残っている（アプリには影響しない）。

## 10. 実行したコマンドの要約

`pnpm typecheck`・`pnpm lint`・`pnpm test`・`TEST_DATABASE_URL=… REQUIRE_DB_TESTS=1 pnpm test:db`・`pnpm build`・`node docs/design/tokens-v2/check-contrast-v2.mjs`・`node scripts/testids.mjs --check`・`pnpm test:e2e:ops --retries=0`（全体・ファイル指定）・`CI=1 E2E_SERVER_CMD="… next start -p 3100" E2E_FIXTURE_SERVER_CMD="NEXT_DIST_DIR=.next … next start -p 3101" pnpm test:e2e --retries=0`（全体・ファイル指定）。
