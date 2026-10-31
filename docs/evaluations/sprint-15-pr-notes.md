# Sprint 15 の PR の説明（generator）

> 対象：`docs/sprints/sprint-15.md`（末尾の追加 R-1・U-2 を含む）。ブランチ `claude/vigilant-fermi-g54nho`（基準 `3e3d2c0`）。PR は作っていない（契約 H-4・F-3 の「PR の説明」をここに置く）。

## Next.js 16.2.4 の記述で確かめたこと（H-4）

| 記述 | 確かめた内容 | 採った方法 |
|---|---|---|
| `01-app/02-guides/progressive-web-apps.md` | マニフェストは `app/manifest.ts`、Service Worker は `public/sw.js` を `navigator.serviceWorker.register` で登録する例。`sw.js` には `Cache-Control: no-cache`・CSP を付ける例。オフラインは Serwist の紹介（webpack 前提） | Serwist は使わず、ルートハンドラ `/ops/sw.js` が本体を返す（`OPS_ENABLED` の関所を proxy.ts に任せるため）。`no-cache`・CSP・`Service-Worker-Allowed: /ops` を付ける |
| `03-file-conventions/01-metadata/manifest.md` | `app/manifest.(json\|ts)` は **app の根** に置く規約（＝公開の `/` にも `<link rel="manifest">` が付く） | 使わない。`/ops/manifest.webmanifest`（ルートハンドラ）を作り、`app/ops/layout.tsx` の `metadata.manifest` で `/ops` の画面にだけ付ける |
| `04-functions/generate-metadata.md`・`generate-viewport.md` | `manifest`・`appleWebApp`・`icons.apple` は metadata、`themeColor` は viewport | `/ops` の layout に追加 |
| `05-config/01-next-config-js/env.md` | `env` はビルド時に束へ埋め込む（legacy の記述だが現行で有効） | ビルドの識別子 `SORABAN_BUILD_ID` を埋め込み、Service Worker の版と、画面と API の版の食い違いの検出に使う |

## 設計の要点

- **Service Worker**（`lib/pwa.ts`）：scope は `/ops`（公開の `/` は対象外）。キャッシュは許可リストだけ：圏外用の枠 `/ops/offline/{field,inspection,journal,today,unavailable}`（**Cookie なしで取得**するので利用者のデータが入らない）と静的ファイル（`/_next/static/*`・`/fonts/*`・`/pwa/*`・`/icon.svg`）。`/api/**`・`/ops/sign-in` は扱わない。画面の移動は通信を先に試し、通信できないときだけ行き先に応じた枠を返す。新しい版はインストール後に**待機**し、利用者が「更新する」を押したとき（`SKIP_WAITING`）か、次に開いたときに切り替わる。背景同期は使わない。
- **圏外用の枠**（`components/ops/offline-shells.tsx`）：URL は元の行き先のまま（`/ops/plans/<id>/field` など）。枠の中で、端末の先読みの束（IndexedDB）と送信待ち（localStorage）から画面を組み立てる。点検・日誌は送信待ちに入れる。
- **判定の同一性（B-5）**：`server/ops/field-compose.ts` の `composeFieldView` を、サーバーの `getFieldView` と圏外の端末の両方が通る（サーバーも「束を作ってから組み立てる」形にした）。
- **先読みの束**：`GET /api/ops/field-bundle`（今日・明日の、利用者が操縦者の計画）と `?planId=`（運航管理者と計画の操縦者本人。他は 403、他の組織は 404、未ログインは 401）。ホームと現場画面を開いたときに取り直す。
- **状態の帯（C-4）**：現場画面の上に固定（`position: sticky`）。接続あり／接続なし（圏外）・送信待ち N 件・最後に保存・先読みの最終更新を文字で出す。帯には押す部品を置かない（スクロールした操作の上に重ならない）。「いま送る」は帯の下の送信の状況に置く。見た目（色・余白）は 12h ④の担当。
- **再送（設計 6）**：画面が前面にあるとき（15 秒ごと）、`online` の 1 秒後（電波が戻った直後の揺れを避ける。その間に圏外に戻れば送らない）、画面を開いたとき、「いま送る」。同じ計画の送信は同時に 1 つ（既存）。
- **古さの基準（B-3）**：12 時間。朝に事務所で開いて夕方まで現場で使う 1 日（約 10 時間）では注記を出さず、前日以前の束には出す。最終更新の時刻は常に帯に出す。
- **離陸の記録に先読みの時刻を残すか**（未確認・リスクの提案）：今回は残さない（14 の `gaps` の形を変えない）。圏外の離陸は `queued` の印で後から分かる。必要なら別の列で足すことを提案する。
- **R-1**：日常点検の作成で `planId` を受け、点検の保存と同じトランザクションで、計画の現場の記録に「点検の結び付き」（`kind=check`・`item=inspection`・`inspection_id`。0014 から許されている形）を追記する。飛行後点検は、結び付きがあり取り消されていない点検だけを、その計画の「済」に数える。**結び付きのない既存の点検は満たした扱いにしない。** 計画の機体と違う機体・中止した計画には結び付けない（点検は保存される）。
- **U-2**：書類の通報の根拠に「通報日時（DIPS での通報。利用者の入力）」と「そらばんへの記録」の時刻の両方を出す。記録が離陸より後なら注記で理由を出す。通報の記録が無い計画では、飛行前に「通報は、離陸の前にそらばんへ記録してください」を出す。判定（要確認）と離陸の未了は変えない。

