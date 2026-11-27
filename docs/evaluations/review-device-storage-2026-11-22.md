# 不変条件 5 の点検: 端末への保存（2026-11-22・reviewer）

- 対象: コミット 956123c 時点の `apps/web`（`git show` / `git grep` で読んだ。変更なし）
- 依頼: 飛行記録・点検・通報の下書き（`drafts.ts`）が、不変条件 5（氏名・技能証明書番号・座標・自由記述を端末に残さない。契約で認めたものを除く）に反していないか
- 状態: **ユーザーの決定済み（2026-11-22）**。修正は Sprint 16 とは別のスプリントとして、planner から計画する

## 結論

- **「違反」0 件。** 座標・自由記述を含む下書き 3 種は、不変条件 5（2026-11-01）より前の契約に保存の許可がある（飛行記録・点検: Sprint 11 設計 E・G、契約 16・20／通報: Sprint 12b）。
- ただし **決定・修正が要る点が 5 件**（F1〜F5）。許可の条件「ログアウトで消す」は明示のログアウトにしか効かず、下書きに期限がない（F1）。点検の下書きの許可は解釈に頼る（F2）。
- 大半は不変条件 5 より前の包括的な許可。今の方針（design-direction の決定、Sprint 16 の K-15・H1-5「新たに書かない」）と揃えるかはユーザーが決める（Sprint 16 §17 申し送り 6）。

## 書き込み箇所の一覧

| # | ファイル | 保存先・キー | 中身（分類） | 書く／消す | 契約の許可 | 判定 |
|---|---|---|---|---|---|---|
| 1 | `components/ops/records-client.tsx`（485-504, 725, 748, 895, 918）、`drafts.ts:13,44` | localStorage `soraban:ops-draft:flight:<memberId>` | 座標 `takeoffPos`・`landingPos`／自由記述 `takeoffPlace`・`landingPlace`・`purpose`・`waypoints`・`safetyIssueDetail`・`defects[].description`・`defects[].action`／氏名 `defects[].confirmerName`／その他 ID・日時など | 入力ごとに書く（新規で計画から来ないとき）。消す: 保存成功・「下書きを消す」・ログアウト・別の利用者。期限なし | あり（sprint-11.md:144, :167、契約 16 :218 は残ることを要求） | 許可済み（条件付き・F1） |
| 2 | `records-client.tsx`（1225-1238, 1350, 1379, 1391, 1444） | localStorage `soraban:ops-draft:inspection:<memberId>` | 座標 `pos`／自由記述 `placeName`・`items[*].note`・`specialNotes`／その他 | 新規のとき入力ごと。消す時機は #1 と同じ | 解釈で許可（sprint-11 設計 E の節。明文は飛行記録の箇条） | 許可済み（解釈・F2） |
| 3 | `components/ops/report-client.tsx`（75-89, 746, 758, 835）、`drafts.ts:18` | localStorage `soraban:ops-draft:report-<planId>:<memberId>` | 自由記述 `reportName`・`otherBusinessText`・`otherNonBusinessText`・`departurePoint`・`destinationPoint`／その他 | 入力後、変わるたびに書く。消す: 記録成功・ログアウト・別の利用者。記録しなければ残る | あり（sprint-12b.md:152, :265） | 許可済み（F3） |
| 4 | `lib/ops-outbox.ts:29-32,509-525`、`components/ops/field-outbox.ts:51-67` | localStorage `soraban:ops-draft:field-<planId>:<memberId>` | 異常項目の備考・日誌 `safetyIssueDetail`（500 字まで）／その他。座標・氏名は `sanitize*` で落とす | 押した時点で書く。送信・破棄で消す。ログアウトで消す。72 時間で送らない | あり（sprint-15.md:103 D-5 ほか） | 許可済み |
| 5 | `field-outbox.ts:97-120` | localStorage `soraban:ops-draft:fieldmeta:<memberId>` | 最終保存時刻のみ | — | 不要 | 対象外 |
| 6 | `lib/incident-outbox.ts` ほか | localStorage `soraban:ops-draft:incident-<planId>:<memberId>` | 区分・時刻・識別子のみ（許可リスト） | — | sprint-12e.md:357 | 対象外 |
| 7 | `components/ops/field-store.ts:8,55-125` | IndexedDB `soraban-ops`/`field-bundles` | 氏名 `plan.pilotName`・`docs.pilot.fullName`／計画名 `plan.title`・`plan.placeName`／その他。証明書番号・座標・備考は落とす | ホームを開いたとき書く。ログアウトで消す | あり（sprint-15.md:38 判断 3）。`title` は明記なし | 許可済み（`title` は F4） |
| 8 | `field-store.ts:127-151` | localStorage `soraban:ops-current-member` | 内部 ID のみ | — | 不要 | 対象外 |
| 9 | `lib/pwa.ts:59-140`、`app/ops/sw.js/route.ts` | Cache `soraban-ops-<version>` | 画面の枠と静的ファイルのみ（`credentials: "omit"`） | — | sprint-15 A-3 | 対象外 |
| 10 | `components/ops/change-notice.tsx:9-45` | sessionStorage `soraban:ops-change-notice` | 定数の文言のみ | 2 分の期限 | 明示なし（個人情報なし） | 対象外 |
| 11 | `lib/history.ts:21-22,133-136,247`（公開の判定画面） | localStorage `soraban:history:v1`（50 件）ほか | 座標 `loc`・住所 `resolvedAddress`／その他 | 判定ごとに書く。利用者の「履歴を消す」だけで消える | 例外の明記なし。存続の決定はあり（sprint-13.md:107, :122, :127、spec.md:301） | 要判断（F5） |

