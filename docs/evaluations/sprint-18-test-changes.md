# Sprint 18-1: 既存テストの変更と理由

意図の変更は「公開の `/` の申請支援（診断パネル・束ね PDF・プリフィル・マニュアル骨子・期限カレンダー）を、フラグ
`APPLICATION_SUPPORT_ENABLED`（既定・本番は無効）で止めた」ことだけ。**元の検査を単に消さず、「無くなっていること」の検査に置き換えた**
（共通の補助 `expectNoApplicationSupport`: 本文 `textContent`（畳みの中も含む）に申請支援の語 10 個が 0 件、診断の部品 4 種が 0 個、「束ね PDF」のボタンが 0 個）。
診断パネルの中身そのものは `packages/regulations` の単体テスト（無変更）が守る。フラグ有効の E2E は作らない（公開の `/` はビルド時に値が固まるため。`apps/web/src/lib/boundary.ts`）。

画面に出なくなった `data-testid` の対応表は `sprint-18-testid-map.md`。基準の一覧から消える識別子は 0（コードを残したため）。

## 置き換えた公開の E2E（16 本）と補助関数

| # | テスト | 前の検査 | 後の検査 | 理由 |
|---|---|---|---|---|
| 1 | `sprint10a` #9 | 束ね PDF に運営者・「判定の版」・免責・証跡 ID（フッター）・禁止語 | 束ね PDF のボタンが 0、申請支援の語・部品が 0。**運営者・判定の版・免責・禁止語は #8（地点判定 PDF）が既に検査**。証跡 ID の日本語ラベル（`証跡 ID（判定と手続き）ev_…`、英字 `Evidence` でない）の検査は #8 に移した | 束ね PDF が出ない |
| 2 | `sprint11a` #4 | `diagnosis-did-status` に「非該当（工業専用地域）」 | `did-status`（DID 自動判定）に同じ文字列。診断パネルが無いこと | 同じ値は公開の `/` に残る `did-status` で見える |
| 3 | `sprint11a` #12 | 診断パネルに通達の注記（国空無機第338898号）とリンク、束ね PDF に番号 | 判定の手続きに「物件の投下」が出る。通達の番号・リンクは**画面に出ない**（実測）。診断パネルが無いこと | 通達の注記は診断の `verificationNotes` で判定の画面には出ない。注記の中身は `packages/regulations/src/sprint11a.test.ts`（10・11）が守る |
| 4 | `sprint11a` #17 | 診断パネルの「飛行できません」・期限の逆算が出ない・5-1(2)c) の説明・プリフィルの飛行の種類・束ね PDF | 結論 `verdict-level`=「飛行不可」（`data-level=no_fly`）、本文に「開庁日以上前までに提出」「起算日」が 0、申請支援が 0、地点判定 PDF に「飛行不可」があり「許可申請」が 0 | 「飛行できません」・5-1(2)c)・プリフィルは診断の文言で出ない。5-1(2)c) は `sprint11a.test.ts` 16 が守る |
| 5 | `sprint11c` #6 | 診断パネルの手続きカード（article）が、同意・通報のチェックの有無にかかわらず出る | 判定の `verdict-small-drone-consent`・`verdict-small-drone-notice`（要手続きの手続き）が出る。入力後は要手続きの行か `verdict-done-item[data-item-id=small-drone-law]` のどちらかに残る。診断の article は 0 | 契約の表は「`small-drone-law-consent-notice` の行」だが、判定の手続きの id は `verdict-small-drone-consent`・`-notice`（2 行に分かれる）。実測で合わせた |
| 6 | `sprint7` 飛行禁止法の手続き | 診断パネルの article と、出典リンク `…/tsuhou.html`。green では article が 0 | 判定の同意・通報の行が出る。出典リンクは規制カード `regulation-card-small-drone-law` の `…/kogatamujinki/index.html`。green では 2 行とも 0 | 判定の手続きの行にはリンクが無い。`tsuhou.html` は診断の手続きのデータ（`sprint12a-diagnose-baseline.json` の応答全文が守る）で、画面には出なくなった |
| 7 | `sprint11d` #6 | `procedure-card[data-procedure-id=flight-permission-did]` が `data-verdict=procedure_done`、`procedure-verdict-done` に「手続き済み（条件付き）」 | 段取り（要手続きの手続き）から DID が外れること（既存）、`verdict-done` の節に「手続き済み（条件付き）」、`verdict-done-item`（aviation-law-did。item の id を持ち、手続きの id は持たない）の中に「国交省 DIPS：DID 上空の飛行許可」と `verdict-done-condition` が 1 件以上、`procedure-card` が 0 | 手続き済みの印は判定の `verdict-done-item` に残る |
| 8 | `sprint11e` #13 | `diagnosis-category-headline` に「対象外（模型航空機」、束ね PDF の文字列、マニュアル骨子に第132条の85 が無い | 申請支援が 0、「カテゴリー I（特定飛行に非該当）」が本文に無い。判定（level・手続き・DID の理由）と地点判定 PDF の検査は残した | カテゴリー・PDF・骨子は出ない。中身は `packages/regulations` の `model-aircraft`・`diagnosis` の単体と `apps/web/src/server/sprint11e.test.ts` |
| 9 | `sprint11f` #3・4 | `diagnosis-did-status`（`DID（人口集中地区）: 対象外（模型航空機）`／`該当`）、束ね PDF の DID の行 | `did-status`（`DID 自動判定：…`）に同じ値、申請支援が 0。地点判定 PDF・履歴の検査は残した | 同じ値は `did-status` に残る |
| 10 | `sprint11g` #15 | 束ね PDF（許可または通報・出典 URL・マニュアル骨子の文） | 申請支援が 0。判定の手続き・義務・注記と地点判定 PDF（出典 URL を含む）の検査は残した | 骨子の中身は `packages/regulations` の単体と `apps/web/src/server/sprint11g.test.ts` |
| 11〜13 | `sprint12h-pr2` B2（3 件） | `diagnosis-details` が見える・閉じている／カテゴリーの見出しと「申請の準備」の summary が見える・束ね PDF が隠れている／キーボードで開閉（矢印の向き・文字・44px・フォーカスの輪） | `diagnosis-details` が 0。申請支援が 0。**開閉の検査は同じ部品（`Disclosure`）の `coverage-details` に移し、検査項目は同じ**。ページ全体の高さの上限（16,646／13,500）は**変えず**、短くなった分が戻らないよう 12,000 の上限を足した（12,000px は 18-1 の後戻り防止の上限。18-3 などで画面が意図して伸びるときは、理由を書いて引き上げてよい） | 部品が無い。実測（375px）前 12,086px → 後 11,244px、1280px は 6,713px → 6,189px |
| 14 | `sprint12h-pr2`「申請の準備を開くと…」 | 必要手続き・提出期限・束ね PDF が出る | 申請支援が 0（全部の畳みを開いても） | 「申請の準備」が無い |
| 15 | `sprint12h-pr2` N1 | `verdict-responsibility` に旧い文全文（「…下書きまでを手伝います。」） | `BOUNDARY_SHORT` の全文（`toHaveText` で他の文が混ざらないことは 18-1 の spec）、「下書き」が無い。「代行・代理申請の語がない」は無変更 | 契約 §4.2。文言の意図的な変更 |
| 16 | `sprint7` D「地点判定 PDF と申請支援 PDF にデータ名・確認日・改正」 | 2 つの PDF（`[t1, t2]`）を同じ項目で検査 | 地点判定 PDF（`t1`）だけ。束ね PDF は出ないこと | 束ね PDF が出ない |
| 補助 | `methodCheck`／`methodBox`（11d・11e・11f・11g） | 凡例「飛行方法（申請支援）」で fieldset を探す | 凡例「飛行の方法（選ぶと判定に反映します）」で探す（探す対象・操作は同じ） | 凡例の文言の変更（契約 §4.2） |
| 補助 | `openDiagnosis`（`field-checks.ts`） | `diagnosis-details` を開く | **削除**。使う所が無くなったため。代わりに `expectNoApplicationSupport`・`APPLICATION_SUPPORT_WORDS`・`APPLICATION_SUPPORT_TESTIDS` を追加 | 補助関数でテストではない |

