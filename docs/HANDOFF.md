# 引き継ぎメモ（2026-10-20 時点）

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
| DB | Neon プロジェクト soraban（id `solitary-silence-51819136`、org「タイヨー通信／フューチャーテック」、aws-ap-southeast-1、PostgreSQL 18、PostGIS 導入済み、従量課金、scale-to-zero） |
| 認証 | Neon Auth（Google ログインのみ）を予定。本番は未設定 |
| 機能フラグ | `OPS_ENABLED`（運航管理）。本番では未設定＝無効。無効の間 `/ops` 等は 404 |
| CI | GitHub Actions：verify（typecheck/lint/test/build）、e2e、db（PostGIS サービスコンテナ）、smoke（外部疎通、失敗しても止めない） |

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
| — | North Star：特許の扱い（§0.1.8）、最終目標（§0.1.1a） | #8、#16 |
| — | noindex | #17 |

## 4. 最優先で確認すること

**soraban.futuretec.jp に古い版が表示されている。** main のデプロイは毎回「成功」だが、2026-10-19 夜の時点で、独自ドメインには Sprint 10a より前の版（特許の表示、「タイヨー通信本社（拠点）」、「個人開発・社内検討段階」のフッター）が出ていた。考えられる原因：

1. Vercel の本番ブランチが main になっていない（main のデプロイがプレビュー扱い）
2. soraban.futuretec.jp が本番ではなく特定のデプロイ・ブランチに割り当てられている
3. トップ画面の `'use cache'`（cacheLife days）が残っている

Vercel の Deployments（最新が Production か）と、Domains の soraban.futuretec.jp の割り当てを確認する。DIPS の申請書に URL を書く前に必ず解消する。

### 4.0 結論（2026-10-20、Vercel コネクタで確認）

**Vercel の設定に問題は無い。** 本番ブランチは main（main のデプロイの target が production）、soraban.futuretec.jp はブランチ割り当て無し（gitBranch null）。独自ドメインの alias は最新の main（#20、dcfeddd、`dpl_76hRM9umhVaTwNZb6W7pBQHN9B32`）に付いている。候補 A・B・C はすべて外れ。

soraban.futuretec.jp を Vercel に追加したのは 2026-10-19 17:54 JST で、Sprint 10a の main への反映（#15、19:16 JST）より前。その間に見た画面か、ブラウザに残った古い画面だった可能性が高い。スーパーリロード（またはシークレットウィンドウ）で、トップに「出願準備中」が無く、`X-Robots-Tag: noindex, nofollow` が返ることを目で確かめれば完了。

Vercel コネクタの注意：チーム ID を付けずに呼ぶ（付けると空の結果が返る）。

### 4.1 調査の結果（2026-10-20、Claude Code）

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

直ったあとで、`private-preview` と `sprint6/reliability` の削除をユーザーに相談する（B のとき、先に割り当てを外してから）。

## 5. ユーザー作業（未完了）

| 作業 | 時期 | 手順の置き場所 |
|---|---|---|
| 会社の回線が固定 IP か確認 | 退院後 | — |
| DIPS 2.0 API 利用申請書の【要記入】を埋めて送付（検証環境） | 固定 IP 確認後 | 記入済みの申請書（会話で送付済み）。接続システム URL は soraban.futuretec.jp |
| 本番の DB 準備：soraban_app ロール作成 → マイグレーション → Vercel の `DATABASE_URL`（Production のみ・Sensitive） | 運航管理を本番で使う前 | `packages/db/README.md` |
| Neon Auth の有効化、Google OAuth クライアント、`ops_bootstrap`、Vercel の環境変数、最後に `OPS_ENABLED=1` | 同上 | `packages/db/README.md`「運航管理（Sprint 10）の本番準備」 |
| 住所データ（アドレス・ベース・レジストリ）の取得 | 日本国内の PC で | `packages/regulations/data/address/README.md`（`pnpm --filter @soraban/regulations fetch:address`。配布元が国外からの接続を拒否するため） |
| 用途地域データ A29（令和元年度）の各市区町村の利用条件の確認 | 商用公開の前 | `packages/regulations/data/sources.json` |
| Neon Auth でメールとパスワードの登録を止められるか確認 | 本番準備時 | — |
| 機体の 2026-12-31 時点の総飛行時間の入力、操縦者の技能証明の有効期限の入力 | 本番で使い始めるとき | — |
| 一時ブランチ `data-fetch/*` の削除（作業環境から削除できなかった） | いつでも | GitHub の画面 |

運用の決めごと（推奨）：共用端末は渡す前に保存かログアウト／スマホの時刻は自動設定。

## 6. 残っている課題（次のスプリント候補）

- **Sprint 12（計画済みの日程）**：飛行計画と判定スナップショット、運航管理者の確認。2026-03-31 改正の飛行計画の通報要領を反映。社内拠点（本社など）を運航管理の「よく使う地点」に。
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
- 証跡 ID：地点判定の証跡 ID と `ENGINE_VERSION`（`soraban-0.3.0-regulations-2026-07`）は、文言の変更では変えない。申請支援の証跡 ID は手続きデータの `revision`・確認日で変わる（版の変更として正しい）。
- 適用済みの SQL マイグレーションは書き換えない（チェックサムで止まる）。
- Next.js は破壊的変更を含む版。実装前に `node_modules/next/dist/docs/` を参照（`apps/web/AGENTS.md`）。

## 8. 関連文書

- 方針と運航管理の説明（Claude のドキュメント）：https://claude.ai/code/artifact/a154207b-9400-4897-a74d-4eeaf8f49486
- North Star：`docs/00_NORTH_STAR.md`（§0.1 が最優先）
- 仕様：`docs/spec.md` §13（第1段階）、スプリント契約：`docs/sprints/`
