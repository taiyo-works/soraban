# Sprint 11f: 11d・11e の軽微な指摘の手直し（模型航空機の DID 表示・診断待ちの履歴・参照先・未収録の題名）

> 親文書：`docs/spec.md` §13.9.3・§13.9.9・§13.6（2026-10-21 差し込み）／ `docs/00_NORTH_STAR.md` §0.1.9
> 期間：半日〜1 日（差し込み）。Sprint 12 の前に終える。
> 前提：Sprint 11d・11e（PR #23）がマージ済み・本番反映済み（main = d08dc6f）。本スプリントは d08dc6f から切ったブランチで行い、新しい PR で出す。`ENGINE_VERSION`（`soraban-0.4.0-verdict-2026-10`）は変えない。DB のマイグレーションは追加しない。`packages/regulations/data/procedures/procedures.json` は変えない。
> ※ Next.js は破壊的変更を含むため、実装前に `node_modules/next/dist/docs/` を参照（`apps/web/AGENTS.md`）。

## 目的と位置付け

Sprint 11d・11e の evaluator が「次に回せる」とした軽微な指摘を、ユーザーの承認（2026-10-21）に基づいてまとめて直す。どれも判定の段階（飛行不可／要手続き／手続き済み（条件付き）／手続き不要／判定不能）は変えず、表示のずれと古い表示の残り方を直す。

1. 100g 未満で DID 内の地点の DID の表示が「非該当」と出て、同じ画面の「対象外（模型航空機）」とずれて読める。
2. 飛行の方法などを変えて診断を待っている間（最大 20 秒）、その実行の履歴に前の入力での判定（例：「手続き不要」）が残る。
3. 参照先 [1] の題名が冗長で、航空法施行規則へのリンクがない。
4. データ未収録の市町村で判定不能のとき、規制の題名に「米子市文化財保護条例」など別の市町村の名前が出る。
5. （任意）lint の警告 1 件。

0.4.0 は本番に出ているため、本スプリントでは証跡 ID が変わる変更をしない（下の C）。

## 現状（2026-10-21、d08dc6f 時点）

| 箇所 | 現在 |
|---|---|
| `packages/regulations/src/core.ts` `applyExemptions` | 機体重量の例外（`weight_below_g`）で `status` を green にし、例外前の判定を `statusBeforeExclusion`（red／yellow）に残す。`didDetail` は変えない（米子市役所の 50g では `in_did` のまま） |
| `packages/regulations/src/verdict.ts` `regulationItem` | 上の場合、`verdict` は `no_procedure`、理由は「対象外（模型航空機）…」。ただし `baseStatus` は green で、表示は `BASE_STATUS_LABEL.green`＝「非該当」。100g 未満の飛行の方法（夜間など）も `baseStatus` green |
| `packages/regulations/src/diagnosis.ts` `formatDidDetermination(status, detail)` | `not_applicable` は工業専用地域のときだけ「非該当（工業専用地域）」、それ以外は「非該当」。重量を見ない |
| 申請支援の欄（`diagnosis-panel.tsx` の「DID（人口集中地区）: …」、`regulation-checker.tsx` の「DID 自動判定：…」）、申請支援の PDF（`application-pdf.tsx`）、履歴の行（`regulation-checker.tsx` の「DID:…」） | いずれも `formatDidDetermination` を使い、50g の米子市役所で「非該当」 |
| 規制ごとの判定の表（`verdict-summary.tsx`・`pdf-verdict.tsx` の「元の判定」）、規制のカードの札（`regulation-card.tsx`）、地点判定の PDF（`regulation-pdf.tsx`） | `BASE_STATUS_LABEL[baseStatus／status]` で「非該当」。カードの例外の欄の見出しは「対象外にした例外（元の判定を非該当にしました）」 |
| 証跡 | 申請支援の証跡ペイロードの `d.did` に `didStatus`（`not_applicable`）が入る。地点判定の証跡には規制 ID・ctx・データセットが入り、題名・`didDetail`・判定の項目は入らない。`evidence_log` には `per_regulation_status`（status）・`per_regulation_verdict`（verdict）・`overall` が入る |
| `regulation-checker.tsx` `runDiagnose` | 応答を待つ間 `diagPending` を true にし、画面の結論は「判定中」。履歴の行（`diagnosisSummary`）は書き換えないため、前の入力での判定が残る。失敗・時間切れでは `markHistoryDiagnosisFailed` で判定を外し「判定未確定」、成功で新しい判定を書く |
| `apps/web/src/lib/history.ts` `historyVerdictDisplay` | `diagnosisSummary.verdict` があればそれを、地点だけの判定しかなければ「判定未確定（申請支援の診断が未完了）」を出す。判定中を表す手段がない |
| `packages/regulations/src/model-aircraft.ts` `MODEL_AIRCRAFT_REFERENCES[0]` | 題名「e-Gov 法令検索 航空法（航空法第134条の3。航空法施行規則第239条の2 は航空法施行規則）」、URL は航空法本体（`327AC0000000231`）だけ。参照先は 5 件 |
| `packages/regulations/src/index.ts` `evaluateMunicipalHeritage`・`evaluateMunicipalParks`・`evaluatePrefecturalNuisance` | 未収録のとき、それぞれ `YONAGO_HERITAGE_REG`（題名「文化財保護法第125条 / 米子市文化財保護条例 — 史跡内の現状変更」、ID `31202-heritage-protection`）、`YONAGO_PARK_REG`（「米子市都市公園条例 — …」、URL は米子市のサイト、ID `31202-park-ordinance`）、`TOTTORI_NUISANCE_REG`（「鳥取県迷惑行為等防止条例 — …」、ID `31-pref-nuisance-prevention`）をひな型にし、`status` を unknown にする。題名・出す先・概要に米子市・鳥取県の名前が残る |
| `apps/web/src/components/ops/records-client.tsx` | 使っていない `useRef` を import している（lint の警告） |

