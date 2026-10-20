# Sprint 11c: 許可の入力の不具合修正（飛行禁止法の同意と通報、DIPS の説明）

> 親文書：`docs/spec.md` §13.6（2026-10-20 差し込み）・§13.9.5／ `docs/00_NORTH_STAR.md` §0.1.9
> 期間：1〜2 日（差し込み）。Sprint 11d より先に終える。
> 前提：Sprint 11b までが本ブランチに入っていること。判定の段階（`red`／`yellow`／`green`／`unknown`）、`computeOverall`、`STATUS_LABEL` は変えない（Sprint 11d で扱う）。`ENGINE_VERSION`（`soraban-0.3.0-regulations-2026-07`）と証跡 ID の計算方法は変えない。DB のマイグレーションは追加しない。
> ※ Next.js は破壊的変更を含むため、実装前に `node_modules/next/dist/docs/` を参照（`apps/web/AGENTS.md`）。

## 目的と位置付け

判定を 4 段に組み直す（Sprint 11d）前に、刑事罰に関わる誤りを小さく先に直す。

1. **飛行禁止法の同意と通報を分ける（最優先）**：入力の「施設管理者」を一つチェックすると、小型無人機等飛行禁止法の例外（施設管理者の同意を得て、飛行の 48 時間前までに都道府県公安委員会へ通報した場合）まで当たり、対象施設の周辺地域が green になる。通報をしていない利用者に「飛べる」と出しうる。同意と通報を別の入力にし、両方そろったときだけ例外が当たるようにする。
2. **「国交省 DIPS」の説明を動きに合わせる**：入力の説明は「航空法 DID / 空港」だが、空港等周辺の規制には DIPS 許可の例外がなく、チェックしても空港等周辺は変わらない。説明を DID に限り、空港等周辺には当てない理由（空港ごとの個別の許可と、空港の設置管理者等との調整が要る）を表示する。

## 現状（2026-10-20、本ブランチ 8ddbfcd 時点）

| 箇所 | 現在 |
|---|---|
| `apps/web/src/components/regulation-checker.tsx` の「取得済みの許可」 | 4 つのチェック：国交省 DIPS（説明「航空法 DID / 空港」）、公園管理者、施設管理者（説明「県条例 / 飛行禁止法（同意＋公安委員会への通報）」）、文化庁・教育委員会 |
| 同 `buildCtx` | 施設管理者のチェックで `facility_manager` と `facility_manager_and_pref_pubsafety` の両方を `pilotPermits` に入れる |
| 同 履歴の復元（`setHasFacilityPermit(permits.includes("facility_manager"))`） | `facility_manager` があれば施設管理者をチェック済みに戻す |
| `packages/regulations/src/small-drone-law.ts` | 例外節 `small-drone-law-ex-consent-notice`：`permit_holder` == `facility_manager_and_pref_pubsafety`。当たると `applyExemptions` で red／yellow が green になる |
| `packages/regulations/src/index.ts` の県条例（迷惑行為等防止条例） | 例外節：`permit_holder` == `facility_manager`（施設管理者との事前調整）。同意だけで当たるのは正しい |
| 同 `AIRPORT_REG` | 例外節は 100g 未満だけ。`mlit` の例外はない |
| 同 `DID_REG` | 例外節 `did-ex-permit`：`permit_holder` == `mlit` |
| `apps/web/src/components/regulation-pdf.tsx` の `PERMIT_LABEL` | `mlit`：国交省 DIPS、`facility_manager`：施設管理者、`facility_manager_and_pref_pubsafety`：施設管理者+県公安委員会 |
| `apps/web/src/server/handlers.ts` の `/api/diagnose` | 地点判定には機体重量だけを渡す（許可を渡さない）。このため申請支援の手続き（同意＋事前通報）は許可の入力に関係なく出る |

## 実装する機能

### A. 飛行禁止法の同意と通報を分ける（generator）

- **A1. 入力を分ける**：「施設管理者」を次の二つに分ける。
  - 「施設管理者の同意」：説明「県条例の事前調整・飛行禁止法の対象施設の同意」
  - 「公安委員会への通報（飛行禁止法）」：説明「飛行の 48 時間前までに通報済み」
  - 5 つのチェックの並びは、スマホ幅（375px）で崩れないように designer が整える。
- **A2. 許可の値の組み立てを純関数にする**：`apps/web/src/lib/permits.ts`（新規）に、チェックの状態から `pilotPermits` を組み立てる関数と、`pilotPermits` からチェックの状態を戻す関数を置き、`regulation-checker.tsx` から使う。規則：
  - 同意 → `facility_manager`
  - 通報 → `pref_pubsafety_notice`（新しい値。エンジンのどの例外節にも当たらない記録用）
  - 同意かつ通報 → さらに `facility_manager_and_pref_pubsafety`（エンジンの飛行禁止法の例外節に当たる値。値は変えない）
  - 戻すとき：同意＝`facility_manager` を含む、通報＝`pref_pubsafety_notice` を含む。`facility_manager_and_pref_pubsafety` だけからは通報を済み扱いに戻さない（旧形式の履歴は同意・通報とも未チェック、または同意だけに戻る）。