sessionStorage は Sprint 16 の K-15・H1-5 で新規の書き込みが禁止され、§9.2 案 C も退けられているため、不変条件 5 の対象として扱われている。

## 指摘

- **F1（中）** 下書きに期限がない。ログアウトを押さずにタブを閉じる・セッションが切れると、座標・自由記述・確認者の氏名が無期限に残る（`drafts.ts:44-50`、`ops-client.tsx:864-870, 988-995`）。修正: `savedAt` を付け、読み込み時と `DraftOwnerGuard` で期限切れを消す（例: 72 時間）。`savedAt` のない既存の下書きを期限切れとみなせば移行も兼ねる。
- **F2（中・要決定）** 点検の下書きは、送信待ち（D-5: 異常項目の備考だけ）より広い。修正: 9 項目の結果・異常項目の備考・日時・ID だけにする。
- **F3（低）** 通報の下書きがサーバーの初期値の上に重なり、別端末で記録した新しい値を古い下書きが上書きするおそれ（推測・未実行）。
- **F4（低・要決定）** 先読みの束に計画名 `title`（自由入力）が入る。契約に書き足すか外す。
- **F5（低・要決定）** 公開の判定履歴の座標・住所。不変条件 5 の対象外と明記するか、移行後に消すか。

## 修正案と優先度

1. F1: 下書きに期限（影響最小、オフラインの継続を損なわない）
2. 下書きを許可リストに絞る（飛行記録は時刻・ID・選択肢・`safetyIssue` のみ、点検は F2）。トレードオフ: `/ops/flights/new` では下書きが唯一の途中保存。時刻は残せるが、座標・場所名は保存直前に入れ直す。計画からの現場の流れは送信待ちを使うので影響しない
3. 通報の下書き: サーバーに寄せる（新マイグレーション）か、メモリ＋離脱の確認（Sprint 16 §9.2 案 A と同じ）
4. 2・3 をするなら移行処理（新キーにし、`DraftOwnerGuard` で旧キーを消す）

## 影響するテスト

- 単体: `components/ops/drafts.test.ts`、`lib/ops-outbox.test.ts:277` 付近、`lib/incident-outbox.test.ts:149,171`
- E2E-DB: `e2e/ops-db/sprint11-db.spec.ts`（契約 16・17、差し戻し 1・2、20）、`sprint12b-db.spec.ts:381` 付近。キーの接頭辞を変えると `sprint12c`・`sprint12e`・`sprint15` の DB 系にも影響
- F5 を直す場合: `e2e/sprint9.spec.ts`、`sprint11a/c/d/f.spec.ts`、`sprint18-1.spec.ts`、`lib/history.test.ts`、`server/public-face-followup.test.ts:127`

## 決定が要る点

1. Sprint 11・12b の包括的な許可を維持するか（維持なら F1 の期限だけ、維持しないなら 2・3 を別スプリントで）
2. 点検の下書きを D-5 と同じ範囲に揃えるか（F2）
3. 通報の下書きをサーバーに寄せるか、メモリ＋離脱の確認か（F3）
4. 先読みの束の `title` を書き足すか外すか（F4）
5. 公開の判定履歴を対象外と明記するか（F5）

## ユーザーの決定（2026-11-22）

1. 飛行記録・点検の下書きは **許可リストに絞り、期限を付ける**。残すのは時刻・ID・選択肢・点検の結果・異常の項目の備考だけ（F2 を含む）。座標・場所名・自由記述・確認者の氏名は残さない。期限は 72 時間。旧形式の下書きは消す（移行の処理）
2. 通報の下書きは **メモリ＋離脱の確認** にし、端末に残さない（Sprint 16 §9.2 案 A と同じ）。旧キーは消す
3. 先読みの束から **計画名 `title` を外す**（圏外の画面は場所名・日時で見分ける）
4. 公開の判定履歴は **不変条件 5 の対象外と明記** し、現状を維持する（ログインしない人が自分で残し、自分で消せる履歴）
