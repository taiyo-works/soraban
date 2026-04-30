# soraban_hinomori 開発キックオフ指示書（確定版）

> **対象**：奥田憲章 様（メルドカルタ事業）
> **作成日**：2026年4月25日
> **想定環境**：macOS + VS Code + Claude Code + GitHub `nor-product`
> **並行プロジェクト**：旬レシピ（別ターミナル・別ディレクトリで進行中）

---

## 0. プロジェクト概要

### ブランド構造（二層）

| 層 | 名称 | 役割 |
|---|---|---|
| サービス層 | **Hinomori（日守）** | エンドユーザー向けSaaS名・マーケティングの顔 |
| エンジン層 | **Soraban（空番）** | 規制計算エンジン名・特許明細書および将来のOEM／API提供の顔 |

リポジトリ名・ディレクトリ名は両者を併記した `soraban_hinomori` を採用します。Stripeにおける「Stripe」「Stripe Connect」のような関係を、初期から構造的に分離しておくことで、将来エンジン部分を他社にOEM／API提供する事業展開が容易になります。

### 事業主体・知財帰属

- **事業主体**：奥田憲章 個人（屋号：Meld Carta、将来的に合同会社メルドカルタ）
- **知財帰属**：奥田憲章 個人
- **タイヨー通信／フューチャーテックとの関係**：完全独立（業務時間外・自宅環境での開発）

---

## 1. ディレクトリ作成と初期化（所要約5分）

### 1-1. メルドカルタ統合ディレクトリの作成

OneDrive配下を**完全に回避**します。OneDriveは設計書・議事録・スプレッドシート等の **「成果物アウトプット」専用** とし、コード資産は一切置きません。

```bash
# メルドカルタ統合ディレクトリの作成
mkdir -p ~/Dev/meldcarta
cd ~/Dev/meldcarta

# 現在の状況確認
pwd
# 期待される出力：/Users/nori/Dev/meldcarta

# soraban_hinomori プロジェクト作成
mkdir soraban_hinomori
cd soraban_hinomori

pwd
# 期待される出力：/Users/nori/Dev/meldcarta/soraban_hinomori
```

### 1-2. 旬レシピの取り扱い（任意）

旬レシピを `~/Dev/meldcarta/shunrecipe/` 配下に移動するかは任意です。

**移動する場合**：
```bash
# 旬レシピを meldcarta 配下に移動（パス確認後に実行）
# mv ~/プロダクト01/旬レシピ ~/Dev/meldcarta/shunrecipe
# 移動後、VS Codeで開き直し、git remote の動作確認
```

**移動しない場合**：旬レシピは現状維持で、新プロジェクトのみ新パスで開始しても全く問題ありません。本指示書は後者を前提に進めます。

### 1-3. 二層ブランドを反映したモノレポ構成

```bash
# soraban_hinomori 配下に戻る
cd ~/Dev/meldcarta/soraban_hinomori

# サービス層（Hinomori）とエンジン層（Soraban）を分離
mkdir -p apps/hinomori-web        # エンドユーザー向けSaaS UI
mkdir -p apps/soraban-engine      # 規制判定エンジン本体
mkdir -p apps/soraban-scraper     # 例規集スクレイパー
mkdir -p apps/soraban-api         # Edge Functions（判定API）

mkdir -p packages/db              # Supabaseマイグレーション
mkdir -p packages/regulations     # 共通型定義（Soraban内部DSL）
mkdir -p packages/geo             # Geocoding/PostGIS用ヘルパー
mkdir -p packages/ui              # Hinomori UIコンポーネント

mkdir -p docs/patent              # 特許関連（gitignore対象）
mkdir -p docs/architecture        # アーキテクチャ図・ADR
mkdir -p docs/decisions           # 意思決定ログ
mkdir -p docs/labor               # 労務証跡（開発時間記録等）

mkdir -p .claude
mkdir -p scripts

# 構成確認
find . -type d -not -path '*/node_modules/*' | sort
```

**期待されるディレクトリツリー**：

```
.
./.claude
./apps
./apps/hinomori-web
./apps/soraban-api
./apps/soraban-engine
./apps/soraban-scraper
./docs
./docs/architecture
./docs/decisions
./docs/labor
./docs/patent
./packages
./packages/db
./packages/geo
./packages/regulations
./packages/ui
./scripts
```