## 実装する機能

### A. 100g 未満で DID 内の地点の表示（generator）

- **A1. 言葉**：100g 未満で、機体重量の例外により対象外にした航空法の規制（DID・空港等周辺）と飛行の方法の「元の判定」の表示を「対象外（模型航空機）」にする（未決 1。推奨どおりなら）。文言は `model-aircraft.ts` に定数（例：`MODEL_AIRCRAFT_EXEMPT_LABEL`）として置き、各所はそれを参照する。
- **A2. DID の三値の表示**：`formatDidDetermination` に重量（例：第 3 引数 `{ droneWeightG }`）を渡せるようにし、`status` が `not_applicable`、`detail` が DID 内（`in_did`・`in_did_near_industrial_boundary`・`in_did_exclusion_unverified`）、重量が `DRONE_THRESHOLD_G`（100）未満のときだけ「対象外（模型航空機）」を返す。DID 外（`outside_did`）は「非該当」、工業専用地域は「非該当（工業専用地域）」、未確認は「未確認」のまま。重量未指定・100g 以上は今と同じ。
  - 重量を条件に入れる理由：0.3.0 以前の履歴では、許可で DID を green に下げた行も（`not_applicable`、`in_did`）になる。`didDetail` だけで判断すると、旧版の 900g の行を「対象外（模型航空機）」と誤って出す。
  - 使う箇所：申請支援の欄の「DID（人口集中地区）: …」と「DID 自動判定：…」、申請支援の PDF、履歴の行の「DID:…」（重量は `SavedCheck.ctx.droneWeightG`、画面と PDF は `DiagnoseResponse.droneWeightG` など既に持っている値を使う）。
- **A3. 規制ごとの判定の表**：`VerdictItem` に表示用の印（例：`baseExcludedAs?: "model_aircraft"`）を足し、`regulationItem`（`statusBeforeExclusion` があるとき）と、100g 未満で手続き不要にした飛行の方法の項目に付ける。`baseStatus` の値（green）は変えない。画面（`verdict-summary.tsx`）と PDF（`pdf-verdict.tsx`）の「元の判定」は、印があれば A1 の言葉を出す（共通の関数、例：`baseStatusDisplay(item)` を `verdict-display.ts` か `verdict.ts` に置く）。
- **A4. 規制のカードと地点判定の PDF**：`statusBeforeExclusion` を持つ規制は、カードの札・「元の判定」の行と `regulation-pdf.tsx` の「元の判定」に A1 の言葉を出す。例外の欄の見出しは、機体重量のときは「対象外にした例外（模型航空機）」の趣旨にし、欄の中に「例外前の判定：該当」（yellow なら「該当の可能性（要確認）」）を 1 行足す。地点が DID 内であることは、これで読み取れるようにする。工業専用地域（`in_zone`）の表示は今のまま。
- **A5. 変えないもの**：`status`・`statusBeforeExclusion`・`didStatus`・`didDetail`・`baseStatus`・`verdict` の値、`deriveDidStatusFromRegulations`、空域フラグの導出、申請支援のカテゴリー（`I`）と手続き。100g 以上・重量未指定の表示。

