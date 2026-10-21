# Sprint 12b: 通報の準備・記録・期限と「次にやること」、通報ゲートウェイ（契約案）

> 親文書：`docs/sprints/sprint-12.md`（全体の設計。特に §2.3 通報の扱い、§10 通報ゲートウェイ、§11 移行手順、§12 契約の下書き、§7.2 確定事項）／ `docs/sprints/sprint-12a.md`（完了済みの土台）／ `docs/spec.md` §13.6・§13.10 ／ `docs/00_NORTH_STAR.md` §0.1.9・§0.1.10
> 一次資料：`docs/references/dips-fpr-guideline-findings.md`（DIPS2.0 API 飛行計画通報ガイドライン 1.10 版（2026-08-26）を原本から精読した結果。本書の「p」はその印字ページ）。`dips-api-notes-external.md` は外部の調査で未検証のため、根拠にしない。
> 期間：2027-01-25〜02-05（2 週間の目安。12a がマージ済みなので前倒しで着手してよい）。
> 状態：**契約案（planner が 2026-10-21 に作成）。オーケストレーターがユーザーの承認を得てから generator を起動する。**
> 前提：Sprint 12a がマージ済み（8fa645b）。本書は 53161dd 以降から切ったブランチで実装し、新しい PR で出す。`ENGINE_VERSION`（`soraban-0.4.0-verdict-2026-10`）、判定ロジック、証跡 ID の計算、`evidence_log` は変えない。
> 機能フラグ：`OPS_ENABLED` の裏（本番は停止のまま）。本番の DB・Neon Auth・Vercel の環境変数はエージェントが触らない。マイグレーションはリポジトリと CI のコンテナでだけ試す。
> ※ Next.js は破壊的変更を含むため、画面・ルートハンドラを書く前に `node_modules/next/dist/docs/` を参照する（`apps/web/AGENTS.md`）。

## 目的と位置付け

ユーザー決定（2026-10-21）：**DIPS 2.0 API の申請・固定 IP は決めない。アプリのみ先に完成させる。** したがって 12b は DIPS へ送信しない。12b でできるようにすることは次の四つ。

1. 通報内容を DIPS の入力順に整え、項目ごとにコピーできる（そらばんが持たない項目は「DIPS で入力」と明示する）。
2. 利用者が DIPS で通報した結果（日時・番号）を手で記録する。変更・取消も記録する。記録するまで「通報済み」にならない。
3. 通報の要否・期限・漏れを、計画ごとの「次にやること」で知らせる。許可・承認の申請と、小型無人機等飛行禁止法の同意・通報の「済み」も記録する。
4. 通報の送信を **通報ゲートウェイ（ポート）** の裏に置き、手動と模擬の二つのアダプターを実装する。入力項目の形は FPR ガイドラインの `flightPlanInfo` に対応づけ、将来 API アダプターを足すとき画面とデータモデルを変えずに済む形にする。API アダプター・中継・OIDC は作らない。

利用は当面社内のみ（10 名以内）。画面には、そらばんが DIPS に送信しないこと、記録は利用者の申告であること、申請・通報は DIPS 2.0 などの公式の手続きで行うことを明記する。

あわせて、12a の評価で出た次の提案と軽微な指摘を 12b に含める（**含めてよいと判断した理由は各項に書く**）。

| 追加する内容 | 判断 |
|---|---|
| 判定の結論に判定不能がある計画の通報の要否を「推奨」でなく「要確認（要として扱う）」に倒す | **含める。** 安全側の変更で、North Star §0.1.9（分からないときは厳しい側）に沿う。変更箇所は `report-requirement.ts` の 1 分岐と文言の更新だけ。判定ロジック・証跡 ID・`ENGINE_VERSION` には触れない。契約 1 |
| 計画詳細の「判定の日時」が UTC の ISO 文字列で出る | **含める。** 表示だけの修正で、12b で通報の日時を JST で出す表示と同じ関数を使う。契約 18 |
| タップ領域が 40px の箇所（`/ops/places` の絞り込みリンク等）を 44px に | **含める。** 12b の新しい画面にも同じ部品が出る。クラス名の変更だけ。契約 18 |
| 375px の計画訂正フォームで機体セレクトの表示が切れる | **含める。** 訂正フォームは 12b でも使い、機体は訂正で変えられないため、表示を読み取り専用の文にすれば直る。契約 18 |

## 現状（2026-10-21、53161dd 時点。コードを読んで確かめた事実）

| 箇所 | 現在 |
|---|---|
| マイグレーション | 0001〜0011。`MIGRATION_VERSIONS` は `packages/db/src/migrations-manifest.ts`。`record_versions.entity_type` の CHECK は `member`・`aircraft`・`pilot`・`daily_inspection`・`flight_record`・`flight_plan`・`saved_place`。トリガー関数と `verify_record_chain` は 0011 が 0008 の定義を丸ごと置き換えている（0012 以降も同じ流儀） |
| 追記専用の表 | `judgement_snapshots`・`plan_confirmations`。`soraban_app` は SELECT・INSERT のみ。更新・削除・TRUNCATE を拒むトリガー（SQLSTATE `SB409`、detail `immutable`） |
| `reportRequirement` | `packages/regulations/src/report-requirement.ts`（12a 新規）。4 種（`confirm`・`not_applicable_model`・`required`・`recommended`）。`category` が `I` なら判定不能の件数に関係なく `recommended`。固定の文言 `REPORT_FIXED_NOTE` に「通報の記録の機能は次の版で追加します」が入っている（12b で改める） |
| 計画の DTO | `PlanDto`（`apps/web/src/server/ops/plans.ts`）に `report`（要否）・`freshness`・`state`・`judgement` がある。一覧は `snapshot_result_slim` で、`result` 全体を読まない |
| 計画が持つ項目 | 計画名（1〜100 文字）、機体、操縦者、予定開始（JST 分）、所要時間（1〜1440 分）、目的（自由記述）、場所の名称、座標、半径（任意）、最大高度（0〜2000m、任意）、フラグ、立入管理措置（`accessControl`）、補助者の有無（`bvlosWithObserver`）、許可番号（手入力の文字）。**持たない：** 飛行目的の区分、補助者の人数、出発地・目的地、航続可能時間、飛行速度、立入禁止措置、係留、保険、連絡先 |
| 機体・操縦者が持つ項目 | 機体：登録記号、型式、製造者、機体認証の区分と番号、最大離陸重量。操縦者：氏名、技能証明の区分と番号（全桁は運航管理者と本人にだけ返す。12a の規則）。**連絡先（住所・電話・メール）は持たない** |
| 時計 | `nowOf(ctx)`（E2E-DB は `OPS_TEST_NOW` で JST 2027-01-05 12:00 に固定）。時刻の整形は `apps/web/src/lib/ops-time.ts`（`formatJst` など） |
| E2E-DB | `playwright.ops.config.ts`（`next start`、`AUTH_PROVIDER=test`、模擬の逆ジオコーダ）。サーバーは本番ビルドの `next start` で動くため、`NODE_ENV` では本番と開発を区別できない（模擬アダプターの拒否の条件に効く。設計 J） |
| 表示の指摘（12a の評価） | `plans/[id]/page.tsx` の「判定の日時」が `{j.checkedAt}`（UTC の ISO）のまま。`components/ops/ui.tsx` の `VoidedToggle`、`record-filter.tsx`、`app/ops/members/page.tsx` の summary が `min-h-10`（40px）、`verdict-summary.tsx` のボタンが `h-10`。`plans-client.tsx` の機体セレクトは訂正でも無効化した select のまま |

## 12 の設計からの変更点（planner の判断。generator は下書きでなく本書に従う）

