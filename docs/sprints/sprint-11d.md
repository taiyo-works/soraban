# Sprint 11d: 判定の 4 段への組み直しと見せ方の刷新

> 親文書：`docs/spec.md` §13.9（判定の定義）・§13.6（2026-10-20 差し込み）／ `docs/00_NORTH_STAR.md` §0.1.9
> 期間：5〜7 日（差し込み）。Sprint 11c の後、Sprint 12（飛行計画と判定スナップショット）の前に終える。Sprint 12 のスナップショットは本スプリントの判定を保存する。
> 前提：Sprint 11c が入っていること。判定の結果が変わるため `ENGINE_VERSION` を上げる。DB は追記のマイグレーション（`0009_*`）を 1 本足す。適用済みのマイグレーション（0001〜0008）は書き換えない。
> ※ Next.js は破壊的変更を含むため、実装前に `node_modules/next/dist/docs/` を参照（`apps/web/AGENTS.md`）。

## 目的と位置付け

判定が答える問いを「この地点・この飛び方で、何の手続きを、いつまでに済ませれば飛べるか」に改める（North Star §0.1.9、ユーザー承認 2026-10-20）。現在の判定は信号の 3 色＋判定不能で「飛べるか」に答えており、次の問題がある。

1. 許可を入力すると規制が green になり、全体が「飛行可能」と出る。許可の条件や、まだ済んでいない飛行ごとの義務が見えなくなる。
2. `yellow`（「要確認・要許可」）が「該当するか要確認」と「許可が要る」の二つの意味を持っている。
3. `computeOverall` で `unknown` が `yellow` の下に隠れ、データ未整備の規制があることが全体の判定から見えない。
4. 結論の下に、何の手続きをいつまでに済ませるかが並んでいない（手続きは申請支援の別の欄にある）。
5. 計画の調査で見つかった見落とし：空港等周辺の判定が `yellow`（6km の概算で該当の可能性）のとき、申請支援の空域フラグに入らず（`extractAirspaceFlagsFromRegulations` は `red` だけを見る）、空港等周辺の飛行許可が手続きに出ない。

本スプリントで、判定を 4 段（飛行不可／要手続き／手続き済み（条件付き）／手続き不要）＋判定不能に組み直し、結論の下に手続きと期限を並べる。あわせて、信号機の見せ方を 4 段に合わせて見直す（ユーザーの要望「判定の信号のイメージが古い」、2026-10-20）。

## 現状（2026-10-20、本ブランチ 8ddbfcd 時点。11c の変更は除く）

| 箇所 | 現在 |
|---|---|
| `packages/regulations/src/core.ts` | `RegulationStatus` = `red`／`yellow`／`green`／`unknown`。`applyExemptions` は permit 効果の例外節（重量・許可・目的を区別しない）が当たると red／yellow を green にする |
| `packages/regulations/src/clause-graph.ts` | `MachineCondition` は `type` と単一の `value`。`permit_holder` は値 1 つとの一致 |
| `packages/regulations/src/index.ts` | `computeOverall`：red ＞ yellow ＞ unknown ＞ green。`STATUS_LABEL`：飛行不可／要確認・要許可／飛行可能／判定不能（未整備） |
| `packages/regulations/src/evidence.ts` | `ENGINE_VERSION` = `soraban-0.3.0-regulations-2026-07`、`PREVIOUS_ENGINE_VERSIONS` = `["soraban-0.2.0-clausegraph"]`。`buildCheckEvidencePayload` は入力（版・座標・時刻・規制 ID・ctx・データセット）だけを持つ |
| `packages/regulations/src/diagnosis.ts` | 特定飛行フラグ（空域 4×方法 6）、手続き、期限（10 開庁日前）。飛行禁止法の通報は期限 0（文言のみ）。`extractAirspaceFlagsFromRegulations` は red のみ。`deriveDidStatusFromRegulations` は green を「非該当」とする（許可で green になった DID も非該当になる） |
| `apps/web/src/server/handlers.ts` | `/api/diagnose` は地点判定に機体重量だけを渡す（許可を渡さない） |
| `apps/web/src/components/regulation-checker.tsx` | 結論は `SignalLight`（3 灯）と `STATUS_LABEL`、`overallHelp`（green は「飛行可能と判断できる状態」）。履歴の点は 4 色 |
| `apps/web/src/components/signal-light.tsx` | 赤・黄・緑の 3 灯。unknown は黄で表示 |
| `apps/web/src/components/regulation-pdf.tsx` | 結論は 3 灯＋`STATUS_LABEL`。規制ごとは `STATUS_LABEL_PDF`（飛行不可／要確認／適用外／未整備） |
| `apps/web/src/lib/history.ts` | `SavedCheck.overall: RegulationStatus`（キー `soraban:history:v1`） |
| `packages/db/migrations/0002_evidence_log.sql` | `overall regulation_status`（enum：green／yellow／red／unknown）、`per_regulation_status jsonb`。アプリのロールは追記のみ（update は拒否） |

