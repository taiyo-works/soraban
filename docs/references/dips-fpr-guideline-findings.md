# DIPS2.0 API（飛行計画通報）接続システム向けガイドライン 調査結果

対象: ca79887c-DIPS2.0_API_FPR__Guideline.pdf（全75頁、1〜15 / 16〜30 / 31〜45 / 46〜60 / 61〜75 を全頁読了）
頁番号は PDF 内の印字ページ番号（PDF の頁位置と一致。表紙=1頁、番号印字なし）。
本文に書かれたことのみ記載。書かれていない事項は「記載なし」。

---

## 1. 版・改訂日・改訂履歴（p1-3）

- 表題: 「DIPS2.0 API（飛行計画通報）接続システム向けガイドライン」 国土交通省 航空局 安全部（p1）
- 版: 1.10 版 / 2026年8月26日（p1、p2 の履歴最終行も 1.10 / 2026/8/26）
- 改訂履歴（p2-3）

| 版 | 日付 | 章 | 内容要点 |
|---|---|---|---|
| 1.0 | 2023/1/10 | 全体 | 新規作成 |
| 1.1 | 2023/2/14 | 2.3.6〜8, 3.1 | 検証環境の API パスを修正 |
| 1.2 | 2023/5/29 | 2.3.3(2), 2.3.7 | リフレッシュトークンの使い方の記載拡充。飛行禁止エリア種別に 1.空港等の周辺空域、2.人口集中地区 を追加。種別 3:試験飛行届出エリア、4:リモートID適用除外空域エリア の記載を削除（誤記修正） |
| 1.3 | 2023/8/28 | 2.3.6, 2.3.8 | パラメータ名称修正、追加・削除、項番修正、階層構造修正、リクエストサンプル追加修正（ジオメトリタイプ別） |
| 1.4 | 2023/11/27 | 2.3.8 | パラメータ値域修正（飛行速度、飛行高度） |
| 1.5 | 2024/3/26 | 2.3.6, 2.3.8 | リクエストサンプル修正（finishTime）。API拡張対応: リクエスト項目「重複計画情報取得フラグ」追加、対応するレスポンス項目・サンプル追加 |
| 1.6 | 2024/9/30 | 1.2, 1.3, 2.3.7, 2.3.8 | 利用規約リンク変更、Email ドメイン変更、空港等の周辺空域の分割について注釈追記、飛行の経路の備考欄修正 |
| 1.7 | 2024/12/16 | 2.3.6, 2.3.8 | 「立入管理措置（レベル3.5飛行関連）」のリクエスト/レスポンス項目追加、サンプル追加、項目名修正 |
| 1.8 | 2025/12/18 | 2.3.6, 2.3.8 | 「技能認証保有状況」の備考欄修正 |
| 1.9 | 2026/3/23 | 2.3.6 | レスポンスボディサンプル（検索結果0件）修正 |
| 1.10 | 2026/8/26 | 全体, 2.3.6, 2.3.7, 2.3.8 | 体裁修正・軽微な誤記修正、JSON記載形式修正。2.3.6: 飛行開始日時/飛行終了日時/総件数のデータ型修正、補定情報削除、insuranceSupplement サンプル削除。2.3.7: 有効期限(FROM/TO)のデータ型修正。2.3.8: リクエスト「飛行開始日時」データ型修正、「重複計画情報取得フラグ」の階層構造修正、レスポンス各備考欄・「他飛行経路と重複している件数」データ型修正、サンプル修正（flightPlanId, flightPlanRegistrationResult, existOtherFlightRoutesCount, radius）等 |

- 目次（p4）: 1章 概要、2章 提供機能（2.3.1〜2.3.8）、3章 リリースに向けた作業、別紙1 国コード、別紙2 都道府県コード。

## 2. 利用開始手続き（p5, p64-66）

- 前提（p5, 1.2）: 「DIPS2.0 の利用規約」に同意の上で利用。利用にはクライアントIDが必要。持っていない場合は発行手続き。利用規約URL: https://www.ossportal.dips.mlit.go.jp/contents/portal/termsDetails.html
- クライアントID発行手続き（p5, 1.3）:
  - 「DIPS2.0 API 利用申請書」に記入し、申請窓口へ電子メールで提出。
  - 申請情報の確認完了後、電子メールでクライアントIDを通知。
  - 申請からお知らせまで「最大1か月程度」要することがある（余裕をもって申請）。
  - 申請内容に関する問い合わせをすることがある。
  - 申請窓口: 国土交通省 航空局 安全部 無人航空機安全課 / Email: hqt-jcab.mujin@ki.mlit.go.jp
  - 申請書様式: https://www.ossportal.dips.mlit.go.jp/guide/fiss/DIPS2.0_API_Application_Forms.xlsx
  - 申請書の記入項目の内容は本文に記載なし（xlsx 側）。
