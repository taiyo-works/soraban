> ユーザー（のりさん）が別の調査で作成して提供した、DIPS2.0 API の精読メモ（2026-10-13 作成、2026-10-21 受領）。**外部の調査で、当方は原本と照合していない。** 原本との照合結果は `dips-fpr-guideline-findings.md` を参照（固定 IP の記載など、食い違う点がある）。

# DIPS2.0 API 精読ノート（FPR＝飛行計画通報／FPA＝飛行許可・承認申請）

- 作成: 2026-10-13 JST。**ガイドライン本文に書かれていることだけ**を記載。書かれていない点は「不明」とした。
- 出典:
  - **[FPR]** DIPS2.0 API（飛行計画通報）接続システム向けガイドライン **v1.10（2026/8/26改訂、全75頁）** https://www.ossportal.dips.mlit.go.jp/guide/fiss/DIPS2.0_API%EF%BC%88FPR%EF%BC%89_Guideline.pdf
  - **[FPA]** DIPS2.0 API（飛行許可・承認申請）接続システム向けガイドライン **v1.5（2026/8/26）** https://www.ossportal.dips.mlit.go.jp/guide/dips/DIPS2.0_API%EF%BC%88FPA%EF%BC%89_Guideline_v1.5.pdf
  - 掲載ページ: https://www.ossportal.dips.mlit.go.jp/portal/manual/ ／ https://www.mlit.go.jp/koku/koku_ua_dips.html
- 頁番号はPDF下部の印字ページ。

## 1. 利用開始手続き
| 項目 | 内容 | 出典 |
|---|---|---|
| 前提 | DIPS2.0利用規約に同意。**クライアントIDが必要** | FPA p4 §1.2 / FPR §1.2 |
| 申請 | 「DIPS2.0 API利用申請書」をメールで提出（国交省 航空局 安全部 無人航空機安全課 hqt-jcab.mujin@ki.mlit.go.jp）→確認後メールでクライアントID通知。**最大1か月程度** | FPA p4 §1.3 / FPR §1.3 |
| 検証環境 | 利用申請書の提出で利用可。ドメイン 本番`www.uafpi.dips.mlit.go.jp`／検証`www.stg.uafpi.dips.mlit.go.jp`（FPR） | FPR p64 §3.1 |
| 制限 | **本番環境で性能負荷試験・異常系試験など本番運用に影響する作業は禁止** | FPR p64 §3.1 |
| 検証の進め方 | 検証環境→本番の順。確認ポイントは「DIPS2.0 API設定通知書」に記載（**この通知書の中身は公開資料に無く不明**） | FPR p65-67 §3.2-3.3 |
| 料金・利用件数制限・SLA | **記載なし（不明）** | — |