✅ **完了確認**：`pwd` の出力が `/Users/nori/Dev/meldcarta/soraban_hinomori` で、上記17ディレクトリが揃っていること。

---

## 2. セキュリティと知財分離の初期設定（所要約5分）

### 2-1. .gitignore 作成

```bash
cat > .gitignore << 'EOF'
# 環境変数
.env
.env.*
!.env.example

# Node
node_modules/
dist/
build/
.next/
.turbo/
.DS_Store

# Python
__pycache__/
*.pyc
.venv/
venv/

# IDE
.vscode/settings.json
.idea/

# 特許関連（外部公開禁止）
docs/patent/drafts/
docs/patent/private/
docs/patent/*.draft.md
*.patent.md

# 労務証跡（プライベート）
docs/labor/private/
docs/labor/*.private.md

# Claude / AI
.claude/local/
.aider*

# Supabase
supabase/.branches
supabase/.temp

# ログ
*.log
EOF
```

### 2-2. .claude/settings.json 作成

```bash
cat > .claude/settings.json << 'EOF'
{
  "permissions": {
    "deny": [
      "Read(.env)",
      "Read(.env.*)",
      "Read(docs/patent/drafts/**)",
      "Read(docs/patent/private/**)",
      "Read(docs/labor/private/**)",
      "Bash(rm -rf*)",
      "Bash(git push --force*)",
      "Bash(git reset --hard*)",
      "Bash(sudo*)"
    ]
  }
}
EOF
```

### 2-3. 知財・労務分離の運用方針ファイル

開発主体・知財帰属・労務分離を明文化します。**これは将来の知財紛争・労務紛争の双方で証跡となる重要文書**です。

```bash
cat > docs/decisions/0001-ownership-and-labor-separation.md << 'EOF'
# ADR-0001: 知財帰属と労務分離の方針

**Status**: Accepted
**Date**: 2026-04-25
**Decider**: 奥田憲章

## Context

soraban_hinomori（Hinomori / Soraban）は、奥田憲章個人が屋号 Meld Carta のもとで開発するSaaSプロダクトである。
奥田は同時にフューチャーテック株式会社（タイヨー通信群）の従業員でもあるため、
職務発明法理および会社IT利用規程との明確な分離が必要である。

## Decision

1. **事業主体**：奥田憲章 個人（将来：合同会社メルドカルタ）
2. **知財帰属**：奥田憲章 個人。職務発明には該当しない
3. **開発時間**：業務時間外（平日19時以降・休日）に限定
4. **開発環境**：個人所有のMacおよび個人インターネット回線のみ使用
5. **使用禁止リソース**：
   - タイヨー通信／フューチャーテック貸与のPC・スマホ・タブレット
   - 会社のVPN・社内ネットワーク
   - 会社契約のクラウドサービス（OneDrive・Google Workspace等）
   - 会社の業務時間中の思考時間
6. **OneDrive運用**：会社OneDriveには本プロジェクトのコード・設計書を一切置かない
   - 会社業務に関連する成果物のみOneDrive使用可
   - 本プロジェクトの設計書・議事録は個人GoogleDriveまたはローカル＋GitHubに保管
7. **会社への事前情報共有**：
   - 岩荷所長へは「個人で副業として小規模なSaaS開発を進めている」旨を口頭で事前共有済み（または近日中に共有予定）
   - 利益相反の可能性が顕在化した時点で、ただちに書面で報告

## Consequences

- 開発スピードは業務時間内開発と比較して2〜3倍遅くなる（許容）
- 知財は完全に個人帰属し、将来の事業売却・ライセンス・出資受入が自由
- タイヨー通信との将来取引時にも、独立したベンダー関係として交渉可能

## References

- 特許法第35条（職務発明）
- フューチャーテック株式会社 就業規則第◯◯条（要確認）
EOF
```

> **TODO**：このファイルは作成後、就業規則を確認して該当条項番号を埋めてください。岩荷所長への事前共有が未済の場合は、近日中の実施を強く推奨します。

### 2-4. .env.example 雛形