- 環境（p64, 3.1）: ドメイン部分 本番 www.uafpi.dips.mlit.go.jp / 検証 www.stg.uafpi.dips.mlit.go.jp。環境利用方法=「DIPS2.0 API 利用申請書を DIPS2.0 API 申請窓口へ提出する」。
- 検証の流れ（p65, 3.2 フロー図）:
  - 検証環境: 接続システム担当者が RP 追加に関するドキュメント（接続システム向けガイドライン、利用申請書、利用規約・プライバシーポリシー）をダウンロード → 利用申請 → DIPS側が申請書受領（検証環境用）→ クライアントID発行通知（検証環境用、「DIPS2.0 API 設定通知書」）→ 検証環境動作確認 → 検証環境動作確認完了報告 → DIPS側受領。
  - 本番環境: DIPS側からクライアントID発行通知（本番環境用、設定通知書）→ 本番環境動作確認 → 本番環境動作確認完了報告 → DIPS側受領。
- 検証での確認ポイント（p66-67, 3.3）: OIDC（ユーザー認可: リダイレクト成功、state一致／トークン取得: 認可コードでアクセストークン取得可、id_token検証／属性取得: アクセストークンで取得可）、認証時にパスワード認証が要求されること、各API（飛行計画情報取得・飛行禁止エリア情報取得・飛行計画通報受付）のリクエスト／レスポンスボディは「DIPS2.0 API 設定通知書に記載された確認ポイントに従って動作確認すること」（具体内容は本書に記載なし）。
- 利用期間・有効期限（クライアントIDの有効期間、更新手続き、料金）: 記載なし。

## 3. 接続元の制限（固定IP・IP制限・ホワイトリスト・TLS・証明書）

- 固定IP、IPアドレス制限、ホワイトリスト、接続元IP登録、クライアント証明書（mTLS）、サーバー証明書の指定、TLSバージョン指定、暗号スイート: 本書全75頁を通じて **記載なし**。
- 申請書の記載事項にIPアドレスが含まれるか: 本文に記載なし（申請書xlsxの中身は本書外）。
- 関連する記述として確認できたのは次のみ:
  - 全エンドポイントURLが https:// である（p12, p18, p24, p27, p40, p46）。
  - RP登録情報としてクライアントIDと redirect_uri が「RP毎に予め定義する」（p13, p18）。
  - トークン取得は「サーバー間通信で行う」（p9 図の注記⑧「アクセストークン、属性情報(UserInfo)の取得をサーバー間通信で行う」）。
  - client_secret をトークンリクエストに含める（p18, p21）。
- ブラウザの同一セッションで認証済みなら認証画面をスキップ（p9, p12）。

## 4. 認証（OpenID Connect）（p8-26）

- 方式（p8）: パスワード認証。認証結果を OpenID Connect の **Authorization Code Flow** で接続システムに提供。接続システム=RP、DIPS2.0=OP（p9, p11）。
- 流れ（p9-10, p12）: ユーザーがRPにアクセス → RPがOP の Authorization エンドポイントへ認証リクエスト（state生成）→ DIPS2.0 の ID/パスワード入力画面（ログインID・パスワード、「同意して連携」ボタン、p14）→ 認可コード+state+session_state を redirect_uri へリダイレクト → RPが state検証 → Token エンドポイントへ認可コード送信 → access_token / refresh_token / id_token 取得、id_token検証 → UserInfo エンドポイント（属性取得）→ DIPS2.0 API 呼出（access_token）。
- ログインID/パスワードは DIPS2.0 のアカウント（RP側ではなくOPの画面に入力）（p6, p14）。
- エンドポイント（原文どおり。環境ごとに切替、p12, 18, 21, 24）