| # | 変更 | 理由 |
|---|---|---|
| 1 | 項目の対応表の `apiField`・値域を **FPR ガイドライン 1.10 版（原本）で埋める** | 精読済みのため。sprint-12.md §10.2 は「API の仕様の入手前は空」としていたが、項目名・型・値域・コード表は原本にある（p46〜52）。**未確認なのは DIPS の通報画面の入力順・項目名（U4）と通報要領 4(3) の対応（U3）** で、その列だけ `unconfirmed` とする |
| 2 | 模擬アダプターは **同じプロセス内の模擬**にする（HTTP の模擬サーバー `mock-dips-relay-server.mjs` と署名つきの要求は作らない） | API アダプター・中継を作らないため、HTTP を通す意味がない。同じ契約テストを通す土台は保つ。HTTP の模擬サーバーは API アダプターを足すとき（Phase 2）に足す |
| 3 | 保存する状態は `prepared`・`reported_manual`・`submitted_api`・`failed`・`unknown`・**`retracted`（記録の取り下げ）**。`copied` は保存せず監査に残す。`cancelled` は状態でなく **種別 `cancel` の別の行**で表す | 記録を誤った（通報していないのに記録した）ときに「通報済み」が残り続けるのを防ぐ。コピーは中間状態にしても記録を増やすだけ。取消は元の行を書き換えない（事実は消さず追記する） |
| 4 | 目安の時刻（飛行開始の 24 時間前）の **組織ごとの設定は持たない**（固定の定数をデータで持つ） | sprint-12.md §3.3 の削る順②を最初から適用。10 名以内の社内利用で、通報要領の確認（U3）で数値が分かればデータの更新で足りる。**ユーザーに伺う 1 件（完了報告）** |
| 5 | 番号の扱い：DIPS の画面に番号が表示されるか未確認（U4）のため、**番号を必須にせず「番号」または「番号が表示されなかった」の宣言のどちらかを必須**にする。方針は対応表のデータ（`numberPolicy`）で持ち、U4 の結果でデータだけ変える | sprint-12.md §7.2 の 5 の推奨（表示されるなら必須、されなければ日時と控え）を、未確認のままでも安全側に実装する |
| 6 | **通報の記録は、計画が `active`（確認を依頼済み）のときだけ**できる。内容の表示は下書きでもできる | 12a の確認と同じ流儀（`not_requested`）。確認済みであることまでは求めない（通報が先になる運用がありうるため）。確認済みでない・判定が古いときは警告を出す |
| 7 | `canCancel` は **API アダプターでは偽**とする前提で設計する（FPR ガイドラインに取消の API が無い。p46〜63 は検索 2 種と通報受付のみ） | 取消は将来 API 連携後も DIPS の画面での操作になる。ゲートウェイの `cancel` は、手動の記録（利用者が DIPS で取り消した結果）に倒す動きを標準にする |
| 8 | 手続きの「済み」の記録は、**許可・承認の申請**と**小型無人機等飛行禁止法の同意・通報**の 2 種に限り、追記専用の別の表に置く | 通報と同じく「利用者の申告」を残して漏れを知らせるため。判定の結論（手続き済み（条件付き））は変えない。「許可済み」とは出さない |

## 設計

### A. 通報の要否の安全側の変更（`report-requirement.ts`）

- `category` が `I` で、判定の結論の **判定不能の件数（`verdict.unknownCount`）が 1 以上**のとき、`recommended` でなく **`confirm`**（見出しは既存の「通報：要確認（要として扱います）」）にする。根拠に「判定不能の項目が N 件あるため、要として扱う」を足す。判定不能が 0 件のときは従来どおり `recommended`。
- 入力の型 `ReportRequirementSnapshot` に `result.verdict.unknownCount` を足す（欠けているときは 0 とみなさず、`category` が `I` のときは**不明として `confirm` に倒す**）。一覧が使う `snapshot_result_slim` に `verdict.unknownCount` が入っていることを generator が確かめ、入っていなければ足す（一覧と詳細で同じ結果になること）。
- 固定の文言 `REPORT_FIXED_NOTE` から「通報の記録の機能は次の版で追加します」を除き、記録の案内に改める（設計 H の文言）。12a の既存の単体・E2E のうち、この変更で期待が変わる箇所の**期待値だけ**を更新してよい（それ以外の既存テストは無変更で通す）。
- 禁止語（12a 契約 15 の一覧。`report-requirement.test.ts`）は、どの出力・どの新しい画面・どの新しい文言にも含めない。

### B. 通報ゲートウェイ（`packages/dips`）

純粋な TypeScript のパッケージ（DB・Next.js・`@soraban/regulations` に依存しない。スナップショットの型だけを受け取る）。

```ts
interface NotificationGateway {
  readonly adapter: "manual" | "mock" | "api";
  capabilities(): { mode: "user_reported" | "direct"; canStatus: boolean; canChange: boolean; canCancel: boolean };
  prepare(input: PlanForReport, kind: "new" | "change" | "cancel"): PreparedReport;          // 副作用なし。どのアダプターでも同じ結果
  submit(prepared: PreparedReport, ctx: SubmitContext): Promise<SubmitResult>;                 // manual: manualResult を受けて記録用の結果を返す
  status(ref: ReportRef): Promise<StatusResult | Unsupported>;                                 // manual: Unsupported
  cancel(ref: ReportRef, ctx: CancelContext): Promise<CancelResult>;                           // canCancel が偽なら手動の記録に倒す
}
```

- **手動アダプター（既定）**：`mode = "user_reported"`、`canStatus = false`、`canChange = true`、`canCancel = true`（利用者が DIPS で取り消した結果を記録する）。`submit` は `manualResult`（通報日時・番号または番号なしの宣言・二つの確認）を検査して、`reported_manual` の結果を返す。外部には何も送らない。
- **模擬アダプター（開発・CI・E2E だけ）**：`mode = "direct"`、`canChange = true`、`canCancel = false`（API と同じ前提）。同じプロセス内で、リクエストの `mockScenario`（またはテストの引数）に応じて結果を返す。**重複の判定・エラーの形・時間切れの扱いは DIPS の実際の仕様ではなく、そらばん独自の仮定**であることを、アダプターのコメントと画面（「模擬（開発用）」「実際の DIPS には送信されません」）に明記する。

  | シナリオ | 結果の状態 | 意味 |
  |---|---|---|
  | `ok` | `submitted_api` | 受理。番号（模擬の採番）と受付日時を返す（FPR の応答 `flightPlanId`・`flightPlanRegistrationDatetime`（`yyyy/MM/dd HH:mm`）・`existOtherFlightRoutesCount` と同じ形を `external_ref` に入れる） |
  | `rejected` | `failed` | 確定した失敗（HTTP 400 相当。パラメータ不正）。再送できる |
  | `unauthorized` | `failed` | トークン切れ相当（401）。「DIPS と再度連携してください」の文言を返す |
  | `server_error` | `unknown` | HTTP 500 相当。**登録されたか分からないため結果不明**（安全側。二重通報を避ける） |
  | `timeout` | `unknown` | 応答なし。同上 |
  | `unknown_status` | `submitted_api` | 未知の外部状況（生の値 `"XYZ"`）を `external_status` に入れて返す。状態は増やさない |
- **API アダプター**：作らない。契約テストの一覧に「API（未実装）」を **`skip` として載せ、理由（DIPS 2.0 API の申請は保留。HANDOFF 2026-10-21）と skip の件数をテスト出力に表示する**（通っていないことを隠さない）。
- **設定**（`packages/dips/src/config.ts`、純粋関数）：環境変数 `DIPS_REPORT_ADAPTER` ∈ `manual`（既定）・`mock`。`api` と未知の値は **設定の誤りとして 503 `adapter_unavailable`**（手動へ自動で落とさない。二重通報を避けるため）。**`mock` は `VERCEL_ENV` が `production` または `preview` のとき拒否する**（E2E は `next start` で動き `NODE_ENV` が `production` になるため、`NODE_ENV` では判断しない）。拒否は起動時（`/api/health/db` が 503 と理由を返す）と、通報の API の両方で効く。`.env.example` には名前だけを書く。
- **項目の対応表（データ）**：`packages/dips/data/report-fields.json`。`procedures.json` と同じ流儀（`revision`・`verifiedAt`・出典つき）。画面の入力順の表示と将来の API の入力項目の両方が同じ表を使う。型・画面を変えずにデータの更新だけで直せる。列は次のとおり。

  | 列 | 内容 |
  |---|---|
  | `key` | そらばんの項目の名前 |
  | `order`・`group` | 表示の順とまとまり。**初期値は FPR ガイドライン 1.10 版の項目の並び**（DIPS の通報画面の入力順は未照合。U4） |
  | `label`・`dipsScreenLabel` | そらばんの表示名。DIPS の画面の項目名（未確認は `null`） |
  | `apiField`・`apiType`・`apiRequired`・`range`・`codes` | 原本（p46〜52）の項目名・型・必須・値域・コード表 |
  | `source` | `plan`／`aircraft`／`pilot`／`snapshot`／`report_input`（通報の画面で入力）／`dips_only`（そらばんが持たない。DIPS で入力）／`api_only`（コピー画面に出さない） |
  | `personal` | 個人情報（技能証明書番号・氏名）。通報の記録の写しには入れない（設計 D） |
  | `copyable` | 地図の経路は偽（座標を表示し、DIPS の地図で描く旨を案内） |
  | `apiStatus`・`screenStatus` | `apiStatus` は原本で確認済み（`guideline_1_10`）、`screenStatus` は `unconfirmed`。`unconfirmed` の行を含むまとまりに「※要確認」を出す（データから出し、直書きしない） |
  | `requirementRef` | 通報要領 4(3) の a〜n との対応。**未確認は `null`**（U3） |
  | `numberPolicy` | 番号の扱い（変更点 5）。`number_or_declared_unavailable` |