```bash
cat > .env.example << 'EOF'
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Gemini API（Soraban エンジンの条文構造化用）
GEMINI_API_KEY=

# 国土地理院 API（Geocoding）
GSI_API_BASE=https://msearch.gsi.go.jp/

# Anthropic API（開発時のみ。本番ランタイムはGeminiに統一）
ANTHROPIC_API_KEY=

# Stripe（Phase 2のクローズドβから使用）
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=

# Resend（Phase 2の通知メール）
RESEND_API_KEY=
EOF
```

✅ **完了確認**：`.gitignore`・`.claude/settings.json`・`docs/decisions/0001-ownership-and-labor-separation.md`・`.env.example` の4ファイルが存在すること。

---

## 3. Git初期化と GitHub リポジトリ作成（所要約5分）

### 3-1. ローカルGit初期化

```bash
git init
git branch -M main

# Git の commit author を個人アカウントに設定（重要：労務分離の証跡）
git config user.name "Noriaki Okuda"
git config user.email "meldcarta@gmail.com"

# 設定確認
git config user.name
git config user.email
```

> **重要**：会社メールアドレス（タイヨー通信のドメイン）でコミットしないでください。すべてのコミットを個人メール（meldcarta@gmail.com）で行うことが、労務分離の重要な証跡になります。

### 3-2. GitHub プライベートリポジトリ作成

```bash
# gh CLI ログイン状態確認
gh auth status

# プライベートリポジトリ作成
gh repo create nor-product/soraban_hinomori \
  --private \
  --source=. \
  --description "Hinomori（サービス層）+ Soraban（規制計算エンジン）。山陰の業務ドローン運用者向けコンプライアンス統合SaaS。" \
  --remote=origin
```

### 3-3. 初回コミット用 README

```bash
cat > README.md << 'EOF'
# soraban_hinomori

山陰の業務ドローン運用者向けコンプライアンス統合SaaS。
航空法・小型無人機等飛行禁止法・自治体条例・民法・気象・緊急用務空域を、1案件単位で統合判定します。

## ブランド構造

| 層 | 名称 | 役割 |
|---|---|---|
| サービス層 | **Hinomori（日守）** | エンドユーザー向けSaaS |
| エンジン層 | **Soraban（空番）** | 規制計算エンジン・将来のOEM/API提供 |

## Status

**Phase 0**：データ層PoC（特許出願前・外部開示禁止）

## 起点エリア

- 鳥取県米子市・境港市
- 島根県出雲市

→ 山陰全域（鳥取県・島根県）→ 中国地方（広島・岡山・山口）と段階展開予定。

## 技術スタック

- Next.js 15 + Tailwind v4 + MapLibre GL
- Supabase (PostgreSQL 15 + PostGIS + pg_cron)
- Gemini 3 Flash-Lite（条文構造化）
- TypeScript strict / pnpm workspace
- Vercel（デプロイ）

## License

**Proprietary - All rights reserved.**
Copyright © 2026 奥田憲章 / Meld Carta

This software is the property of Noriaki Okuda (Meld Carta).
Unauthorized copying, modification, distribution, or use is strictly prohibited.

## Development

詳細は `docs/architecture/setup.md` を参照。
事業設計・知財帰属の方針は `docs/decisions/0001-ownership-and-labor-separation.md` を参照。
EOF
```

### 3-4. 初回コミット

```bash
git add .
git commit -m "chore: initial scaffold with security and IP separation baseline"
git push -u origin main
```

### 3-5. Push Protection と Secret Scanning 有効化

```bash
gh api -X PATCH /repos/nor-product/soraban_hinomori \
  -f security_and_analysis='{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}'
```

### 3-6. gitleaks pre-commit 有効化

```bash
# gitleaks インストール確認
which gitleaks || brew install gitleaks

# pre-commit フック作成
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
gitleaks protect --staged --redact --config-path=.gitleaks.toml || {
  echo "⛔ gitleaks: secrets detected. commit aborted."
  exit 1
}
EOF
chmod +x .git/hooks/pre-commit

# gitleaks 設定
cat > .gitleaks.toml << 'EOF'
[allowlist]
paths = [
  '''node_modules''',
  '''dist''',
  '''build''',
  '''\.next''',
]
EOF

git add .gitleaks.toml
git commit -m "chore: add gitleaks config"
git push
```

✅ **完了確認**：
- `gh repo view nor-product/soraban_hinomori --web` でブラウザが開き、Privateバッジが付いていること
- 全コミットが `meldcarta@gmail.com` の名前で記録されていること