| 用途 | メソッド | 本番 | 検証 |
|---|---|---|---|
| Authorization（p12） | GET | https://www.dips-reg.mlit.go.jp/auth/realms/drs-fpl/protocol/openid-connect/auth | https://www.stg.uafp.dips.mlit.go.jp/auth/realms/drs-fpl/protocol/openid-connect/auth |
| Token（p18, p21） | POST | https://www.dips-reg.mlit.go.jp/auth/realms/drs-fpl/protocol/openid-connect/token | https://www.stg.uafp.dips.mlit.go.jp/auth/realms/drs-fpl/protocol/openid-connect/token |
| UserInfo（p24） | GET | https://www.dips-reg.mlit.go.jp/auth/realms/drs-fpl/protocol/openid-connect/userinfo | https://www.stg.uafp.dips.mlit.go.jp/auth/realms/drs-fpl/protocol/openid-connect/userinfo |

  - 綴りの注意（原文どおり）: 認証系の本番ホストは `www.dips-reg.mlit.go.jp`、検証ホストは `www.stg.uafp.dips.mlit.go.jp`（uafp、末尾に i なし）。一方、API系（検索・通報）は本番 `www.uafpi.dips.mlit.go.jp`、検証 `www.stg.uafpi.dips.mlit.go.jp`（uafpi、i あり）（p27, p40, p46, p64）。認証系検証ホストと p64 の検証ドメインの綴りは一致していない（本文のまま）。
  - id_token の iss（p26-27）: 本番「https://www.dips-reg.mlit.go.jp/auth/realms/drs-fpl」、検証「https://www.stg.uafp.dips.mlit.go.jp/auth/realms/drs-fpl」。
- 認証リクエスト パラメータ（p13）: response_type=「code」固定（必須）、client_id=RP毎に予め定義（必須）、redirect_uri=RP毎に予め定義（必須）、**scope=「openid offline_access」固定**（必須）、state（必須。リクエストとコールバック間の状態保持）、ui_locales（任意、ja / en。未指定は Accept-Language に基づく）。リクエストヘッダは「-」。サンプルの redirect_uri は `http%3A%2F%2Fxxxxx%2Ftop`（http）、scope は `openid offline_access`。
- PKCE: code_challenge / code_verifier 等の記載なし。
- nonce: 認証リクエストのパラメータ表に nonce の記載なし。ただし p26「nonce はペイロード部に含まれています」との記述が id_token の説明にあるのみ（リクエストでの指定方法・検証方法の記載なし。p27 の id_token 検証手順の表にも nonce 検証なし）。
- 認可コード受領（p17）: redirect_uri へ code（認可コード）、session_state、state（保存値と一致確認。不一致は CSRF の可能性があるため Token エンドポイントへ要求しないこと）。
- 認証エラー（p15）: システムエラー画面（「システムエラーが発生しました…」）。一部エラーは redirect_uri へ error（必須）、error_description（任意）、state（必須）でリダイレクト。代表例 `unsupported_response_type`（response_type 不正）。サンプル `...?error=unsupported_response_type&state=QJFnyhLBzI`。メンテナンス時はメンテナンス画面（p16）。
- Token リクエスト（認可コード、p18）: POST、Content-Type `application/x-www-form-urlencoded;charset=UTF-8`、パラメータすべて必須: grant_type=「authorization_code」固定、code、redirect_uri、client_id、**client_secret**（「RP毎に予め定義する」）。
- Token リクエスト（リフレッシュ、p21）: POST、同 Content-Type、grant_type=「refresh_token」固定、client_id、client_secret、refresh_token、scope=「openid」固定（すべて必須）。
- Token レスポンス（p19, p22、JSON、全項目必須○）: access_token（userinfo リクエスト発行時に必要な token）、expires_in（access_token の有効時間・秒）、refresh_expires_in（refresh_token の有効時間・秒）、refresh_token（access_token 更新時に必要）、token_type=「bearer」固定、id_token（JWT）、not-before-policy、session_state、scope=「openid profile offline_access」固定。
- **トークン有効時間**: 固定値の記載は仕様表にはなし。サンプルのみ `"expires_in":300`、`"refresh_expires_in":3600`（p19, p22）。アクセストークン300秒・リフレッシュ3600秒と明記した本文記述はない（サンプル値）。
- リフレッシュ: p21-22 のとおり refresh_token グラントで新しいトークンセットが返る（サンプルは初回と同一構造）。リフレッシュトークンの更新・ローテーション、再利用可否の詳細な説明は記載なし（改訂履歴1.2で「使い方の記載拡充」とあるが本文には上記以上の説明なし）。
- Token エラー（p20, p23）: error / error_description（JSON）。unauthorized_client=400（client_id/client_secret不正）、invalid_request=400（grant_type不正）、invalid_grant=400（認可コード不正・期限切れ・無効、redirect_uri不正）。
- UserInfo（p24-25）: GET、ヘッダ `Authorization: Bearer [access_token]`。レスポンス sub（アカウント管理番号・内部ID）、preferred_username（ユーザー名）。エラー: invalid_token=401（アクセストークン不正・期限切れ・無効）、invalid_request=400（アクセストークンなし）。
- ID トークン検証（p26-27）: alg、iss、aud（=client_id）、exp、iat、auth_time。検証: issが環境ごとの値と一致、audがclient_idと一致、expが現在時刻より後、iat/auth_timeが過去で古すぎない（許容は RP 判断）。署名検証の手順・JWKS の URL の記載なし。state検証（p26）: レスポンスのstateがリクエスト送信値と同一。
- ログアウト（end_session / logout エンドポイント、トークン失効 revoke）: 記載なし。
- redirect_uri: RP毎に予め定義（ログイン成功時等にリダイレクトするURL）（p13, p15, p17, p18）。登録方法（申請書で提出するか等）の明記なし。
- Accept-Language 等 ui_locales は p13。

