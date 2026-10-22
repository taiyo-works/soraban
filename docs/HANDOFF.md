# 引き継ぎメモ（2026-10-21 時点）

Claude（クラウドの作業環境）から Claude Code へ作業を引き継ぐための文書。最初にこの文書と `CLAUDE.md`、`docs/00_NORTH_STAR.md` §0.1、`docs/spec.md` §13 を読むこと。

## 1. 前提

- そらばんは、フューチャーテック株式会社の事業。担当は奥田憲章（のりさん）。会話・文書はすべて自然な日本語で、相手に応じた敬語で書く。
- 最終目標は全国での提供と安定稼働。山陰（鳥取県・島根県）での自社運用はその最初の段階（North Star §0.1.1a）。
- 特許は出願しておらず、当面出願しない（§0.1.8）。画面・PDF に特許・出願の表示を出さない（出願していないのに「出願中」と書くのは特許法の虚偽表示）。
- 開発は `CLAUDE.md` の 4 エージェント体制（planner → generator → designer → evaluator）で進める。エージェントの定義は `.claude/agents/` にある（2026-10-20 に追加）。マージはユーザーが「マージ」と言ったときに行うのが基本。

## 2. 環境

| 項目 | 内容 |
|---|---|
| リポジトリ | `taiyo-works/soraban`（GitHub 組織 taiyo-works。taiyo-works-admin が所有する Pro） |
| Mac の手元のクローン | 接続先がまだ旧リポジトリのまま。`git remote set-url origin https://github.com/taiyo-works/soraban.git` が必要 |
| Vercel | チーム **taiyo-works-projects**（Pro）、プロジェクト soraban。関数リージョン sin1（設定済み）。Root Directory `apps/web` |
| 公開 URL | `https://soraban.futuretec.jp`（Xserver ドメインの DNS に CNAME 追加済み、Valid）、`soraban-gules.vercel.app` |
| 検索エンジン | 全ページに `X-Robots-Tag: noindex, nofollow`（試験運用中。本格公開時に外す） |
| DB | Neon プロジェクト soraban（id `solitary-silence-51819136`、org「タイヨー通信／フューチャーテック」、aws-ap-southeast-1、PostgreSQL 18、PostGIS 導入済み、従量課金、scale-to-zero）。**当面は Neon のまま使い、国内保管の要件が出たときに東京（Supabase 東京か AWS 東京）へ移す**（2026-10-21 ユーザー決定。下の「DB の方針」） |
| 認証 | Neon Auth（Google ログインのみ）を予定。本番は未設定 |
| 機能フラグ | `OPS_ENABLED`（運航管理）。本番では未設定＝無効。無効の間 `/ops` 等は 404 |
| CI | GitHub Actions：verify（typecheck/lint/test/build）、e2e、db（PostGIS サービスコンテナ）、smoke（外部疎通、失敗しても止めない） |

### DB の方針（2026-10-21 ユーザー決定。正は `docs/spec.md` §13.8.1）

- 経緯：Neon に日本の地域がない（アジアはシンガポールとシドニーだけ。2026-10-20・21 に Neon コネクタで確認）。官公庁等への提供で国内保管が要件になるかは「わからない」。運用は のりさん が一人で行う。
- **乗り換えの合図**：① お客様から国内保管を求められた。② 官公庁への提供が具体的になった。③ 運航記録の本格入力の前に、念のため移しておきたいと判断した。
- **備え**：認証は `AUTH_PROVIDER` で切り替える作り（neon／test）を保つ。標準の PostgreSQL（PostGIS）と自前の SQL マイグレーションだけに依存する。運航記録のハッシュ連鎖（`verify_record_chain`、12a から判定スナップショットの検証関数も）は、移行の前後で検証する。
- 本番 DB の準備の手順書（`docs/runbooks/production-db-prep.md`）は Neon 前提。乗り換えるときは差し替える。

## 3. 完了したスプリント（すべて main にマージ済み）