- **A3. エンジンは変えない**：`small-drone-law.ts` の例外節の値と `applyExemptions` は変えない。同じ `pilotPermits` に対する判定結果は変わらないため、`ENGINE_VERSION` を上げない。エンジン側で二つの値を両方必須にする変更（`permit_holder_all`）は Sprint 11d で `ENGINE_VERSION` を上げるときに行う。
- **A4. PDF の表記**：`PERMIT_LABEL` に `pref_pubsafety_notice`：「公安委員会への通報（飛行禁止法）」を加え、`facility_manager` を「施設管理者の同意」、`facility_manager_and_pref_pubsafety` を「飛行禁止法の同意＋通報（両方）」に改める。

### B. DIPS の説明を動きに合わせる（generator）

- **B1. 説明の文言**：「国交省 DIPS」の説明を「航空法 DID（人口集中地区）の許可」に改める。空港等周辺には当てないことが分かる文言にする。
- **B2. 空港等周辺に当てない理由**：`mlit` を入力し、空港等周辺の規制（`aviation-law-airport`）が red または yellow のとき、その規制の表示（カードと PDF）に次の趣旨を出す：「空港等周辺は、空港ごとの個別の許可と、空港の設置管理者等との調整が必要です。入力した DIPS の許可は空港等周辺には当てていません。」
  - 実装は表示側（カードと PDF）で行い、`note` を書き換えない（`note` は判定結果であり、表示の補足と分ける）。共通の文言は `packages/regulations` に定数として置き、画面と PDF で同じ文を使う。
  - 文言の裏付け：generator は実装の当日に、国土交通省「飛行許可・承認手続」（https://www.mlit.go.jp/koku/koku_fr10_000042.html ）と審査要領で、空港等周辺の飛行に空港の設置管理者等との調整が要ることと、包括申請の扱いを確かめ、確認日と URL を定数のコメントに書く。確証が取れない部分は「※要再確認」を付ける。

### C. 磨き込み（designer）

- 5 つのチェックの並び（375px・768px・1280px）と、同意・通報が一組であることの見せ方（並べて置く、見出しでまとめる等）。
- 空港等周辺の補足の見た目（注記として控えめに、ただし読み飛ばされない）。
- ロジック・`data-testid`・`aria-*`・文言は変えない。

## 範囲外

- 判定の段階の組み直し、`STATUS_LABEL`・`computeOverall` の変更、信号機の見せ方（Sprint 11d）
- `ENGINE_VERSION` の変更、エンジンの例外節の変更（Sprint 11d）
- DIPS の許可・承認を種類ごとに入力すること（Sprint 11d）
- 許可の範囲（場所・方法・期間）と許可番号・有効期限の記録（Sprint 12）
- 申請支援（`/api/diagnose`）に許可を渡すこと（Sprint 11d）
- DB のマイグレーション

## スプリント契約（完了条件）

「単体」は vitest、「E2E」は Playwright（`e2e/sprint11c.spec.ts` を新設）、「grep」は `rg`・`git` による確認、「目視」は evaluator が Playwright MCP で確かめる項目。全 12 項目。

### A. 飛行禁止法の同意と通報

- [ ] 1. （単体）`apps/web/src/lib/permits.ts` の組み立て関数が、同意だけ → `["facility_manager"]`、通報だけ → `["pref_pubsafety_notice"]`、両方 → `facility_manager`・`pref_pubsafety_notice`・`facility_manager_and_pref_pubsafety` の 3 つを含む値を返す。他のチェック（DIPS・公園・文化庁）の値は従来どおり。
- [ ] 2. （単体）戻す関数が、`["facility_manager_and_pref_pubsafety"]`（Sprint 6 形式の履歴）から同意・通報とも未チェックを、`["facility_manager", "facility_manager_and_pref_pubsafety"]`（Sprint 11b までの形式）から同意だけチェック済み・通報は未チェックを返す。`apps/web/src/lib/history.test.ts` の旧形式の読み込みのテストが変更なしで通る。
- [ ] 3. （E2E）「美保基地の周辺（境港市）」で、同意だけをチェックすると小型無人機等飛行禁止法のカードが red のままで、適用された例外が表示されない。通報だけでも同じ。
- [ ] 4. （E2E）同じ地点で同意と通報の両方をチェックすると、小型無人機等飛行禁止法のカードに例外「対象施設の管理者の同意を得たうえで、飛行の 48 時間前までに都道府県公安委員会へ通報した場合」が適用されたと表示される。
- [ ] 5. （E2E）県条例（迷惑行為等防止条例）が red または yellow になる地点で（県条例のエンジンは対象施設の周辺で yellow を返し、red を返す地点はない。2026-10-20 evaluator の所見により修正）、同意だけをチェックすると従来どおり例外が当たる（同意で足りる規制は変わらない）。地点は既存の E2E の地点から generator が選ぶ。
- [ ] 6. （E2E）申請支援の手続き「施設管理者の同意 ＋ 都道府県公安委員会への事前通報（飛行の 48 時間前まで）」が、同意・通報のチェックの有無にかかわらず「美保基地の周辺（境港市）」で出る（`e2e/sprint7.spec.ts` の該当テストが緑のまま）。