## 2. OIDC 認証フロー（Authorization Code Flow）
| 手順 | 内容 | 出典 |
|---|---|---|
| 方式 | OpenID Connect **Authorization Code Flow**。OP=DIPS、RP=接続システム。**パスワード認証**が要求されることを検証項目で確認 | FPR p8,p11,p66 |
| Realm | **FPRは`drs-fpl`、FPAは`drs-req`で別realm**（iss: `https://www.dips-reg.mlit.go.jp/auth/realms/drs-fpl` / `.../drs-req`）。→ 通報と許可申請は別の認可・トークン管理が必要と読める。クライアントIDが共通か別かは**不明** | FPR p25 / FPA p26 |
| 認可EP | GET `https://www.dips-reg.mlit.go.jp/auth/realms/drs-fpl/protocol/openid-connect/auth`（検証: `https://www.stg.uafp.dips.mlit.go.jp/auth/realms/drs-fpl/...`） | FPR p12 |
| パラメータ | `response_type=code`(固定)、`client_id`、`redirect_uri`(RP毎に事前定義)、`scope=openid offline_access`(固定)、`state`(必須)、`ui_locales`(ja/en 任意) | FPR p13 |
| PKCE / nonce | **PKCE(code_challenge)の記載なし**。nonceはid_tokenペイロードに含まれる旨の記述のみ（送信必須かは記載なし＝不明） | FPR p25 |
| コールバック | `code`、`state`。**stateが一致しない場合はCSRFの可能性** | FPR p15,p17 |
| 認可エラー | 一部エラーは redirect_uri へ `error`/`error_description`/`state`。例 `unsupported_response_type`。それ以外はDIPSのシステムエラー画面、メンテ時はメンテ画面に遷移 | FPR p15-16 |
| トークンEP | POST `.../protocol/openid-connect/token`、`application/x-www-form-urlencoded`。`grant_type=authorization_code`、`client_id`、**`client_secret`**、code、redirect_uri → access_token, refresh_token, id_token, `expires_in`, `refresh_expires_in` | FPR p18-19 |
| 有効時間 | サンプル値 `expires_in:300`, `refresh_expires_in:3600`（**サンプルであり保証値かは不明**） | FPR p19 |
| リフレッシュ | `grant_type=refresh_token` + client_secret | FPR p21-22 |
| トークンエラー | `unauthorized_client`(400: client_id/secret不正)、`invalid_request`(400: grant_type不正)。API呼出時 `invalid_token`(401: 不正・期限切れ・無効) | FPR p20,p24 |
| UserInfo | GET `.../openid-connect/userinfo`、Bearer。返却属性の詳細は FPR p24 | FPR p24 |
| id_token検証 | iss一致、aud=client_id、exp>現在、auth_timeが古すぎないか（許容幅はRP判断） | FPR p25-26 |

**設計含意**: client_secret を使うためトークン交換は**サーバ側**で行う（ブラウザに秘密を置かない）。refresh_tokenの寿命が短い（サンプル1時間）ため、「送信直前に本人がDIPSに再ログイン」するUXが前提になり得る＝本人確認送信と整合。

## 3. FPR API一覧
| API | メソッド/URL(本番) | 概要 | 出典 |
|---|---|---|---|
| 飛行計画情報取得 | POST `https://www.uafpi.dips.mlit.go.jp/api/flight-plan/search` | 公開されている飛行計画＋認証された通報者自身の計画 | p27- |
| 飛行禁止エリア情報取得 | POST `https://www.uafpi.dips.mlit.go.jp/api/flight-prohibited-area/search` | 公開されている飛行禁止エリア | p40- |
| 飛行計画通報受付 | POST `https://www.uafpi.dips.mlit.go.jp/api/flight-plan/register` | 認証された申請者の通報（新規/更新） | p46- |
| **通報の取消・削除** | — | **ガイドラインに記載なし（不明）** | — |

### 3.1 他者の飛行計画（飛行計画情報取得）
- 検索: `features`(Circle: center[経度,緯度]+radius(m) ／ Polygon: 3点以上)、`allFlightPlan`("1"=自アカウントのみ/"0"=全ユーザー、省略時は全ユーザー)、`startTime`/`finishTime`(`yyyyMMdd HHmm`、**開始から24時間以内**、省略時当日0:00〜23:59)、`updateTime`。(p28-29)
- **他者の計画で取得できる項目（「○」）**: 飛行計画ID、飛行開始/終了日時、航続可能時間、所要時間、飛行速度、高度、飛行経路(ジオメトリ)、総件数。
- **自アカウントのみ（「●」）**: 名称、目的、空域/方法、補助者数、出発地/目的地、立入管理措置、保険、通報者・操縦者・機体・許可承認・各連絡先。(p30-36、凡例 p36「○：全ユーザの飛行計画において出力、●：自アカウントの飛行計画のみ出力」)
- → 他者の個人情報（氏名・連絡先）は返らない。