---

## 4. Supabase プロジェクト作成（所要約10分）

### 4-1. Supabase プロジェクト新規作成

ブラウザ作業：

1. https://supabase.com/dashboard/projects へアクセス（**個人Googleアカウントでログイン**。タイヨー通信のGoogle Workspaceアカウントは絶対に使わない）
2. 「New Project」クリック
3. 設定値：
   - **Organization**：個人Org（無ければ新規作成、名称：`meldcarta`）
   - **Project name**：`soraban-hinomori`（Supabaseはアンダースコア不可のためハイフン）
   - **Database Password**：強力なものを生成し、1Password等に保管
   - **Region**：`Northeast Asia (Tokyo)`
   - **Pricing Plan**：Free

### 4-2. PostGIS と pg_cron の有効化

1. 作成後、左メニュー「Database」→「Extensions」
2. `postgis` を検索して **Enable**
3. `pg_cron` も **Enable**（スクレイパー定期実行用）

### 4-3. ローカルから接続するための設定

```bash
# Supabase CLI インストール
which supabase || brew install supabase/tap/supabase

# プロジェクトリンク
supabase login
supabase link --project-ref <Supabaseダッシュボード上のProject Ref>
```

### 4-4. .env 作成

```bash
cp .env.example .env

# Supabaseダッシュボードの Settings > API から以下を取得して .env に貼る
# - SUPABASE_URL
# - SUPABASE_ANON_KEY
# - SUPABASE_SERVICE_ROLE_KEY（絶対に外部公開しない）
```

✅ **完了確認**：`cat .env` で値が入っていること、かつ `git status` で `.env` が無視されていること。

---

## 5. データベーススキーマ作成（Claude Code に渡す）

VS Codeのターミナルで Claude Code を起動します。

### 5-1. Claude Code 起動

```bash
# 現在地確認
pwd
# /Users/nori/Dev/meldcarta/soraban_hinomori

# Claude Code 起動
claude
```

### 5-2. Claude Code に渡す初回プロンプト

以下を **そのままClaude Codeに貼り付け** てください。

```
あなたは soraban_hinomori プロジェクトの実装パートナーです。

# プロジェクト概要
山陰（鳥取県米子市・境港市、島根県出雲市）を起点とした、業務ドローン運用者向けコンプライアンス統合SaaSのPoCを構築します。

# ブランド構造（二層）
- Hinomori（日守）: エンドユーザー向けSaaS
- Soraban（空番）: 規制計算エンジン・将来のOEM/API提供

このため、ディレクトリ構成も `apps/hinomori-*`（サービス層）と `apps/soraban-*`（エンジン層）で
物理分離されています。エンジン層は将来単独でOEM/API提供できる粒度を意識して実装してください。

# Phase 0 の最終ゴール
鳥取県米子市の特定の緯度経度（例: 米子市役所 35.4283, 133.3309）と日時を入力すると、
PostGIS の ST_Contains で適用される自治体条例規制を 0.5 秒以内に返す Edge Function。

# 技術スタック
- Supabase (PostgreSQL 15 + PostGIS + pg_cron)
- Node.js 20 + TypeScript strict
- pnpm workspace（モノレポ）
- Playwright（例規集スクレイピング）
- Gemini 3 Flash-Lite（条文構造化）
- 国土地理院 Geocoding API

# モノレポ構成（既に作成済み）
apps/
├── hinomori-web/       # サービスフロント（Phase 1で着手）
├── soraban-engine/     # 規制計算エンジン本体
├── soraban-scraper/    # 例規集スクレイパー
└── soraban-api/        # Edge Functions（判定API）
packages/
├── db/                 # Supabaseマイグレーション
├── regulations/        # 共通型定義（Soraban内部DSL）
├── geo/                # Geocoding/PostGIS用ヘルパー
└── ui/                 # Hinomori UIコンポーネント（Phase 1）

# 重要な制約
1. 特許出願前のため、外部公開・SNS投稿・ブログ化は一切禁止
2. .env は絶対にコミットしない（gitleaks pre-commit で防御済み）
3. Anthropic API キーは開発時のみ。本番ランタイムはGeminiに統一
4. コミットメッセージは Conventional Commits（feat: / fix: / chore: / docs:）
5. 全ファイルは TypeScript strict モード
6. Soraban エンジン層は Hinomori サービス層から疎結合に保つ
   - エンジン層は「規制DB + 判定ロジック + API」のみ
   - サービス層は「UI + 認証 + 課金 + 通知」のみ

# 今日のタスク（順番に実行してください）
1. ルート package.json を pnpm workspace 設定で作成
2. tsconfig.base.json を作成（strict, ES2022, NodeNext）
3. packages/db に Supabase マイグレーションファイル作成：
   - regulations テーブル
     - id (uuid, primary key)
     - source_municipality (text, not null) // 例: '鳥取県米子市'
     - source_url (text, not null)
     - source_article (text) // 例: '米子市公園条例第3条'
     - regulation_category (enum)
     - raw_text (text, not null)
     - structured (jsonb, not null) // Sorabanの内部DSL
     - geom (GEOGRAPHY(POLYGON, 4326)) // PostGIS
     - applicable_drone_weight_g_min (integer)
     - applicable_drone_weight_g_max (integer)
     - valid_from (timestamptz)
     - valid_until (timestamptz)
     - last_verified_at (timestamptz, not null)
     - created_at (timestamptz, default now())
     - updated_at (timestamptz, default now())
   - regulation_categories enum:
     - aviation_law
     - small_drone_law
     - municipal_ordinance
     - civil_law
     - road_traffic_law
     - radio_law
     - emergency_use_airspace
   - GISTインデックス on geom
   - GINインデックス on structured
4. packages/regulations に共通型定義
   - Regulation
   - RegulationCategory
   - FlightContext (lat, lng, datetime, drone_weight_g, pilot_license)
   - ComplianceResult (overall: 'green'|'yellow'|'red', applicable_regulations[])
5. packages/geo に Geocoding ヘルパー（国土地理院API ラッパー）

各ステップ完了後、私に確認を求めてから次に進んでください。
不明点があれば必ず質問してください。勝手に推測で進めないこと。
```