## 5. API 一覧（p27, p40, p46）と通報受付 API の全入力項目

### 5.1 API一覧

| API | メソッド | 本番URL | 検証URL | 頁 |
|---|---|---|---|---|
| 飛行計画情報取得 | POST | https://www.uafpi.dips.mlit.go.jp/api/flight-plan/search | https://www.stg.uafpi.dips.mlit.go.jp/api/flight-plan/search | p27 |
| 飛行禁止エリア情報取得 | POST | https://www.uafpi.dips.mlit.go.jp/api/flight-prohibited-area/search | https://www.stg.uafpi.dips.mlit.go.jp/api/flight-prohibited-area/search | p40 |
| 飛行計画通報受付 | POST | https://www.uafpi.dips.mlit.go.jp/api/flight-plan/register | https://www.stg.uafpi.dips.mlit.go.jp/api/flight-plan/register | p46 |

- 3 API とも ヘッダ `Authorization: Bearer [access_token]`、`Content-Type: application/json;charset=UTF-8`（固定）。
- 認証関連3エンドポイント（auth / token / userinfo）は 4 章参照。
- 通報受付 API の概要（p46）: 「認証された申請者に係る飛行計画通報を受け付けます。」リクエストの flightPlanId は「更新時は必須」（p46）のため、同一エンドポイントで登録/更新を兼ねる（「登録/更新対象の飛行計画情報を指定する」）。

### 5.2 飛行計画通報受付 API リクエストボディ（JSON、p46-52）

凡例: ○=必須 △=条件付き（備考の条件） －=任意（本文に凡例の明記はなく、表中の記号と備考から読み取り）。文字数・桁数の制限は name の「最大30文字」以外は記載なし。