## 実装する機能

### A. 判定の型と導出（generator、`packages/regulations`）

- **A1. 型**：`VerdictLevel` = `no_fly`／`needs_procedure`／`procedure_done`／`no_procedure`、規制ごとの判定は加えて `unknown`。表示は `VERDICT_LABEL`：飛行不可／要手続き／手続き済み（条件付き）／手続き不要／判定不能（データ未整備）。
- **A2. 元の判定**：`RegulationWithStatus.status` を「許可・同意を当てる前の法令上の該当」に改める。`applyExemptions` を分け、対象外にする例外（`weight_below_g`、`in_zone`）だけが `status` を green にし、満たす例外（`permit_holder`、`permit_holder_all`、`purpose`）は `status` を変えずに `satisfiedBy`（適用した例外節）へ記録する（spec §13.9.3）。表示は `BASE_STATUS_LABEL`：該当／該当の可能性（要確認）／非該当／判定不能（データ未整備）。
- **A3. 飛行禁止法の両方必須**：`MachineCondition` に複数の値を全て要求する `permit_holder_all` を加え、飛行禁止法の例外節を `facility_manager` と `pref_pubsafety_notice` の両方必須にする（例外節の id は変えない）。旧値 `facility_manager_and_pref_pubsafety` はどの例外節にも当たらない。`formatMachineCondition` も対応する。
- **A4. 飛行不可の区分**：空港の敷地内（`evaluateAirports` の敷地内の分岐）と緊急用務空域（飛行の条件のフラグ）は、満たす例外を当てず飛行不可とする。規制ごとに「飛行不可の区分か」を判定結果に持たせる。
- **A5. 法的な重さ**：`Regulation` に `legalTier`（1 国の法律、2 条例、3 施設管理者の取り決め）を加える。航空法・小型無人機等飛行禁止法・文化財保護法は 1、都市公園条例・県の迷惑行為等防止条例は 2。
- **A6. 全体の判定**：純関数 `deriveFlightVerdict`（新規 `verdict.ts`）を置く。入力は地点判定の規制、飛行の条件のフラグ（方法・利用者が選ぶ空域）、機体重量、許可。出力は：
  - `level`（全体。spec §13.9.4 の順序。判定不能があれば要手続き以上）
  - `unknownCount`
  - 規制・飛行の方法ごとの判定（元の判定、判定、適用した許可、理由）
  - `procedures`：要手続きの手続き（段階 → `legalTier` → 期限の早い順。期限のないものは最後）
  - `done`：手続き済み（条件付き）の項目と守るべき条件（「許可の範囲と有効期間は照合していません。許可書で確認してください」を含む）
  - `perFlightDuties`：飛行の前後に必ず行うこと（特定飛行なら飛行計画の通報・飛行日誌、緊急用務空域の確認、100g 以上なら機体登録とリモート ID は前提）
- **A7. 期限**：DIPS の許可・承認は既存の 10 開庁日前の逆算を使う。飛行禁止法の通報は「飛行開始の 48 時間前まで」とし、飛行予定日があれば「飛行予定日の 2 日前の、飛行開始と同じ時刻まで」と日付を出す（開庁日計算の対象にしない）。同意は「通報より前」。公園・史跡・県条例は「管理者の定めによる（未収録）」。
- **A8. 見落としの修正**：空港等周辺が `yellow`（該当の可能性）のときも、空港等周辺の飛行許可を要手続きの手続きに出し、理由に「該当の可能性（要確認）」と出す。`deriveDidStatusFromRegulations` は元の判定で該当／非該当を決める（許可で該当が非該当にならない）。
- **A9. 目的による例外**：`purpose`（緊急・公務・市の行事）が当たった規制は手続き済み（条件付き）とし、条件に「目的の例外に当たることを、根拠となる依頼・後援の書面で確かめる」の趣旨を出す（未決 3）。