### 5-3. Claude Code が完了したら

```bash
# 動作確認
pnpm install
pnpm -r typecheck

# マイグレーション適用
supabase db push

# コミット
git add .
git commit -m "feat: scaffold soraban engine with PostGIS schema"
git push
```

✅ **完了確認**：Supabaseダッシュボードの Database > Tables で `regulations` テーブルが見えること。

---

## 6. スクレイパー実装（Day 2〜3）

Day 1 完了の翌日以降、Claude Code に以下のプロンプトを渡します。

```
soraban_hinomori Phase 0 の続きです。

今日のタスク：
apps/soraban-scraper に、米子市の例規集（https://www.city.yonago.lg.jp/）から
ドローン関連条文を抽出するスクレイパーを実装してください。

要件：
1. Playwright で例規集トップから条例一覧を取得
2. キーワード「ドローン」「無人航空機」「小型無人機」「飛行」「ラジコン」で関連条例を抽出
3. 抽出した条文を Gemini 3 Flash-Lite に渡し、Soraban内部DSLとしてJSON構造化：
   {
     "regulation_category": "municipal_ordinance",
     "applicable_areas": [{"name": "...", "address": "...", "geometry_hint": "..."}],
     "applicable_drones": {"weight_min_g": 100, "weight_max_g": null},
     "exceptions": [...],
     "penalty": "...",
     "source_article": "..."
   }
4. applicable_areas を国土地理院APIでジオコーディング → POLYGON生成
5. Supabase に upsert
6. 同じ構造で境港市・出雲市にも対応できるよう municipality を引数化

注意事項（重要）：
- robots.txt を必ず尊重
- アクセス間隔は最低3秒
- User-Agent に連絡先メールを含める（meldcarta@gmail.com）
- 取得元URL・取得日時を必ずDBに記録（last_verified_at）
- スクレイピング履歴を docs/decisions/ にログ化（後日の訴訟対応の証跡）

完了したら、米子市の3条例で動作確認の結果を見せてください。
```

✅ **完了確認**：`regulations` テーブルに米子市の3件以上のデータが入っていること。

---

## 7. 判定API実装（Day 4）