| No | 項目名 | パラメータ名 | 型 | 必須 | 備考・値域・コード表 |
|---|---|---|---|---|---|
| 1 | 飛行計画情報 | flightPlanInfo | オブジェクト(－) | ○ | 登録/更新対象 |
| 2 | 飛行計画ID | flightPlanId | 文字列 | △ | 登録時に採番されたID。更新時は必須 |
| 3 | 飛行計画名称 | name | 文字列 | ○ | 任意の文字列、最大30文字 |
| 4 | 飛行目的 | flightPurpose | 配列(数値) | ○ | 複数設定可。1:空撮 2:報道取材 3:警備 4:農林水産業 5:測量 6:環境調査 7:設備メンテナンス 8:インフラ点検・保守 9:資材管理 10:輸送・宅配 11:自然観測 12:事故・災害対応等 13:その他1(業務) 14:趣味 15:研究開発 16:その他2(業務以外) |
| 5 | その他1理由入力 | othergyomutext | 文字列 | △ | その他1(13)選択時は必須。未選択時は無視 |
| 6 | その他2理由入力 | othergyomugaitext | 文字列 | △ | その他2(16)選択時は必須。未選択時は無視 |
| 7 | 飛行空域 | flightAirspace | 配列(数値) | － | 複数設定可。1:人・家屋の密集地域の上空チェック有無 2:地表・水面から150m以上の高さの空域チェック有無 3:空港周辺チェック有無 |
| 8 | 飛行方法 | flightType | 配列(数値) | － | 複数設定可。1:人・物件から30m未満の距離チェック有無 2:催し物上空の飛行チェック有無 3:夜間の飛行チェック有無 4:目視外での飛行チェック有無 5:危険物の飛行チェック有無 6:物件投下チェック有無 |
| 9 | 補助者 | assistantsNumber | 数値 | ○ | 補助者の人数。補助者無しは0 |
| 10 | 出発地 | departurePoint | 文字列 | ○ | 出発地の地名・固有名称など |
| 11 | 飛行開始日時 | startTime | 文字列 | ○ | 形式「yyyyMMdd□HHmm」（□は半角スペース）。終了日時は所要時間から計算 |
| 12 | 航続可能時間 | plannedMaxTime | 数値 | ○ | 機体の航続可能時間(分)のうち最大値。5分単位 5〜1440 |
| 13 | 所要時間 | plannedFlightTime | 数値 | ○ | 開始〜終了時刻の時間(分)。5分単位 5〜1440 |
| 14 | 飛行速度 | flightSpeed | 数値 | ○ | 多用する速度又は最大速度(GS)、km/h、1〜999 |
| 15 | 飛行する高度 | flightAltitude | 数値 | ○ | 多用する高度又は最大高度(AGL)、メートル、1〜999 |
| 16 | 飛行の経路 | flyRoute | －（GeoJSON文字列） | ○ | 飛行範囲も含む。GeoJSON形式の**文字列**として格納。線種・塗りつぶし色・透過率等の飾りは無視。GeoJSON内の「"」はエスケープ必要 |
| 17 | ジオメトリタイプ | type | 文字列 | ○ | Circle:円 / Polygon:多角形 |
| 18 | ジオメトリ(中心点) | center | 配列 | △ | Circle の場合必須 |
| 19 | 経度 | － | 数値 | △ | 代表点経度（十進法 度表記 世界測地系） |
| 20 | 緯度 | － | 数値 | △ | 代表点緯度（同） |
| 21 | 半径 | radius | 数値 | △ | Circle の場合必須。単位メートル |
| 22 | ジオメトリ(構成点) | coordinates | 配列 | △ | Polygon の場合必須 |
| 23 | 以下、構成点数分繰り返す | － | 配列 | △ | Polygon 指定時は設定必須。3点以上（終点は始点と同じ座標をサーバー側で生成） |
| 24 | 経度 | － | 数値 | △ | 構成点経度 |
| 25 | 緯度 | － | 数値 | △ | 構成点緯度 |
| 26 | 目的地 | destinationPoint | 文字列 | ○ | 目的地の地名・固有名称など |
| 27 | 立入管理措置 | riskMitigationOnsiteControl | 文字列 | ○ | 講じる"1"/講じない"0" |
| 28 | 立入管理措置(レベル3飛行) | riskMitigationOnsiteControlL3 | 文字列 | ○ | "1"/"0" |
| 29 | 立入管理措置(レベル3.5飛行関連) | riskMitigationOnsiteControlL35 | 文字列 | ○ | "1"/"0" |
| 30 | 立入禁止措置 | riskMitigationOnsiteControl2 | 文字列 | ○ | 講じる"1"/講じない"0" |
| 31 | 係留飛行 | exceptionalConditionsMooring | 文字列 | ○ | 行う"1"/行わない"0" |
| 32 | 保険に関する情報 | insuranceInformation | － | △ | 許可・承認情報を設定する場合は必須 |
| 33 | 保険会社名 | insuranceCompany | 文字列 | △ | |
| 34 | 商品名 | insuranceProduct | 文字列 | △ | |
| 35 | 補償金額(対人) | interPerson | 数値 | △ | 無制限の場合は「-1」 |
| 36 | 補償金額(対物) | interObject | 数値 | △ | 無制限の場合は「-1」 |
| 37 | 賠償能力 | insuranceAbility | 文字列 | △ | "0":なし "1":あり |
| 38 | 通報者 | reporter | － | ○ | |
| 39 | 連絡先フラグ | contactReporterFlag | 文字列 | ○ | 通報者を連絡先とする"1"/しない"0"。通報者・操縦者・許可承認情報のいずれか一つの連絡先フラグが"1"であること |
| 40 | 連絡先 | contactReporter | － | ○ | |
| 41 | 氏名 | name | 文字列 | ○ | |
| 42 | 国 | country | 文字列 | ○ | 別紙1国コード（3桁、例 "001"） |
| 43 | 都道府県 | prefectures | 文字列 | ○ | 別紙2都道府県コード（例 "13"） |
| 44 | 住所 | municipality | 文字列 | ○ | 住所（市町村） |
| 45 | 電話番号(国コード) | telephoneCountry | 文字列 | ○ | 別紙1国コード |
| 46 | 電話番号 | telephone | 文字列 | ○ | |
| 47 | メールアドレス | email | 文字列 | ○ | |
| 48 | その他特記事項 | otherInformation | 文字列 | － | |
| 49 | 操縦者情報 | pilotInfo | 配列 | ○ | |
| 50 | 連絡先フラグ | contactPilotFlag | 文字列 | ○ | 操縦者を連絡先とする"1"/しない"0"。39と同じ「いずれか一つが"1"」条件 |
| 51 | 連絡先 | contactPilot | － | ○ | |
| 52-58 | 氏名/国/都道府県/住所/電話(国コード)/電話/メール | name / country / prefectures / municipality / telephoneCountry / telephone / email | 文字列 | ○ | 41-47 と同じコード表参照 |
| 59 | 技能証明書番号 | skillCertificationNumber | 文字列 | － | |
| 60 | 技能証明(一等) | firstClass | 文字列 | ○ | 有り"1"/無し"0" |
| 61 | 技能証明(二等) | secondClass | 文字列 | ○ | 有り"1"/無し"0" |
| 62 | 技能認証保有状況 | privateLicense | 文字列 | ○ | 有り"1"/無し"0"。「2025年12月の制度改正により、将来的に廃止予定」 |
| 63 | 使用機体製造者名 | maker | 文字列 | ○ | 操縦する機体のうち代表1機の製造者名 |
| 64 | 使用機体型式/名称 | model | 文字列 | ○ | 代表1機の型式/名称 |
| 65 | 機体情報 | aircraftInfo | 配列 | ○ | |
| 66 | 機体の種類 | type | 文字列 | ○ | 1:飛行機 2:回転翼航空機(ヘリコプター) 3:回転翼航空機(マルチローター) 4:回転翼航空機(その他) 5:滑空機 6:飛行船 |
| 67 | 機体認証書番号 | certificationNum | 文字列 | － | |
| 68 | 登録記号 | symbol | 文字列 | ○ | |
| 69 | 型式/名称 | model | 文字列 | ○ | |
| 70 | 製造者名 | maker | 文字列 | ○ | |
| 71 | 機体認証(第一種) | certification1 | 文字列 | ○ | 有り"1"/無し"0" |
| 72 | 機体認証(第二種) | certification2 | 文字列 | ○ | 有り"1"/無し"0" |
| 73 | 総重量(kg) | maxWeight | 数値 | ○ | kg。通報を行う飛行形態で入力。困難な場合は最大離陸重量 |
| 74 | 許可・承認情報 | flightPermitApplicationInfo | － | △ | 許可・承認を必要とする飛行の場合は必須 |
| 75 | 許可・承認番号 | flightPermitApplicationNumber | 文字列 | △ | |
| 76 | 許可書発行日 | permitDate | 文字列 | △ | 形式の指定は本文になし（サンプルは "20221205"） |
| 77 | 許可期間(自) | startDate | 文字列 | △ | 同上 |
| 78 | 許可期間(至) | finishDate | 文字列 | △ | 同上 |
| 79 | 連絡先フラグ | contactPermitFlag | 文字列 | △ | 許可・承認情報登録者を連絡先とする"1"/しない"0"。「いずれか一つが"1"」条件 |
| 80 | 連絡先 | contactPermit | － | △ | |
| 81-87 | 氏名/国/都道府県/住所/電話(国コード)/電話/メール | name / country / prefectures / municipality / telephoneCountry / telephone / email | 文字列 | △ | コード表は同上 |
| 88 | 重複計画情報取得フラグ | getDuplicateFlightPlanFlag | 文字列 | △ | 重複する飛行計画の詳細情報を取得する場合"1"。取得しない場合はカラムを省略 |

