# Sprint 18-2 評価レポート（evaluator）

対象: ブランチ `claude/vigilant-fermi-g54nho` のコミット `ccdd211`。基準は `90d8097`（18-2 の前）。契約は `docs/sprints/sprint-18.md` §4.3・§7.2（2-1〜2-11）・B5・§12。
方法: 別の worktree（`scratchpad/wt-18-2`）に ccdd211 を作り、空の DB（PostgreSQL 16）で `next build` + `next start`（OPS_ENABLED=1、AUTH_PROVIDER=test、`APPLICATION_SUPPORT_ENABLED` 未設定）を動かして評価した。作業ツリーは使っていない。アプリのコードは直していない。

## 総合判定: 条件付き合格

契約 2-1〜2-11 はすべて満たしている。API・既存データ・L8 に不具合は見つからなかった。ただし、**契約が想定していない「許可・承認の手続きが残るのに、次にやることが何も出ない」状態**を 1 つ見つけた（F1）。境界（申請の代行・支援をしない）を越える不具合ではなく、案内の抜け。generator へ差し戻して直すことを勧める。

## 要修正

| # | 内容 | 差し戻し先 |
|---|---|---|
| F1 | 計画に許可・承認の手続きが複数残り、**そのうち一部だけ**に登録を適用すると、残りの手続きが要手続きのままなのに `register_permit` が消える。再現: 米子市役所の近く（35.4281, 133.3311。DID＋施設管理者）に夜間飛行の計画を作り、許可番号に夜間飛行だけの登録を入れる → `/judgement` は「要手続き 2 件」で「飛行許可（DID上空）」が残るが、`nextActions` は `report`・`confirm` だけ（`register_permit` なし。`apply_permit` も出ない）。原因は `report-logic.ts` の無効側の条件が `!permits.applied`（適用された番号が 1 件でもあれば出さない）であること。旧い振る舞い（`apply_permit` は適用の有無にかかわらず出た）と比べて案内が消える。契約 2-4 の文は「適用できる登録が無いとき」。 | generator：適用の有無ではなく、判定に残る許可・承認の手続き（要手続き）に基づいて出す。単体・DB・E2E-DB に「一部だけ適用」の場合を足す |

## 契約項目ごとの結果