### B. 診断を待っている間の履歴（generator）

- **B1. 待っている間は「判定中」**：`runDiagnose` が要求を送るとき（`setDiagPending(true)` の時点）、その実行（`runId`）の履歴から診断の判定（`diagnosisSummary.verdict`・`verdictUnknownCount`）を外して保存する（`markHistoryDiagnosisFailed` と同じ処理を共通化。例：`clearHistoryDiagnosisVerdict(runId)`）。あわせて、応答待ちの `runId` を画面の状態に持ち、その行の判定を「判定中」（`VERDICT_PENDING_LABEL`）と出す。保存するのは「判定を外した」状態だけにし、「判定中」の印は保存しない。
  - 理由：判定中の印を localStorage に保存すると、待っている間に画面を閉じた行が次に開いたときも「判定中」のまま残る。判定を外した状態だけを保存すれば、開き直したときは既存の「判定未確定」になる（手続き不要とは出ない）。
- **B2. 既存の動きを保つ**：成功で診断の判定を書く（今と同じ）。失敗・時間切れで「判定未確定」（今と同じ）。古い応答は捨てる（`diagSeqRef`）。地点判定だけが先に記録された新しい実行の行も、診断を待つ間は「判定中」と出す（今は「判定未確定」）。
- **B3. 待っている間の副次の表示**：判定中の行では、前の入力の診断から来た表示（カテゴリー・DID・手続きの件数・診断の証跡 ID）も出さない（未決 2。推奨どおりなら）。応答が来たら新しい値で出す。保存した値は消さない（失敗時の扱いは今のまま）。
- **B4. 見せ方**：判定中の行の記号は、今の判定未確定と同じ点線の枠でよい（`data-level` は空）。`data-testid="history-verdict"` に `data-pending="true"` を付け、E2E で判定中を見分けられるようにする。

### C. 証跡と版（generator）

- **C1. `ENGINE_VERSION`**：`soraban-0.4.0-verdict-2026-10` のまま。A・B・D・E はすべて表示の変更で、判定の結果（`status`・`verdict`・段取り）を変えない（spec §13.9.7「文言の変更だけの場合は `ENGINE_VERSION` と証跡 ID を変えない」）。
- **C2. 証跡 ID**：変えない。
  - A：申請支援の証跡の `d.did` は `didStatus` の値（`not_applicable`）のままで、表示の言葉は入らない。`VerdictItem` の印は証跡ペイロードに入れない。
  - D：規制 ID（`31202-heritage-protection`・`31202-park-ordinance`・`31-pref-nuisance-prevention`）は変えない。地点判定の証跡に入るのは規制 ID で、題名・出す先・概要・URL は入らない。
  - 固定の入力で、地点判定と申請支援の証跡 ID が d08dc6f と一致することを単体で確かめる（契約 14）。
- **C3. evidence_log**：列・値とも変わらない（`per_regulation_status`・`per_regulation_verdict`・`overall`・`applied_permits` は表示の言葉を持たない）。マイグレーションは追加しない。

### D. 参照先 [1] の題名とリンク（generator）

- **D1. 分ける**：`MODEL_AIRCRAFT_REFERENCES` を 6 件にする。
  1. 題名「e-Gov 法令検索 航空法（航空法第134条の3）」、URL `https://laws.e-gov.go.jp/law/327AC0000000231`（今と同じ）
  2. （新規）題名「e-Gov 法令検索 航空法施行規則（航空法施行規則第239条の2）」、URL `https://laws.e-gov.go.jp/law/327M50000800056`（航空法施行規則＝昭和27年運輸省令第56号を指す e-Gov の法令 ID として置く。※要確認：一次資料未取得のため、法令番号と URL が航空法施行規則を指すことを確かめていない。未決 3）
  3〜6. 今の 2〜5 件目（国交省 2 件、教則 第5版、警察庁）