| Sprint | 内容 | PR |
|---|---|---|
| 7 | 判定の現行法令対応（飛行禁止法 1,000m、DID 令和2年、工業専用地域の除外、出典・確認日の台帳） | #7 |
| 8 | Neon の土台（pg、SQL マイグレーションと安全装置付きランナー、Supabase 撤去、判定証跡 evidence_log） | #10 |
| 9 | 地図での地点指定（現在地ボタン、長押し、住所検索の強化） | #11 |
| — | 地図の初期表示（その後 11a で米子市役所に変更） | #12 |
| 10 | 利用者・機体・操縦者（Neon Auth、組織と役割、版の履歴 record_versions、機能フラグ） | #13 |
| 10a | 公開面の整備（特許・社内用語の除去、見出し、運営者・利用範囲・免責） | #15、#18 |
| 11 | 日常点検と飛行記録（JST 1 分単位、総飛行時間の自動累計、現場入力、利用者ごとの下書き） | #14 |
| 11a | 制度の最新化（教則 第5版、緊急用務空域＝原則飛行禁止、農薬散布の通達、保険、技能証明の更新期限）と、トップの意図の明確化 | #19 |
| 11b | 見出しの線画（ユーザーが Adobe Firefly で生成した PNG に差し替え） | #21 |
| 11c | 許可の入力の不具合修正（飛行禁止法の「同意」と「公安委員会への通報」を別の入力に） | #22 |
| 11d | 判定を 4 段（飛行不可・要手続き・手続き済み（条件付き）・手続き不要）＋判定不能に組み直し、見せ方を刷新（`ENGINE_VERSION` 0.4.0、マイグレーション 0009） | #23 |
| 11e | 100g 未満の機体（模型航空機）の手続きと参照先を判定に明記 | #23 |
| 11f | 11d・11e の軽微な指摘の手直し（模型航空機の DID 表示・診断待ちの履歴・参照先・未収録の市町村の題名）。あわせて Sprint 12 の設計（`docs/sprints/sprint-12.md`）と本番 DB 準備の手順書を追加 | #24 |
| 11g | 100g 未満の機体の空港等周辺・150m 以上の手続きを「許可または通報」と表示（施行規則第239条の3を追加、参照先 9 件）。※条文の原文は未照合 | #25 |
| 12a | 飛行計画・判定スナップショット（追記専用）・運航管理者の確認・よく使う地点・日誌との紐付け（`OPS_ENABLED` の裏。マイグレーション 0010・0011。本番は停止のまま） | #26 |
| — | North Star：特許の扱い（§0.1.8）、最終目標（§0.1.1a） | #8、#16 |
| — | noindex | #17 |

## 4. 解決済みの記録（旧「最優先で確認すること」。2026-10-20 に解消）

> 現在の最優先は、Sprint 12a の着手（`docs/sprints/sprint-12a.md`）と、本番の DB・Neon Auth の準備（§5）。下の古い版の件は解決済みで、対応は不要。

**soraban.futuretec.jp に古い版が表示されている。** main のデプロイは毎回「成功」だが、2026-10-19 夜の時点で、独自ドメインには Sprint 10a より前の版（特許の表示、「タイヨー通信本社（拠点）」、「個人開発・社内検討段階」のフッター）が出ていた。考えられる原因：

1. Vercel の本番ブランチが main になっていない（main のデプロイがプレビュー扱い）
2. soraban.futuretec.jp が本番ではなく特定のデプロイ・ブランチに割り当てられている
3. トップ画面の `'use cache'`（cacheLife days）が残っている

Vercel の Deployments（最新が Production か）と、Domains の soraban.futuretec.jp の割り当てを確認する。DIPS の申請書に URL を書く前に必ず解消する。

### 4.0 結論（2026-10-20、Vercel コネクタで確認）

**Vercel の設定に問題は無い。** 本番ブランチは main（main のデプロイの target が production）、soraban.futuretec.jp はブランチ割り当て無し（gitBranch null）。独自ドメインの alias は最新の main（#20、dcfeddd、`dpl_76hRM9umhVaTwNZb6W7pBQHN9B32`）に付いている。候補 A・B・C はすべて外れ。