| # | 結果 | 根拠 |
|---|---|---|
| 2-1 | ✅ | 夜間飛行＋美保基地の計画の `/overview#procedures`（375・1280）：`procedure-form-dips_permit`・`procedure-dips_permit` が 0、`procedure-form-small_drone_law` が 1。説明文は「小型無人機等飛行禁止法の同意・通報を、済んだら記録します。記録は利用者の申告です。」 |
| 2-2 | ✅ | `kind=dips_permit` の `done`・`retract` は運航管理者・計画の操縦者本人で 409 `procedure_kind_disabled`。**閲覧者・他の操縦者は 403、他の組織は 404、未認証は 401（409 より先）**。`plan_procedure_records` の `dips_permit` は 0 のまま。`small_drone_law` は 201。 |
| 2-3 | ✅ | DB に `dips_permit` の行を直接入れた計画で、`procedure-dips_permit` に `data-legacy="true"`・`data-status="done"`、見出し「以前の記録：許可・承認の手続きの申告（受付を停止しています）」、札「手続き済みの申告（以前の記録）」、履歴 1 行。カード内の `button`・`input`・`textarea`・`form` が 0。API の `summary` は `legacy: true, applicable: false, deadlineLabel: null`。 |
| 2-4 | 🟡 | 計画の主画面・ホームとも、`register_permit`「取得した許可・承認を登録する」が出て（期限の文言なし）、「警察へ通報する」が出て、「許可・承認を申請する」は無い。許可を登録して計画の許可番号に入れると `register_permit` が消える。ただし F1 の抜けがある。 |
| 2-5 | ✅（CI を根拠） | CI run 183（e2e ジョブは Google Fonts の取得失敗で 1 回再実行して成功）。 |
| 2-6 | ✅ | 札は一覧・詳細・ホームで同じ文字列（「更新の時期」「更新の期限（満了の 1 か月前）を過ぎています」「有効期限切れ」）。詳細の文は「満了の 1 か月前（…）が更新の期限です。更新の手続きは、操縦者本人が DIPS 2.0 で行います。」 |
| 2-7 | ✅ | `/judgement`・`/snapshots/[sid]`「飛行の方法を含む判定の証跡 ID」、`/snapshots`「方法を含む判定 ev_…」。「申請支援」は 0。値は同じ。 |
| 2-8 | ✅ | `plan-permit-applied-note` は「許可・承認は、利用者本人が DIPS 2.0 で取得します。取得した許可・承認を登録し、…」。 |
| 2-9 | ✅ | ホーム `today-disclaimer`、主画面、`/judgement`、`/snapshots` で新しい 1 文「許可・承認の申請と飛行計画の通報は、利用者本人が DIPS 2.0 で行います。」旧い文は出ない。4 定数は表示専用で、判定エンジン・証跡のペイロードに入らない。 |
| 2-10 | ✅ | 手動の走査（計画・概要・判定・履歴・根拠・通報・ホーム・操縦者の一覧と詳細）で「許可・承認を申請する」「申請済み」「申請の準備」「申請支援」「更新の申請」が 0。API の応答（procedure-records・計画・通報）にも「申請済み」が 0（以前の記録の行がある計画でも）。 |
| 2-11 | ✅ | 空の DB から `pnpm test:e2e:ops` 全体 1 回：**189 件通過**（20.7 分、`scratchpad/ev182-ops-full.log`）。他の検証は CI を根拠にした。 |

## L8（判定スナップショット）

- 新規の計画（版 1・版 2）の `result` のキーに `prefill`・`deadlines`・`categoryNote` が無い（DB の jsonb でも `GET /snapshots/{sid}` でも）。一覧 `GET /snapshots` は `result` を返さない。`verdict`・`procedures`・`category`・`evidenceId` などは残る。
- 既存の行の再現：オーナー権限で、`result` に `prefill`・`deadlines`・`categoryNote`（目印の文字列入り）を足した行を `INSERT`（seq 3。ハッシュはトリガーが計算）。`GET /snapshots/{sid}` の応答から 3 つとも除かれ、目印の文字列も出ない。DB の行は `result ? 'prefill'` が真のまま（書き換えなし）、既存の行（seq 1・2）の `content_hash` は前後で同じ。`verify_judgement_snapshots` は `content_hash_mismatch`・`prev_hash_mismatch` を出さない（出たのは、現在の版より新しい行を入れたことによる `head_snapshot_not_latest` だけ。検証用の人工の状態）。
- フラグ有効側で保存する行（`prefill` 入り）は、DB テスト（CI）を根拠にし、手動では見ていない。

## 目視（スクリーンショット）

`/tmp/claude-0/-home-user-soraban/e2b7cf3b-a312-58ea-9c67-2848f619f74d/scratchpad/shots182/`（`*-375-*`・`*-1280-*`）。
- `A-*-plan`・`A-*-overview`：主画面の「次にやること 4 件」に「取得した許可・承認を登録する」（期限なし）と「ほか 2 件」。`/overview` の「手続きの記録」は飛行禁止法の同意・通報だけ。崩れなし。空の節が不自然に残る箇所なし。
- `D-*-sdl-*`：飛行禁止法の記録・取り下げ・再記録（375・1280 とも実操作で通った。履歴に取り下げが行として残る）。
- `H-*-legacy`：以前の記録（読み取り専用）。
- `E-*`・`F-1280-*`：許可を登録して番号を入れた後の主画面・判定。
- `J-*`・`K-*`：ホーム（近づく期限、次にやること）・操縦者の一覧と詳細。
- `L-*-did-plan`：F1 の再現の計画。
- 横スクロールなし（375・1280。ホーム・計画・概要・判定・操縦者）。
- 所見（18-2 の範囲外・既存）：技能証明の「期限を過ぎています」の札は墨の面（暗い面）に白文字。既存の設計（コードのコメントに明記）で、18-2 は文言だけを変えた。不変条件 6「暗い表示は使わない」との関係は designer・ユーザーの判断。操縦者の画面の札は実時計、ホームは `OPS_TEST_NOW` を使うため、テスト環境では日付がずれる（本番では同じ）。