### C. 通報内容の整形（`prepare`）— DIPS の値域の根拠は原本

| 項目（`apiField`） | そらばんの元 | 整形・値域（原本 p46〜52） |
|---|---|---|
| `name` 飛行計画名称 | 計画名（または通報用の名称の入力） | 最大 30 文字（文字数。コードポイントで数える）。超えるときは**切り詰めずに警告**し、通報用の名称の入力を促す。入力も 30 文字以内を検査（400 `name_too_long`） |
| `flightPurpose` 飛行目的 | 通報の画面で選ぶ（計画の目的は自由記述のため自動変換しない） | 配列。1〜16 のコード（1 空撮 2 報道取材 3 警備 4 農林水産業 5 測量 6 環境調査 7 設備メンテナンス 8 インフラ点検・保守 9 資材管理 10 輸送・宅配 11 自然観測 12 事故・災害対応等 13 その他 1（業務） 14 趣味 15 研究開発 16 その他 2（業務以外））。13 を選ぶと `othergyomutext`、16 を選ぶと `othergyomugaitext` が必須 |
| `flightAirspace` 飛行空域 | スナップショットの結果の `flags` | `airspace_did`→1、`airspace_150m`→2、`airspace_airport`→3。`airspace_emergency`（緊急用務空域）は通報の項目に無いため警告（「飛行できない判定です」を併記） |
| `flightType` 飛行方法 | 同上 | `method_30m`→1、`method_event`→2、`method_night`→3、`method_bvlos`→4、`method_dangerous`→5、`method_drop`→6 |
| `assistantsNumber` 補助者 | 通報の画面で入力 | 数値。補助者なしは 0 |
| `departurePoint`・`destinationPoint` | 場所の名称（初期値。入力で変えられる） | 文字列（地名・固有名称） |
| `startTime` 飛行開始日時 | 予定開始（JST 分） | 形式 `yyyyMMdd□HHmm`（□は半角スペース）。**画面は人が読む形（`2027-01-05 14:00 JST`）で出し、API 形式の文字列も併記する**（DIPS の画面の入力形式は未確認） |
| `plannedMaxTime` 航続可能時間 | 通報の画面で入力 | 分。5 分単位、5〜1440 |
| `plannedFlightTime` 所要時間 | 計画の所要時間 | 分。**5 分単位に切り上げる**（終了日時は所要時間から計算されるため、切り上げが安全側）。5〜1440（1→5、5→5、6→10、1438→1440、1440→1440）。切り上げたときは理由を表示 |
| `flightSpeed` 飛行速度 | 通報の画面で入力 | km/h、整数 1〜999 |
| `flightAltitude` 飛行する高度 | 計画の最大高度 | m（AGL）、整数 1〜999。未入力・0・999 超は**値を変えずに警告**（計画は 0〜2000m を持てるため） |
| `flyRoute` 飛行の経路 | 計画の座標と半径 | **GeoJSON の文字列**。Circle（中心 `[経度, 緯度]`、半径 m）または 3 点以上の Polygon。計画は点と半径だけなので Circle のみ。半径が未入力なら経路を作れないと警告。原本のサンプルは半径を `properties.radius` に置く一方、項目表は geometry の `radius` とする不一致がある（精読結果の気づき 5）。**コピー画面では座標（中心の経度・緯度と半径）を表示し、GeoJSON は API 形式として併記するだけ**。形は API 接続時に検証環境で確かめる（※要確認）。地図は DIPS の画面で描く |
| 立入管理措置など | `accessControl`（計画）。`riskMitigationOnsiteControlL3`・`L35`・`riskMitigationOnsiteControl2`・`exceptionalConditionsMooring` は通報の画面で入力 | 文字列 `"1"`（講じる・行う）／`"0"`。未選択は未入力として警告 |
| 機体 | 機体：登録記号→`symbol`、型式→`model`、製造者→`maker`、機体認証の区分→`certification1`／`certification2`、認証番号→`certificationNum`、最大離陸重量→`maxWeight`（kg。原本は「通報を行う飛行形態の総重量。困難な場合は最大離陸重量」） | 機体の種類（`type` 1〜6）は持たないため `dips_only` |
| 操縦者 | 氏名、技能証明の区分→`firstClass`／`secondClass`（`"1"`／`"0"`）、技能証明書番号→`skillCertificationNumber`、代表機体の製造者・型式→`maker`・`model` | `personal`。連絡先・`privateLicense`（将来廃止予定。p51）は `dips_only` |
| 許可・承認 | 計画の許可番号（手入力の文字）→`flightPermitApplicationNumber` | 判定に許可・承認の手続きがあるのに空なら警告。発行日・期間・連絡先は `dips_only` |
| `dips_only` | 通報者の連絡先、保険、その他特記事項、連絡先フラグ（通報者・操縦者・許可承認のいずれか一つが `"1"`。p50） | 「そらばんは保持しません。DIPS で入力してください」と出し、FPR の項目名を併記する |

- 出力：項目ごとの `{ key, label, value, apiValue, source, warnings[], missing }` の一覧、全体の警告、未入力の必須項目の件数、通報の指紋、対応表の版（`mapRevision`）。**未入力があっても記録はできる**（そらばんは送信しないため。件数は警告として出す）。
- **通報の指紋**：計画から次の値を取り出して正規化し、SHA-256（`soraban-report-fp-v1`）にした値。`{ startAt（JST 分）, durationMinutes, lat, lng, radiusM, maxAltitudeM, aircraftId, pilotId, flags（スナップショットの結果の最終の `flags`・固定の順） }`。指紋の元の値（`fingerprintParts`）も記録に残し、変わったとき**どの項目がどう変わったか**を表示できるようにする。通報の画面で入力する項目（速度など）は指紋に含めない（変えたときは利用者が「通報を変更する」を選ぶ）。
- **冪等性キー**：SHA-256 で `(組織 ID, 計画 ID, 種別, 指紋, 基準)`。種別 `new` の基準は「その計画の完了した取消の件数（世代）」、`change`・`cancel` の基準は「元の通報の ID」。画面の再読み込み・二度押しでも同じキーになり、取消のあとの再度の新規は別のキーになる。

### D. データモデル（マイグレーション 0012 以降。追記のみ。分け方は generator が決めてよい）

**D1. `flight_reports`（通報の記録。ヘッド表。`record_versions` の `entity_type = flight_report` から DB が作る）**

| 列 | 内容 |
|---|---|
| `id`、`org_id`、`plan_id` | `(plan_id, org_id)` は `flight_plans(id, org_id)` への複合外部キー。`(id, plan_id, org_id)` は一意 |
| `kind` | `new`／`change`／`cancel`（CHECK） |
| `base_report_id` | `change`・`cancel` は必須、`new` は NULL（CHECK）。`(base_report_id, plan_id, org_id)` は同じ表への複合外部キー（別の計画の通報を指せない） |
| `snapshot_id` | 通報の対象のスナップショット。`(snapshot_id, plan_id, org_id)` は `judgement_snapshots(id, plan_id, org_id)` への複合外部キー。証跡 ID は `judgement_snapshots` から引ける |
| `plan_version`、`fingerprint`、`fingerprint_parts jsonb`、`map_revision` | 通報時の計画の版、指紋、その元の値、対応表の版 |
| `channel` | `manual`／`mock`／`api`（CHECK。`api` は 12b では使わないが CHECK に含める） |
| `status` | `prepared`／`reported_manual`／`submitted_api`／`failed`／`unknown`／`retracted`（CHECK） |
| `idempotency_key` | `(org_id, idempotency_key)` が一意 |
| `reported_at` | 通報日時（JST 分の `timestamptz`）。`reported_manual`・`submitted_api` は必須 |
| `dips_number`、`number_unavailable` | DIPS 側の番号、または「番号が表示されなかった」の宣言。`reported_manual` は**どちらか一方が必須**（CHECK） |
| `content jsonb` | 整えた通報内容の写し（項目の `key` と整形済みの値、通報の画面で入力した項目）。**`personal` の項目（技能証明書番号・氏名）は入れない**。通報の画面の入力は利用者の端末の下書き（`drafts.ts` の流儀）に保持し、記録のときに写しに入る。変更通報では前の通報の入力を初期値にする |
| `memo`、`error_kind`、`external_ref jsonb`、`external_status jsonb` | 控えのメモ（0〜500 文字。番号が無いときは必須）、失敗の種類、API 連携用の拡張点（空でよい。模擬は FPR の応答と同じ形で入れる）、未知の外部状況の生の値と取得日時 |
| `current_version`、`created_at`、`updated_at` | 既存のヘッド表と同じ。物理削除はない。**通報の記録に `voided_at` は設けない**（取消は種別 `cancel` の別の行、誤りは `retracted`） |