soraban.futuretec.jp を Vercel に追加したのは 2026-10-19 17:54 JST で、Sprint 10a の main への反映（#15、19:16 JST）より前。その間に見た画面か、ブラウザに残った古い画面だった可能性が高い。スーパーリロード（またはシークレットウィンドウ）で、トップに「出願準備中」が無く、`X-Robots-Tag: noindex, nofollow` が返ることを目で確かめれば完了。

**解消済み（2026-10-20）**：ユーザーがブラウザで確認し、「出願準備中」は出ていない。DIPS の申請書に soraban.futuretec.jp を書いてよい。

Vercel コネクタの注意：チーム ID を付けずに呼ぶ（付けると空の結果が返る）。

### 4.1 調査の経過（2026-10-20、Claude Code。§4.0 の結論より前の記録で、ここに書いた設定変更は不要）

> **この節は経過の記録であり、対応手順ではない。** 下の候補 A〜C は §4.0 の確認ですべて外れた。表の「直し方」は実施しないこと。

Vercel のダッシュボードは見られなかった（作業環境の Vercel コネクタは carta-lab-projects チームだけに権限があり、taiyo-works-projects は 403。soraban.futuretec.jp と vercel.app への接続も作業環境のネットワーク方針で拒否）。GitHub とリポジトリから分かったこと：

- デプロイ先は taiyo-works-projects のプロジェクト soraban（`prj_rW9rpj8jsKZM2jinw5CD8wgVnBIX`、Root Directory `apps/web`）。main の CI はすべて成功。
- 報告された古い文言（「出願準備中」「特許コア」「タイヨー通信本社（拠点）」「個人開発・社内検討段階」）は main には無い。main から消えたのは 2026-10-19 17:54〜18:40 JST（Sprint 10a）。
- 同じ文言が残っているブランチは `private-preview`（最終 2026-06-08「空港データを静的import化しVercel serverlessで配信可能に」＝もとは Vercel に載せるためのブランチ）と `sprint6/reliability`（最終 2026-10-14）。
- 候補 3（`'use cache'`）は外れ。トップ画面には無く、残るのは `server/regulation-check.ts` の DID データの取得だけ。データのキャッシュが画面の文言（JSX）を古くすることは無い。Service Worker もどのブランチにも無い。

残る候補は、どれも「どのデプロイを独自ドメインに出すか」の設定：

| 候補 | ダッシュボードでの見え方 | 直し方 |
|---|---|---|
| A. 本番ブランチが main でない（`private-preview` 等） | Deployments で main のデプロイに「Preview」と付く | Settings → Environments → Production の Branch Tracking を `main` に。最新の main のデプロイを Promote to Production |
| B. soraban.futuretec.jp がブランチに割り当てられている | Settings → Domains の soraban.futuretec.jp に Git Branch（`private-preview` 等）が出る | 同じ画面の Edit で Production に戻す |
| C. Instant Rollback や手動の Promote で、本番ドメインの自動割り当てが止まっている | main のデプロイは「Production」だが「Current」が付かない。上部に Rollback の表示 | 最新の main のデプロイを Promote する（Undo Rollback でも可） |

soraban-gules.vercel.app も古ければ A か C、新しければ B。

直ったかの確かめ方：`curl -sI https://soraban.futuretec.jp/ | grep -i x-robots-tag` で `noindex, nofollow` が返ること（noindex は #17 で main にだけ入った。古い版には付かない）と、トップに「出願準備中」が無いこと。古い版は noindex が無いため、検索エンジンに載りうる点でも急ぐ。

`private-preview` と `sprint6/reliability` は 2026-10-20 にユーザーが GitHub の画面で削除した（済み）。

## 5. ユーザー作業（未完了）