### B. 許可の入力（generator）

- **B1. DIPS の許可・承認を種類ごとに**：「国交省 DIPS」を、DID 上空・150m 以上・夜間・目視外・30m 未満・催し場所・危険物・物件投下の種類ごとの入力に分ける（値は例：`mlit:did`、`mlit:night`）。空港等周辺は入力に含めず、Sprint 11c の補足（個別許可と空港の設置管理者等との調整）を出し続ける。旧値 `mlit` は DID 上空の許可として読み替える（履歴の互換。未決 2）。
- **B2. 申請支援に許可を渡す**：`/api/diagnose` に許可を渡し、`deriveFlightVerdict` の結果を返す。手続きの一覧（申請支援の既存の欄）でも、手続き済みの項目に印と条件を出す。手続きそのものは消さない。

### C. API・証跡・DB・履歴（generator）

- **C1. API**：`/api/check` と `/api/diagnose` の応答に `verdict` を加える。`/api/check` は地点だけの判定（飛行の方法なし）、`/api/diagnose` は飛行の方法を含む判定。既存の `overall`（`computeOverall` の値。0.4.0 からは元の判定から求める）は互換のため残す。
- **C2. `ENGINE_VERSION`**：`soraban-0.4.0-verdict-2026-10`（実装が 11 月にずれた場合は `-2026-11`）に上げ、`soraban-0.3.0-regulations-2026-07` を `PREVIOUS_ENGINE_VERSIONS` に加える。`buildCheckEvidencePayload` と `buildDiagnosisEvidencePayload` の正規化は変えない（版の文字列だけが変わる）。申請支援の証跡には許可（並べ替えた配列）を新しいキーで加える。
- **C3. 既存の証跡 ID のテスト**：`apps/web/src/server/sprint10a.test.ts` などの期待値は、`engineVersion` に旧版の文字列を渡したペイロードで旧値が再現できることを確かめるテストに残し、現行版の期待値は新しい値に更新する（更新した理由をテストのコメントに書く）。
- **C4. evidence_log**：`packages/db/migrations/0009_evidence_log_verdict.sql`（新規）で列を足す：`verdict text null`（`no_fly`／`needs_procedure`／`procedure_done`／`no_procedure` の check 制約）、`verdict_unknown_count integer null`、`per_regulation_verdict jsonb null`、`applied_permits text[] null`。既存の行は書き換えない（null のまま。追記のみの権限も変えない）。列のコメントに「`overall` は 0.3.0 までは許可を当てた後、0.4.0 からは許可を当てる前の元の判定」と書く。`toEvidenceLogInsert` と `packages/db/src/evidence.ts` を対応させる。
- **C5. 履歴**：`SavedCheck` に `verdict?`・`verdictUnknownCount?` を足す（キー `soraban:history:v1` のまま、旧形式も読める）。旧形式（`verdict` なし）は旧版の値であることを明示して出す（例：「適用外（旧版の判定）」）。「飛行可能」の言葉は新旧とも出さない。
- **C6. 文言**：`STATUS_LABEL` は旧版の表示用（`LEGACY_STATUS_LABEL`）に改め、「飛行可能」を使わない。`overallHelp` の文言を 4 段＋判定不能に合わせて書き直す。

### D. 画面と PDF の表し方（generator が構造を作り、designer が見せ方を決める）