## 追加したテスト

- `e2e/sprint18-1.spec.ts`（公開の E2E）: 1-1（4 地点 × 375×812・1280×900、畳みを開いても、横スクロールなし）、1-2（判定の部品が見える・地点判定 PDF・結論 8 通り）、1-3（責任の注記）、1-4（`/api/diagnose` に `prefill` が無い）、1-5（凡例・予定日・補助者・免責・診断の失敗の文・PDF に「許可申請」が無い）、1-6（旧い履歴の項目）。
- 単体: `lib/boundary.test.ts`（フラグ 5 通り＋`page.tsx` が 1 回だけ呼ぶ）、`server/diagnose-response.test.ts`（ルートの層の取り除き。無効なら無く他の項目は同一・有効なら無変更・本番は取り除く）、`lib/history.test.ts`（手続きの完了を含む旧い項目を読んでも JSON が変わらない）。

## 結論の同一性（1-2）

基準のコミット `8b3ee65` のビルドで、フラグ前の画面（凡例「飛行方法（申請支援）」）から同じ 8 通りを取り、18-1 後と完全に一致した（`data-verdict-key`/`data-level`）:

| 地点 | 飛行の方法なし | 夜間 |
|---|---|---|
| 米子市役所（初期表示） | needs / needs_procedure | needs / needs_procedure |
| 美保基地の周辺（境港市） | needs / needs_procedure | needs / needs_procedure |
| 鳥取市の工業専用地域 | none / no_procedure | needs / needs_procedure |
| 米子市役所＋緊急用務空域 | no / no_fly | no / no_fly |