### 3.2 飛行禁止エリア（飛行禁止エリア情報取得）
- 種別ID: **1 空港等の周辺空域／2 人口集中地区／5 小型無人機等飛行禁止法(レッドゾーン)／6 同(イエローゾーン)／7 条例等で定めるエリア／8 有人機離着陸エリア／9 緊急時用務空域／10 その他1／11 その他2**（3・4は欠番。改訂履歴に試験飛行届出エリア・リモートID適用除外空域の削除記載）(p41,p43, 改訂履歴p1)
- 返却: ID、名称、範囲ジオメトリ、説明詳細、説明URL、種別、有効期限FROM/TO(`yyyy-MM-ddTHH:mm:ss`)、総件数。(p42-43)
- 注: 空港等周辺空域は**地理院タイルのズームレベル単位でポリゴン分割**されて返る場合あり。(p44)
- → **緊急用務空域・条例エリアもAPIで取得可能**。ただし「条例等(7)」にどの自治体条例が登録されているかの網羅性は**不明**。

### 3.3 飛行計画通報 入力項目（`flightPlanInfo`）
凡例: ○必須／△条件付き必須／－任意（p46-56）

| 区分 | 項目（パラメータ） | 必須 | 制約・備考 |
|---|---|---|---|
| 基本 | 飛行計画ID `flightPlanId` | △ | 更新時必須 |
| | 飛行計画名称 `name` | ○ | 最大30文字 |
| | 飛行目的 `flightPurpose`[] | ○ | 1空撮 2報道取材 3警備 4農林水産業 5測量 6環境調査 7設備メンテナンス 8インフラ点検・保守 9資材管理 10輸送・宅配 11自然観測 12事故・災害対応等 13その他1(業務) 14趣味 15研究開発 16その他2(業務以外) |
| | その他1/2理由 `othergyomutext`/`othergyomugaitext` | △ | 13/16選択時 |
| 特定飛行 | 飛行空域 `flightAirspace`[] | － | 1 DID上空 2 150m以上 3 空港周辺 |
| | 飛行方法 `flightType`[] | － | 1 人・物件30m未満 2 催し物上空 3 夜間 4 目視外 5 危険物 6 物件投下 |
| 運航 | 補助者数 `assistantsNumber` | ○ | 無しは0 |
| | 出発地 `departurePoint` / 目的地 `destinationPoint` | ○ | 地名等 |
| | 飛行開始日時 `startTime` | ○ | `yyyyMMdd HHmm`。終了は所要時間から計算 |
| | 航続可能時間 `plannedMaxTime` | ○ | 分、5分単位 5〜1440 |
| | 所要時間 `plannedFlightTime` | ○ | 分、5分単位 5〜1440 |
| | 飛行速度 `flightSpeed` | ○ | km/h 1〜999（多用速度又は最大GS） |
| | 飛行高度 `flightAltitude` | ○ | m(AGL) 1〜999 |
| | 飛行の経路 `flyRoute` | ○ | **GeoJSON文字列（"をエスケープ）**。Circle(center+radius) または Polygon(3点以上) |
| 安全措置 | 立入管理措置 `riskMitigationOnsiteControl` | ○ | "1"/"0" |
| | 同 レベル3 `...L3` / レベル3.5関連 `...L35` | ○ | "1"/"0" |
| | 立入禁止措置 `riskMitigationOnsiteControl2` | ○ | "1"/"0" |
| | 係留飛行 `exceptionalConditionsMooring` | ○ | "1"/"0" |
| 保険 | `insuranceInformation`（会社名、商品名、対人・対物補償額(無制限=-1)、賠償能力"0/1"） | △ | **許可・承認情報を設定する場合は必須** |
| 通報者 | `reporter`: 連絡先フラグ、氏名、国コード、都道府県コード、住所(市町村)、電話国コード、電話、メール | ○ | 通報者・操縦者・許可承認の**いずれか1つの連絡先フラグ="1"** |
| | その他特記事項 `otherInformation` | － | |
| 操縦者 | `pilotInfo`[]: 連絡先一式、技能証明書番号(－)、一等/二等(○)、技能認証保有状況(○、**2025/12制度改正で将来廃止予定**)、代表機体の製造者名・型式(○) | ○ | |
| 機体 | `aircraftInfo`[]: 種類(1飛行機 2ヘリ 3マルチローター 4回転翼その他 5滑空機 6飛行船)、機体認証書番号(－)、**登録記号**(○)、型式、製造者、第一種/第二種機体認証(○)、**総重量kg**(○、困難なら最大離陸重量) | ○ | |
| 許可承認 | `flightPermitApplicationInfo`: 許可・承認番号、許可書発行日、許可期間(自/至)、連絡先 | △ | **許可・承認を必要とする飛行の場合は必須** |
| 重複 | 重複計画情報取得フラグ `getDuplicateFlightPlanFlag` | △ | "1"で重複計画詳細を取得 |