- **D1. 構造（generator）**：結論（段階の言葉、判定不能の件数）→ 要手続きの手続き（期限順の段取り）→ 手続き済み（条件付き）と条件 → 飛行の前後に必ず行うこと → 規制ごとの「元の判定 → 適用した許可 → 判定」。画面と地点判定の PDF（`regulation-pdf.tsx`）で同じ順・同じ言葉にする。申請支援の PDF（`application-pdf.tsx`）は結論と手続き済みの印を合わせる。
- **D2. 信号機の見せ方の見直し（designer）**：赤・黄・緑の 3 灯（`signal-light.tsx`）の見せ方を、4 段の判定に合わせて見直す。要件：
  - 色だけに頼らない。段階ごとに言葉と、形または記号を持たせ、色覚の多様性に配慮する（WCAG 2.2 AA 1.4.1。グレースケールでも 5 つを区別できる）。
  - 「手続き済み（条件付き）」が「手続き不要」と、色以外でも見分けられる。「条件付き」であることが結論の位置で読める。
  - 判定不能は「要手続き」に寄せつつ、判定不能であることと件数が結論の位置で読める。
  - 結論の下に、必要な手続きを期限順に並べる段取りの見せ方を作る（手続き名、出す先、期限の日付または文言、法的な重さ）。
  - 画面と PDF で同じ表し方（言葉・記号・並び）にする。
  - 紙面調（測量野帳）の既存デザイン（罫、書体、余白、`--color-*` のトークン、ライト・ダーク）に合う。
  - 方向性は未決 1 でユーザーに確認してから磨き込む。
- **D3. 範囲**：ロジック・ルート・API の形は変えない。`data-testid` は generator が付けたものを保つ。

### E. テスト（generator）

- 単体：`deriveFlightVerdict` の規則（spec §13.9.3・§13.9.4）、`permit_holder_all`、並べ方、期限、旧値の読み替え、証跡の旧版再現。
- E2E：`e2e/sprint11d.spec.ts`（新設）で契約の E2E 項目を確かめる。既存の E2E のうち `STATUS_LABEL`・信号の色・「飛行可能」に依存するものを新しい表示に合わせて直し、直したファイルと理由を報告する。
- DB：`pnpm test:e2e:ops`／db ジョブで 0009 が適用でき、アプリのロールで新しい列を含む insert ができ、update が拒否されたままであること。

## 範囲外

- 許可の範囲（場所・飛行の方法・機体・操縦者・期間）、許可番号・有効期間の記録と照合、空港等周辺の個別許可の登録（Sprint 12。spec §13.6 の Sprint 12 の行）
- 飛行計画と判定スナップショット（Sprint 12）
- 緊急用務空域のリアルタイム取得
- 公園・史跡の管理者ごとの申請期限の収録
- 既存の evidence_log の行の書き換え・後追いの補完
- 画面・PDF への特許・出願の表示（出さない。North Star §0.1.8）

## スプリント契約（完了条件）

「単体」は vitest、「E2E」は Playwright（`e2e/sprint11d.spec.ts`）、「DB」は db ジョブ、「grep」は `rg`・`git`、「目視」は evaluator が Playwright MCP で確かめる項目。全 20 項目。

### A. 判定の規則

- [ ] 1. （単体）元の判定 `red`／`yellow` で満たす例外が当たると判定は手続き済み（条件付き）、当たらないと要手続き、`green` は手続き不要、`unknown` は判定不能になる。許可・同意・目的の例外で `status` が変わらない。100g 未満と工業専用地域では `status` が `green` になる。
- [ ] 2. （単体）どの許可の組み合わせでも、元の判定が `red`／`yellow` の規制が手続き不要にならない（全ての許可の値を入れた ctx で全規制を確かめる）。
- [ ] 3. （単体・E2E）空港の敷地内と緊急用務空域は、全ての許可を入れても飛行不可。
- [ ] 4. （単体）全体の集約が 飛行不可 ＞ 要手続き ＞ 手続き済み（条件付き） ＞ 手続き不要 で、判定不能が 1 件でもあれば要手続き以上になり、`unknownCount` が正しい。規制が 0 件なら要手続き扱い。
- [ ] 5. （単体）飛行禁止法の例外は `facility_manager` と `pref_pubsafety_notice` の両方で当たり、どちらか一方、または旧値 `facility_manager_and_pref_pubsafety` だけでは当たらない。

### B. 地点と飛び方での結果（E2E）

