# Sprint 18: サービスの境界の整備 — 申請支援の停止、「申請」と読める文言の整理、提供元の表記、禁止語の検査

> 状態: **詳細な契約（2026-11-01、planner 改訂。ユーザーの承認待ち）。コードは変えない。** 2026-10-31 の粗い契約を、generator がそのまま実装できる粒度に詰め、3 本の PR（18-1・18-2・18-3）に分けた。
> 棚卸しの基準: ブランチ `claude/vigilant-fermi-g54nho` の先端 `f85e3c4`（2026-11-01。PR #49。Sprint 14・15・17 を含む）を、コードの検索で実測した。
> 親: `ops-completion-plan.md` §B（境界）、`legal-info-plan.md`（提供元・免責・禁止語・専門家確認）、`sprint-17.md`（手続きの記録を計画のタブへ移した）、`sprint-16.md`（同じファイルを触る後続）。
> **planner は法的助言をしない。** 下の分類（外す／止める／直す／残す）は**安全側の方針案で、法的な結論ではない**。専門家確認（`legal-info-plan.md` Q-L1・Q-L2）が出るまで外部へ提供しない。**取り返しのつかない削除はせず、無効化（機能フラグ）を基本**にする（確認の結果で戻せるように）。
> 読み方: 【確認】はコードで確かめた事実（ファイル:行は `f85e3c4` 時点）。【推定】は確かめていないこと。

## 0. 読みの前提（ユーザーの原文と決定）

- 原文（2026-10-31）: 「ディップスを経由せずに行いたいのは飛行計画の通報だけです。…申請する項目がありますが、この部分だけを代替する機能です。…他の申請とかそういうことは一切やりません。行政書士法にも抵触しますので。ですのでディップスが提供している API で、かつ民間の企業が独自アプリでできるようなものだけを使います。」
- 要旨（2026-11-01、オーケストレーター経由）: 代替するのは**飛行計画の通報に含まれる項目（実際に飛ばす日時、飛行エリア、機体の点検、飛行日誌など）だけ**。**他の申請は一切やらない**。DIPS API は未申請。法令・条例の判定は後回し（やるなら山陰が先）。
- サービスの主役（CLAUDE.md 不変条件 1）: 飛行計画の通報、飛行前・飛行後の点検、日誌・飛行記録。**公開の `/` は判定の画面（補助）**で、その下に申請支援（手続き診断・書類 PDF・プリフィル・マニュアル骨子・申請支援の保存）が続いている。**判定の部分は残し、申請支援の部分だけを止める。**
- 「ディップス」は DIPS 2.0（国土交通省のドローン情報基盤システム）と読む。

## 1. 要点

1. **棚卸しをやり直した結果、旧版の抜けと古い記述があった**（§3.1）。最大の抜けは、判定の結論の下に常に出る責任の注記 `RESPONSIBILITY_NOTE`「そらばんは**入力項目の下書きまでを手伝います**」（`verdict-summary.tsx:71-72`。公開の `/` と `/ops/plans/[id]/judgement` の両方）。申請の作成の支援をうたう文で、真っ先に直す。
2. **公開の `/` の申請支援は、機能フラグ `APPLICATION_SUPPORT_ENABLED` で止める（既定は無効。本番のデプロイでは常に無効）**。判定（4 段の結論・規制ごとの判定・地図・地点判定の PDF・計画への引き継ぎ）は残す。止めたコードは削除しない（案 §4.5）。
3. **運航管理では、「許可・承認の申請済み」の記録（`dips_permit`）と、次にやること「許可・承認を申請する」（`apply_permit`）を同じフラグで止め**、代わりに「取得した許可・承認を登録する」（既存の `register_permit` を、申請の記録に依存しない形に）を出す。既存の記録の行は消さず、読むだけで表示する。
4. 「申請」「保証」「必ず」の語は**許可リスト方式**で検査し、「代行」「代理」は**全面禁止**（境界の文を「代行」の語を使わずに書くことで、例外を作らない。§6）。判定エンジンの文言（`ENGINE_VERSION` に結びつく）は変えず、**判定の領域の印**の中だけ限定語を許す。
5. 提供元は `docs/provider-info.md` の**確認済みの 6 項目だけ**を 1 か所の定数から出す。ロゴは使用ルール（U2）が未確認のため載せない。題名・説明・マニフェストを「飛行計画の通報・点検・飛行日誌」に改める。
6. **DB のマイグレーションは無い。** 判定エンジン・証跡 ID・`evidence_log`・既存マイグレーション・`/api/diagnose` の応答の本体（`handleDiagnosePost`）は変えない。
7. PR は直列で 3 本: **18-1 公開の `/` の申請支援を止める → 18-2 運航管理の「申請」に見える機能・文言 → 18-3 提供元・題名・免責・禁止語の検査**。各 PR は generator → reviewer（18-1・18-2 は必須。境界と既存データに触れるため）→ designer（18-3 のみ。18-1・18-2 は文言と非表示だけで省略可）→ evaluator。

## 2. 境界の定義（契約の冒頭。旧版 §1 を引き継ぐ）

| 区分 | 内容 |
|---|---|
| **やること（境界の内）** | 飛行計画の通報の項目の入力・整形（DIPS の入力順）、利用者本人が DIPS で出した通報の受付番号・結果・更新・取消の記録（P1 手動）、期限と漏れの管理。それに関わる計画（日時・エリア・機体・操縦者・点検の確認）、当日の飛行日誌（離陸・着陸・飛行時間）、機体の点検、地図の範囲選択。判定（法令・条例のチェック）は補助 |
| **やらないこと（境界の外）** | 許可・承認の申請の作成・提出・代行・支援（書類の下書き・プリフィル・申請の進行管理・申請期限の逆算の案内を含む）、機体登録・操縦者登録の申請、その他の申請。DIPS 以外を経由した手続き |
| **使う API** | DIPS 2.0 の FPR 系だけ（飛行計画通報受付・飛行計画情報取得・飛行禁止エリア情報取得）。**API は未申請**。利用規約・民間の独自アプリでの利用可否、認定 USP の位置づけは ※要再確認（`legal-info-plan.md` Q-L6・Q-L14） |
| **使わない API** | FPA（許可・承認の取得・申請受付）、機体情報一覧取得 |
| **取得済みの許可・承認** | 利用者が自分で取得した許可・承認の**控えの登録**と、計画が範囲内かの照合（通報の項目のため）。申請ではない。DIPS からの取り込みはしない |
| **飛行禁止法の同意・通報の記録** | 利用者が施設の管理者の同意を得て、公安委員会へ通報したことの**申告の記録**。許可・承認の申請ではないため残す（専門家確認 Q-L2 の資料に入れる） |

## 3. 棚卸し（実測。`f85e3c4`）

検索した語: 申請・代行・代理・許可・承認を申請・申請済み・申請書・プリフィル・束ね・手続き診断・飛行マニュアル・保証・必ず・完璧・問題なし・通報不要・下書き・確実に・抵触。対象は `apps/web/src`、`packages/*/src`・`packages/*/data`、`e2e`、`docs`。

- `申請` を含む行: テスト・フィクスチャを除く **46 ファイル・157 行**【確認】（旧版の「25 ファイル以上」を更新）。
- `代行`・`代理`: 表示される文言には **0 件**。コメントだけ（`verdict-summary.tsx:70`、`server/ops/authz.ts:47`、`server/ops/field.ts:463` の「代理入力」）【確認】。
- `完璧`・`問題なし`・`通報不要`・`安心して`・`確実に適法`: 表示される文言に **0 件**【確認】。
- `保証`（表示）: `app/page.tsx:211`、`lib/ops-incident.ts:36`、`packages/regulations/src/index.ts:1091`（`DEFAULT_DISCLAIMER`）、`diagnosis.ts:404`（`DIAGNOSIS_DISCLAIMER`）。いずれも否定（「保証するものではありません」）【確認】。
- 旧名称（「AIさんいん」「タイヨー通信群」「メルドカルタ」）: `apps/web/src`・`packages/*/src` に **0 件**【確認】。

### 3.1 旧版（2026-10-31）からの訂正

| # | 旧版の記述 | 実測 | 対処 |
|---|---|---|---|
| D1 | （記載なし） | **`RESPONSIBILITY_NOTE`「そらばんは入力項目の下書きまでを手伝います」**が、判定の結論の直下（`verdict-responsibility`）に常に出る。公開の `/` と `/judgement` の両方。E2E が全文を固定（`sprint12h-pr2.spec.ts:994`） | **新 A15。18-1 で直す** |
| D2 | （記載なし） | `/api/diagnose` の応答に**許可・承認の申請フォームの値（`prefill`）**が入る（`server/diagnose-core.ts:132,173`）。公開の API | **新 A16。18-1 で、ルートの層（`app/api/diagnose/route.ts`）でフラグ無効なら取り除く**。`handleDiagnosePost` は変えない（基準の SHA 比較 `diagnose-core.test.ts` を保つ） |
| D3 | A10「期限カレンダー（`deadline-calendar.tsx`・`deadlines-logic.ts`）」を 1 つの項目に | 別物。`deadline-calendar.tsx` は公開の `/` の**申請の提出期限**（診断パネルの中）。`server/ops/deadlines-logic.ts` は運航管理のホームの**近づく期限**（技能証明の有効期限と、登録した許可・承認の有効期限） | 前者は A10（止める）、後者は A11（文言を直す。期限の通知は残す） |
| D4 | A5「申請支援の保存・診断の証跡ハッシュ（`history.ts`、`evidence`）」 | 公開の `/` の判定履歴は**端末の localStorage**（最大 50 件。`lib/history.ts`）で、DB ではない。DB の `evidence_log` は地点判定（`/api/check`）の証跡で、申請支援の行は無い【確認】 | DB の対処は不要。端末の履歴は消さない（§4.4） |
| D5 | A9「許可・承認の登録の文言を直す（申請の語を使わない）」 | `permit-ui.tsx`・`permits-client.tsx`・`/ops/permits` に `申請` は **0 件**【確認】 | 文言の変更は不要（**残す**）。境界の 1 行を足すのは 18-3 |
| D6 | A12「機体登録の案内（`diagnosis-panel` ほか）」 | 機体登録の案内（DRS のリンクの枠）は**診断パネルの中だけ**（`diagnosis-panel.tsx` の「2 系統の手続き窓口」）。判定の結論の段取りには「機体登録（DRS）＋リモートID」が判定の出力として出る（`procedures.json` の `drone-registration`） | 前者は診断パネルごと止まる。後者は判定の出力として残す（A14 と同じ扱い） |
| D7 | 「`/judgement` の注意書きに『必ず DIPS で確認』『保証するものではありません』」（`b74d167` のコメント） | `/judgement` の画面で `保証` を出すコードは**見つからない**。`必ず` は「飛行の前後に必ず行うこと」（`lib/verdict-display.ts:139`、`packages/regulations/src/verdict.ts:80`）と、判定の項目の理由（例 `index.ts:575`「地理院地図・DIPS で必ず確認してく…」）【確認】。`保証` は【推定】で出ない | 18-3 の DOM の走査で実測する。どちらも利用者への注意・否定の文で、許可リストに入れる（§6.3） |
| D8 | （記載なし） | 次にやること `renew_license`「技能証明を更新する」（`messages.ts:292`）と、技能証明の札「更新の申請期間」「更新の申請期限を過ぎています」（`license-renewal.tsx:25-36`、`server/ops/license.ts:13-14`、`deadlines-logic.ts:54-55`、`today-ui.tsx:398`） | A11 に含める。18-2 で直す |
| D9 | （記載なし） | 「申請支援の証跡 ID」の見出し（`/judgement` `judgement/page.tsx:54`、`snapshots/[sid]/page.tsx:69`、`snapshots/page.tsx:52`、通報の記録の行 `report-client.tsx:677`） | 新 A17。18-2 で見出しだけ直す（値・`data-testid` は変えない） |
| D10 | （記載なし） | 固定の文言の末尾「申請・通報は DIPS 2.0 などの公式の手続きで行ってください」が 4 つの定数に重複（`OFFICIAL_PROCEDURE_NOTE` `messages.ts:29`、`REPORT_NOTICE_MANUAL` `messages.ts:12`、`REPORT_FIXED_NOTE` `report-requirement.ts:75`、`PLAN_JUDGEMENT_DISCLAIMER` `report-requirement.ts:79`）。`PLAN_JUDGEMENT_DISCLAIMER` は 8 画面に出る | 新 B5。18-2 で 1 つの文に揃える |
| D11 | （記載なし） | `/ops/design`（デザイン見本。`DESIGN_CATALOG=1` かつ本番以外だけ）に「申請の準備へ」（`ui/catalog/style-screens.tsx:116,252`）、「DIPS から取り込む（未接続）」（`ui/catalog/trial-pages.tsx:475`、`act-dips-import`） | **触らない**。Sprint 16-1 で旧い見本ごと削除される予定（`sprint-16.md` §5）。走査の対象外（本番 404） |
| D12 | 「`申請` は 25 ファイル以上」 | 46 ファイル・157 行 | 更新 |