```
soraban_hinomori Phase 0 の最終ステップです。

apps/soraban-api に Supabase Edge Function を実装してください。
これは Soraban エンジンの公開APIになります（将来のOEM/API提供時の基盤）。

エンドポイント：POST /functions/v1/check-compliance

入力：
{
  "lat": 35.4283,
  "lng": 133.3309,
  "datetime": "2026-05-01T10:00:00+09:00",
  "drone_weight_g": 900,
  "pilot_license": "level_2"
}

処理：
1. 緯度経度から PostGIS ST_Contains で該当 regulations を検索
2. datetime が valid_from <= datetime <= valid_until に該当するか
3. drone_weight_g, pilot_license が条例の applicable 条件にマッチするか
4. 結果を信号機形式（green/yellow/red）でスコアリング

出力：
{
  "overall": "yellow",
  "applicable_regulations": [
    {
      "category": "municipal_ordinance",
      "source": "米子市公園条例 第3条",
      "severity": "yellow",
      "summary": "...",
      "action_required": "公園管理者への事前申請"
    }
  ],
  "response_time_ms": 234,
  "engine_version": "soraban-0.1.0"
}

完了したら、鳥取DDSの3つの実績地点で動作確認してください：
- 産業廃棄物施設チムニー点検地点
- 米子市下水道管路点検地点
- 水源池水中点検地点
```

✅ **完了確認**：3地点とも500ms以内に応答が返り、人間の目で見て妥当な判定であること。

---

## 8. Day 5：精度検証と特許出願準備への移行

### 8-1. 精度ログ収集

`docs/decisions/0002-phase0-validation.md` を作成し、鳥取DDS PoC現場で実際に出会った規制と、Sorabanエンジンの判定結果を比較する精度ログを記録します。

目標：一致率80%以上。これを下回る場合は、プロンプトチューニング・スクレイパー精度向上を優先します。

### 8-2. 特許出願準備

このタイミングで以下を並行で進めます。

1. J-PlatPat で先行技術調査（キーワード：「例規集 構造化」「条例 地理情報」「無人航空機 規制 統合」）
2. 弁理士候補3社にメール送信（私からテンプレ提供可）
3. 島根よろず支援拠点に進捗報告
4. **岩荷所長への正式書面通知**（個人事業として進めることの再確認）

**この時点で外部への一切の情報開示を停止**してください。
以降、特許出願完了まで AIさんいんセミナー・SNS・ブログでの言及禁止。

---

## 9. VS Code 並行運用設定

旬レシピと soraban_hinomori を快適に切り替えるため、マルチルートワークスペースを作成します。

### 9-1. ワークスペース設定

旬レシピが現状 `~/プロダクト01/` 配下にある前提：

```bash
cat > ~/Dev/meldcarta/meldcarta.code-workspace << 'EOF'
{
  "folders": [
    { "name": "🚁 soraban_hinomori", "path": "soraban_hinomori" },
    { "name": "🍳 旬レシピ", "path": "../../プロダクト01/旬レシピ" }
  ],
  "settings": {
    "files.exclude": {
      "**/node_modules": true,
      "**/.next": true,
      "**/.turbo": true
    },
    "terminal.integrated.cwd": "${workspaceFolder}",
    "git.openRepositoryInParentFolders": "always"
  }
}
EOF
```

> **注**：旬レシピのパスは実際の配置に合わせて修正してください。`../../プロダクト01/旬レシピ` を実パスに置き換える。

VS Codeで開く：
```bash
code ~/Dev/meldcarta/meldcarta.code-workspace
```

### 9-2. ターミナル運用ルール

VS Codeのターミナルパネル右上の「分割」ボタンで横並びにすると、両プロジェクトを同時監視できます。

| ターミナル | 用途 | 起動コマンド |
|---|---|---|
| 1 | 旬レシピ開発 | （既存運用） |
| 2 | soraban_hinomori 開発 | `cd ~/Dev/meldcarta/soraban_hinomori && claude` |
| 3 | Supabase ログ監視 | `cd ~/Dev/meldcarta/soraban_hinomori && supabase functions serve` |

---

## 10. 知財・労務分離の運用ルール（毎日意識すること）

これは技術ではなく、**個人事業主としての日常規律**です。Phase 0〜Phase 3の全期間で守ってください。

### 守るべき5原則