- [ ] 6. 米子市役所（DID 内）で許可なし → 要手続き、DID 上空の飛行許可と期限が結論の下に出る。DID 上空の DIPS 許可を入れる → 手続き済み（条件付き）で、元の判定「該当」と適用した許可、範囲・期間を照合していない旨が出る。
- [ ] 7. 空港等周辺が該当（または該当の可能性）の地点で、DIPS の全種類を入れても空港等周辺は要手続きのまま、個別許可と空港の設置管理者等との調整の理由が出る。空港等周辺が `yellow` のとき、空港等周辺の飛行許可が手続きに出る。
- [ ] 8. 「美保基地の周辺（境港市）」で同意だけ → 要手続き、同意＋通報 → 小型無人機等飛行禁止法が手続き済み（条件付き）。飛行予定日を入れると通報の期限が「飛行予定日の 2 日前」の日付で出る。
- [ ] 9. どの規制にも当たらない地点で飛行の方法なし → 手続き不要（機体登録は前提として出る）。夜間を選ぶ → 要手続き（夜間の飛行承認と 10 開庁日前の期限）。夜間の DIPS 承認を入れる → 手続き済み（条件付き）。特定飛行のとき、飛行計画の通報と飛行日誌が「飛行の前後に必ず行うこと」に出る。
- [ ] 10. 判定不能の規制がある地点（境港市の史跡が判定不能になる「美保基地の周辺」など）で、全体が要手続き以上になり、判定不能の件数が結論の位置に出る。
- [ ] 11. 手続きの並びが、法的な重さ（国の法律 → 条例）の順、同じ重さの中で期限の早い順になっている（複数の規制に当たる地点で順序を確かめる）。

### C. 表示・PDF・履歴

- [ ] 12. （grep・E2E）`rg -n "飛行可能|要確認・要許可" apps/web/src packages/regulations/src` が 0 件。画面と地点判定の PDF のテキストにもこれらの語が出ない。
- [ ] 13. （E2E）地点判定の PDF のテキストに、結論の段階の言葉、手続きと期限、手続き済みの項目の元の判定と適用した許可と条件が、画面と同じ言葉で出る。特許・出願の語が出ない。
- [ ] 14. （単体・E2E）旧形式の履歴（`verdict` なし、`engineVersion` が 0.3.0／0.2.0）が読み込め、旧版の判定であることが分かる表示になる。旧値 `mlit` は DID 上空の許可として復元される。

### D. 証跡と DB

- [ ] 15. （単体）`ENGINE_VERSION` が `soraban-0.4.0-verdict-` で始まり、`PREVIOUS_ENGINE_VERSIONS` に `soraban-0.3.0-regulations-2026-07` を含む。旧版の文字列を渡したペイロードから、`sprint10a.test.ts` にあった旧版の証跡 ID が再現できる。
- [ ] 16. （DB）0009 が空の DB と 0008 まで適用済みの DB の両方に適用でき、0001〜0008 のファイルが変わっていない（`git diff --name-only origin/main -- packages/db/migrations` が 0009 の 1 行だけ）。アプリのロールで新しい列を含む insert ができ、update は従来どおり拒否される。
- [ ] 17. （単体）`toEvidenceLogInsert` が `verdict`・`verdict_unknown_count`・`per_regulation_verdict`・`applied_permits` を埋め、`overall` は元の判定から求めた値になる。

### E. 見せ方（目視）

- [ ] 18. 5 つの段階（判定不能を含む）が言葉と形・記号で区別でき、グレースケールのスクリーンショットでも見分けられる。「手続き済み（条件付き）」と「手続き不要」が色以外で見分けられる。evaluator はレポートにライト・ダーク・グレースケールのスクリーンショット（1280px・375px）を添える。
- [ ] 19. 結論の下の段取り（手続き・出す先・期限）が期限順に読め、画面と PDF で同じ表し方になっている。紙面調の既存デザインに合い、ライト・ダークで崩れない。
- [ ] 20. evaluator のデザイン 4 基準で合格。

### 回帰（全項目に共通）

既存の E2E（表示の変更に合わせて直したものを含む）、`e2e/ops-db/`、CI がすべて緑で、`pnpm typecheck`・`pnpm lint`・`pnpm test`・`pnpm build` が通ること。項目数に数えない。

## 担当と順序

| 順 | 担当 | 行うこと | 渡すもの |
|---|---|---|---|
| 0 | オーケストレーター | 未決 1（見せ方の方向性）をユーザーに確認し、designer への指示に入れる | 確認結果 |
| 1 | generator | A〜C、D1、E。見た目は最低限でよい（既存の部品を流用し、段階の言葉と仮の記号を出す） | 変更ファイル、API の応答の例、ENGINE_VERSION、証跡 ID の新旧、マイグレーション、直した既存 E2E の一覧 |
| 2 | designer | D2（信号機の見せ方の見直し、段取りの見せ方、画面と PDF の統一）。表示部分のクラス・部品だけを触る | 変更点、色とコントラストの実測値、グレースケールの確認 |
| 3 | evaluator | 契約 1〜20 | 合否レポート（不合格なら差し戻し先：規則・期限・API・証跡・DB・履歴・PDF の文言は generator、見せ方は designer） |