### 3.2 機能の棚卸しと分類

列: 場所（ファイル:行）／画面のどこに出るか／`data-testid`／関連するテスト／データ・マイグレーション／分類／実施方法（PR）。「止める」= フラグ `APPLICATION_SUPPORT_ENABLED` が無効のとき画面・導線・API から外す（コードは残す）。

| # | 機能 | 場所 | 画面 | `data-testid` | 関連するテスト | データ | 分類 → 実施（PR） |
|---|---|---|---|---|---|---|---|
| A1 | 手続き診断のパネル（カテゴリー切り分け、必要手続きチェックリスト、DRS/DIPS の窓口、診断の証跡） | `components/diagnosis-panel.tsx`（全体。見出し「申請支援 — 必要手続き診断」263 行）、`regulation-checker.tsx:1709-1721` | 公開の `/`、詳細な指定の下（`sb-area-wide`） | `diagnosis-category-headline`、`diagnosis-did-status`、`diagnosis-details`（畳み）、`procedure-card`・`procedure-verdict-done`（`procedure-card.tsx`） | E2E: 11a #4・#17、11c #6、11d #6、11e #13、11f #3・4、11g #15、12h-pr2 B2（3 件）・「申請の準備を開くと」、7（4 件）、10a #9（§7.1 の表）。単体: `packages/regulations` の `diagnosis.test.ts` ほか | なし | **止める**（パネルごと描かない）→ 18-1 |
| A2 | 束ね PDF（申請支援サマリ） | `application-pdf.tsx`、`diagnosis-panel.tsx:446-479` | A1 の中 | なし（ボタン名「束ね PDF を出力」） | 10a #9、11a 共通、11e #13、11f 共通、11g #15、7 #199 | なし | **止める**（A1 と一緒）→ 18-1 |
| A3 | DIPS プリフィル（許可・承認の申請フォームの値） | `prefill-table.tsx`、`packages/regulations/src/prefill.ts`、`server/diagnose-core.ts:132` | A1 の中 | なし | 11a #17（プリフィルの飛行の種類）、`prefill.test.ts` | `/api/diagnose` の応答の `prefill` | **止める**（画面）＋**応答から取り除く**（ルートの層。§4.2）→ 18-1。通報（FPR）の整形 `packages/dips` は別物で残す |
| A4 | 飛行マニュアルの骨子（書類の下書き） | `manual-draft.tsx`、`packages/regulations/data/manual-templates/` | A1 の中 | なし | 11e #13、11g #15 | なし | **止める** → 18-1 |
| A5 | 判定履歴（端末）の申請支援の項目 | `regulation-checker.tsx:1724-1830`（行の「手続き N/M 件」、`title`「…申請支援の条件・進捗も復元」1766 行）、`lib/history.ts` | 公開の `/`、判定履歴 | `history-item`、`history-verdict` | 11a #21、`history.test.ts` | **端末の localStorage**（`diagnosisInput.completedProcedureIds` を含む旧い項目） | **直す**: 履歴は判定の履歴として残す。フラグ無効なら「手続き N/M」「手続き N 件」を出さず、`title` を「証跡 … を復元して再判定」に。保存済みの項目は消さず、読めること（§4.4）→ 18-1 |
| A6 | 手続きの記録「許可・承認の申請済み」（`dips_permit`） | `components/ops/procedure-client.tsx`（84-123、203 行）、`server/ops/procedure-records.ts`、`app/api/ops/plans/[id]/procedure-records/route.ts`、`validate-report.ts:242` | `/ops/plans/[id]/overview#procedures`（畳み「手続きの記録を開く」） | 式 `procedure-${kind}`・`procedure-form-${kind}`・`procedure-check-${kind}-${k}`・`procedure-submit-${kind}`・`procedure-status-…`・`procedure-history-…`・`procedure-retract-…`、`plan-procedures`、`plan-procedures-details`、`procedure-none` | E2E-DB: 12b #17、12d #15。DB: `reports.db.test.ts:1417-1525`、`permits.db.test.ts:914-932`。単体: `report-logic.test.ts:290-380`、`messages.test.ts` | **表 `plan_procedure_records`**（`kind='dips_permit'` の行）。シードに行は無い【確認】。本番の行の有無は【未確認】 | **止める**（新規の記録を受け付けない。既存の行は読むだけで表示）→ 18-2。マイグレーションなし |
| A6b | 手続きの記録「飛行禁止法の同意・通報」（`small_drone_law`） | 同上 | 同上 | 同上（`kind=small_drone_law`） | 12b #17 の後半 | 同じ表 | **残す**（申請ではない利用者の申告の記録）。説明文から「許可・承認の申請」を外す → 18-2 |
| A7 | 次にやること `apply_permit`「許可・承認を申請する」 | `packages/dips/src/messages.ts:282`、`server/ops/report-logic.ts:335-377`（`href` は 230 行 `/overview#procedures`） | 計画の主画面・ホーム「今日」の次にやること | `next-action`（`data-action-id="apply_permit"`）、`next-action-link`、`next-action-label` | E2E-DB: 12b #17、12d #15、17-db（236・249 行）。DB: 上記 | なし | **止める**（出さない）→ 18-2 |
| A8 | 次にやること `register_permit`「許可・承認の結果を登録する」 | `messages.ts:284`、`report-logic.ts:349-358`（`dips_permit` の記録が前提） | 同上 | 同上（`register_permit`） | 12d #15、`permits.db.test.ts:921` | なし | **直す**: 申請の記録に依存せず、「判定（補助）に許可・承認の手続きが残り、適用できる登録が無い」ときに出す。名前「取得した許可・承認を登録する」。期限の文言（開庁日の逆算）は付けない → 18-2 |
| A9 | 許可・承認の登録と範囲の照合 | `permit-ui.tsx`、`permits-client.tsx`、`/ops/permits/**`、`/judgement` の「許可・承認の照合」 | `/ops/permits`、`/judgement` | `permit-*`、`plan-permit-*` | 12d 一式 | `permit_registrations` | **残す**（文言の変更なし。D5）。`/judgement` の注記 `plan-permit-applied-note`（`judgement/page.tsx:131`）は A6 に合わせて直す → 18-2 |
| A10 | 申請の提出期限のカレンダー（10 開庁日の逆算） | `deadline-calendar.tsx`、`regulation-checker.tsx` の「飛行予定日」の説明（「提出期限の逆算に使用」） | 公開の `/` | なし | 11a #17、12h-pr2「申請の準備を開くと」 | なし | **止める**（A1 と一緒）。飛行予定日の入力は判定の条件として残し、説明文を直す → 18-1 |
| A11 | 技能証明の更新の案内・札・次にやること | `license-renewal.tsx:12-36`、`server/ops/license.ts:13-14`、`deadlines-logic.ts:54-55`、`today-ui.tsx:398`、`messages.ts:292`（`renew_license`） | 操縦者の詳細・一覧、ホームの近づく期限、次にやること | `license-renewal-status`、`flight-license`、`next-action`（`renew_license`） | `license.test.ts`、`deadlines-logic.test.ts`、`today-logic.test.ts:295,356`、`field.db.test.ts:1091-1105` | なし | **直す**: 有効期限の通知は残し、「申請」の語と更新の手順の案内を外す（§4.3）→ 18-2 |
| A12 | 機体登録の案内（DRS の窓口） | `diagnosis-panel.tsx` の「2 系統の手続き窓口」 | A1 の中 | なし | なし | なし | **止める**（A1 と一緒）→ 18-1 |
| A13 | 公開の `/` の申請支援の入口・説明の文言 | `regulation-checker.tsx:1546-1551`（凡例「飛行方法（申請支援）」「該当する方法を選ぶと必要手続きを診断」）、目視外の補助者の説明（「プリフィル表に反映します」）、`DIAGNOSIS_DISCLAIMER` の常設の注記（1705 行）、低い確からしさの注記「引受・許可申請の前に」（1317 行、`regulation-pdf.tsx:490` も同文）、診断の失敗の文（`verdict-display.ts:217,228`「申請支援の診断に失敗…」「判定未確定（申請支援の診断が未完了）」） | 公開の `/`、地点判定の PDF | `detail-block`、`verdict-failed-note`、`history-verdict` | 11d・11e・11f・11g の補助関数 `methodCheck`（凡例の文字で fieldset を探す）、`history.test.ts` | なし | **直す** → 18-1（§4.2 の文言表） |
| A14 | 判定の段取り「要手続きの手続き（期限順）」（手続き・出す先・期限・法的な重さ）と、段の名前「要手続き」 | `verdict-summary.tsx:385-480`、`lib/verdict-display.ts:137,144`、データは `procedures.json` | 公開の `/` と `/judgement` の判定の結論の下 | `verdict-procedures-section`、`verdict-procedures`、`verdict-procedure`、`verdict-procedure-deadline` | 11d ほか多数 | 判定のスナップショット | **残す**（判定エンジンの出力。`ENGINE_VERSION`・証跡を変えない）。Q-L2 の資料に入れる。専門家が不可とした場合は、表示の層で期限の列を隠すフラグを別 PR で足す（ユーザーに聞くこと Q4） |
| A15 | 責任の注記「そらばんは入力項目の下書きまでを手伝います」 | `verdict-summary.tsx:70-75,347-349` | 公開の `/` と `/judgement` の結論の直下（常に） | `verdict-responsibility` | 12h-pr2 N1（994 行が全文を固定） | なし | **直す**（フラグに関わらず）→ 18-1 |
| A16 | `/api/diagnose` の応答の `prefill` | `server/diagnose-core.ts:132,173`、`lib/diagnose.ts:20` | API | なし | `diagnose-core.test.ts`（`handleDiagnosePost` の応答の SHA を比べる） | なし | **止める**（`app/api/diagnose/route.ts` で取り除く。`handleDiagnosePost` は変えない）→ 18-1 |
| A17 | 「申請支援の証跡 ID」の見出し | `judgement/page.tsx:54`、`snapshots/[sid]/page.tsx:69`、`snapshots/page.tsx:52`、`report-client.tsx:677` | `/judgement`、判定の根拠・履歴、通報の記録の行 | `plan-diagnosis-evidence`、`basis-diagnosis-evidence`、`report-row-diagnosis-evidence` | なし（見出しを固定するテストは無い【確認】） | 列 `diagnosis_evidence_id`（変えない） | **直す**（見出しだけ「飛行の方法を含む判定の証跡 ID」）→ 18-2 |
| A18 | 携行の確認の項目「許可承認書」「飛行マニュアルの組み合わせ制限」 | `lib/ops-field.ts:381-388`（`FIELD_DOC_LABEL`） | 現場の飛行前の確認 | `field-doc-*`（Sprint 14） | 14-db | なし | **残す**（取得済みの書類の携行の確認で、申請ではない） |