| 作業 | 時期 | 手順の置き場所 |
|---|---|---|
| 会社の回線が固定 IP か確認（なければ国内 VPS を契約） | **保留**（2026-10-21：DIPS 連携は後回し。アプリを先に完成させる） | `docs/references/dips-api-application-draft.md` |
| DIPS 2.0 API 利用申請書の送付（検証環境）。**当面は社内のみの利用**（担当：営業部 奥田憲章）。外部へ提供する段階で、航空局に「複数事業者への提供の可否」を確認する | **保留**（固定 IP の決定後） | 記入案：`docs/references/dips-api-application-draft.md`、ガイドラインの精読結果：`docs/references/dips-fpr-guideline-findings.md` |
| 本番の DB 準備：soraban_app ロール作成 → マイグレーション → Vercel の `DATABASE_URL`（Production のみ・Sensitive） | 運航管理を本番で使う前 | `packages/db/README.md` |
| Neon Auth の有効化、Google OAuth クライアント、`ops_bootstrap`、Vercel の環境変数、最後に `OPS_ENABLED=1` | 同上 | `packages/db/README.md`「運航管理（Sprint 10）の本番準備」 |
| 住所データ（アドレス・ベース・レジストリ）の取得 | 日本国内の PC で | `packages/regulations/data/address/README.md`（`pnpm --filter @soraban/regulations fetch:address`。配布元が国外からの接続を拒否するため） |
| 用途地域データ A29（令和元年度）の各市区町村の利用条件の確認 | 商用公開の前 | `packages/regulations/data/sources.json` |
| Neon Auth でメールとパスワードの登録を止められるか確認 | 本番準備時 | — |
| 機体の 2026-12-31 時点の総飛行時間の入力、操縦者の技能証明の有効期限の入力 | 本番で使い始めるとき | — |
| 本番 DB 準備の予行演習つき手順書に沿って進める | 運航管理を本番で使う前（2027-01 中旬までを推奨） | `docs/runbooks/production-db-prep.md` |
| 通報要領（令和8年3月31日最終改正）の本文で通報事項・期限・障害時の扱いを確認（U3） | Sprint 12b の着手前 | `docs/sprints/sprint-12.md` §6 |
| DIPS 2.0 の通報画面の入力順・番号の表示を確認（U4） | Sprint 12b の着手前 | 同上 |
| 条文の一次資料での確認（航空法第134条の3・同施行規則第239条の2・第157条の10、小型無人機等飛行禁止法・航空法の条番号。e-Gov）（U5・U9） | 12b・12e の着手前、随時 | `docs/sprints/sprint-12.md` §6。確認できたら画面の「※要確認」を外す |
| `futuretec.jp` でメールを送受信できるようにする（任意。DIPS の申請の前提ではない）。公式サイトは `futuretec.jp`（メール不可）、メールは `futuretec-jp.com`。DNS はエックスサーバー。**確認待ち：①`futuretec.jp` はドメインのみの契約か、レンタルサーバーにも登録済みか　②`futuretec-jp.com` のメールもエックスサーバーか**。レンタルサーバー契約があれば追加ドメイン＋メールアカウントで費用 0 の見込み。ドメインのみなら MX/TXT で転送（ImprovMX 等）。**`soraban.futuretec.jp`（Vercel 向け）の DNS レコードは消さない** | 随時 | `docs/references/dips-api-application-draft.md`「メールアドレスについて」 |
| 社内拠点（本社）の位置を地図で目視確認し、本番で `/ops/places` から登録する（U8） | 12a の本番利用の開始時 | `docs/sprints/sprint-12a.md`「ユーザー作業」 |
| **見込みのお客様に尋ねる 3 つの質問**（国内保管の判断材料） | 見込みのお客様との最初の相談のとき | 下の「見込みのお客様への質問」 |
| ~~一時ブランチ `data-fetch/*` の削除~~（2026-10-20 にユーザーが削除。済み） | — | — |

### 見込みのお客様への質問（DB の保管場所の判断材料。2026-10-21）

1. **クラウド利用の要件**：クラウドサービスの利用に条件はあるか（データの保管場所＝国内かどうか、ISMAP などの認証の登録が要るか）。
2. **データの保管の決まり**：操縦者の氏名・飛行場所などの記録を、どこに、どの期間保管する決まりがあるか。
3. **導入時の情報セキュリティ確認の手順**：導入のとき、情報セキュリティの確認（チェックシート、審査、書面など）をどう行うか。

答えは `docs/spec.md` §13.8.1 の「乗り換えの合図」の判断に使う。