- 追加前のトリガー：`new`・`change` は計画が取消されておらず（`voided`）、`status = active`（SB409 `not_requested`）、`plan_version` が計画の**最新の版**（SB409 `version_conflict`）であること。`cancel` は**取消された計画でも作れる**。`snapshot_id` が計画の別のスナップショットでもよい（過去の通報の取消・変更のため）が、別の計画のものは外部キーで拒否。`channel = manual` の `status` は `reported_manual`・`retracted` に限る。**有効な通報が既にある計画への `new` は 409 `already_reported`、有効な通報が無い計画への `change`・`cancel` は 409 `no_active_report`、`base_report_id` が現在の有効な通報でなければ 409 `base_changed`**（有効な通報の定義は設計 E）。`mock`／`api` の `new` は、有効な手動の通報がある計画で 409 `manual_report_exists`。
- 追加後のトリガー：`data` からヘッド表を作る・更新する。`verify_record_chain` に `flight_report` を足す。
- 状態の遷移の許可は**アプリの遷移表（設計 E）が 1 か所で決める**。DB は列の整合（CHECK）と、上記の組織・計画・版の検査だけを持つ。

**D2. `flight_report_attempts`（通報の試行・監査。追記専用）**

ゲートウェイの操作 1 回ごとに 1 行。`org_id`、`plan_id`、`report_id`（NULL 可）、`operation`（`copy`／`submit`／`status`／`cancel`／`manual_record`／`correct`／`retract`／`resolve`）、`member_id` と**その時点の表示名・役割の写し**、`adapter`、`idempotency_key`、`payload_hash` と `summary`（要約。内容の全文を入れない）、`map_revision`、`check_evidence_id`・`diagnosis_evidence_id`（スナップショットから）、`result`（`success`／`failure`／`unknown`）、`http_status`、`error_kind`、`dips_number`、`created_at`（DB が決める）。**秘密・トークン・技能証明書番号・氏名は入れない。** 更新・削除・TRUNCATE を拒むトリガー（`SB409` `immutable`）。`prepare` は監査しない（画面を開くたびに行が増えるため）。コピーは項目ごとに 1 行（クライアントから送る。送れなくてもコピーは止めない）。

**D3. `plan_procedure_records`（手続きの「済み」の記録。追記専用）**

`id`、`org_id`、`plan_id`、`kind`（`dips_permit`＝許可・承認の申請／`small_drone_law`＝飛行禁止法の同意と公安委員会への通報）、`action`（`done`／`retract`）、`done_at`（JST 分。`done` は必須）、`reference`（申請受付番号など。0〜100 文字、任意）、`checks jsonb`（`dips_permit`：申請を完了した。`small_drone_law`：施設管理者の同意を得た／公安委員会へ通報した。**`done` はすべての確認が真のときだけ**。CHECK）、`snapshot_id`（記録した時点の計画の現在のスナップショット）、`plan_version`、`recorded_by_member_id` と表示名の写し、`reason`（`retract` は必須）、`created_at`・`content_hash`（DB が決める）。更新・削除・TRUNCATE を拒むトリガー。**有効な記録**は、計画ごと・種別ごとの最新の行が `done` のもの。

**D4. 権限・型・CI**

- `soraban_app`：`flight_report_attempts`・`plan_procedure_records` は SELECT・INSERT のみ（UPDATE・DELETE・TRUNCATE なし）。`flight_reports` は SELECT のみ（書くのは `record_versions` への追加→トリガー）。`do $$ if exists (… soraban_app) …` の流儀。
- `packages/db/src/types.ts` に行の型と列の一覧を足し、`OPS_TABLES`・`TABLE_COLUMNS` に新しい表を入れる。`MIGRATION_VERSIONS` を更新する（`schema-columns.test.ts`・`migrations-manifest.test.ts` が通る）。
- CI の db ジョブの `has_table_privilege` の確認に新しい表を足す（`flight_report_attempts`・`plan_procedure_records` は INSERT=t・UPDATE=f・DELETE=f・TRUNCATE=f、`flight_reports` は INSERT=f・UPDATE=f）。
- テスト用の初期データ（`ops-seed.ts`）は、必要なら組織 A に通報のテスト用の計画を足す（既存の行は変えない）。

### E. 状態・遷移・有効な通報・期限・次にやること（純粋関数。単体テストで全組合せ）

**遷移表（`packages/dips/src/transitions.ts`。1 か所。画面・アダプター・サービス・テストが同じ表を使う）**

| 元 → 先 | 条件 |
|---|---|
| （なし）→ `reported_manual` | 手動。二つの確認が揃っている |
| （なし）→ `prepared` | 模擬（`direct`）の送信の開始。外部を呼ぶ前に記録する |
| `prepared` → `submitted_api`／`failed`／`unknown` | 模擬の結果 |
| `failed` → `prepared` | 再送（**同じ行・同じ冪等性キー**。版が増える） |
| `unknown` → `submitted_api`／`failed`／`reported_manual` | 確認の後（`status` か、利用者が DIPS の画面で確かめた結果）。理由必須 |
| `reported_manual` → `retracted` | 記録の誤り。理由必須。取消（種別 `cancel`）とは別 |
| `reported_manual`／`submitted_api` の訂正 | 状態は変えず、番号・日時・メモを理由つきの新しい版で直す |

表にない遷移は拒否する。`prepared` のまま 5 分を超えた行は「送信の途中で止まった可能性（結果不明として扱う）」と表示し、**自動で再送しない**。未知の外部状況は状態を増やさず `external_status` に保存し、「状況：不明（生の値）」と表示する。

**有効な通報**：計画の通報の行のうち、種別が `new`／`change`、状態が `reported_manual`／`submitted_api` で、`retracted` でなく、それより後に完了した `cancel` の行（状態が `reported_manual`／`submitted_api`）が無い**最新の 1 件**。純粋関数 `effectiveReport(rows)` で求め、保存しない。

**通報の状況（表示用の導出 `reportStatus`）**：要否（`reportRequirement`）と有効な通報・指紋・計画の取消・時刻から、次のどれかを返す。

| 導出 | 条件 | 表示（例） |
|---|---|---|
| 記録なし | 要・要確認・推奨で、有効な通報が無い | 「通報の記録がありません」（要・要確認のときは「通報済み」と出さない） |
| 通報済み（手動記録） | 有効な通報があり、指紋が一致 | 「DIPS で通報済み（利用者の申告・手動記録）：日時・番号」 |
| 変更通報の要否を確認 | 有効な通報があり、現在の指紋と通報時の指紋が違う | 「計画が通報時から変わっています。変更点：…」 |
| 取消が必要 | 有効な通報があり、計画が中止された | 「計画は中止されました。DIPS で通報を取り消し、結果を記録してください」 |
| 取消済み | 最新が完了した `cancel` | 「取消済み」 |
| 結果不明／失敗 | 最新が `unknown`／`prepared` 超過／`failed` | 「送信結果が不明です。DIPS の画面で確かめてください」「失敗しました。再送できます」 |
| 対象外（模型航空機） | 要否が `not_applicable_model` | 要否の文言のとおり |

**期限と漏れ（`reportDeadlineState`）**

- 目安の時刻：**飛行開始の 24 時間前**。社内の目安であり法定ではないと必ず併記する。数値は `packages/dips/data/report-policy.json`（`guideLeadHours: 24`、出典・確認日・「通報要領の数値の期限は確認できていない。※要確認（U3）」）に持つ。法定の期限として日付・時刻を表示しない。
- 要・要確認で有効な通報が無いとき：
  - 飛行開始時刻を過ぎている → **最上位の警告**（`overdue_started`）。「通報せずに特定飛行を行うと罰則の対象になりえます（航空法第157条の10。※要確認：条文は一次資料で未照合。U5）」を添える。金額は出さない。
  - 目安の時刻を過ぎている → 警告（`past_guide`）。「社内の目安（飛行開始の 24 時間前）を過ぎています」
  - それより前 → 情報（`upcoming`）。「目安まであと N 時間」