### 3.3 文言（B 系）

| # | 文言 | 場所 | 分類 → PR |
|---|---|---|---|
| B1 | 「そらばんは入力項目の下書きまでを手伝います」 | A15 | 直す → 18-1 |
| B2 | 「飛行方法（申請支援）」「該当する方法を選ぶと必要手続きを診断」「提出期限の逆算に使用…」「プリフィル表に反映します」「引受・許可申請の前に」「申請支援の診断に失敗…」「判定未確定（申請支援の診断が未完了）」「…申請支援の条件・進捗も復元」 | A5・A10・A13 | 直す → 18-1 |
| B3 | 免責の常設の注記 `DIAGNOSIS_DISCLAIMER`（「本診断は…必要な手続きを最終的に保証するものではありません。最終確認は必ず DIPS（飛行許可・承認）／DRS（機体登録）…」）と、判定の結果の `result.disclaimer`（`DEFAULT_DISCLAIMER`） | `regulation-checker.tsx:1323,1705` | **画面では**アプリ側の定数（§5.3 の `DISCLAIMER_JUDGEMENT`）に差し替え → 18-1。**`packages/regulations` の定数と API の応答は変えない**（判定エンジンの文言。応答の基準のテストを保つ） |
| B4 | 「手続きの記録」の説明「許可・承認の申請と、小型無人機等飛行禁止法の同意・通報を、済んだら記録します」（`overview/page.tsx:82`）、`procedure-none`（`procedure-client.tsx:203`）、`PROCEDURE_RECORD_KIND_LABEL`・`DONE_LABEL`・`CHECK_LABEL`・`PROCEDURE_RECORD_NOTE`（`messages.ts:300-322`）、`/judgement` の注記（`judgement/page.tsx:131`） | A6 | 直す・止める → 18-2 |
| B5 | 「申請・通報は DIPS 2.0 などの公式の手続きで行ってください」（4 定数。D10） | `messages.ts:12,29`、`report-requirement.ts:75,79` | 1 文に揃える → 18-2（`ENGINE_VERSION` には関わらない表示の定数【確認】: 証跡のペイロード `buildDiagnosisEvidencePayload` に入らない。`reportRequirement` は読むたびに計算し、保存しない） |
| B6 | 公開の `/` の題名・見出し「ドローン飛行の可否判定と運航管理」、`site-lead`「…どの手続きが要るかを一度に確かめ…」、`site-facts` の「運営者」、フッターの「鳥取県西伯郡日吉津村」（所在地の一部だけ）、免責事項の本文 | `app/layout.tsx:32-33`、`app/page.tsx:91-98,120,127-134,205-229` | 直す → 18-3 |
| B7 | マニフェストの `description`「ドローンの飛行前の確認・離着陸・点検・日誌を、電波の弱い現場でも記録します。」（通報が無い） | `lib/pwa.ts:161` | 直す → 18-3 |
| B8 | `ops-incident.ts:36`「…判断するものでも、保証するものでもありません」 | 事故・ヒヤリハット | 残す（否定。許可リスト） |
| B9 | 地図の注記「飛行の前に必ず DIPS でご確認ください」 | `regulation-map-layers.ts:195` | 残す（利用者への注意。許可リスト） |

### 3.4 E2E・単体・DB の影響（実測の件数）

- 公開の E2E で申請支援に依存するもの: **9 ファイル・16 テスト**（§7.1 の表）＋補助関数 2 種（`e2e/field-checks.ts` の `openDiagnosis`、11d・11e・11f・11g の `methodCheck`＝凡例「飛行方法（申請支援）」で fieldset を探す）。
- E2E-DB で `dips_permit`・`apply_permit` に依存するもの: **12b #17、12d #15（と 377 行の `plan-permit-applied-note`）、17-db の 2 か所**。
- DB テスト: `reports.db.test.ts:1417-1525`、`permits.db.test.ts:914-932`、`field.db.test.ts:1091-1105`。単体: `report-logic.test.ts:290-380`、`messages.test.ts`、`license.test.ts`、`deadlines-logic.test.ts`、`today-logic.test.ts:295,356`、`report-requirement.test.ts:272`。
- 文言を固定する公開の E2E: 10a（`TITLE`・`PURPOSE` 9-10 行、#3 運営者、#5 フッター）、11a #7・#8（`site-lead`・`site-ops-note`）、12h-pr2 N1（`verdict-responsibility`）。

## 4. 実施方法（共通の設計）

### 4.1 機能フラグ `APPLICATION_SUPPORT_ENABLED`

- 置き場所: `apps/web/src/lib/boundary.ts`（新規。1 か所）。`isApplicationSupportEnabled(env = process.env): boolean`。
- 真になるのは **`APPLICATION_SUPPORT_ENABLED === "1"` かつ `VERCEL_ENV !== "production"`** のときだけ。既定（未設定）は偽。**本番のデプロイでは常に偽**（外部提供しない。戻すときはコードの変更で、記録が残る）。`DESIGN_CATALOG`（`lib/design-catalog.ts`）と同じ作法。
- 読む場所: サーバーだけ（公開の `/` は `app/page.tsx` で読んで `RegulationChecker` に `applicationSupport` を渡す。運航管理はサービス層で読み、純粋関数には引数で渡す）。**公開の `/` は静的に描かれるため、値はビルド時に固まる**（`next start` の前の `next build` の環境で決まる）。この性質を `boundary.ts` のコメントに書く。
- E2E の設定: `playwright.config.ts`（2 つのサーバー）と `playwright.ops.config.ts` の `webServer.env` に `APPLICATION_SUPPORT_ENABLED: ""` を明記する（環境の持ち越しで揺れないように）。**フラグを有効にした E2E は作らない**（静的な `/` はビルドごとに値が 1 つで、別のビルドが要るため）。止めたコードの回帰は単体テスト（`packages/regulations` の既存のテスト）で保つ。
- 単体: `boundary.test.ts`（未設定・`"0"`・`"1"`・`"1"`＋`VERCEL_ENV=production`・`"1"`＋`VERCEL_ENV=preview`）。

### 4.2 公開の `/` の変更の範囲（18-1）

**変えるもの**（フラグ無効のとき）:
1. 診断パネル（A1・A2・A3・A4・A10・A12）を描かない（`regulation-checker.tsx:1709-1721` の `DiagnosisPanel` を `applicationSupport && diagnosis ? … : null`）。`/api/diagnose` の呼び出しは**続ける**（4 段の結論はこの応答から作る【確認】）。
2. `/api/diagnose` の応答から `prefill` を取り除く（`app/api/diagnose/route.ts` で、`handleDiagnosePost` の応答の JSON を読み、`prefill` を消して返す。状態コード・ヘッダーは保つ）。`lib/diagnose.ts` の型は `prefill?` に。単体: ルートの層の取り除きのテスト（有効なら残る・無効なら無い・他の項目は同一）。
3. 文言（フラグに関わらず）:

| 場所 | 現在 | 改めた文言 |
|---|---|---|
| `verdict-summary.tsx:71-72` `RESPONSIBILITY_NOTE` | 「手続きは、ご本人の名義で作成し、ご本人が提出します。そらばんは入力項目の下書きまでを手伝います。」 | `BOUNDARY_SHORT`（§5.2）をそのまま使う |
| `regulation-checker.tsx:1549-1552` 凡例 | 「飛行方法（申請支援）」「（該当する方法を選ぶと必要手続きを診断）」 | 「飛行の方法」「（選ぶと判定に反映します）」 |
| 飛行予定日の説明 | 「提出期限の逆算に使用（…10 開庁日以上前…）」、札「起算日」 | 「飛行の予定日（判定の条件に使います）」。札は外す |
| 目視外の補助者の説明 | 「…プリフィル表に反映します」 | 「補助者の有無を判定の条件に使います」 |
| `regulation-checker.tsx:1317`・`regulation-pdf.tsx:490` | 「…引受・許可申請の前に、該当条文の原本…」 | 「…飛行の前に、該当条文の原本…」（後半は同じ） |
| `regulation-checker.tsx:1705` 常設の免責 | `DIAGNOSIS_DISCLAIMER` | `DISCLAIMER_JUDGEMENT`（§5.3） |
| `regulation-checker.tsx:1323` 結果の免責 | `result.disclaimer`（API の `DEFAULT_DISCLAIMER`） | `DISCLAIMER_JUDGEMENT` |
| `verdict-display.ts:217` | 「申請支援の診断に失敗したため、この入力（…）での判定が出ていません。…」 | 「飛行の方法を含む判定に失敗したため、この入力（…）での判定が出ていません。…」（後半は同じ） |
| `verdict-display.ts:228` | 「判定未確定（申請支援の診断が未完了）」 | 「判定未確定（飛行の方法を含む判定が未完了）」 |
| 判定履歴の行 | 「手続き N/M」「手続き N 件」、`title`「…申請支援の条件・進捗も復元」 | フラグ無効なら手続きの件数を出さない。`title`「証跡 {id} を復元して再判定」 |