| # | 原則 | 違反時のリスク |
|---|---|---|
| 1 | 業務時間外（平日19時以降・休日）のみ開発 | 職務発明扱いされる可能性 |
| 2 | 個人MacおよびWi-Fiのみ使用 | 会社資産を使った成果物として帰属が疑われる |
| 3 | 会社OneDrive・会社Google Workspaceに本プロジェクトのファイルを置かない | 会社のデータ管理規程違反、所有権の混濁 |
| 4 | git commit author を `meldcarta@gmail.com` で固定 | コミット履歴で個人成果物であることが立証可能 |
| 5 | 開発時間記録を `docs/labor/` に残す（任意だが強く推奨） | 万一の労務紛争時の客観証拠 |

### 開発時間記録の最小フォーマット

`docs/labor/2026-04.md` のような月次ファイルで、以下を毎日1行ずつ記録：

```
## 2026-04-25 (Sat) 09:00–12:30 (3.5h)
- soraban_hinomori 初期スキャフォールド作成
- 場所: 自宅
- 端末: 個人MacBook Pro
- 回線: 自宅光回線
```

これは将来、特許出願時の発明者立証や、万一の会社との紛争時に**極めて強力な証拠**になります。**5分の手間で数千万円のリスクを回避できる**ので、強く推奨します。

---

## 11. Day 1 完了チェックリスト

- [ ] `~/Dev/meldcarta/soraban_hinomori/` ディレクトリ作成完了
- [ ] 二層モノレポ構成（apps/hinomori-* と apps/soraban-*）作成完了
- [ ] `.gitignore`・`.claude/settings.json`・`docs/decisions/0001-*.md`・`.env.example` 設置完了
- [ ] git config の user.email が `meldcarta@gmail.com` であることを確認
- [ ] GitHub `nor-product/soraban_hinomori` プライベートリポジトリ作成完了
- [ ] gitleaks pre-commit / Push Protection 有効化完了
- [ ] Supabase プロジェクト作成・PostGIS有効化完了（個人アカウントで）
- [ ] `.env` に Supabase キー設定完了
- [ ] Claude Codeでスキーマ・型定義のスキャフォールド完了
- [ ] 初回コミット・プッシュ完了
- [ ] VS Codeワークスペースで旬レシピと並行運用可能な状態
- [ ] `docs/labor/2026-04.md` に本日の開発時間を記録

---

## 12. 困ったときの参照先

| 状況 | 参照先 |
|---|---|
| Supabase接続エラー | https://supabase.com/docs/guides/cli |
| PostGIS構文 | https://postgis.net/docs/reference.html |
| 国土地理院API | https://maps.gsi.go.jp/development/ichiran.html |
| DIPS2.0 仕様 | https://www.mlit.go.jp/koku/koku_fr10_000042.html |
| gitleaks 設定 | https://github.com/gitleaks/gitleaks |
| 職務発明法（特許法35条） | https://www.jpo.go.jp/system/laws/sangyou/shokumu/ |

---

## 13. 次に依頼すべきドキュメント

Day 1完了後、以下を私に依頼してください。

1. **特許①請求項ドラフト**（弁理士への持ち込み資料、米子・出雲の実施例込み）
2. **弁理士向け事業概要書**（A4 2〜3枚、Hinomori/Soraban二層構造を反映）
3. **NDA テンプレ**（クローズドβテスター用、日本語）
4. **岩荷所長宛の事前共有メール**（副業届けの形を取った丁寧版）
5. **鳥取県補助金継続申請書ドラフト**（ドローン社会実装モデル創出支援補助金）

---

## 14. 着手前の最終確認3点

以下のみ事前に確認してから Section 1 のコマンド実行に入ってください。

1. **gh CLIのログイン状態**：`gh auth status` で `Logged in to github.com as nor-only` 等が表示されるか
2. **個人GoogleアカウントでSupabase登録可能か**：会社Google Workspaceで誤ログインしないよう、ブラウザのプロファイルを個人用に切り替え
3. **旬レシピの実パス**：`ls ~/プロダクト01/` で旬レシピのディレクトリ名（日本語か英語か）を確認

これら3点が揃えば、**Section 1 から順に実行することでDay 1（約30分）で土台が完成**します。

---

**奥田様、ここまでで不明点や追加要望があれば即座に修正します。
特に Section 9-1 のワークスペース定義における旬レシピのパスと、Section 2-3 の就業規則の条項番号（後で埋める箇所）にご注意ください。**