- 推奨：警告にしない（`recommended_open`）。「通報を行うことを推奨します」と次にやることの末尾に出すだけ。
- 通報システムの障害時に飛行開始後の通報ができる例外は、注記として出す（義務の根拠は通報要領。※要確認）。小型無人機等飛行禁止法の通報は別の手続き（`dips_permit`・`small_drone_law` の記録で追う）と注記する。

**次にやること（計画単位。`planNextActions`）**：計画の状態から**保存せずに導出**した、動詞で始まる 1 行の一覧。各項目は `{ id, label, reason, href, tier, dueLabel }`。12b で扱う項目は次のとおり（点検・緊急用務空域・日誌は 12c）。

| 次にやること | 条件 | 押すと |
|---|---|---|
| 確認を依頼する | 下書き | 計画の詳細の確認依頼 |
| 計画を確認する（運航管理者のみ） | 確認待ち・修正済み（再確認待ち）・前の版への確認 | 確認の画面 |
| 差し戻しを直す | 差し戻し | 計画の訂正 |
| 判定をやり直す | 判定が古い | 再判定 |
| 飛行計画を DIPS で通報する | 要・要確認で、有効な通報が無い | 通報内容（`/ops/plans/[id]/report`） |
| 通報の結果を記録する | 結果不明の通報、または通報内容を開いて記録がない場合の入口 | 記録フォーム |
| 通報を変更する | 有効な通報があり指紋が変わった | 変更点つきの通報内容 |
| 通報を取り消す | 有効な通報があり計画が中止された | 取消の記録フォーム |
| 許可・承認を申請する | 現在のスナップショットの手続きに DIPS の許可・承認（`procedureId` が `flight-permission-*`／`flight-approval-*`）があり、**有効な `dips_permit` の記録が現在のスナップショットに対して無い** | 手続きの記録（計画の詳細） |
| 警察へ通報する | 手続きに `small-drone-law-consent-notice` があり、有効な `small_drone_law` の記録が無い | 同上 |
| 通報を検討する（推奨） | 推奨で記録なし | 通報内容 |

- 並び：`tier`（1 通報の漏れ（飛行開始後）＞ 2 通報・許可・警察の目安または期限の超過 ＞ 3 通報・許可・警察の未了 ＞ 4 確認・再判定・変更 ＞ 5 推奨）の順、同じなら飛行開始までの時間が短い順。許可・警察の期限の表示は**スナップショットの手続きが持つ期限の文言と日付をそのまま使う**（12b で新しい期限の日付を作らない）。期限の日付が過去で記録が無ければ tier 2。
- 手続きの記録が**記録時のスナップショットと現在のスナップショットで違う**とき（計画の訂正や再判定で判定が変わった）は、「前の判定に対する記録です。もう一度確認してください」と出し、次にやることに残す。

### F. 認可（`authz.ts` に行を足す。単体テストで全組合せ）

| 操作 | 運航管理者 | 操縦者 | 閲覧者 |
|---|---|---|---|
| `report.read`（通報内容・履歴・状況の閲覧） | 可 | 可 | 可（技能証明書番号は伏せ字） |
| `report.record`・`report.correct`・`report.retract`・`report.resolve`、`procedure.record` | 全員分 | 自分が操縦者の計画だけ | 不可 |
| `report.copyAudit`（コピーの監査） | 可 | 自分の計画 | 不可 |

- 通報内容の表示で技能証明書番号の全桁を出すのは運航管理者と本人だけ（既存の `flight.readLicenseNumber` と同じ規則）。閲覧者には伏せ字でコピー対象にしない。
- すべて `org_id` を条件にし、他の組織の計画・通報は 404。

### G. API（すべて `opsHandler`。`OPS_ENABLED` 無効なら 404）

| メソッド・経路 | 内容 |
|---|---|
| `GET /api/ops/plans/[id]/report` | 整えた通報内容（項目の一覧・警告・指紋・対応表の版）、アダプターと能力、通報の状況（導出）、期限の状態、変更点（指紋の差分）、通報の履歴 |
| `POST /api/ops/plans/[id]/reports` | 通報の記録を作る。`kind`（`new`／`change`／`cancel`）、`baseReportId`、`expectedPlanVersion`、手動：`manual{ reportedAt, dipsNumber または numberUnavailable、memo、confirmedDipsDone、confirmedMatchesLatest }`、`inputs`（通報の画面の入力）。模擬：`confirmSend: true`（と `mockScenario`）。201。同じ冪等性キーなら新しい行を作らず既存を **200** で返す |
| `PATCH /api/ops/plans/[id]/reports/[rid]` | 手動記録の訂正（`expectedVersion`・`reason` 必須） |
| `POST …/reports/[rid]/retract`／`resolve`／`retry` | 取り下げ（理由必須）／結果不明の確定（`reported_manual`・`failed`。理由必須）／失敗の再送（模擬。同じ行・同じキー。`failed` のときだけ） |
| `POST /api/ops/plans/[id]/reports/audit` | コピーの監査（項目の `key`） |
| `GET`・`POST /api/ops/plans/[id]/procedure-records` | 手続きの「済み」の記録の一覧・追加（`kind`・`action`・`doneAt`・`checks`・`reference`・`reason`） |
| 既存 `GET /api/ops/plans`・`/plans/[id]` | `report` に導出の状況、`nextActions`、一覧は先頭の 1 件と件数を足す（`result` 全体は読まない） |

- 誤りの形は既存と同じ（400 `invalid_input` と項目ごとの理由コード、403、404、409 `voided`・`version_conflict`・`not_requested`・`already_reported`・`no_active_report`・`base_changed`・`manual_report_exists`、503 `adapter_unavailable`）。`route.ts` は薄く、処理は `server/ops/reports.ts`・`procedure-records.ts` に置く。
- **サーバーが決めるもの**：通報の指紋・冪等性キー・対応表の版・状態・`plan_version`・`snapshot_id`（計画の現在のもの）。リクエストの同名の値は読まない。`reportedAt` は JST 分の形で、未来の時刻（`nowOf(ctx)` より後）は 400。
- 外部を呼ぶ（模擬）ときは、**外部の呼び出しの間トランザクションを開けておかない**。①`prepared` の行と監査を書く → ②アダプターを呼ぶ（上限 10 秒） → ③結果の版と監査を書く。③が失敗しても②の結果で再送しない（`prepared` のまま「結果不明」として扱う）。

### H. 画面（スマートフォン 375px で横スクロールなし。designer が見た目を整える）

| 経路 | 内容 |
|---|---|
| `/ops/plans/[id]/report`（新規） | ①通報の要否と状況（導出）・期限の状態・固定の文言 ②通報の画面で入力する項目（飛行目的・補助者の人数・出発地と目的地・航続可能時間・飛行速度・立入管理措置など。端末の下書きに保持） ③**DIPS の入力順の項目の一覧**（まとまりごと。項目名・値・「コピー」ボタン。未入力は「未入力（DIPS で入力）」、`dips_only` は「そらばんは保持しません」。経路は座標と「DIPS の地図で描く」の案内で、コピー対象ではない。未入力の必須項目の件数。対応表の版と確認日、「※要確認」） ④記録：手動なら「通報の結果を記録する」（通報日時・番号または番号なしの宣言・メモ・二つの確認）、模擬なら「送信内容の確認 → 送信」 ⑤通報の履歴（種別・送信元の表示「手動（利用者の申告）」「模擬（開発用）」・状態・番号・日時・版）と、訂正・取り下げ・結果不明の確定・再送・変更・取消 |
| `/ops/plans/[id]`（既存に追加） | 「次にやること」（先頭付近）、「通報」の節（状況・期限・変更点・`/report` への導線）、「手続きの記録」の節（許可・承認の申請、飛行禁止法の同意・通報の記録フォーム。「申請済み（利用者の申告）」と表示し、「許可済み」と出さない） |
| `/ops/plans`（既存に追加） | 各行に先頭の「次にやること」と、通報の状況の印（文字と記号を添える）。「対応が必要」の絞り込み |