- **D2. 1 か所**：条番号・URL は `model-aircraft.ts` だけに置く（題名は `MODEL_AIRCRAFT_LAW`・`MODEL_AIRCRAFT_ORDINANCE` から組み立てる）。冒頭の「※要確認：一次資料未取得」のコメントに、施行規則の URL も未確認である旨を足す。確認日（`MODEL_AIRCRAFT_RULES_CHECKED_AT`）は変えない。
- **D3. 表示**：画面の参照先の一覧（番号付き）と PDF の参照先に 6 件が出る。リンクは題名で読み上げを区別できる。`MODEL_AIRCRAFT_PRIMARY_URL`（飛行マニュアル骨子の出典）は航空法本体のまま。

### E. 未収録の市町村の題名（generator）

- **E1. 判定不能のときの題名**：未収録で `status` を unknown にする 3 か所で、ひな型の題名・出す先・概要・URL を、市町村名・都道府県名を出さない種類名に置き換える（未決 4。推奨どおりなら 3 か所とも）。

  | 規制 | 題名 | 出す先（`authority`） | 概要 | URL |
  |---|---|---|---|---|
  | 史跡（`31202-heritage-protection`） | 文化財保護法第125条 / 市町村の文化財保護条例（データ未整備）— 史跡内の現状変更 | 地点の市町村の教育委員会・文化庁 | 市町村名を含まない一般の説明（国指定史跡は文化財保護法第125条、市町村指定は各市町村の条例） | 文化庁の史跡の頁（今と同じ。市町村に依存しない） |
  | 都市公園（`31202-park-ordinance`） | 市町村の都市公園条例（データ未整備）— 都市公園内での無人航空機の使用 | 地点の市町村 | 市町村名を含まない一般の説明 | 付けない（米子市のサイトを出さない） |
  | 県条例（`31-pref-nuisance-prevention`） | 都道府県の迷惑行為等防止条例（データ未整備）— 公衆密集地周辺での迷惑行為 | 地点の都道府県 | 都道府県名を含まない一般の説明 | 付けない（鳥取県の例規集を出さない） |

  文言はひな型のそばに定数として置く（例：`UNCOVERED_HERITAGE_REG_TEXT`）。`note`（判定不能の理由）は今のまま。
- **E2. ID は変えない**：規制 ID・例外節の ID・`clauseGraph`・`legalTier`・`datasets` はひな型のまま（ID は証跡に入るため。C2）。ID の中の `31202`（米子市の市町村コード）は内部の鍵で、画面・PDF には出ない（`data-testid` にだけ出る）。
- **E3. 収録済みの市町村は今のまま**：鳥取市・米子市・倉吉市・松江市・出雲市の史跡、収録済みの市町村の都市公園、鳥取県・島根県の県条例の題名は変えない。
- **E4. 判定の項目と段取り**：`VerdictItem.title` は規制の題名を引くため、判定不能の項目の題名も E1 の題名になる。段取りの手続き名（`verdict.ts` の「史跡・文化財（文化財保護法・文化財保護条例）の該当を確認（データ未整備）」など）は既に市町村名を含まないため変えない。
- **E5. 基準の fixture**：`apps/web/src/server/__fixtures__/sprint11d-verdict-baseline.json`（`sprint11e.test.ts` の 100g 以上・未指定の一致の検査）は、判定不能の規制の題名・出す先・概要・URL だけが変わる。fixture を作り直すときは、差分がこの 4 項目に限られることを確かめて報告する（判定・段取り・理由は一致のまま）。

### F. lint（generator、任意）

- `apps/web/src/components/ops/records-client.tsx` の使っていない `useRef` の import を消す。

### G. 見せ方（designer は原則不要）

- A・B の変更は文言と既存の部品の中で収まる見込みで、designer は通さない。A4 の「例外前の判定」の行や B4 の判定中の行が既存の見た目に収まらないと generator が判断したときだけ designer に回す（ロジック・`data-testid` は変えない）。