`handleDiagnosePost` の応答の SHA を比べる `diagnose-core.test.ts` は無変更で通る。`git diff --stat` に `packages/` は無い。

## レビュー後の追加（18-1 リトライ 1/3）

- **M1**: フラグ無効のとき `/api/diagnose` の応答から `prefill` に加え `deadlines`（申請の提出期限の逆算）・`categoryNote` も除く（`server/diagnose-response.ts`）。`category`（履歴の保存値）・`procedures`・`verdict`・`evidenceId` は残す。単体: 無効なら 3 項目が無く文字列に「開庁日以上前までに提出」「提出期限の目安」が無い／有効なら無変更／本番・Vercel は有効でも除く。E2E: `sprint18-1.spec.ts` 1-4b。
- **L1**: 判定履歴の行の `cat:IIA相当` などを、フラグ無効では出さない（保存値は不変）。既存の E2E の変更: `sprint11a` #21（`cat:IIA相当` → `cat:` が無いこと＋保存値に `II_A` が残ること）、`sprint11f`（正の検査 `cat:` 4 か所 → 診断由来で残る `DID:`。負の検査 `not cat:` はそのまま）。
- **L5**: フラグは `VERCEL` が設定された環境では常に偽（`boundary.test.ts` を更新）。契約 §12 に追記、`docs/runbooks/local-verification.md` に運用の注意。
- **M2（契約の誤り）**: `/ops/plans/[id]/judgement` と `snapshots/[sid]` には `verdict-responsibility` が**元から出ない**（`evidence` prop を渡すのは公開の `/` だけ）。契約 1-3 の「`/judgement` で `BOUNDARY_SHORT`」の E2E-DB は足さない。代わりに `sprint17-db` の J-4 に「主画面・`/report`・`/judgement` に旧い注記の文「入力項目の下書き」「手伝います」が 0 件（`/report` には別の意味の「下書き」が元からあるため、語でなく文で検査）、`/judgement` に `verdict-responsibility` が 0 個」を足した。
- **語の一覧**: `APPLICATION_SUPPORT_WORDS` に「起算日」「開庁日以上前までに提出」「提出期限の目安」「DIPS／DRS 入力」「マニュアル骨子」「手続き窓口」を追加（公開の `/` の全体の走査として強くなる）。
- **L2**: `sprint11d` #6 の重複した検査を、`verdict-done` の見出しと `verdict-done-condition` の件数に置き換えた。