## 保存先の選択（設計 4）

- 先読みの束：**IndexedDB**（`soraban-ops` / `field-bundles`、キー `<利用者の ID>:<計画の ID>`）。使えなければメモリ。
- 送信待ち：**localStorage のまま**（12c のキー `soraban:ops-draft:field-<計画>:<利用者>`・形式 `v: 1` を維持し、種別 `inspection`・`journal` と、識別子の対応 `ids` を足しただけ）。理由：押した瞬間に同期で書ける（タップの直後に画面を閉じても残る）、既存の行を移行せずに読める（E-8 の単体・E2E）、行は小さい。

## 端末に保存するもの（F-3）と消えるタイミング

| 保存先 | 中身 | 個人情報 | 消えるとき |
|---|---|---|---|
| IndexedDB（先読み） | 計画の要約（日時・場所名・機体の記号と型式・**操縦者の氏名**・特定飛行の形態）、許可の番号・期間・照合の要約、通報の状態・受付番号・日時、機体の状態、操縦者の技能証明の有効期限と限定の有無、現場の行（備考なし）、直近の点検の結果、計画の版 | **技能証明書の番号・座標・自由記述（目的・備考・特記事項）・他の人の計画・判定の全文は入れない**（`sanitizeFieldBundle` の許可リストと単体・DB・E2E で固定）。操縦者の氏名は、契約の設計の判断 3（含めるもの「操縦者」）に従い入れる | ログアウト、別の利用者のログイン |
| localStorage（送信待ち） | 計画の ID（キー）・種別・時刻・識別子・確認の項目・現場状況の選択と数値、点検の 9 項目の結果、日誌の離着陸の時刻・離陸と点検の識別子、機体・操縦者の ID | 自由記述は **点検の「異常」の項目の備考と、日誌の「安全に影響のあった事項」の内容だけ**（契約 D-5 の推奨の方式、500 文字まで）。氏名・技能証明書番号・座標・場所名・目的は入れない（送るときにサーバーが計画から補う `fillFromPlan`） | 送れたとき・破棄したとき。ログアウト（「送信待ちを残してログアウト」を選んだ場合は残る）。別の利用者のログイン |
| localStorage（その他） | `soraban:ops-current-member`（利用者の内部 ID だけ）、`soraban:ops-draft:fieldmeta:<利用者>`（最後に保存・送信した時刻） | なし | ログアウト・別の利用者のログイン |
| Cache Storage | 圏外用の枠と静的ファイル | なし（Cookie なしで取得） | 新しい版に切り替わったとき（古い版を消す） |

## マイグレーション

足していない（0001〜0017 のまま）。R-1 は 0014 の `flight_field_events`（`check`・`inspection`・`inspection_id`）で足りた。

## 変えた既存のテストと理由