コード中のコメント（「申請支援」）は直さなくてよい（表示されない）。ただし 18-1 で触る行のコメントは新しい意味に合わせる。

**変えないもの**: 見出し・挿絵・`site-*`・フッター（18-3）、判定の結論・段取り・規制ごとの判定・地図・地点判定の PDF・「この判定で飛行計画を作る」・機体・運航条件の入力（取得済みの許可のチェックを含む）・地点の例・収録の一覧。`packages/regulations`（エンジン・データ・`DEFAULT_DISCLAIMER`・`DIAGNOSIS_DISCLAIMER`）。

### 4.3 運航管理の変更（18-2）

1. **`dips_permit` の記録を止める**（フラグ無効のとき）:
   - API `POST /api/ops/plans/[id]/procedure-records` で `kind='dips_permit'` は `action` に関わらず **409 `procedure_kind_disabled`**（メッセージ「この記録は受け付けていません」）。`small_drone_law` は今までどおり。サービス層（`procedure-records.ts`）で判定し、ルートは変えない。
   - 要約（`summarizeProcedureRecords`）: `dips_permit` は、**既存の行があるときだけ**「以前の記録」として返す（`legacy: true`、`applicable: false`）。行が無ければ返さない。
   - 画面（`procedure-client.tsx`）: `legacy` の種別は、記録のフォーム・取り下げのボタンを出さず、見出し「以前の記録：許可・承認の手続きの申告（受付を停止しています）」、状態の札「手続き済みの申告（以前の記録）」、履歴（`procedure-history-dips_permit`）だけを出す。`data-testid` は今までの式のまま（`procedure-dips_permit` に `data-status` と `data-legacy="true"`）。
   - `procedure-none` の文言: 「この計画の判定には、記録する手続き（小型無人機等飛行禁止法の同意・通報）はありません。」
   - `overview` の節の説明: 「小型無人機等飛行禁止法の同意・通報を、済んだら記録します。記録は利用者の申告です。」
   - 定数（`messages.ts`）: `PROCEDURE_RECORD_NOTE` は「記録は利用者の申告です。」＋ B5 の 1 文。`PROCEDURE_RECORD_KIND_LABEL.dips_permit`・`DONE_LABEL.dips_permit`・`PROCEDURE_CHECK_LABEL.applicationCompleted` は**フラグ有効のときの表示に残す**（値は変えない）。
2. **次にやること**（`report-logic.ts` の `planNextActions` に引数 `applicationSupport: boolean` を足す。既定 `false`。呼び出し側 `plans.ts`・`today.ts` などがサービス層でフラグを読んで渡す）:
   - 無効: `apply_permit` を出さない。許可・承認の手続き（`PERMIT_PROCEDURE` かつ `NOT_AN_APPLICATION` 以外）が判定に残り、`permits` が与えられて `!permits.applied` のとき、`register_permit` を出す（`dips_permit` の記録に依存しない）。tier 3 固定、期限の文言なし、理由「判定（補助）に許可・承認の手続きがあります。許可・承認は、利用者本人が DIPS 2.0 で取得します。取得したら控えを登録し、計画の許可番号の欄に番号を入れます」、`canAct = permits.canRegister`（運航管理者だけ。今までどおり）。
   - 有効: 今までの振る舞い（`apply_permit`、申請済みのあとの `register_permit`）をそのまま。
   - `notify_police` は両方で今までどおり。
   - `NEXT_ACTION_LABEL.register_permit` を「取得した許可・承認を登録する」に（両方の状態で）。`apply_permit` の名前は変えない（有効のときだけ出る）。
3. **技能証明（A11）**: 札 `renewal_window`「更新の申請期間」→「更新の時期」、`past_deadline`「更新の申請期限を過ぎています」→「更新の期限（満了の 1 か月前）を過ぎています」（`license-renewal.tsx`・`license.ts`・`deadlines-logic.ts`・`today-ui.tsx` の 4 か所を 1 つの定数に寄せる）。説明文（`license-renewal.tsx:33`）→「満了の 1 か月前（{deadline}）が更新の期限です。更新の手続きは、操縦者本人が DIPS 2.0 で行います。」（`:36` も同じ方針）。次にやること `renew_license` の名前「技能証明を更新する」→「技能証明の有効期限を確認する」。`renew_license` の識別子・`href`・tier は変えない。
4. **見出し（A17）**: 「申請支援の証跡 ID」→「飛行の方法を含む判定の証跡 ID」、`snapshots/page.tsx:52` の「申請支援 {id}」→「方法を含む判定 {id}」。
5. **`/judgement` の注記（`plan-permit-applied-note`）**: 「許可・承認は、利用者本人が DIPS 2.0 で取得します。取得した許可・承認を登録し、計画の許可番号の欄に番号を入れると、範囲に収まるときだけ判定が変わります。」（フラグ有効のときは今の文を残してよい）。
6. **固定の文言の末尾（B5）**: 4 定数の「申請・通報は DIPS 2.0 などの公式の手続きで行ってください。」を `OFFICIAL_PROCEDURE_NOTE` の新しい 1 文「許可・承認の申請と飛行計画の通報は、利用者本人が DIPS 2.0 で行います。」に揃える（`REPORT_NOTICE_MANUAL`・`REPORT_FIXED_NOTE`・`PLAN_JUDGEMENT_DISCLAIMER` はこの定数を連結する。`packages/regulations` が `packages/dips` を読めない場合は同じ文を両方に置き、単体テストで一致を確かめる）。

### 4.4 既存データの扱い

| データ | 場所 | 扱い |
|---|---|---|
| 公開の `/` の判定履歴（`diagnosisInput`・`completedProcedureIds`・`diagnosisSummary` を含む旧い項目） | 利用者の端末の localStorage | **消さない・書き換えない**。復元（`restoreFromHistory`）は今までどおり動く（手続きの完了の状態は内部の state に戻るが、フラグ無効では表示しない）。新しい保存では `completedProcedureIds` を空のまま保存してよい |
| `plan_procedure_records` の `dips_permit` の行 | DB | **消さない**。読むだけで表示（§4.3-1）。追記専用の作法・ハッシュ・版の履歴に触れない。マイグレーションなし |
| 判定のスナップショット（`diagnosis_evidence_id`、`result` の `prefill` を含む） | DB | 変えない。画面に `prefill` を出すところは無い【確認】 |
| `evidence_log` | DB | 変えない（地点判定の証跡のみ） |

### 4.5 止めたコードの残し方（案。推奨: 残す）

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **残す（推奨）** | `diagnosis-panel.tsx`・`application-pdf.tsx`・`prefill-table.tsx`・`manual-draft.tsx`・`deadline-calendar.tsx`・`procedure-card.tsx`・`packages/regulations` の `prefill.ts`・`manual-templates` と、運航管理の `dips_permit`・`apply_permit` の分岐を、フラグの裏に残す。PDF は既に動的 import（`diagnosis-panel.tsx:222-223`）で、無効なら読み込まれない | 専門家確認（Q-L2）の結果で戻せる。`data-testid` の基準の一覧（`--check`）が変わらない。既存の単体テストがそのまま回帰を守る | 使われないコードが残る。E2E で動かさないので画面の回帰は守られない |
| 削除する | 上のファイルと分岐を削除する | 誤って出る余地が無い | 戻せない（Git の履歴からの復元は可能だが、データと画面の整合を取り直す仕事になる）。基準の一覧の書き直し（`--write --reason`）と多数のテストの削除が要る |

推奨の段取り: 18 では残す。**Q-L2 の回答が「不可」なら、別の PR（番号は後で付ける）で削除**し、基準の一覧を `node scripts/testids.mjs --write --reason "Sprint 18 の後: 申請支援のコードを削除（Q-L2 の回答 YYYY-MM-DD）"` で書き直す。「可」なら、フラグを外すかどうかを改めてユーザーに諮る。

### 4.6 判定エンジンの文言の扱い（`/judgement` の注意書きの件を含む）

- `packages/regulations` の判定の出力（`verdict.ts`・`index.ts`・`procedures.json`・`categories.json` の文言、`DEFAULT_DISCLAIMER`・`DIAGNOSIS_DISCLAIMER`）は**このスプリントでは変えない**。理由: 判定のスナップショットに保存され、`/api/check`・`/api/diagnose` の応答の基準のテスト（`diagnose-core.test.ts` の SHA 比較、`sprint11d-verdict-baseline.json`）に入る。変えるなら基準の作り直しと、保存済みの判定との表示の食い違いの整理が要り、境界の整備の範囲を超える。
- 画面では、エンジンの文言を**判定の領域の印**（`data-wording-scope="judgement"`）の中に置き、限定語（申請・保証・必ず）を許す（§6）。全面禁止語は印の中でも 0。
- `/judgement` の「必ず」（「飛行の前後に必ず行うこと」と判定の項目の理由）は、利用者への注意として許可リストに載せる。「保証」は【推定】で出ない（D7）。18-3 の走査で実測し、出れば否定の文であることを確かめて許可リストに載せる。
- エンジンの文言で「申請」を含むものは、18-3 で `docs/legal/screen-wording-inventory.md` の「判定エンジン由来」の節に一覧にし、専門家確認（Q-L2）の資料にする。直すかどうかは回答の後。

## 5. 提供元の表記・題名と説明・免責（18-3）

### 5.1 提供元の定数

- 置き場所: `apps/web/src/lib/provider-info.ts`（1 か所）。値は `docs/provider-info.md` の表の**確認済みの 6 項目だけ**: 正式名称、郵便番号＋所在地、電話番号、代表者、問い合わせメール、受付時間（「9:00〜17:00」。曜日・祝日を書かない）。
- **載せない**: 受付の曜日・祝日（U1）、ロゴ（U2 使用ルールが未確認。`docs/brand/futuretec-logo-mark.png` は使わない）、適格請求書発行事業者番号（U3）、法人番号・設立年月日（U4）、色コード（U5）。空欄・「準備中」・「未定」・仮の値も出さない。
- 単体 `provider-info.test.ts`: `docs/provider-info.md` の表（「| 項目 | 内容 | 出典 |」）を読み、定数の 6 項目が表の値と一致すること（受付時間は表の値「9:00〜17:00」と一致し、括弧の注記を含めない）。定数のキーに未確認の項目が無いこと。

### 5.2 境界の文（定数。`lib/boundary.ts`）

「代行」「代理」の語を使わずに書く（§6 で全面禁止にするため）。