## 範囲外

- 100g 未満で DID のデータがない（未確認）ときの判定の扱いの見直し（今は判定不能＝要手続き扱いのまま。過剰側で見落としではないため）
- 機体重量の例外の欄（カード）の緑の色の見直し（11e で重さの欄の緑はやめたが、カードの例外の欄の色は 11d の部品のまま。必要なら別に計画する）
- 判定不能の規制の ID の付け替え（証跡 ID が変わるため。将来 `ENGINE_VERSION` を上げるときに合わせて検討する）
- 失敗・時間切れのときに、保存してある前の入力のカテゴリー・DID を消すこと（今の動きのまま）
- 航空法施行規則の条文の取得と照合（ユーザー作業）
- `ENGINE_VERSION` の更新、DB のマイグレーション、`procedures.json` の変更

## スプリント契約（完了条件）

「単体」は vitest、「E2E」は Playwright（`e2e/sprint11f.spec.ts`、新設）、「grep」は `rg`・`git`、「目視」は evaluator が Playwright MCP で確かめる項目。全 15 項目。

### A. 100g 未満で DID 内の地点の表示

- [ ] 1. （単体）`formatDidDetermination` が、（`not_applicable`、`in_did`／`in_did_near_industrial_boundary`／`in_did_exclusion_unverified`、50g）で「対象外（模型航空機）」、（`not_applicable`、`outside_did`、50g）で「非該当」、（`not_applicable`、`industrial_exclusive`、50g）で「非該当（工業専用地域）」、（`unverified`、50g）で「未確認」を返す。重量未指定・100g・900g では d08dc6f と同じ文字列を返す（`not_applicable`＋`in_did`＋900g は「非該当」のまま＝0.3.0 以前の許可で下げた履歴の行）。
- [ ] 2. （単体）米子市役所（DID 内）50g：`aviation-law-did` の判定の項目は `verdict` が `no_procedure`、`baseStatus` が green（値は変わらない）で、表示用の印があり、元の判定の表示関数が「対象外（模型航空機）」を返す。50g＋夜間の飛行の方法の項目も同じ。900g と重量未指定では印がなく、元の判定の表示は d08dc6f と同じ。
- [ ] 3. （E2E）米子市役所で 50g：申請支援の欄（「DID（人口集中地区）:」と「DID 自動判定：」）、規制ごとの判定の表の DID の行の元の判定、DID の規制のカードの札、最新の履歴の行、申請支援の PDF のテキスト、地点判定の PDF のテキストに「対象外（模型航空機）」が出る。画面と両 PDF のテキストに「DID（人口集中地区）: 非該当」「DID:非該当」が出ない。DID のカードの例外の欄に「例外前の判定：該当」が出る。
- [ ] 4. （E2E）米子市役所で 900g：申請支援の欄・履歴の行の DID は「該当」、規制ごとの判定の表の元の判定は「該当」で、11e までと同じ。

### B. 診断を待っている間の履歴

- [ ] 5. （単体）診断の開始で、その `runId` の履歴（確定分と保留分の両方）から診断の判定が外れて保存される。判定中として渡した行の表示は「判定中」、渡さない行（画面を開き直した場合に当たる）の表示は「判定未確定」で、どちらも「手続き不要」を含まない。成功を書いた後は診断の判定、失敗の後は「判定未確定」。
- [ ] 6. （E2E）区域外の地点（11d の E2E の静かな地点）で結論が「手続き不要」になった後、`/api/diagnose` の応答を数秒遅らせて夜間飛行を選ぶ：待っている間、最新の履歴の行が「判定中」（`data-pending="true"`）で、「手続き不要」もカテゴリー・DID の表示も出ない。応答が来ると「要手続き」になる。
- [ ] 7. （E2E）既存の `sprint11d.spec.ts` の 15（診断が 500 で失敗）と 18（応答しないまま時間切れ）が、直さずに通る（履歴は「判定未確定」）。直す必要が出たら、直したテストと理由を報告し、失敗・時間切れで「判定未確定」になる検査は残す。

### C. 参照先