運用の決めごと（推奨）：共用端末は渡す前に保存かログアウト／スマホの時刻は自動設定。

## 6. 残っている課題（次のスプリント候補）

- **方針（2026-10-21 ユーザー決定）**：DIPS 2.0 API の申請・固定 IP は決めず、**アプリのみ先に完成させる**（Sprint 12b〜12f。通報は手動・模擬のアダプターで）。利用は当面社内のみ。DIPS の接続情報：`docs/references/`（FPR ガイドライン 1.10 版の精読。申請書の様式にアクセス元 IP の欄があり、接続元 IP の登録が要る）。
- **12b の方針（2026-10-21）**：契約案は `docs/sprints/sprint-12b.md`（20 項目、ユーザー承認待ち）。12a の評価で出た提案「通報の要否が『推奨』になるのは、判定の結論に判定不能がある計画でもあり得る。安全側に『要確認』へ倒す」は **12b の範囲に含める案**（契約 1）。あわせて 12a の軽微な表示の指摘（判定の日時の JST、タップ領域 44px、375px の機体表示）も含める（契約 18）。通報は手動と模擬のアダプターまで（送信しない）。通報要領（U3）・DIPS の画面（U4）は未確認で、確認できた時点でデータの更新だけで反映できる。
- **Sprint 12（統合した運航管理サービス）**：設計と 12a〜12f の分け方は 2026-10-21 にユーザーが承認済み（`docs/sprints/sprint-12.md`。未決事項 13 件は推奨どおりで確定）。12a（飛行計画・判定スナップショット・運航管理者の確認）は実装・マージ済み（契約は `docs/sprints/sprint-12a.md`）。**次は 12b（通報の準備・記録・期限、通報ゲートウェイ）で、契約案は `docs/sprints/sprint-12b.md`。**社内拠点（本社）の「よく使う地点」への登録は 12a に含む。通報の準備と記録は 12b（通報ゲートウェイ）、今日・現場モードは 12c。2026-03-31 改正の通報要領の本文は未照合（ユーザー作業 U3）。
- **12c の方針（2026-10-21）**：12b はマージ済み（#27）。**次は 12c（トップの「今日」・下メニュー・現場モード・点検と日誌の統合）で、契約案は `docs/sprints/sprint-12c.md`（18 項目、ユーザー承認待ち）。** 現場の事実は追記専用の新しい表（0014）に残す。Service Worker による完全な圏外対応は範囲外（端末の送信待ちまで）。ユーザーに伺うことはなし（実機の屋外確認 U14 と、緊急用務空域の確認先 U13 は完了後の任意）。
- **12d の方針（2026-10-21）**：12c はマージ済み（main = a84e8cb）。**次は 12d（許可・承認の登録と、包括許可の照合）で、契約案は `docs/sprints/sprint-12d.md`（18 項目、ユーザー承認待ち）。** 許可・承認を番号・有効期間・範囲つきで追記専用に登録し、計画の許可番号の欄の番号が登録に結びつき、範囲に収まるものだけを判定に適用する（範囲外・期限切れ・失効・未登録・確認できないものは要手続きのまま）。判定エンジン・`ENGINE_VERSION`（0.4.0）・証跡 ID は変えない。変える点は運航管理の計画の入力の組み立てだけ（計画での DIPS の許可の手入力を廃止、判定画面 `/` は従来のまま、許可番号が判定の入力になる、スナップショットに根拠にした登録の版を残す）。空港等周辺の個別許可は登録・照合・表示までで、判定の段は変えない（未決事項 1。推奨どおりで進めてよい）。DIPS・FPA には接続しない。ユーザーに伺うことはなし（U15：自社の許可・承認書の様式の確認は完了後の任意）。
- **100g 未満の機体（模型航空機）の扱い（Sprint 11e・11f で判定に反映済み）**：航空法の無人航空機の規制は対象外と明記し、空港等の周辺は第134条の3 の許可、150m 以上は同条の通報を要手続きとして段取りに出す。残る点：① 条文・施行規則の e-Gov の URL・許可と通報の対象空域の分け方・出す先・期限は一次資料と未照合（`model-aircraft.ts` の「※要確認」）。② 第134条の3 の許可・通報を済ませた入力は未実装で、常に要手続き（12d の範囲外。運航管理の機体は 100g 以上のみのため、後続で扱う）。③ 管制圏・情報圏・航空路を収録していない。④ 運航管理の機体登録は最大離陸重量が 0.1kg 刻みで、100g 未満の機体は登録できない（12a の計画は登録機体だけが対象。100g 未満を運航管理で扱うかは後続の検討）。
- **条文確認のユーザー作業**：上の ①、航空法第157条の10（通報義務違反の罰則）・事故の報告義務の条文、小型無人機等飛行禁止法・航空法の条番号（技能証明の条番号以外の表記）。§5 の表を参照。
- 美保基地の周辺の例で、境港市の文化財が「判定不能」と出る（データ未整備）。
- 対象施設（美保基地等）の敷地ポリゴンは未収録。中心点＋推定半径の安全側判定で暫定運用中（ユーザー承認済み）。区域図からの作成が本線。
- 2026-06-30 付の国交省告示（人口集中地区から除かれる区域の指定）と、告示第435号の関係の確認。
- 迷惑行為等防止条例を病院・駅周辺の規制として並べている表示の位置付けの確認。
- 技能証明の条番号以外の法令表記（機体登録「第131条の3〜8」など）の照合。
- 毎月の制度確認（North Star §0.1.5）。