- `BOUNDARY_SHORT`: 「許可・承認などの申請は、ご本人が DIPS 2.0 などで行います。そらばんは、申請の作成・提出とその支援を行いません。」（判定の結論の直下。A15）
- `BOUNDARY_FULL`: 「そらばんは、許可・承認、機体登録、操縦者登録などの申請の作成・提出とその支援を行いません。飛行計画の通報は、利用者本人が DIPS 2.0 の認証と最終確認のもとで行います。そらばんは、通報の内容の整理と、通報した結果の記録を扱います。」（このアプリについて）
- `BOUNDARY_REGISTRATION`: 「機体・操縦者の DIPS への登録は、利用者本人が DIPS で行います。」（機体・操縦者の一覧と、通報の作業台）
- 文言は**専門家確認の前の暫定版**であることを定数のコメントに書く（画面には出さない）。

### 5.3 免責の定数（`lib/disclaimers.ts`。暫定版）

| 定数 | 文言 | 出す場所（`data-testid`） |
|---|---|---|
| `DISCLAIMER_JUDGEMENT` | 「判定は入力された情報の範囲での参考情報です。データの更新の遅れ・欠落がありえます。制度の最新性・正確性は保証しません。飛行の前に、国土交通省（DIPS 2.0）・警察・各自治体の最新の情報を確認してください。」 | 公開の `/` の詳細な指定の常設の注記・結果の免責（18-1 で差し替え済みの位置）、`/` の免責事項の本文（18-3）。運航管理の判定の画面は既存の `plan-disclaimer`（`PLAN_JUDGEMENT_DISCLAIMER`。B5 で直した文）のまま |
| `DISCLAIMER_INSPECTION` | 「点検は利用者の確認の記録です。項目の説明は参考で、機体の取扱説明書に従ってください。」 | 点検の入力の先頭（`/ops/inspections/new`、現場の点検の段）。`inspection-disclaimer`（新規） |
| `DISCLAIMER_RECORD` | 「記録は利用者の申告です。」 | 既存の `REPORT_SELF_REPORT_NOTE` などはそのまま（重複させない） |

日誌の確定の前（確定の機能が未実装）と、地図の範囲選択の送信前（Sprint 19）は対象外。

### 5.4 題名・説明・マニフェスト・フッター・このアプリについて

| 場所 | 現在 | 改めた値 |
|---|---|---|
| `app/layout.tsx:32` `SITE_TITLE` | 「そらばん — ドローン飛行の可否判定と運航管理」 | 「そらばん — ドローンの飛行計画の通報・点検・飛行日誌」 |
| `app/layout.tsx:33` `SITE_DESCRIPTION`（`description`・OG） | 「ドローン飛行の可否判定と運航管理。運営：…」 | 「ドローンの飛行計画の通報の記録、飛行前・飛行後の点検、飛行日誌をまとめる運航管理アプリです。地点の判定は補助の機能です。提供元：フューチャーテック株式会社。現在は社内での試験運用中です。」 |
| `app/page.tsx:120` 見出しの副題 | 「ドローン飛行の可否判定と運航管理」 | 「ドローンの飛行計画の通報・点検・飛行日誌」 |
| `site-lead`（127 行） | 「…飛ばす前に、その地点がどの法令・条例に当たり、どの手続きが要るかを一度に確かめ、出典つきの記録として残せます。」 | 「業務でドローンを飛ばす事業者・操縦者のための道具です。このページでは、地点がどの法令・条例に当たるかを、出典つきで確かめられます（判定は補助の情報です）。」 |
| `site-ops-note`（132 行） | 「運航管理（飛行計画・通報・飛行日誌）は、社内で試験運用しながら整えています。」 | 「飛行計画の通報の記録、飛行前・飛行後の点検、飛行日誌は、運航管理の画面で扱います（社内で試験運用中）。」 |
| `site-facts` の「運営者」 | 「運営者｜フューチャーテック株式会社」 | 「提供元｜フューチャーテック株式会社」（値は定数から） |
| `/` のフッター（222-229 行） | 「© 2026 フューチャーテック株式会社　鳥取県西伯郡日吉津村」 | `site-provider`（新規）: 提供元の 6 項目（名称、代表者、〒・所在地、電話、メール、受付時間）と `BOUNDARY_FULL`。「© 2026 フューチャーテック株式会社」は残す（10a #5） |
| `/` の免責事項の本文（211 行） | 「本ツールは参考情報であり、飛行可否を最終的に保証するものではありません。…実運用前に必ず…」 | `DISCLAIMER_JUDGEMENT` ＋ 既存の後半（条例データの手作業の収録・確からしさ）。DIPS のリンクは残す |
| マニフェスト（`lib/pwa.ts:159-161`） | `name`「そらばん 運航管理」、`description`「ドローンの飛行前の確認・離着陸・点検・日誌を、電波の弱い現場でも記録します。」 | `name` は変えない。`description`「ドローンの飛行計画の通報の記録、飛行前・飛行後の点検、飛行日誌を、電波の弱い現場でも扱えます。提供元：フューチャーテック株式会社」 |
| `/ops/about`（新規） | なし（運航管理に「このアプリについて」は無い【確認】） | 題名「このアプリについて」。`about-provider`（6 項目）、`about-boundary`（`BOUNDARY_FULL`）、`about-disclaimer`（`DISCLAIMER_JUDGEMENT`・`DISCLAIMER_INSPECTION`・`DISCLAIMER_RECORD`）、版（既存のビルドの版・`ENGINE_VERSION` の表示があればそれを再利用）。ログインした全役割が読める。`OPS_ENABLED` の裏 |
| `/ops` の全画面からの入口 | なし | ①利用者メニュー（`user-menu`）に「このアプリについて」（`user-menu-about`）。②`/ops/more`（登録）の末尾、`dips-note` の下に行（`more-link-about`）。**本文の末尾のフッターは足さない**（Sprint 17-2 の画面の長さの検査 `sprint17-2-db.spec.ts:398` などの上限を変えないため） |
| 機体・操縦者の一覧、通報の作業台 | なし | `BOUNDARY_REGISTRATION` を 1 行（`boundary-registration`）。通報の作業台は既存の注記の並びの末尾に足し、主画面（第一画面）には足さない |
| 地点判定の PDF のフッター（`regulation-pdf.tsx:649`） | 「© 2026 フューチャーテック株式会社」（直書き） | 定数の名称を使う（文言は同じ）。所在地などは足さない（長さ） |

「1 タップ以内」の扱い: 公開の `/` はフッター（スクロールのみ、タップ 0）。`/ops` は利用者メニューから 2 タップ、登録のタブから 2 タップ。**`legal-info-plan.md` §1.4 ③の「1 タップ以内」は満たさない**（画面の長さの上限との両立のため）。ユーザーに聞くこと Q6。

## 6. 禁止語・限定語の検査の仕様（18-3）

### 6.1 方針

- 語の一覧は 1 か所: `apps/web/src/lib/wording-policy.ts`（新規）。E2E と単体の両方がこれを読む。
- **全面禁止**（どこでも 0 件。判定の領域の印の中も）: 「通報不要」「通報は不要」「通報の必要はありません」「通報しなくて」「問題なし」「問題ありません」「大丈夫」「完璧」「完全に対応」「確実に適法」「法に抵触しません」「違法になりません」「安心して飛べます」「保証します」「代行」「代理」。※「代行」「代理」は境界の文に使わない（§5.2）ため、例外を作らない。専門家が「申請の代行はしません」という書き方を求めた場合は、その全文だけを許可リストに足す（語の全面禁止を外さない）。
- **限定語**（許可リストの文の中だけ許す）: 「申請」「保証」「必ず」。
- **判定の語**: 「手続き不要」は判定の段の名前としてだけ（判定の領域の印の中）。
- **判定の領域の印** `data-wording-scope="judgement"`: 判定エンジンの文言を出す要素に付ける — 公開の `/` の `result-section`・`result-details`（`VerdictSummary` と規制カード）・`did-status`、`/ops/plans/[id]/judgement` の `VerdictSummary`、`/ops/plans/[id]/snapshots/[sid]` の判定の本文、計画の主画面の判定の 1 行（`plan-main` の判定の行）。印の中では限定語を検査しない（全面禁止語は検査する）。**印を付ける要素は上の一覧に固定し、増やすときは理由を `wording-policy.ts` のコメントと test-changes の文書に書く。**

### 6.2 走査の手順（E2E）

- 対象の文字列: `document.documentElement.textContent`（畳み・`display:none` の中も含む）から、印の中の文字列を除いたもの（限定語の検査用）と、除かないもの（全面禁止語の検査用）。加えて全要素の `aria-label`・`title`・`alt`・`placeholder`、`<title>`、`<meta name="description">`、OG。
- 限定語の判定: 対象の文字列から許可リストの文（完全一致の部分文字列）を全部取り除き、残りに限定語が 0 件。
- 失敗のメッセージに、ルート・語・前後 20 文字を出す。
- **モックのデータを対象にしない**: シード（`db:seed:ops-test`）と E2E のフィクスチャの文字列に全面禁止語・限定語が無いことを単体で確かめる（`wording-policy.test.ts`）。

### 6.3 許可リスト（初期値。18-3 で実測して確定する）

| 語 | 許す文（完全一致の部分文字列） | 出どころ |
|---|---|---|
| 申請 | `BOUNDARY_SHORT`・`BOUNDARY_FULL` の全文、`OFFICIAL_PROCEDURE_NOTE` の新しい 1 文 | §5.2、B5 |
| 保証 | 「制度の最新性・正確性は保証しません」、「報告が必要かどうかを判断するものでも、保証するものでもありません」 | `DISCLAIMER_JUDGEMENT`、`ops-incident.ts:36` |
| 必ず | 「飛行の前に必ず DIPS でご確認ください」 | `regulation-map-layers.ts:195`（地図の凡例。印の外に出る場合） |

印の中で使われている限定語の文（例: 「飛行の前後に必ず行うこと」「事前申請が必要」「申請を不要化できる」）は、許可リストに載せず、`docs/legal/screen-wording-inventory.md` の「判定エンジン由来」の節に記録する。

### 6.4 走査するルート

| 区分 | ルート | 状態 |
|---|---|---|
| 公開 | `/` | ①初期表示、②プリセットの 4 地点（米子市役所・美保基地の周辺・境港の工業専用地域・緊急用務空域を手で選んだもの）で判定が終わった後、③機体・運航条件を開いた後。地点判定の PDF の文字列（既存の 10a #8 の抽出を使う） |
| 運航管理（運航管理者でログイン） | `/ops`、`/ops/plans`、`/ops/plans/new`、`/ops/plans/[id]`（主画面）、`/overview`、`/report`、`/judgement`、`/journal`、`/field`、`/field/incident`、`/snapshots`、`/snapshots/[sid]`、`/edit`、`/ops/inspections`・`/new`・`/[id]`、`/ops/flights`・`/new`・`/[id]`、`/ops/journal`、`/ops/incidents`・`/new`・`/[id]`、`/ops/aircraft`・`/new`・`/[id]`、`/ops/pilots`・`/new`・`/[id]`、`/ops/permits`・`/new`・`/[id]`、`/ops/places`・`/new`・`/[id]`、`/ops/members`、`/ops/more`、`/ops/about`、`/ops/offline/*`（5 つの殻）、`/ops/manifest.webmanifest`（JSON の全文字列） | 計画は、通報の記録あり・なし、判定に許可・承認の手続きがあるもの（`register_permit` が出る）、飛行禁止法の手続きがあるもの（`notify_police`）、技能証明の更新の時期の操縦者（`renew_license`）を含むシード |
| 対象外 | `/ops/design`（本番 404。Sprint 16-1 で作り直し）、`/ops/sign-in`・`/ops/no-access`（認証の画面。18-3 では対象外、次の検査の拡張で） | — |