- [ ] 8. （単体・grep）`MODEL_AIRCRAFT_REFERENCES` が 6 件で、1 件目の題名が「e-Gov 法令検索 航空法（航空法第134条の3）」、2 件目の題名に「航空法施行規則第239条の2」、URL が `https://laws.e-gov.go.jp/law/327M50000800056`。`rg -n "は航空法施行規則" packages/regulations/src apps/web/src` が 0 件。`model-aircraft.ts` に確認日 2026-10-20 と「※要確認：一次資料未取得」が残り、施行規則の URL が未確認である旨のコメントがある。
- [ ] 9. （grep）`rg -n "第134条の3|第239条の2|laws.e-gov.go.jp/law/327AC0000000231|laws.e-gov.go.jp/law/327M50000800056|koku_tk1_000048|001708524" apps/web/src packages/regulations/src -g '!*.test.*'` の一致が `packages/regulations/src/model-aircraft.ts` だけである。
- [ ] 10. （E2E）出雲縁結び空港の周辺（敷地の外）で 50g：画面の参照先の一覧に航空法と航空法施行規則のリンクが別々に出て、読み上げの名前が異なる。地点判定の PDF のテキストに両方の URL が出る。

### D. 未収録の市町村の題名

- [ ] 11. （単体）境港市の地点（史跡が未収録）で、`31202-heritage-protection` の `status` が unknown、題名が「文化財保護法第125条 / 市町村の文化財保護条例（データ未整備）— 史跡内の現状変更」で、題名・出す先・概要・URL に「米子市」が含まれない。都市公園が未収録の市町村（収録一覧で確かめて選ぶ。例：日吉津村）の `31202-park-ordinance`、県条例が未収録の地点（例：岡山県内）の `31-pref-nuisance-prevention` も同じく、市町村名・都道府県名を含まず、URL がない。規制 ID は 3 件とも d08dc6f と同じ。
- [ ] 12. （単体）収録済みの市町村（米子市・松江市の史跡、境港市の都市公園、鳥取県・島根県の県条例）の題名・出す先・概要・URL が d08dc6f と同じ。`sprint11d-verdict-baseline.json` を作り直した場合、差分が判定不能の規制の題名・出す先・概要・URL（と、それを引く判定の項目の題名）に限られる。
- [ ] 13. （E2E）境港市の地点で、規制ごとの判定の表・規制のカード・地点判定の PDF のテキストに「米子市文化財保護条例」が出ず、「市町村の文化財保護条例（データ未整備）」が出る。判定不能の件数が結論の横に出る（今と同じ）。

### E. 証跡と回帰

- [ ] 14. （単体・grep）`ENGINE_VERSION` が `soraban-0.4.0-verdict-2026-10` のまま。固定の入力（50g・900g・未指定 × 米子市役所・出雲縁結び空港の周辺・境港市の地点、150m 以上の有無）で、地点判定と申請支援の証跡 ID と `toEvidenceLogInsert` の値（`overall`・`per_regulation_status`・`per_regulation_verdict`）が d08dc6f と一致する。`git diff d08dc6f --name-only -- packages/regulations/data/procedures packages/db/migrations` が空。
- [ ] 15. （grep・目視）画面と PDF のテキストに「飛行可能」「要確認・要許可」、特許・出願の表示が出ない（既存の検査が通る）。3・6・13 の画面を 1280px・375px、ライト・ダークで確かめ、崩れと横スクロールがない。designer を通した場合はデザイン 4 基準で合格。`pnpm lint` で `records-client.tsx` の警告が出ない（F を行った場合）。

### 回帰（全項目に共通）

既存の E2E（直したものを含む）、`e2e/ops-db/`、CI がすべて緑で、`pnpm typecheck`・`pnpm lint`・`pnpm test`・`pnpm build` が通ること。項目数に数えない。

## 担当と順序

| 順 | 担当 | 行うこと | 渡すもの |
|---|---|---|---|
| 1 | generator | A〜F（G は判断だけ） | 変更ファイル、50g・900g の米子市役所の表示の例（申請支援の欄・表・履歴）、証跡 ID の一致の確認結果、fixture の差分の要約、直した既存テストの一覧、designer が要るかの判断 |
| 2 | designer（必要なときだけ） | G。例外の欄の「例外前の判定」の行、判定中の履歴の行 | 変更点、コントラストの実測値 |
| 3 | evaluator | 契約 1〜15 | 合否レポート（不合格なら差し戻し先：表示の言葉・履歴・参照先・題名・証跡は generator、見せ方は designer） |