### B. DIPS の説明

- [ ] 7. （E2E）「国交省 DIPS」のチェックの説明に「空港」の文字がなく、「DID」を含む。
- [ ] 8. （E2E）空港等周辺の規制が red または yellow になる地点（既存 E2E の米子空港の近傍）で、DIPS をチェックしても空港等周辺のカードの状態が変わらず、補足「空港ごとの個別の許可と、空港の設置管理者等との調整が必要」の趣旨の文が表示される。DIPS を外すと補足は出ない。
- [ ] 9. （grep）補足の文言が `packages/regulations` の定数 1 か所にあり、カードと PDF の両方がそれを参照している。定数のコメントに一次資料の URL と確認日がある。

### C. 版と証跡・範囲

- [ ] 10. （単体）`ENGINE_VERSION` が `soraban-0.3.0-regulations-2026-07` のままで、`apps/web/src/server/sprint10a.test.ts` の地点判定の証跡 ID の期待値と、申請支援の証跡 ID の期待値を持つ既存の単体テストが変更なしで通る。`packages/regulations/src/index.test.ts` の「MihoBase drops to green for facility_manager + pref_pubsafety」が変更なしで通る（エンジンを変えていない）。
- [ ] 11. （grep）`git diff --name-only origin/main` に `packages/db/migrations/` のファイルと `packages/regulations/src/small-drone-law.ts` が含まれない。`rg -n "特許|Patent|patent|出願" apps packages e2e scripts -g '!**/node_modules/**' -g '!packages/db/migrations/**' -g '!e2e/sprint10a.spec.ts'` が 0 件のまま。地点判定の PDF の「取得済み許可」に、同意と通報が別の語で出る。
- [ ] 12. （目視）evaluator のデザイン 4 基準で合格。特に、5 つのチェックが 375px で崩れず、同意と通報が一組だと分かり、空港等周辺の補足が読み飛ばされない。

### 回帰（全項目に共通）

既存の E2E（`e2e/reliability.spec.ts`・`sprint7`〜`sprint11b`、`e2e/ops-db/`）と CI がすべて緑で、`pnpm typecheck`・`pnpm lint`・`pnpm test`・`pnpm build` が通ること。項目数に数えない。

## 担当と順序

| 順 | 担当 | 行うこと | 渡すもの |
|---|---|---|---|
| 1 | generator | A1〜A4、B1・B2、単体テストと `e2e/sprint11c.spec.ts`（契約 1〜9）。見た目は最低限でよい | 変更ファイルの一覧、空港等周辺の文言の一次資料と確認日、375px・1280px のスクリーンショット |
| 2 | designer | C（チェックの並び、同意と通報の一組の見せ方、補足の見た目）。クラスだけを触る | 変更点 |
| 3 | evaluator | 契約 1〜12 を確かめる。3・4・8 は画面でも操作して確かめる | 合否レポート（不合格なら差し戻し先：値の組み立て・復元・文言・補足の条件は generator、並び・見た目は designer） |

## 既存の E2E を壊さないための注意

- 「取得済みの許可」のチェックをラベルで取っている E2E があれば、ラベルの変更に合わせて直す（`rg -n "施設管理者|国交省 DIPS" e2e` で確かめる）。直した箇所は報告する。
- `e2e/sprint7.spec.ts` の手続き名「施設管理者の同意 ＋ 都道府県公安委員会への事前通報（飛行の 48 時間前まで）」は変えない。

## リスク

| リスク | 対応 |
|---|---|
| API を直接呼ぶと `facility_manager_and_pref_pubsafety` を単独で送れ、例外が当たる | 利用者は自社の画面だけで、API は画面の入力から組み立てる。エンジンで二つの値を必須にするのは Sprint 11d（`ENGINE_VERSION` を上げるため、そこでまとめる） |
| 旧形式の履歴を復元すると、以前は green だった地点が red に戻る | 安全側の変化として受け入れる（契約 2）。利用者が通報を済ませていれば改めてチェックする |
| 空港等周辺の補足の文言が一次資料と食い違う | 実装の当日に一次資料を確かめ、確証のない部分は「※要再確認」を付ける（B2、契約 9） |

## ユーザー作業

- 公安委員会への通報を済ませた運用で、入力が実際の手順（同意を得てから通報する）に合っているかを確かめる。

## 未決事項（推奨つき）

1. **通報のチェックを常に出すか、飛行禁止法に当たる地点だけに出すか**。推奨：常に出す（入力欄が地点で増減すると、入力の手間と見落としが増えるため）。説明に「飛行禁止法の対象施設の周辺だけで使う」と書く。
2. **エンジンの例外節を 11c で両方必須にするか**。推奨：11c ではしない（`ENGINE_VERSION` を上げずに済ませ、11d の版上げにまとめる）。