### 6.5 単体での走査

`wording-policy.test.ts`: 次の定数の文字列（オブジェクトは深く）を同じ規則で検査する — `packages/dips/src/messages.ts` の全 export、`NEXT_ACTION_LABEL`、`lib/verdict-display.ts`、`lib/plan-main.ts`、`lib/ops-field.ts` のラベル、`lib/ops-incident.ts`、`server/ops/license.ts`・`deadlines-logic.ts` のラベル、`PLAN_JUDGEMENT_DISCLAIMER`・`REPORT_FIXED_NOTE`、`lib/boundary.ts`・`lib/disclaimers.ts`・`lib/provider-info.ts`、`lib/pwa.ts` のマニフェスト。`packages/regulations` の判定の出力（エンジン）は対象外（§4.6）。旧名称（「AIさんいん」「タイヨー通信群」「メルドカルタ」）が `apps/web/src`（テストを除く）と `apps/web/public` に 0 件。メールアドレスの形の文字列は `info@futuretec-jp.com` だけ（テスト・フィクスチャを除く）。

既存の `e2e/ops-db/plan-screen.ts` の `FORBIDDEN_WORDS`・`FORBIDDEN_WORDS_NON_JUDGEMENT` と `expectNoForbiddenTextContent` は**残す**（弱めない）。新しい検査はそれに加える。

## 7. PR の分割と契約（直列）

共通: 検証の手順は `docs/runbooks/local-verification.md`。区切りごとにコミットし、実行のログを `docs/evaluations/` に残す。外したテスト・置き換えたテストは `docs/evaluations/sprint-18-test-changes.md`（テスト名・前の検査・後の検査・理由）に、画面に出なくなった `data-testid` は `docs/evaluations/sprint-18-testid-map.md`（識別子・前の画面・フラグ無効での扱い・同等の検査先）に書く。**基準の一覧から消える識別子は 0 の想定**（コードを残すため）。もし消すなら `node scripts/testids.mjs --write --reason "…"` で書き直し、`apps/web/src/components/ops/testids-baseline.test.ts` の `BASELINE_MIN_COUNT`・`BASELINE_SHA256` を意図して更新し、対応表に載せる。新しく足す識別子は基準の一覧に足さなくてよい（`--check` は消えたものだけを見る）。

### 7.1 PR 18-1: 公開の `/` の申請支援を止める（フラグ）と関連テストの整理

**変更するファイル（想定）**: `lib/boundary.ts`（新）、`app/page.tsx`（フラグを読んで渡すだけ）、`components/regulation-checker.tsx`、`components/verdict-summary.tsx`（`RESPONSIBILITY_NOTE`）、`components/regulation-pdf.tsx`（490 行の文言）、`lib/verdict-display.ts`、`lib/disclaimers.ts`（新。`DISCLAIMER_JUDGEMENT` だけ先に）、`lib/diagnose.ts`（型）、`app/api/diagnose/route.ts`、`playwright.config.ts`・`playwright.ops.config.ts`（env の明記）、E2E（下表）、`docs/evaluations/sprint-18-test-changes.md`・`sprint-18-testid-map.md`（新）。**`packages/regulations` は変えない。**

**完了条件**

| # | 内容 | 検証 |
|---|---|---|
| 1-1 | フラグ無効（既定）で、公開の `/` に判定が出た後、`body` の `textContent` に「申請支援」「申請の準備」「必要手続きチェックリスト」「提出期限」「プリフィル」「束ね PDF」「飛行マニュアル」「書類の下書き」「カテゴリー切り分け」「下書きまでを手伝います」が 0 件。`diagnosis-details`・`diagnosis-category-headline`・`diagnosis-did-status`・`procedure-card` が `toHaveCount(0)` | E2E `e2e/sprint18-1.spec.ts`（375×812 と 1280×900。プリセット 4 地点） |
| 1-2 | 判定は残る: `verdict-level`・`verdict-procedures-section`・`verdict-duties-section`・`verdict-items`・`verdict-responsibility`・`did-status`・`evidence-id` が見え、「PDF 出力」で地点判定の PDF が出る。4 段の結論が、同じ入力で 18-1 の前と同じ（`data-verdict-key` を 4 地点×飛行の方法 2 通りで比べる。前の値は基準のコミットで取って test-changes に記録） | E2E 1-2 |
| 1-3 | `verdict-responsibility` の文が `BOUNDARY_SHORT` と一致（`/` と `/ops/plans/[id]/judgement`） | E2E 1-3、E2E-DB（`sprint17-db` に 1 件追加） |
| 1-4 | `/api/diagnose` の応答（`page.request.post`）に `prefill` が無く、`verdict`・`procedures`・`evidenceId` はある。`handleDiagnosePost` の応答は変わらない（`diagnose-core.test.ts` が無変更で通る） | E2E 1-4、単体（ルートの取り除き）、既存の単体 |
| 1-5 | §4.2 の文言表のとおり（凡例「飛行の方法」、予定日・補助者の説明、低い確からしさの注記、診断の失敗の文、常設の免責 `DISCLAIMER_JUDGEMENT`）。地点判定の PDF に「許可申請」が 0 件 | E2E 1-5 |
| 1-6 | 判定履歴: 旧い形式の項目（`diagnosisInput.completedProcedureIds` を含む。localStorage に入れてから開く）が一覧に出て、押すと復元・再判定でき、行に「手続き」の件数と「申請支援」が出ない。localStorage の項目は書き換わらない（開く前後で JSON が同じ。押す前） | E2E 1-6、`history.test.ts` に 1 件 |
| 1-7 | フラグの関数の単体（§4.1 の 5 通り）。`page.tsx` が `isApplicationSupportEnabled` を 1 回だけ呼ぶ | 単体 |
| 1-8 | 375×812・1280×900 で横スクロールなし。`/` の全体の高さが 18-1 の前以下（`sprint12h-pr2` の上限 16,646px は変えない） | 既存 E2E |
| 1-9 | 回帰: `pnpm typecheck`・`lint`・`test`・`test:db`・`build`・公開の E2E（`--retries=0`）・`test:e2e:ops`。`node scripts/testids.mjs --check` が 0。`git diff --stat` に `packages/regulations/`・`packages/db/migrations/` が無い | CI と同じ |

**テストの移し替え（削除でなく置き換え。test-changes に全件）**

| テスト | 今の検査 | 18-1 後の検査 |
|---|---|---|
| 10a #9 申請支援 PDF に運営者・免責・判定の版 | 束ね PDF の文字列 | 「束ね PDF を出力」のボタンが 0 件。運営者・免責・判定の版は #8（地点判定 PDF）が既に検査 |
| 11a #4 工業専用地域 | `diagnosis-did-status` に「非該当（工業専用地域）」 | `did-status` と DID のカードで同じ文字列 |
| 11a #12 物件の投下の通達の注記と PDF の通達番号 | 診断パネルの注記・束ね PDF | 判定（印の中）に通達の注記が出るかを generator が確かめ、出るならそちらで。出ないなら「出ないこと（フラグ無効）」と、`packages/regulations` の既存の単体での通達の注記の検査を test-changes に記す |
| 11a #17 緊急用務空域 | 「飛行できません」・提出期限の逆算が出ない・PDF | 「飛行できません」（結論）と地点判定の PDF はそのまま。提出期限は「無いこと」を全体で |
| 11c #6、7 #98 飛行禁止法の同意＋事前通報 | 診断パネルの手続き | `verdict-procedure`（手続きの id `small-drone-law-consent-notice` の行）と出典のリンク |
| 11d #6 DID の許可で手続き済み | `procedure-card[data-procedure-id="flight-permission-did"]` の印 | `verdict-done-item` の同じ手続き |
| 11e #13、11g #15 | `diagnosis-category-headline`、束ね PDF、マニュアル骨子 | 結論・注記（印の中）はそのまま。カテゴリー・PDF・骨子は「出ないこと」。中身は `packages/regulations` の `model-aircraft`・`diagnosis` の単体が守る（件名を test-changes に） |
| 11f #3・4 | `diagnosis-did-status` | `did-status` |
| 12h-pr2 B2（3 件） | `diagnosis-details` が閉じている・要約が見える・開閉 | `diagnosis-details` が 0 件。開閉の検査は規制カードの畳み（`coverage-details` ほか）で続ける。高さの上限は変えない |
| 12h-pr2「申請の準備を開くと…」 | 必要手続き・提出期限・束ね PDF が出る | 「申請の準備」が無いこと（1-1 と同じ語） |
| 12h-pr2 N1 | 責任の注記の全文（旧） | `BOUNDARY_SHORT` の全文。「代行・代理申請の語がない」はそのまま |
| 7 #199 地点判定 PDF と申請支援 PDF | 2 つの PDF | 地点判定 PDF だけ（データ名・確認日・改正）。申請支援 PDF は「出ないこと」 |
| 補助 `methodCheck`（11d・11e・11f・11g） | 凡例「飛行方法（申請支援）」で fieldset を探す | 凡例「飛行の方法」で探す（検査の強さは同じ） |
| 補助 `openDiagnosis`（`field-checks.ts`） | `diagnosis-details` を開く | 使う所が無くなれば削除（補助関数で、テストではない） |

**リスク**: ①公開の E2E が多い（16 件）。移し替えのたびに「検査が弱くなっていないか」を reviewer が表で確かめる。②`/` は静的に描かれるので、フラグの値はビルド時に決まる。開発サーバー（`next dev`）とビルドで振る舞いが同じであることを 1-1 で両方確かめる（CI は `next start`）。③既知の不安定なテスト（12h-pr2 B1 の地図のスクロール）と混同しない（runbook）。

### 7.2 PR 18-2: 運航管理の手続きの記録・次にやること・「申請」に見える文言

**前提**: 18-1 がマージ済み（`lib/boundary.ts` を使う）。