- 固定の文言（手動のとき、通報の画面の目立つ位置）：「そらばんは DIPS に送信しません。この内容を DIPS 2.0 で通報し、通報した日時と番号をここに記録してください。記録するまで『通報済み』にはなりません。申請・通報は DIPS 2.0 などの公式の手続きで行ってください。」模擬のとき：「模擬（開発用）です。実際の DIPS には送信されません。」
- 表示用の文言は `packages/dips/src/messages.ts` の定数に集め、画面は定数だけを使う。禁止語（12a 契約 15）を含まない。
- 色だけで状態を区別しない（文字か記号を添える）。タップの的は 44px 以上。特許・出願の表示を出さない。

### I. 軽微な表示の修正（契約 18）

1. 計画詳細の「判定の日時」を `formatJst` で JST にそろえる（`<time dateTime>` は ISO のまま）。スナップショットの画面の併記（JST と ISO）は変えない。画面上のテキストに `T…Z` 形式の文字列が出ない。
2. `min-h-10`・`h-10` の対話部品を 44px 以上にする（`components/ops/ui.tsx` の `VoidedToggle`、`record-filter.tsx`、`app/ops/members/page.tsx` の summary、`verdict-summary.tsx` のボタン。generator が `apps/web/src` を `min-h-10`・`h-10`・`h-9` で検索し、対話部品を洗い出す）。クラスの変更だけで、判定の画面（`/`）の動き・文言は変えない。
3. 計画の訂正フォームでは、機体を**無効化した select でなく読み取り専用の文**（登録記号・型式。折り返し可）にする。新規作成の select は、幅を親に収め、選択肢の文言を短くする（登録記号・型式。長いときは省略記号）。

### J. 回帰と範囲の守り

- 変えないもの：`ENGINE_VERSION`、`packages/regulations/src` のうち `report-requirement.ts`（と `index.ts` の export の追加）以外、`packages/regulations/data`、`/api/check`・`/api/diagnose` の応答、`evidence_log`、`judgement_snapshots`・`plan_confirmations` の列、0001〜0011。
- 通常の E2E（DB なし・`OPS_ENABLED` なし）：`/ops/plans/[id]/report`・`/api/ops/plans/[id]/reports` が 404、`/` は 12a のまま。
- テスト：単体（vitest）は `packages/dips`（対応表・`prepare`・指紋・冪等性キー・遷移表・設定・アダプターの契約）と `apps/web`（期限・次にやること・認可・入力検査）。DB（`pnpm test:db`）は `reports.db.test.ts` を新設。E2E-DB は `e2e/ops-db/sprint12b-db.spec.ts` を新設し、`playwright.ops.config.ts` に**模擬アダプター用のサーバー**（`DIPS_REPORT_ADAPTER=mock`、別ポート、同じ DB）を足す。ゲートウェイの契約テストは、アダプターを引数に取る形（`gatewayContract(makeAdapter)`）で書き、手動・模擬で同じ群を流す。サービス層の契約（冪等性・取消・再送）も同様にアダプターを差し替えて DB で流す。

## 担当と進め方

標準フロー（直列）：generator → designer → evaluator。generator は 2 つに分け、1 つ目のあとで中間の確認をする。

| 順 | 担当 | 内容 | 終わりの確認 |
|---|---|---|---|
| 1 | generator（G1：土台） | `packages/dips`（対応表・`prepare`・指紋・冪等性キー・遷移表・設定・手動と模擬のアダプター・契約テスト）、マイグレーション 0012 以降、`types.ts`、`reportRequirement` の変更、`effectiveReport`・`reportStatus`・`reportDeadlineState`・`planNextActions`、サービス層・API・認可、`ops-seed.ts`、CI の権限の確認、単体・DB のテスト。見た目は不要 | `pnpm typecheck`・`lint`・`test`・`test:db` が通る。契約 1〜3・5〜12・14・15・17（DB 部分）・19・20 の単体・DB の部分 |
| 2 | generator（G2：画面） | 通報の画面、計画の詳細・一覧への追加、手続きの記録、設計 I の軽微な修正、E2E-DB（手動・模擬）と通常の E2E の追加、`playwright.ops.config.ts` の模擬サーバー。見た目は最低限。`data-testid` を付け、一覧を完了報告に書く | E2E・E2E-DB が通る。契約 4・13・16・17・18 |
| 3 | designer | 通報の画面（コピーの一覧・記録フォーム・履歴）、状況と期限の札、次にやることの一覧、手続きの記録を既存の紙面調に合わせて磨く。ロジック・経路・`data-testid`・文言の定数・対応表は変えない。375px、色だけで区別しない（文字と記号を添える）、タップの的 44px | 契約 4・16・18 の見た目 |
| 4 | evaluator | Playwright MCP で、契約とデザイン 4 基準を採点。DB を使う確認は E2E-DB のログと DB テストの結果で確かめる。模擬のシナリオ（時間切れ・失敗・再送）を目視 | 合否レポート（差し戻し先を明記） |

- 差し戻しは同一スプリントで最大 3 回を目安にする（CLAUDE.md）。
- 現場試用で出た軽微な修正は、契約の外の予備枠として最大 2 日まで受ける（起票されたものだけ。契約の合否に含めない）。

## 範囲外

- DIPS への送信、API アダプター、中継、OIDC、HTTP の模擬サーバー、DIPS の状況の取得（`status` は手動で `Unsupported`）
- 「今日」の画面・下メニュー・現場モード・飛行前確認・点検や日誌の次にやること（12c）、許可・承認の登録と範囲の照合（12d）、事故・ヒヤリハット（12e）、期限一覧（12f）
- 通報の期限の組織ごとの設定（変更点 4）、通報の画面の項目の画像の控え、通報の通知（メール・プッシュ）
- 複数の機体・操縦者、多角形の経路、24 時間を超える飛行、周期的な計画（12a の範囲外のまま）
- DIPS の通報画面の入力順の確定と通報要領の改正内容の反映（U3・U4。確認できた時点でデータの更新だけで反映する）
- 判定ロジック・証跡 ID・`ENGINE_VERSION`・`procedures.json`・規制データの変更
- 本番の DB・Neon Auth・Vercel の環境変数の操作

## スプリント契約（完了条件）

「単体」は vitest、「DB」は `pnpm test:db`、「E2E-DB」は `pnpm test:e2e:ops`、「E2E」は通常の Playwright、「目視」は evaluator が Playwright MCP で確かめる項目。全 20 項目。時計は `OPS_TEST_NOW`（JST 2027-01-05 12:00）などで固定する。

### A. 要否の安全側の変更

- [ ] 1. （単体・E2E-DB）`reportRequirement` が、`category` が `I` で `verdict.unknownCount` が 1 以上のとき `confirm`（根拠に判定不能の件数）を返し、0 件のとき `recommended`、件数が欠けているとき `confirm` を返す。重量（なし・50g・100g・900g・25kg 以上）× `category`（6 種）× 判定不能の件数（なし・0・1・3）× 目的の例外の全組合せで期待の 4 種になる。一覧（`snapshot_result_slim`）と詳細で同じ結果。画面で、特定飛行に当たらず判定不能がある地点の計画が「通報：要確認（要として扱います）」になり、判定不能が無い計画は「通報：義務ではないが推奨」のまま。`REPORT_FIXED_NOTE` に「次の版で追加します」が残らない。どの出力にも 12a 契約 15 の禁止語が無い。

### B. 通報内容の DIPS 入力順の表示とコピー

- [ ] 2. （単体）項目の対応表（`report-fields.json`）：`revision`・`verifiedAt`・出典がある。FPR ガイドライン 1.10 版 p46〜52 の通報受付 API の項目名（`apiField`）の一覧（テストの固定データとして原本から書き写したもの）と過不足なく対応し、型・必須・値域・コード表が一致する（名称 30 文字、飛行目的 1〜16、飛行空域 1〜3、飛行方法 1〜6、所要時間・航続可能時間は 5 分単位 5〜1440、速度・高度 1〜999、機体の種類 1〜6）。`screenStatus` が `unconfirmed` の行を含むまとまりに「※要確認」が出て、`confirmed` にすると消える（データから出る）。`personal` の行が技能証明書番号と氏名。
- [ ] 3. （単体）`prepare` が副作用なく、同じ入力・同じ対応表の版なら手動・模擬で同じ結果を返す。名称 31 文字以上は切り詰めずに警告、所要時間は 5 分単位に切り上げ（1→5、6→10、1438→1440）、高度 0・未入力・1000 以上は値を変えずに警告、フラグは設計 C のコードに変換（緊急用務空域は警告）、経路は Circle の GeoJSON 文字列（中心 `[経度, 緯度]`、半径 m）で半径が無ければ警告、日時は JST 分で `yyyyMMdd HHmm` を併記、`dips_only` の項目が「そらばんは保持しません」になる。指紋が元の値の変更（日時・所要時間・座標・半径・高度・機体・操縦者・最終のフラグ）で変わり、通報の画面の入力（速度など）では変わらない。冪等性キーが同じ入力で一致し、種別・指紋・基準（世代・元の通報）で変わる。
- [ ] 4. （E2E-DB・目視）`/ops/plans/[id]/report` に、まとまりごとに項目が対応表の順で並び、各項目に「コピー」ボタンがある（押すとクリップボードに値が入る）。経路は座標（中心の経度・緯度と半径）と「DIPS の地図で描く」の案内が出て、コピー対象でない。未入力の必須項目の件数と、そらばんが持たない項目の案内が出る。対応表の版・確認日と「※要確認」が出る。固定の文言（送信しない・記録するまで通報済みにならない・公式の手続き）が出て、画面全文に禁止語が無い。閲覧者には技能証明書番号が伏せ字でコピーできず、運航管理者と本人には全桁が出る。375px で横スクロールがない。