- コード表: 国コード（別紙1、日本=001）、都道府県コード（別紙2）。(p68-)
- 他システムからの自動入力に適する項目: 経路・高度・日時（そらばんの判定入力）、機体・操縦者（台帳）、許可承認（FPA許可情報取得から）。**目的・特定飛行区分・安全措置・保険は利用者が選択**する設計とする（前回仕様の法的方針）。

### 3.4 通報レスポンス
- 正常: 飛行計画ID、登録結果、受付日時(`yyyy/MM/dd HH:mm`)、**他飛行経路との重複件数 `existOtherFlightRoutesCount`**、フラグ"1"時に重複計画詳細（10件以内は詳細、11件以上は件数のみ。詳細は計画ID・**連絡先メール**・開始/終了・経路）。(p58-62)
- 重複時の調整機能: DIPS画面上の調整メッセージ機能あり（API経由で調整できるかは**記載なし＝不明**）。https://www.mlit.go.jp/common/001732680.pdf
- エラー: HTTP 400（パラメータ不正）/500（システムエラー）、body `{"errorMessage": "..."}`。(p63)。項目別エラーコード表はFPRには**無し**（FPAには「別紙1 入力項目に関するエラーコード」あり）。

## 4. FPA（許可・承認）で取得できる内容
- 認可realm `drs-req`、scope `openid offline_access`(リクエスト)。(FPA p11-13)
- 許可・承認情報取得 GET `https://www.uafp.dips.mlit.go.jp/req-pub/api/v1/appliers/me/permissions`（FPA p27）: 許可番号/許可番号2、申請受付番号、許可日、許可期間(自/至)、飛行場所(≤600字)、飛行経路(0〜5件、名称・緯度経度)、特定飛行の該当（DID・150m以上・空港周辺・催し物・夜間・目視外・危険物・物件投下 等 true/false）、機体情報(1〜300件: 製造者、型式、登録記号 等)。(FPA p27-31)
- 提供条件: 認証IDに紐づき、**許可期間(至)が過去日でないもの**。経路緯度経度はDIPS地図で矩形指定した場合のみ。(FPA p5)
- 申請受付 POST `.../permissionRegister`: **飛行経路の特定や添付資料の提出が不要な飛行のみ**。(FPA p6, p32-)
- 飛行計画通報の `flightPermitApplicationInfo` へ、取得した許可番号・期間を流用可能（そらばん側の設計）。

## 5. 不明点（航空局へ確認）
1. 通報の取消・削除API（無ければDIPS画面で取消）。
2. 「DIPS2.0 API設定通知書」の確認ポイント内容。
3. FPRとFPAでクライアントIDは共通か別か。redirect_uri は複数登録可か。
4. トークン有効時間はサンプル値（300秒/3600秒）通りか、変更可能か。PKCE対応の有無。
5. レート制限・利用料・障害時連絡・SLA。
6. 飛行禁止エリア種別7「条例等」の登録範囲・更新頻度。
7. 重複計画の調整をAPIで行えるか。
8. SaaS（複数事業者へ提供）としての利用申請の書き方・制約。