## 7. 作業環境での注意（Claude Code でも参考に）

- Google Fonts をビルド時に取得する。取得できない環境では `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` でモックする（モックはリポジトリに入れない）。
- E2E は国土地理院の逆ジオコーダを模擬サーバー（`e2e/mock-gsi-server.mjs`）で置き換える。Neon Auth は `e2e/mock-neon-auth-server.mjs`。
- DB を使う E2E は `pnpm test:e2e:ops`（PostgreSQL＋PostGIS と soraban_app ロールが必要。手順は CI の db ジョブ）。
- 証跡 ID：地点判定の証跡 ID と `ENGINE_VERSION`（Sprint 11d から `soraban-0.4.0-verdict-2026-10`。旧版 0.3.0 の証跡 ID は旧版の文字列を渡したペイロードで再現できる）は、文言の変更では変えない。申請支援の証跡 ID は手続きデータの `revision`・確認日で変わる（版の変更として正しい）。
- 適用済みの SQL マイグレーションは書き換えない（チェックサムで止まる）。
- Next.js は破壊的変更を含む版。実装前に `node_modules/next/dist/docs/` を参照（`apps/web/AGENTS.md`）。

## 8. 関連文書

- Sprint 12 の設計：`docs/sprints/sprint-12.md`、12a の契約：`docs/sprints/sprint-12a.md`、12b の契約：`docs/sprints/sprint-12b.md`、12c の契約案：`docs/sprints/sprint-12c.md`、12d の契約案：`docs/sprints/sprint-12d.md`、本番 DB 準備：`docs/runbooks/production-db-prep.md`
- DIPS 2.0 API の資料：`docs/references/`（`dips-fpr-guideline-findings.md`＝原本の精読、`dips-api-application-draft.md`＝申請書の記入案、`dips-api-notes-external.md`＝ユーザー提供の外部調査・未検証）
- 方針と運航管理の説明（Claude のドキュメント）：https://claude.ai/code/artifact/a154207b-9400-4897-a74d-4eeaf8f49486
- North Star：`docs/00_NORTH_STAR.md`（§0.1 が最優先）
- 仕様：`docs/spec.md` §13（第1段階）、スプリント契約：`docs/sprints/`

- **既知の制約（API アダプターを作るときに解決する）**：通報の冪等性キーは、通報画面で入れる項目（速度・目的など）を含まない。直接送信（模擬、将来の API）が `failed` になったあと、これらの入力だけを直して送り直すと同じキーになり、失敗した行が返る（再送は保存した入力で行う）。手動の記録には失敗の状態がなく、模擬は本番で使えないため、現状の利用には影響しない。API アダプターの設計時に、「失敗した行を訂正して再送する」操作（入力の訂正を版として残す）を加える。