### C. 手動の記録・冪等性・変更・取消

- [ ] 5. （DB・API・E2E-DB）手動の記録：二つの確認（DIPS で通報を完了した／最新の版と一致している）が揃わないと 400（DB の CHECK でも拒否）。番号または「番号が表示されなかった」の宣言のどちらかが必須（宣言のときはメモが必須）。通報日時は JST 分の形で、未来の時刻は 400。記録すると `reported_manual`・`channel = manual` の行ができ、画面に「DIPS で通報済み（利用者の申告・手動記録）」と日時・番号が出る。**記録が無いうちは、どの画面・API の応答にも「通報済み」が出ない**。`content` に技能証明書番号・氏名が入らない。下書きの計画、中止した計画、最新でない版（`expectedPlanVersion`）への新規・変更は 409。
- [ ] 6. （DB・単体）冪等性：同じ計画・同じ指紋・同じ世代の二重送信（逐次と並行の 2 リクエスト）は、新しい行を作らず既存の行を 200 で返し、行は 1 件のまま。`(org_id, idempotency_key)` の一意制約を DB が持つ。完了した取消のあとの新規は別のキーで新しい行になる。有効な通報がある計画への新規は 409 `already_reported`。
- [ ] 7. （DB・API・単体）変更・取消・訂正：`change`・`cancel` は元の通報（有効な通報）を指す別の行になり、元の行は書き換わらない。`effectiveReport` が、新規・変更・取消・取り下げ・失敗・結果不明の全組合せで期待どおりの有効な通報（なし／1 件）を返す。有効な通報が無い計画への変更・取消は 409、元の通報が現在の有効な通報でなければ 409 `base_changed`。**中止した計画でも取消は記録できる**（新規・変更は 409 `voided`）。手動記録の訂正と取り下げは理由必須の新しい版で、元の値が履歴に残り、`verify_record_chain` が 0 行を返す。物理削除はない。
- [ ] 8. （DB）根拠の鎖：通報の行が `snapshot_id`（証跡 ID は `judgement_snapshots` から引ける）・`plan_version`・`fingerprint`・`fingerprint_parts`・`map_revision`・`channel` を持ち、画面の履歴に証跡 ID・計画の版・対応表の版・送信元が出る。別の計画のスナップショットや元の通報を指す行を外部キーが拒否する。他の組織の計画・通報は 404。
- [ ] 9. （DB・CI）権限：`soraban_app` で `flight_report_attempts`・`plan_procedure_records` の UPDATE・DELETE・TRUNCATE が権限エラー（42501）で、INSERT と SELECT はできる。`flight_reports` への直接の INSERT・UPDATE・DELETE も権限エラー。オーナーロールでも追記専用の表の更新・削除・TRUNCATE をトリガーが拒む（SB409 `immutable`）。CI の `has_table_privilege` の確認に同じ内容が入っている。
- [ ] 10. （DB・単体）監査：コピー・記録・訂正・取り下げ・結果不明の確定・送信・取消の各操作が、`flight_report_attempts` に「誰が（利用者の ID と表示名・役割の写し）・いつ（DB の時刻）・何を（操作・冪等性キー・内容のハッシュと要約・対応表の版・証跡 ID）・どこへ（アダプター）・結果」で 1 行ずつ残る。失敗した操作も結果つきで残る。行に秘密・技能証明書番号・氏名・内容の全文が入らない（テストで列の値を検査）。

### D. ゲートウェイ・模擬・設定

- [ ] 11. （単体）遷移表が 1 か所（`transitions.ts`）にあり、画面・サービス・テストが同じ表を使う。全ての（元の状態 × 先の状態）の組合せで、表にあるものだけが許可され、表にないものが拒否される。`prepared` のまま 5 分を超えた行が「結果不明」の扱いになり、自動で再送されない。未知の外部状況が `external_status` に保存されて状態が増えず、画面に「状況：不明（生の値）」と出る。
- [ ] 12. （単体・DB）ゲートウェイの契約テスト群 `gatewayContract(makeAdapter)` を手動と模擬で同じように流し、すべて通る：`prepare` の結果が同じ／同じ冪等性キーの `submit` の二度目は既存の結果／結果が遷移表の許す状態で証跡 ID・指紋・対応表の版・送信元を持つ／取消が別の行になり有効な通報が無くなる／`canCancel` が偽のアダプターは手動の記録に倒す／模擬の `timeout`・`server_error` は `unknown` で自動で再送しない／`rejected`・`unauthorized` は `failed` で、同じ行・同じキーで再送でき二重にならない／有効な手動の通報がある計画への模擬の新規は 409 `manual_report_exists`／外部の呼び出しの間にトランザクションを開けない（②の前に `prepared` の行が見える）／③の失敗を注入すると `prepared` のまま結果不明として残る。API アダプターは `skip`（理由と件数をテスト出力に表示）。
- [ ] 13. （E2E-DB）同じシナリオ（計画を作る → 通報内容を開く → 通報する／記録する → 番号と状態を確かめる → 変更 → 取消）を、手動（「コピー → 記録」）と模擬（「送信内容の確認 → 送信」）の両方で流し、画面の結果（状態・番号・証跡 ID・送信元の表示「手動（利用者の申告）」「模擬（開発用）」）と DB の行の形が同じ。模擬では `timeout` で「結果不明」となり再送のボタンが出ず、確認後に確定でき、`rejected` で失敗となり再送できる。模擬の画面に「実際の DIPS には送信されません」が出る。
- [ ] 14. （単体・CI）設定：`DIPS_REPORT_ADAPTER` が未設定なら `manual`。`mock` は `VERCEL_ENV` が `production`・`preview` のとき拒否される（`/api/health/db` が 503 と理由を返し、通報の API も 503 `adapter_unavailable`）。`api`・未知の値は設定の誤りとして 503 で、手動に自動で落ちない。`.env.example` に名前だけがあり値は無い。

### E. 期限・次にやること・手続きの記録

- [ ] 15. （単体）`reportDeadlineState` と `planNextActions`：目安の時刻（飛行開始の 24 時間前。`report-policy.json`）の前後・飛行開始の前後で `upcoming`・`past_guide`・`overdue_started` を返し、飛行開始後の未記録が最上位の `tier 1`。推奨は警告にならない。要確認は要と同じに扱う。指紋が変わると「通報を変更する」、中止で「通報を取り消す」、記録後は「飛行計画を DIPS で通報する」が消える。許可・警察の項目は、スナップショットの手続きと有効な記録から出入りする。並びが `tier`、飛行開始までの時間の順。**法定の期限として日付・時刻を作らず**、目安は「社内の目安」と併記される。罰則の文言に「※要確認」が付き金額が無い。保存された「状態」を読まず、記録の有無から毎回導出される（記録を足すだけで一覧が変わる）。
- [ ] 16. （E2E-DB）計画の詳細と一覧に「次にやること」が動詞で始まる 1 行で出て、押すと該当の画面（通報内容・記録フォーム・確認・再判定）へ直接移る。時計の固定で、目安超過の警告・飛行開始後の最上位の警告・記録後に消える・計画の変更で「通報を変更する」と変更点（例：予定開始 14:00 → 15:00）・計画の中止で「通報を取り消す」が出る。一覧で「対応が必要」の絞り込みができる。固定の文言（送信しない・公式の手続き・目安は社内のもの）が出て、画面全文に禁止語が無い。
- [ ] 17. （DB・API・E2E-DB）手続きの「済み」の記録：許可・承認の申請（`dips_permit`）と飛行禁止法の同意・通報（`small_drone_law`）を、すべての確認が真のときだけ記録できる（偽は 400、CHECK でも拒否）。追記専用で、取り下げ（`retract`）も理由つきの行として残り、有効な記録は最新の行で決まる。記録すると次にやることから該当の項目が消え、「申請済み（利用者の申告）」と表示される（「許可済み」とは出ない）。計画の訂正や再判定でスナップショットが変わると「前の判定に対する記録です」と出て次にやることに戻る。他の組織は 404、閲覧者は 403。