**変更するファイル（想定）**: `server/ops/procedure-records.ts`、`server/ops/report-dto.ts`（要約の `legacy`）、`components/ops/procedure-client.tsx`、`app/ops/plans/[id]/overview/page.tsx`、`app/ops/plans/[id]/judgement/page.tsx`、`snapshots/page.tsx`・`snapshots/[sid]/page.tsx`、`components/ops/report-client.tsx`（677 行の見出し）、`server/ops/report-logic.ts`（引数 `applicationSupport`）、その呼び出し（`plans.ts`・`today.ts`・`flight-extras.ts` など）、`packages/dips/src/messages.ts`、`packages/regulations/src/report-requirement.ts`（表示の定数 2 つだけ。エンジンではない）、`server/ops/license.ts`・`deadlines-logic.ts`・`components/ops/license-renewal.tsx`・`today-ui.tsx`、テスト。**マイグレーションなし。`ENGINE_VERSION`・証跡を変えない。**

**完了条件**

| # | 内容 | 検証 |
|---|---|---|
| 2-1 | フラグ無効で、判定に許可・承認の手続きがある計画の `/overview#procedures` に `procedure-form-dips_permit` が 0、`procedure-small_drone_law`（飛行禁止法の手続きがあるとき）は今までどおり記録できる | E2E-DB `sprint18-2-db.spec.ts` |
| 2-2 | API: `kind=dips_permit` の `done`・`retract` は 409 `procedure_kind_disabled`。行は増えない（件数を前後で比べる）。`small_drone_law` は 201 | DB テスト（`procedure-records.db.test.ts` に追加）、E2E-DB |
| 2-3 | 既存の `dips_permit` の行（DB テストで直接入れる、またはフラグ有効の状態で記録してからフラグ無効で読む）は消えず、`procedure-dips_permit[data-legacy="true"]` と履歴の行が出て、フォーム・取り下げのボタンが無い。表の行数・ハッシュの列が変わらない | DB テスト、E2E-DB（`process.env` を切り替えられない E2E では、DB テストの方で） |
| 2-4 | 次にやること: フラグ無効で `apply_permit` が 0（計画の主画面とホーム）。許可・承認の手続きが残り適用できる登録が無いとき `register_permit`（名前「取得した許可・承認を登録する」、期限の文言なし、tier 3、`href` `/ops/permits/new`、操縦者は `canAct=false`）。登録を入れて判定が手続き済みになると消える。`notify_police` は今までどおり | 単体 `report-logic.test.ts`（無効・有効の両方）、DB、E2E-DB |
| 2-5 | フラグ有効の振る舞いが今と同じ: 既存の `report-logic.test.ts:290-380`、`reports.db.test.ts:1417-1525`、`permits.db.test.ts:914-932` を、引数またはテストの環境（`vi.stubEnv("APPLICATION_SUPPORT_ENABLED","1")`）で有効にして、**期待値を変えずに**通す（`register_permit` の名前の変更だけは期待値を直す） | 単体・DB |
| 2-6 | 技能証明: 札「更新の時期」「更新の期限（満了の 1 か月前）を過ぎています」、説明文（§4.3-3）、次にやること「技能証明の有効期限を確認する」。札の文字列は 1 つの定数から 4 か所に出る | 単体（`license.test.ts`・`deadlines-logic.test.ts`・`today-logic.test.ts`）、DB（`field.db.test.ts`） |
| 2-7 | 見出し「飛行の方法を含む判定の証跡 ID」（3 画面と通報の記録の行）。値と `data-testid` は同じ | E2E-DB |
| 2-8 | `/judgement` の `plan-permit-applied-note` が §4.3-5 の文。`/overview` の手続きの記録の説明、`procedure-none` の文が §4.3-1 のとおり | E2E-DB（12d 377 行を直す） |
| 2-9 | B5: 4 定数の末尾が `OFFICIAL_PROCEDURE_NOTE` の新しい 1 文で、互いに一致（単体）。`/ops`（`today-disclaimer`）・計画の主画面（`plan-disclaimer`）ほかで新しい文が出る | 単体（`messages.test.ts`・`report-requirement.test.ts:272` を直す）、E2E-DB |
| 2-10 | `/ops/**` の主要画面（§6.4 の運航管理の一覧）の `main` の `textContent` に、「許可・承認を申請する」「申請済み」「申請の準備」「申請支援」「更新の申請」が 0（フラグ無効。以前の記録の表示「以前の記録：許可・承認の手続きの申告…」は該当しない文にしてある） | E2E-DB 2-10 |
| 2-11 | 回帰: 1-9 と同じ一式。`pnpm test:db` が通る（版の履歴・ハッシュ連鎖）。`--check` が 0 | CI と同じ |

**テストの移し替え**

| テスト | 今の検査 | 18-2 後 |
|---|---|---|
| 12b-db #17 手続きの記録 | 画面で `dips_permit` を記録・取り下げ・再記録・古い記録、`apply_permit` の出入り | 前半を `small_drone_law` の同じ流れ（記録・取り下げ・再記録・古い記録・`notify_police` の出入り）に置き換え、`dips_permit` は「フォームが無い・API が 409・`apply_permit` が 0」。`dips_permit` の流れの検査は DB テスト（2-5、フラグ有効）で残す |
| 12d-db #15 申請済みの記録は判定を変えない | `dips_permit` を API で記録 → `register_permit` | 記録なしで `register_permit` が出る（2-4）→ 登録して番号を入れると消える。後半（番号で手続き済み）はそのまま |
| 12d-db 377 行 | `plan-permit-applied-note` に「申請済み」 | 「利用者本人が DIPS 2.0 で取得します」 |
| 17-db 236・249 行 | `apply_permit` の `href` が `/overview#procedures`、押して移る | `notify_police` の `href` が `/overview#procedures`（同じ移動の検査）と、`register_permit` の `href` |

**リスク**: ①`planNextActions` の呼び出しが多い（計画・ホーム・現場の束）。引数の渡し忘れで「有効」の振る舞いが出ると境界を越えるので、**既定を `false`** にし、型で必須にするかは generator の判断（必須なら呼び出しの全部が型で分かる。推奨: 必須）。②圏外の先読みの束（Sprint 15 の `field-bundle`）に次にやることの名前が入る【推定】。古い束を開いたとき旧い名前が出る可能性は、束の版で入れ替わるので許容（test-changes に記す）。③`packages/regulations` の表示の定数の変更は reviewer が「エンジンの出力に入らない」ことを確かめる（`reportRequirement` は保存されない【確認】）。

### 7.3 PR 18-3: 提供元の表記・題名と説明・免責・禁止語の検査

**前提**: 18-2 がマージ済み（直した文言の上で検査する）。designer の工程あり（フッター・このアプリについて・点検の注記の見た目）。

**変更するファイル（想定）**: `lib/provider-info.ts`・`lib/wording-policy.ts`（新）、`lib/boundary.ts`・`lib/disclaimers.ts`（追加）、`app/layout.tsx`、`app/page.tsx`、`lib/pwa.ts`、`app/ops/about/page.tsx`（新）、`components/ops/ops-nav.tsx`（利用者メニュー）、`app/ops/more/page.tsx`、機体・操縦者の一覧、通報の作業台、点検の入力（`/ops/inspections/new`、現場の点検の段）、`components/regulation-pdf.tsx`（定数の名称）、判定の領域の印（§6.1 の要素）、E2E・単体、`docs/legal/screen-wording-inventory.md`（新。走査の結果から作る）。

**完了条件**

| # | 内容 | 検証 |
|---|---|---|
| 3-1 | 提供元の定数が `docs/provider-info.md` の確認済みの 6 項目と一致。未確認の項目のキーが無い | 単体 `provider-info.test.ts` |
| 3-2 | 公開の `/` のフッター `site-provider` と `/ops/about` の `about-provider` に 6 項目が出る。文字列は定数から（ソースに値の直書きが `provider-info.ts` 以外に 0。単体で `apps/web/src` を検索） | E2E、単体 |
| 3-3 | 表示の文言に「未定」「準備中」「TBD」「要記入」「xxx」「ダミー」「example」、受付の曜日・祝日を示す語（「平日」「土日」「祝日」を受付時間の近く 30 文字以内）、法人番号・適格請求書の語が 0（`/`・`/ops/about`・マニフェスト） | E2E |
| 3-4 | 題名・説明・OG・見出しの副題・`site-lead`・`site-ops-note`・`site-facts`・マニフェストの `description` が §5.4 の値。`<title>` が「そらばん — ドローンの飛行計画の通報・点検・飛行日誌」 | E2E（10a の `TITLE`・`PURPOSE`、11a #7・#8 を新しい値に。test-changes に記す）、単体（`pwa.test.ts` に `description` の検査） |
| 3-5 | `/ops/about` が全役割で開け、`about-provider`・`about-boundary`（`BOUNDARY_FULL`）・`about-disclaimer` がある。利用者メニューの `user-menu-about` と `/ops/more` の `more-link-about` から 1 回の操作で移る。押す部品は 48px 以上 | E2E-DB |
| 3-6 | `boundary-registration` が機体・操縦者の一覧と通報の作業台にある。通報の主画面の第一画面（375×812）の並びは変わらない（Sprint 17-2 の検査が無変更で通る） | E2E-DB |
| 3-7 | `inspection-disclaimer` が点検の入力の先頭にあり、文が `DISCLAIMER_INSPECTION`。現場の画面の長さ・第一画面の検査（Sprint 14・15・17-2）が無変更で通る | E2E-DB |
| 3-8 | **禁止語・限定語の走査**（§6）: §6.4 の全ルート・全状態で、全面禁止語が 0、限定語が許可リストの文の外に 0。マニフェストの JSON・`<title>`・`meta`・地点判定の PDF の文字列も同じ | E2E `sprint18-3-wording.spec.ts`（公開）・`sprint18-3-wording-db.spec.ts`（運航管理） |
| 3-9 | 単体の走査（§6.5）: 定数の全文、旧名称 0、メールアドレスは `info@futuretec-jp.com` だけ、シードの文字列に禁止語・限定語なし | 単体 `wording-policy.test.ts` |
| 3-10 | `docs/legal/screen-wording-inventory.md`: 走査で見つかった限定語の全件（ルート・文・印の内外・分類〔許可リスト／判定エンジン由来〕）と、判定エンジン由来の「申請」の文の一覧（専門家確認の資料）。走査のスクリプトの出力から作り、手で書き足さない | 文書（evaluator が走査の出力と突き合わせる） |
| 3-11 | 公開の `/` の 375×812・1280×900 で横スクロールなし。10a #7（見出し・`site-facts`・`site-disclaimer`・フッターがビューポートの幅に収まる）、11b の見出しの CLS 0 が無変更で通る | 既存 E2E |
| 3-12 | 回帰一式（1-9 と同じ）。デザインの不変条件（白基調、橙は文字・細い線に使わない、本文 16px 以上、押す部品 48px 以上）を designer と evaluator が確かめる | CI、評価 |