- 補足: pilotInfo / aircraftInfo は配列（サンプルは要素1件）。複数件の上限は記載なし。
- リクエストサンプル（p52-58）: Circle（p52-55）と Polygon（p56-58）の2種。flyRoute は `"{\"type\":\"FeatureCollection\",\"features\":[{\"type\":\"Feature\",\"properties\":{\"radius\":10.0},\"geometry\":{\"type\":\"Circle\",\"center\":[経度,緯度]}}]}"` の形（サンプル中のエスケープは「¥"」と印字）。Circle のサンプルでは radius が geometry 内ではなく properties 内に置かれている。Polygon サンプルの coordinates は `[[[lon,lat],[lon,lat],[lon,lat]]]`（3点、閉じていない）で properties は {}。
- 日時のタイムゾーン指定の記載なし。過去日時・上限期間（何日先まで通報可か）の記載なし。

## 6. 通報レスポンスとエラー（p59-63）

- 正常時レスポンス（p59-63）: JSON 配列。要素に `flightPlanInfoRegistrationResult`: flightPlanId（登録時に採番されたID、文字列）、flightPlanRegistrationResult（登録結果、文字列。サンプル「登録完了」）、flightPlanRegistrationDatetime（受付日時、形式「yyyy/MM/dd□HH:mm」）、existOtherFlightRoutesCount（他の飛行経路と重なっている件数、数値）、duplicateFlightPlan（配列、重複計画情報取得フラグ"1"の場合のみ）。
  - duplicateFlightPlan: 重複件数が10件以内なら詳細を返却、11件以上なら詳細は返さず件数のみ。各要素 flightPlanId、contactEmail（緊急連絡先メール）、startTime / finishTime（yyyyMMdd□HHmm）、flyRoute（type=Circle/Polygon、center、radius、coordinates）。
  - サンプル: 重複情報取得なし／取得ありで0件／2件／11件（p60-63）。
  - 登録結果の取り得る値の一覧（「登録完了」以外）: 記載なし。