## 既存の E2E を壊さないための注意

- 結論の文言、信号の色、`STATUS_LABEL` を前提にしている E2E は赤になる。`rg -n "飛行不可|要確認|飛行可能|判定不能|signal" e2e` で洗い出し、新しい表示に合わせて直す。直すのは表示の検査だけとし、地点・入力・期待する規制の該当は変えない。
- `e2e/sprint10a.spec.ts`・`sprint11a.spec.ts` の見出しの禁止語の検査は保つ。

## リスク

| リスク | 対応 |
|---|---|
| 変更が広く、既存の E2E と単体テストの直しが多い | 規則は純関数 `deriveFlightVerdict` に集め、表示は API の `verdict` を読むだけにする。既存テストの直しは表示の検査に限る |
| 証跡 ID が全て変わり、過去の証跡と照合できなくなる | 正規化を変えず版の文字列だけを変える。旧版の文字列から旧 ID を再現できることをテストで保つ（契約 15） |
| evidence_log の `overall` の意味が版で変わる | 列のコメントと spec §13.9.7 に記録し、`engine_version` で読み分ける。新しい列で判定を別に持つ |
| 本番 DB はまだ準備前（HANDOFF §5） | 0009 は 0001〜0008 と一緒に適用される。準備の手順書（`packages/db/README.md`）に 0009 を含めて書き足す |
| DIPS の許可を種類ごとに入れる手間が増える | 既定は全て未チェック。チェックの並びは designer が整える。範囲と期間の登録は Sprint 12 で許可ごとにまとめて行えるようにする |
| 「手続き済み（条件付き）」を「飛べる」と読み違える | 結論の位置に「条件付き」と条件を出し、範囲・期間を照合していない旨を必ず添える（契約 6・18） |

## ユーザー作業

- 未決 1（見せ方の方向性）を選ぶ。
- 完成した画面と PDF を、自社の点検の地点（DID 内、美保基地の周辺）で確かめ、手続きの並びと期限が実際の段取りに合うかを見る。

## 未決事項（推奨つき）

1. **信号機の見せ方の方向性**（ユーザーに確認する）。
   - (a) 信号機の丸をやめ、段階の言葉の札（枠付きの見出し）と記号（例：飛行不可＝斜線の丸、要手続き＝三角、手続き済み（条件付き）＝中抜きの丸にチェック、手続き不要＝塗りの丸、判定不能＝破線の枠と「？」）にする。
   - (b) 結論は一行の札にとどめ、その下の手続きの段取り表（期限順）を主役にする。
   - (c) 信号機の 3 灯を残し、言葉と記号を添える。
   - 推奨：**(a) と (b) の組み合わせ**。3 灯は 4 段＋判定不能に数が合わず、「手続き済み（条件付き）」と「手続き不要」がどちらも緑になって区別しにくい。判定の問いが「何をいつまでに」に変わったため、段取り表を主役にした方が問いに合う。記号の具体は designer が紙面調に合わせて決める。
2. **旧値 `mlit` の読み替え**。推奨：DID 上空の許可として読む（Sprint 11c までの説明「航空法 DID」と動きに合わせる）。夜間・目視外などには当てない。
3. **目的による例外（緊急・公務・市の行事）の扱い**。推奨：手続き済み（条件付き）とする（自己申告のため、手続き不要にはしない）。
4. **飛行ごとの義務（飛行計画の通報・飛行日誌）を段階に入れるか**。推奨：入れない。段階は事前の許可・承認・同意で決め、飛行ごとの義務は「飛行の前後に必ず行うこと」として常に並べる（入れると、特定飛行は常に要手続きになり、手続き済み（条件付き）が出なくなる）。
5. **画面の結論に使う判定**。推奨：`/api/diagnose` の判定（飛行の方法を含む）を結論に使い、届くまでは「判定中」とする。`/api/check` の判定（地点だけ）は evidence_log と履歴の地点の判定に使う。
6. **`ENGINE_VERSION` の名前**。推奨：`soraban-0.4.0-verdict-<実装月>`。