**リスク**: ①副題・説明が長くなり、公開の `/` の見出しの折り返しで 10a #7・11b の CLS の検査に触れうる。上限は変えず、文を短くして合わせる。②走査の対象のルートが多く、E2E の時間が延びる（推定 2〜4 分）。運航管理の走査は 1 つのテストにまとめず、区分ごとに分けて失敗の場所を分かるようにする。③判定の領域の印を広く付けると検査が弱くなる。§6.1 の一覧に固定し、reviewer が差分で確かめる。

### 7.4 順序と衝突

- 直列: 18-1 → 18-2 → 18-3（18-2・18-3 は前の PR の定数を使う）。いずれも PR #49（Sprint 14・15・17）の上に積む。
- **Sprint 16 との衝突**: 16-1 は公開の `/` の挿絵と `/ops/design` を、16-3 は `/` と `/ops` の一貫性と旧い部品を触る。18 は文言・非表示・新しい小さな画面で、`regulation-checker.tsx`・`page.tsx`・`ops-nav.tsx` が重なる。**推奨: 18 を 16-1 より先に入れる**（境界の文言は後から直しにくく、外部提供の前提。16 は 18 の文言の上で見た目を整える）。16-1 で `/ops/design` の旧い見本が消えるので、D11 は 18 では触らない。
- **Sprint 19（地図）**: 18 と重なるファイルは無い見込み【推定: 19 は地図の部品と通報の整形。ファイル単位の突き合わせはしていない】。地図の範囲選択の免責（§5.3 の対象外）は 19 で。

## 8. ユーザーに聞くこと（絞った。推奨で進めてよいものは確定扱い）

| # | 質問 | 推奨 |
|---|---|---|
| **Q1** | **公開の `/` の申請支援（手続き診断・書類 PDF・プリフィル・マニュアル骨子・申請の期限・申請支援の保存の表示）を、専門家確認（Q-L2）が出るまで止めてよいか** | **止める**（本番では常に無効。判定は残る） |
| Q2 | 止めたコードを残すか消すか | **残す**（フラグの裏）。Q-L2 の回答で「不可」なら別 PR で削除 |
| Q3 | 運航管理の「許可・承認の申請済み」の記録と「許可・承認を申請する」を止め、「取得した許可・承認を登録する」に置き換える。既存の記録は読むだけで残す | **はい** |
| Q4 | 判定（補助）の段取り「要手続きの手続き（期限順）」の期限の列（例: 許可・承認の「飛行の 10 開庁日以上前」）は、判定エンジンの出力として残す | **残す**（エンジンを変えない。専門家確認の資料に入れ、回答で外すなら表示の層で隠す） |
| Q5 | 技能証明の更新は、有効期限の通知だけ残し、「申請」の語と手順の案内を外す（次にやることは「技能証明の有効期限を確認する」） | **はい** |
| Q6 | 「このアプリについて」への入口を、`/ops` では利用者メニューと登録のタブ（どちらも 2 回の操作）にする。全画面の末尾のフッター（1 タップ）は、画面の長さの上限と両立しないため入れない | **2 回の操作でよい**（`legal-info-plan.md` §1.4 ③を改める申し送り） |

推奨で確定扱いにするもの（異論があれば言ってもらう）: フラグの名前と既定（`APPLICATION_SUPPORT_ENABLED`、既定・本番は無効）、境界の文に「代行」「代理」を使わず両語を全面禁止にすること（§5.2・§6.1）、飛行禁止法の同意・通報の記録を残すこと（A6b）、取得済みの許可・承認の登録と照合を残すこと（A9）、提供元の 6 項目だけを載せてロゴは載せないこと（U2 まで）、`/api/diagnose` の `prefill` をルートの層で取り除くこと、判定エンジンの文言を変えないこと（§4.6）、旧名称の語は「AIさんいん」「タイヨー通信群」「メルドカルタ」の 3 つ（足す語があれば後から一覧に足す）。

## 9. 範囲外

判定の中身の変更・拡張（エンジン・データ・`ENGINE_VERSION`）。通報の送信（P2）。利用規約・プライバシーポリシーの本文と同意の記録（専門家確認の後）。取扱説明書（Sprint 25 の最小版）。ブランドの刷新・ロゴの掲載（U2 の後）。`/ops/design` の見本（Sprint 16-1）。地図の範囲選択の免責（Sprint 19）。日誌の確定の前の免責（確定の機能の実装時）。`/ops/sign-in`・`/ops/no-access` の走査。DIPS の API の申請。

## 10. 確認できていないこと

- 本番の DB に `plan_procedure_records` の `dips_permit` の行があるか（本番の DB に触れない）。行があっても 18-2 は消さず読むだけ。
- `/judgement` の画面に「保証」が出るか（コードの検索では見つからない。D7）。18-3 の走査で実測する。
- 11a #12 の通達の注記が、診断パネルの外（判定の項目）にも出るか。18-1 で generator が確かめる。
- 圏外の先読みの束に、次にやることの名前が保存されるか（18-2 のリスク②）。
- 公開の `/` が完全に静的に描かれ、フラグがビルド時に固まるか（`page.tsx` に `dynamic` の指定は無い【確認】が、`OpsHomeEntry` の Suspense があるため、部分的な描画の作法の確認が要る）。18-1 で `next build` の出力で確かめる。
- 専門家の評価（Q-L1・Q-L2）。分類はすべて安全側の方針案。

## 11. オーケストレーターへの申し送り（planner は書き換えない文書）

- `docs/sprints/README.md` の索引: 18 の状態を「詳細な契約（承認待ち）。18-1・18-2・18-3」に。
- `legal-info-plan.md` §1.4 ③「`/`・`/ops` の全画面から 1 タップ以内」→ Q6 の回答で改める。§2.4 の全面禁止語に「代理」と「問題ありません」「大丈夫」を足す（本契約 §6.1 と揃える）。
- `docs/spec.md`（`申請` 44 行）・`docs/00_NORTH_STAR.md`（16 行）・`docs/HANDOFF.md`（8 行）に申請支援を現役の機能として書く記述がある【確認: 件数のみ】。北極星の改訂の時に、Sprint 18 で止めたことを反映する。
- `sprint-16.md`: 18 を 16-1 より先に入れる推奨（§7.4）。
- `docs/evaluations/sprint-17-testids-baseline.txt` は 18 でも基準として使う（消える識別子 0 の想定）。

## 12. ユーザー決定（2026-11-01、オーケストレーター経由。ユーザーの方針「他の申請は一切やらない」に沿った推奨案での進行）

- **Q1〜Q6 はすべて推奨で確定**: Q1 公開の `/` の申請支援は専門家確認まで止める／Q2 止めたコードは削除せずフラグの裏に残す（専門家の回答が否定的なら別の PR で削除）／Q3 運航管理の「申請済み」の記録と次にやること `apply_permit` は止め、「取得した許可・承認を登録する」に置き換える／Q4 判定の手続き一覧の期限の列は、判定エンジンの出力なので残す／Q5 免許更新は期限の通知だけにして「申請」の語を外す／Q6 運航管理の「このアプリについて」は 2 タップで届く形を許容する。
- **順序**: Sprint 18 を Sprint 16-1 の前に行う（同じファイルを触るため）。18-1 → 18-2 → 18-3 の直列。
- **契約 §4.1 からの意図的な変更（18-1 のレビュー後、オーケストレーターの決定）**: フラグ `isApplicationSupportEnabled` は、`VERCEL` が設定されている環境（production・preview を含む Vercel のどこでも）では常に偽。有効にできるのは Vercel 以外（ローカル・自前ホスト）で `APPLICATION_SUPPORT_ENABLED=1` のときだけ。理由: preview の URL が保護されていないと外から見え、再ビルドなしの昇格で静的な `/` にフラグ有効が残るおそれがあるため。
- **契約 §4.2 の補足（同レビュー）**: フラグ無効のとき、`/api/diagnose` の応答から `prefill` に加えて `deadlines`（申請の提出期限の逆算）と `categoryNote` も除く（ルートの層 `server/diagnose-response.ts`。`handleDiagnosePost` と SHA の基準は不変）。`category`・`procedures`・`verdict`・`evidenceId` は残す。
- **契約の誤り（実測）**: §1-3 の「`/ops/plans/[id]/judgement` の `verdict-responsibility`」は、元から出ない（`evidence` prop を渡すのは公開の `/` だけ）。1-3 の E2E-DB は「出ないこと」の検査にした。

### 12.1 18-2 の独立レビューを受けた決定（2026-11-01、オーケストレーター）

- **L8（判定スナップショット）**: フラグ無効のとき、新しいスナップショットの `result` から `prefill`・`deadlines`・`categoryNote` を除いて保存する。既存の行は書き換えず、読み出しの DTO で除く。§4.4 の「変えない」の例外として記録する（運航管理にこれらを読む画面・API は無い。フラグを戻しても、無効の期間に保存した行に `prefill` が無いだけ）。
- **中-1（安全側の抜け。契約 §4.3-2 の条件の変更）**: `register_permit`（取得した許可・承認を登録する）は、**判定に許可・承認の手続きが残っているとき**に出す。条件 `!permits.applied` は外す。`applied` は「計画の許可番号のうち、必要な種類の 1 つでも合えば真」で、一部しか登録されていない計画（例: DID と夜間に当たるのに、DID だけの登録）で、残った手続きについて次にやることが 0 件になるため。単体テスト（適用された登録があれば消える）は、手続きが残らない入力に限る形に直し、「一部だけ登録」の DB テストを足す。
- **中-2（文言の変更）**: 以前の `dips_permit` の記録の札「✓ 手続き済みの申告(以前の記録)」は、判定の「手続き済み（条件付き）」と紛れ、許可・承認が下りたと読めるので、**「以前の申告（許可・承認の取得を示すものではありません）」**にする（緑の ✓ を使わない中立の札）。以前の記録が stale のときの「もう一度確認してください」は、操作の入口が無いので出さない。
- **低-3（事実性）**: 「DIPS 2.0 で行います」「DIPS 2.0 で取得します」と断定した文は、**「DIPS 2.0 などの公式の手続きで」**に直す（18-1 の `BOUNDARY_SHORT` と揃える。許可・承認は書面の申請の道もありうるが未確認）。免許更新の文は、「更新の手続きは、操縦者本人が公式の手続きで行います」とし、**期限（満了の 1 か月前）を過ぎたあとも更新できるように読める言い方をしない**。いずれも `legal-info-plan.md` の専門家確認の質問票に「※要確認」として入れる（オーケストレーターが追記）。
- **低-1**: `NextActionsInput.permits` を必須にする。**低-2**: `ProcedureRecordsPanel` の legacy の分岐（フォーム・取り下げが 0）の部品テストを足す。

### 12.2 18-3 の申し送り（2026-11-01）

- 技能証明の札「更新の期限（満了の 1 か月前）を過ぎています」が黒い面に白文字になっている（18-2 の評価）。不変条件 6「暗い表示は使わない」との関係は、18-3 では触らず、Sprint 16 で色の仕組みごと見直す。