- エラー時（p63）: HTTP 400（リクエストパラメータエラー、処理失敗（パラメータ不正））、HTTP 500（API内システムエラー、予期しないシステムエラー）。ボディ `{"errorMessage": "..."}`（String、必須、エラー内容の詳細な説明）。サンプルは `"システムエラー"`。
  - 400/500 以外（401、403、429 等）の HTTP コード、エラーメッセージ文言一覧、バリデーションエラー別メッセージ: 記載なし。
  - 認証エラー（API呼出時にアクセストークン不正・期限切れ）の応答: API側の記載なし（UserInfo の invalid_token 401 のみ p25）。
- 取消・削除: 通報の取消／削除／キャンセル API は **記載なし**（3 API は検索2種と通報受付のみ）。
- 通報の更新: flightPlanId 指定で更新（p46 の flightPlanId「更新時は必須」）。更新時の挙動の詳細説明は記載なし。
- 通報結果の確認: 専用の結果照会 API は記載なし。登録応答に flightPlanId・登録結果・受付日時が含まれる（p59）。事後確認に相当しうる API は飛行計画情報取得 API（POST /api/flight-plan/search、p27-39）で、allFlightPlan="1"（自アカウントのみ）/"0"（全ユーザー、未指定も全ユーザー）で検索範囲指定（p28）。「●」項目（氏名・連絡先・機体等の詳細）は自アカウントの飛行計画のみ出力、「○」項目は全ユーザー分出力（p36）。
  - 検索リクエスト（p28-29）: features（type: Circle/Polygon、center、radius[m]、coordinates）必須、allFlightPlan、startTime（未指定=当日0:00）、finishTime（未指定=当日23:59、開始時刻より24時間以内）、updateTime（指定時刻以降に更新されたもの。未指定=全て）。日時形式 yyyyMMdd□HHmm。
  - 検索レスポンス（p30-36）: flightPlanInfo 配列（flightPlanId 等）、totalCount。エラーは通報APIと同じ 400/500＋errorMessage（p39）。
- 飛行禁止エリア情報取得API（p40-45）: features＋flightProhibitedAreaInfo（flightProhibitedAreaTypeId: 1:空港等の周辺空域 2:人口集中地区 5:レッドゾーン 6:イエローゾーン 7:条例等で定めるエリア 8:有人機離着陸エリア 9:緊急時用務空域 10:その他1 11:その他2、startTime/finishTime/updateTime）。レスポンス: flightProhibitedAreaId、name、range、detail、url、種別、有効期限（yyyy-MM-ddTHH:mm:ss）、totalCount。空港等の周辺空域は広域の場合、地理院タイルのズームレベル8単位で複数ポリゴンに分割して返されることがある（p44 注）。エラーは 400/500（p45）。