### F. 表示・認可・回帰

- [ ] 18. （E2E-DB・目視）軽微な表示：①計画詳細の「判定の日時」が JST の日時で出て、画面のテキストに `T…Z` 形式の文字列が出ない。②375px の `/ops/places`・`/ops/plans`・計画の詳細・通報の画面・`/ops/flights`・`/ops/inspections`・`/ops/members` で、ボタン・フォームの部品・独立したリンク（文章の中のリンクを除く）の高さがすべて 44px 以上（E2E で要素の高さを走査する）。③375px の計画の訂正フォームで、機体が読み取り専用の文（登録記号・型式が折り返して全部見える）で出て、新規作成の機体セレクトがはみ出さず、横スクロールがない。
- [ ] 19. （単体・API）`can()` が新しい操作（`report.*`・`procedure.record`）で全役割 × `isSelf` の組合せを網羅し、設計 F の表のとおりになる。`OPS_ACTIONS` に新しい操作がすべて入っている。操縦者は自分の計画だけ、閲覧者は読み取りだけ、他の組織は 404。
- [ ] 20. （単体・grep・CI）回帰：`ENGINE_VERSION` が `soraban-0.4.0-verdict-2026-10` のまま。固定の入力で、地点判定・申請支援の証跡 ID が 53161dd と一致する。`git diff` で、`packages/regulations/src` は `report-requirement.ts` と `index.ts` の export の追加以外に変更がなく、`packages/regulations/data`・0001〜0011 に変更がない。マイグレーションは 0012 以降の追記だけで、`MIGRATION_VERSIONS` が更新され、`migrations-manifest.test.ts` と `schema-columns.test.ts` が通り、空の DB に全マイグレーションが通って 2 回目は何もしない。12a までの既存テスト（単体・DB・E2E・E2E-DB）が、設計 A で認めた期待値の更新を除き無変更で通る。`OPS_ENABLED` 無効で `/ops/plans/[id]/report`・`/api/ops/plans/[id]/reports` が 404 で、`/` は変わらない。画面・文言に特許・出願の表示と禁止語が無い。`pnpm typecheck`・`lint`・`test`・`test:db`・`build` が通る。

## 分量の判断と削る順

機能は 5 件（ゲートウェイと手動・模擬、通報の整形とコピー、通報の記録と監査、要否・期限・漏れと次にやること、手続きの記録）に、要否の安全側の変更と軽微な表示が付く。契約 20 項目は §13.6 の目安（10〜20）の上限である。ただし 1 項目あたりの検証が重い（契約 6〜7・12・13）ため、2 週間の上限付近と見る。遅れたときに削る順：

1. 模擬アダプターの E2E（契約 13 の模擬側。手動の E2E と、契約 12 の単体・DB の契約テストは残す）。
2. 計画の一覧の「対応が必要」の絞り込みと先頭の「次にやること」の列（契約 16 の一覧側。詳細の「次にやること」は残す）。
3. 通報内容の端末の下書きの保持と、変更通報での前回の入力の引き継ぎ（毎回入力する形にする）。
4. 手続きの記録の取り下げの画面（API・DB は残す）。

**削らないもの**：記録するまで「通報済み」にならない仕組みと二つの確認、冪等性、追記専用と監査、DIPS の入力順の表示とコピー、判定不能がある計画の要確認、飛行開始後の未記録の最上位の警告、ゲートウェイの契約テスト（API 取得後の移行が軽くなる要）。

## リスク

| リスク | 備え |
|---|---|
| 利用者が「記録＝通報済み」と誤解する、または DIPS で通報せずに記録する | 二つの確認を必須にし、記録は「手動（利用者の申告）」と表示する。記録の誤りは取り下げ（`retracted`）で直せる。取り下げ・訂正・取消は理由つきの版として残る。12c で現場モードの飛行前に再掲する |
| DIPS の通報画面の入力順・項目名・番号の表示が未確認（U4）で、一覧の順が画面と違う | 初期の順は原本の API の順と明示し、「※要確認」をデータから出す。順や項目名の修正はデータの更新だけ。番号は「番号または番号なしの宣言」で運用する |
| 通報要領の 2026-03-31 改正の内容が未確認（U3） | 通報事項 a〜n との対応（`requirementRef`）は `null` のまま。期限は日付を作らず、社内の目安を目安と明記。罰則の文言に「※要確認」 |
| 通報の要否を誤って出さない側に見せる | 4 種の表示のみ。判定不能・重量不明は要確認。12a の禁止語の検査を新しい文言にも適用 |
| 模擬の振る舞いを DIPS の実際の仕様と誤解する | 模擬は「そらばん独自の仮定」とコード・画面に明記。本番・プレビューで拒否。HTTP を通す模擬は API 取得後 |
| 外部の呼び出し（模擬）の途中で止まり、二重通報になる | 外部を呼ぶ前に `prepared` を記録する。結果不明は自動で再送しない。再送は `failed` の同じ行・同じキーだけ |
| 一覧の「次にやること」の計算で `result` 全体を読み、遅くなる | 一覧は必要な値（`verdict.unknownCount`、手続きの `procedureId` と期限）だけを SQL の JSON 抽出で取る。詳細は 1 件なので全体を読んでよい |
| 0012 でトリガー関数を丸ごと置き換え、既存の動きを壊す | 0011 と同じ流儀で、既存の分岐は文字どおりに写す。`records.db.test.ts`・`plans.db.test.ts` を無変更で通す |
| 通報の指紋に含める項目の選び方が現場に合わない | 指紋の元の値を記録に残し、変更点を項目名つきで表示する。含める項目の追加は指紋の版（`soraban-report-fp-v1`）を上げて対応する |
| 12 の規模が 2 週間に収まらない | 上の削る順 |

## ユーザー作業（エージェントは行わない。12b の完了には不要）

| 番号 | 作業 | 時期 | 12b への効き方 |
|---|---|---|---|
| U3 | 通報要領（令和8年3月31日最終改正。https://www.mlit.go.jp/common/001878897.pdf ）の本文で、通報事項（4(3) の a〜n）、期限の書き方、障害時の扱いを確認する | 任意（12b の完了後でもよい） | `requirementRef`・目安の数値・文言がデータの更新だけで確定する |
| U4 | DIPS 2.0 の通報画面で、入力順・項目名・選択肢、通報後に番号が表示されるかを確認する（操作マニュアル飛行計画通報編 https://www.ossportal.dips.mlit.go.jp/guide/fiss/DIPS-Manual_FPR_ALL_Ja.pdf と実画面） | 任意 | `order`・`dipsScreenLabel`・`screenStatus`・`numberPolicy` がデータの更新だけで確定する |
| U5 | 航空法第157条の10（通報義務違反の罰則）の条文を e-Gov で確認する | 任意 | 罰則の文言の「※要確認」を外せる |
| U1・U2 | 本番の DB 準備と Neon Auth の有効化、最後に `OPS_ENABLED=1`（`docs/runbooks/production-db-prep.md`）。12b のマイグレーションも U1 のあとにまとめて適用される | 12b を本番で使う前（2027-01 中旬までを推奨） | 本番で使えるようになる時期だけ |

DIPS 2.0 API の申請と固定 IP（U6・U11）は保留（2026-10-21）。開発・検証・マージの間にユーザー作業はない。

## 未決事項

**推奨どおりで確定したもの**（sprint-12.md §7.2。ユーザー承認 2026-10-21）：9（証跡出力で手動の記録を「利用者の申告」と区別して出す）、11（ゲートウェイの置き場所は `packages/dips`、切り替えは環境変数で全体に一つ）、13（中継の置き場所は Phase 2）。5 は本書の変更点 5 のとおり未確認のまま安全側に実装する。

**ユーザーに伺うこと**：1 件（完了報告）— 通報の目安時間（飛行開始の 24 時間前）の組織ごとの設定を 12b では持たず、固定の定数（データで変更可）にしてよいか。推奨：固定にする。