## リスク

| リスク | 対応 |
|---|---|
| DID の表示を `didDetail` だけで判断し、0.3.0 以前の履歴（許可で DID を下げた 900g の行）を「対象外（模型航空機）」と誤って出す | 重量（100g 未満）を条件に入れる（A2）。契約 1 で 900g の（`not_applicable`、`in_did`）が「非該当」のままであることを確かめる |
| 表示の言葉を判定や証跡の値と取り違え、`didStatus` や `baseStatus` の値を変えて証跡 ID が変わる | 値は変えず、表示の関数と表示用の印だけを足す（A5・C2）。契約 14 で証跡 ID の一致を確かめる |
| 判定中の印を保存して、画面を閉じた行が「判定中」のまま残る | 保存は判定を外した状態だけにし、判定中は画面の状態で出す（B1）。開き直した行は「判定未確定」 |
| 判定中の行で副次の表示を隠すと、前の値を見たい利用者には情報が減る | 応答は最大 20 秒で戻り、成功・失敗のどちらでも表示が確定する。前の入力の値を出すより、隠す方がずれがない（未決 2） |
| 航空法施行規則の e-Gov の URL（法令 ID）が誤っている | 「※要確認」を残し、ユーザー作業で確かめる。誤っていたら `model-aircraft.ts` の 1 行を直せば画面・PDF がそろう（D2） |
| 判定不能の規制の ID に `31202`（米子市）が残り、データを見た人が誤解する | ID は内部の鍵で画面・PDF に出ない（E2）。付け替えは証跡 ID が変わるため範囲外とし、将来の版の更新で検討する |
| fixture の作り直しで、判定の差分を見落とす | 差分を題名・出す先・概要・URL に限ることを確かめ、要約を報告する（E5・契約 12） |

## ユーザー作業

- e-Gov で航空法施行規則の法令 ID（`327M50000800056`）と第239条の2 の所在を確かめる。確かめた結果を伝えれば、`model-aircraft.ts` の URL と注記を直す（数行の修正）。11e のユーザー作業（第134条の3・施行規則第239条の2 の対象空域・出す先・期限の確認）と合わせて行うとよい。

## 未決事項（推奨つき）

1. **100g 未満で DID 内の地点の表示の言葉**。推奨：「対象外（模型航空機）」。判定の理由・重さの欄・申請支援のカテゴリー（11e）と同じ言葉で、画面の中のずれがなくなる。このアプリで「該当」は手続きが要る側の言葉として使っているため、「該当（模型航空機のため対象外）」は手続き不要の結論と並べると逆の意味に読める。地点が DID 内であることは、カードの例外の欄の「例外前の判定：該当」で示す（A4）。代替：「該当（模型航空機のため対象外）」（DID 内であることを一語で示せるが、上の読み違いがある）。
2. **判定中の履歴の行で、前の入力のカテゴリー・DID・手続きの件数を隠すか**。推奨：隠す（B3）。判定だけ「判定中」にして前の入力のカテゴリーや手続きの件数を出すと、今回と同じずれが副次の表示に残る。保存した値は消さず、表示だけを止める。
3. **航空法施行規則の URL**。推奨：`https://laws.e-gov.go.jp/law/327M50000800056` を置き、「※要確認」を残す。代替：e-Gov 法令検索のトップ（`https://laws.e-gov.go.jp/`）に「航空法施行規則で検索」と添える（誤りはないが、利用者の手間が増える）。
4. **未収録の題名の直しを都市公園と県条例にも広げるか**。推奨：広げる（E1）。原因と直し方が史跡と同じで、都市公園は未収録の町村で「米子市都市公園条例」と米子市のサイトのリンクが出ている。
5. **`ENGINE_VERSION`**。推奨：据え置く（C1）。0.4.0 は本番に出ているが、本スプリントは表示だけの変更で、証跡 ID と判定の結果を変えない。証跡 ID か判定の結果が変わる変更が要るとわかった場合は、その項目を本スプリントから外し、版を上げる計画を別に立てる。