## 7. 複数事業者に提供するSaaS・代理通報・再配布・利用規約上の制約

- 複数事業者向けSaaS、代理通報（事業者に代わって通報）、再配布、再販、1クライアントIDを複数事業者で共用すること、クライアントIDの貸与・譲渡の可否: 本書に **記載なし**。
- 関連しうる記述:
  - API の定義は「利用者が保有するシステム（接続システム）からリクエストを送信することで…指定したログインIDに係る飛行計画の通報機能を提供するサービス」（p5, 1.1）。
  - 通報は「認証された申請者に係る飛行計画通報」を受け付ける（p46）。ユーザーは接続システム上で DIPS2.0 の ID/パスワードを入力（DIPS2.0 側の画面で認証）して連携（p6, p14）。つまりログインID（ユーザー）単位の認可。p6 の利用イメージ図に「DIPS2.0アカウントを保存」の注記あり（誰が保存するかの説明文は本文になし）。
  - 利用規約への同意が利用の前提（p5）。規約本文は本書に含まれず（URLのみ）、規約上の制約の内容は本書では確認不可。
  - 通報データの「通報者」「操縦者」「許可・承認情報」の連絡先フラグのいずれか1つは"1"（p50）。
  - 利用イメージ図の登場人物は「国民・事業者等」（p8）。
- 上記を踏まえ、SaaS／代理通報の可否は本書では判断不能。申請窓口（p5）か利用規約（p5 URL）での確認が必要。

## 8. 検証・試験上の禁止事項や運用上の注意

- 禁止事項（p64, 3.1 制限事項）: 「本番環境にて性能負荷試験や異常系試験など、本番運用に影響をきたす作業は禁止。」
- 環境の切替必要（各URLの注記「※環境によって切り替えが必要です」p12, 18, 21, 24, 27, 40, 46、p64）。
- 動作確認は検証環境→本番環境の順に実施し、それぞれ完了報告を行う（p65）。確認ポイントは「設定通知書」に記載（p66-67）。
- 運用上の注意（本文記載）:
  - state の一致確認。不一致なら Token エンドポイントへリクエストしない（p17）。
  - id_token の検証（iss/aud/exp/iat/auth_time）。許容する古さは RP 側判断（p27）。
  - 同一ブラウザで認証済みで有効期限内なら ID/パスワード画面はスキップ（p9, p12）。
  - 申請から ID 通知まで最大約1か月（p5）。
  - 技能認証保有状況（privateLicense）は2025年12月の制度改正により将来的に廃止予定（p34, p51）。
  - 空港等の周辺空域ポリゴンの分割返却（p44）。
  - 重複計画詳細は10件以内のみ返却（p59）。
  - メンテナンス時はメンテナンス画面に遷移（p16）。
- レート制限（回数制限、タイムアウト）、同時接続数、メンテナンス時間帯、SLA、問い合わせ先（申請窓口メール以外）の記載: なし（申請窓口は p5 のメールのみ）。

---

## 本文上の気づき（原文どおりの不整合・注意点）

1. 認証系検証ホスト `www.stg.uafp.dips.mlit.go.jp`（uafp）と API 系検証ホスト `www.stg.uafpi.dips.mlit.go.jp`（uafpi）が綴り違い。p64 は uafpi 表記。本文のまま写すこと。
2. nonce: p26 は id_token に nonce が含まれると述べるが、認証リクエスト項目表（p13）に nonce なし。PKCE も記載なし。
3. トークン有効時間はサンプル値（300秒/3600秒）のみで、仕様としての固定記述なし。
4. 別紙1 国コードに「ドミニカ国(050)」「ドミニカ共和国(051, 052, 053)」と、同名が3件重複して印字されている（p69）。コード 001=日本、199=「-（その他）」（p73）。別紙2 は 01〜47（北海道〜沖縄県）と 99=その他（p74-75）。
5. 通報リクエストのサンプルで Circle の radius が geometry でなく properties に入っている（p53）。レスポンス側の radius の説明は別途 geometry 内（p60 項目16）。
6. Authorization サンプルの redirect_uri は http（p13）。
7. 通報リクエストの必須記号（○△－）の凡例は通報API表の近傍に明記なし。検索レスポンス表のみ「○/●」の出力凡例がある（p36）。