| テスト | 変更 | 理由 |
|---|---|---|
| `field-logic.test.ts`（飛行後点検の導出 2 件） | 飛行後点検の入力に、計画への結び付きの行を足した | R-1：結び付きのない点検は「済」にしない（意図の変更）。結び付きの無い場合を新しいテストで固定 |
| `field.db.test.ts` D-9 | 飛行後点検の作成に `planId` を渡す | 同上 |
| `sprint14-db.spec.ts` D-7 | 飛行後点検の作成（API）に `planId` を渡す | 同上（画面から開いたときと同じ） |
| `playwright.ops.config.ts` | 既定を `serviceWorkers: "block"` に | 既存の E2E は Service Worker の無い前提（`page.route` で応答を作る、圏外で画面の読み込みが失敗する）。Sprint 14 までと同じ条件で動かす。Sprint 15 の E2E だけ `allow` |
| `FIELD_OFFLINE_SCOPE_NOTE` の文言 | 「画面そのものを圏外で開くことはできません」を外した | 圏外で開けるようになったため（E2E はこの文言を検査していない） |

寸法・`data-testid` の検査は弱めていない。

## Service Worker と E2E

- Service Worker は本番のビルド（`next start`）でだけ登録する（`next dev` では登録しない）。`pnpm test:e2e:ops` は `next start` なので効く。
- Playwright の `context.setOffline(true)` の下で、Service Worker が受け持っている画面の再読み込み・移動は Service Worker を通る。**受け持つ前（最初の登録の直後）の再読み込みは通らない**ため、E2E は `navigator.serviceWorker.controller` を待ってから圏外にする。

## 確認していないこと

- 実機（G-1〜G-3）。とくに iOS の端末の保存の消去条件（ホーム画面に追加していない場合、長く開かなかった場合。※要再確認）。消える環境でも記録を失わないよう、画面に「電波のある場所で、送信待ちが 0 件になってから帰ってください」を出している。
- 背景同期・プッシュ通知（範囲外）。CI と同じ PostgreSQL 18（ローカルは 16）。
- HTTPS 以外での登録（E2E は `127.0.0.1` で、ブラウザが安全な接続とみなす）。

## 再評価の差し戻し（リトライ 1/3）での変更

- **BUG-1**：`createInspection` は、`planId` を指定した点検に、現場の記録と同じ権限 `field.record`（運航管理者、または計画の操縦者本人）を求める。無ければ 403 で、点検も結び付きも残さない（点検の保存と結び付けは同じトランザクションのまま）。画面（`/ops/inspections/new?planId=…`）からも 403 の誤りが出る。圏外の点検の枠も、記録できない計画では入力させない。
- **BUG-2**：利用者の上のバーの関所（`OpsTopBarGate`。ログイン中のすべての `/ops` の画面で描かれる）で `DraftOwnerGuard` を走らせる。前の利用者の下書き・送信待ち・先読みの束を消し、「いまの利用者」を書き換える。
- **飛行前点検の結び付け**（オーケストレーターの判断。`sprint-15.md` の追加節）：確認項目の日常点検と、日誌への引き継ぎ（`preInspectionId`）も、結び付きのある点検だけを数える。ラウンドの導出は変えていない。
- **ホームの文字**：先読みの件数・ホーム画面への追加の案内を 16px に。
- **水和の誤り #418**：Service Worker は圏外の現場の枠を現場の URL で返す。サーバーで描いた枠（`/ops/offline/field`）では「本文へ移動」のリンクがあり、ブラウザ（`/ops/plans/<id>/field`）では無いため食い違っていた。`/ops/offline/field` もメニューを出さない画面にした。E2E で圏外の画面の誤りが 0 であることを確かめる。残る食い違い：事故・ヒヤリハットの簡易記録の URL（`…/field/incident`）を圏外で開いたときの「圏外の案内」の枠は同じ理由で食い違う（表示には支障なし）。
- **先読みの束の取り残し**：ホームで取り直すとき、端末にある束の計画も送る。サーバーは、まだ使えるもの（記録できる・中止していない・今日以降）だけを返し、返らなかった束は端末が消す（送信待ちのある計画は残す）。

### 変えた既存のテスト（追加分）

| テスト | 変更 | 理由 |
|---|---|---|
| `field-logic.test.ts`・`today-logic.test.ts` | 補助の関数が、点検に結び付きの行を足す。結び付きの有無を確かめるテストは `{ link: false }` で足さない | 飛行前点検も計画に結び付いた点検だけを数える（意図の変更） |
| `field.db.test.ts`（未了事項・現場モードの状態・今日・D-9） | 飛行前点検に `planId` を渡す | 同上 |
| `sprint12c-db`・`sprint14-db`・`sprint12h-pr3-db`・`sprint12h-pr3b1-db` | API で作る飛行前点検に `planId` を渡す | 同上（現場から入れた点検と同じ） |