## 穴探し

- `kind` の表記ゆれ（`DIPS_PERMIT`・前後の空白・改行・NUL・全角・配列・オブジェクト・null・数値）：すべて 400（`invalid_input`）。行は作られない。同じキーを 2 回書く JSON（最後が優先）：`dips_permit` が後なら 409、`small_drone_law` が後なら 201（`small_drone_law` として記録される。迂回にはならない）。
- `OPS_ENABLED` 無効：`/ops`・`/ops/plans`・`/ops/permits`・計画の `/overview`・`/api/ops/me`・`/api/ops/plans/*/procedure-records`（GET・POST）がすべて 404。公開の `/` は 200。
- 409 の応答は `{"error":"procedure_kind_disabled"}` で、日本語のメッセージ「この記録は受け付けていません」は応答に入らない（画面側の `PROCEDURE_ERRORS` が対応）。他の API エラーと同じ作法で、問題としない。

## テストの置き換えの精査（`git diff 90d8097..ccdd211`）

弱めた検査は見つからなかった。
- 12b #17：`dips_permit` の「記録・取り下げ・再記録・前の判定に対する記録」を `small_drone_law` の同じ流れ（美保基地の計画）に移した。`dips_permit` 側は「フォーム無し・API 409・行が増えない・`apply_permit` 0」。`dips_permit` の「確認が偽なら 400」「開庁日以上前」の検査は、フラグ有効側の DB テスト（`reports.db.test.ts`・`permits.db.test.ts`）に残る。
- 12d #15：事前の記録の作成を 409 の検査に変え、`register_permit`（期限なし）→ 登録 → 消える、を維持。
- 17-db：`apply_permit` の `href` の検査を `notify_police` と `register_permit` の `href` に移した。`plan-procedures` の存在の検査は `procedure-none` ＋ `plan-procedures-details` に変わった（構造の検査として少し弱いが、契約のとおり）。
- 12b・12a・11a・field.db：文言の置き換えと `label` の追加のみ。
- 新しい `sprint18-2-db.spec.ts` は F1 のような「一部だけ適用」を検査していない。

## 禁止された領域・禁止語

- マイグレーション・`packages/db`・判定エンジン・`ENGINE_VERSION`・証跡 ID・`evidence_log` に差分なし。`packages/regulations` の差分は表示の定数 2 つ（と単体テスト）だけ。
- 追加行に「完璧」「保証」「必ず」「代行」「代理」「問題なし」「通報不要」は無い（「代行」「代理」は、含まないことを確かめる単体テストの中だけ）。

## 検証できなかったこと

- 自分での `typecheck`・`lint`・`test`・`test:db`・公開側 `test:e2e` の再実行は、CI（run 183）を根拠にして省いた。`build` は手動検証用に自分で通した（成功）。
- フラグ有効側（`APPLICATION_SUPPORT_ENABLED=1`）の運航管理の振る舞いは手動では見ていない（DB テスト・単体が守る）。
- Sprint 15 の圏外の先読みの束（古い束に旧い次にやることの名前が残る可能性。契約 §7.2 リスク②）は見ていない。

## ユーザーの判断が要る点

1. F1 を 18-2 の中で直すか（推奨：直す。小さな変更）。直さない場合、「判定に許可・承認の手続きが残るが案内が出ない」計画を許容するか。
2. 技能証明の「期限を過ぎています」の札が墨の面である点（既存。不変条件 6 の「暗い表示」に当たるか）。
