# SanFlightGuard 開発キックオフ指示書

> 対象：奥田憲章 / フューチャーテック株式会社 出雲拠点
> 作成日：2026年4月25日
> 想定環境：macOS + VS Code + Claude Code + GitHub `nor-product`
> 並行プロジェクト：旬レシピ（別ターミナル・別ディレクトリで進行中）

---

## 0. このドキュメントの読み方

VS Codeで**新しいターミナルを別ペインで開き**、上から順にコピー＆ペーストで実行できるよう構成しています。
旬レシピのターミナルは閉じる必要はありません。タブを切り替えて並行開発できます。

各セクションの末尾に **「✅ 完了確認」** があります。次のセクションに進む前に必ず確認してください。

---

## 1. ディレクトリ作成と初期化（所要約5分）

### 1-1. 既存の「プロダクト01」配下に新規ディレクトリ作成

```bash
# プロダクト01ディレクトリへ移動（既存の旬レシピと同階層）
cd ~/プロダクト01

# 現在の状況確認（旬レシピ等の既存プロジェクトが見えるはず）
ls -la

# SanFlightGuard ディレクトリ作成
mkdir SanFlightGuard
cd SanFlightGuard

# 現在地確認
pwd
# 期待される出力例：/Users/noriaki/プロダクト01/SanFlightGuard
```

### 1-2. モノレポ構成のスキャフォールド作成

```bash
# ディレクトリ構成を一括作成
mkdir -p apps/scraper apps/api apps/web
mkdir -p packages/db packages/regulations packages/geo
mkdir -p docs/patent docs/architecture docs/decisions
mkdir -p .claude
mkdir -p scripts

# ツリー確認
find . -type d -not -path '*/node_modules/*' | sort
```

**期待される出力**：

```
.
./.claude
./apps
./apps/api
./apps/scraper
./apps/web
./docs
./docs/architecture
./docs/decisions
./docs/patent
./packages
./packages/db
./packages/geo
./packages/regulations
./scripts
```

✅ **完了確認**：`pwd` の出力が `~/プロダクト01/SanFlightGuard` で、上記10ディレクトリが揃っていること。

---

## 2. セキュリティ初期設定（所要約3分）

旬レシピ運用と同じ規律を最初から強制します。

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
*.patent.md

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

### 2-2. .claude/settings.json 作成（旬レシピと同等の防御設定）

```bash
cat > .claude/settings.json << 'EOF'
{
  "permissions": {
    "deny": [
      "Read(.env)",
      "Read(.env.*)",
      "Read(docs/patent/drafts/**)",
      "Read(docs/patent/private/**)",
      "Bash(rm -rf*)",
      "Bash(git push --force*)",
      "Bash(git reset --hard*)",
      "Bash(sudo*)"
    ]
  }
}
EOF
```

### 2-3. gitleaks pre-commit フック設定

```bash
# gitleaks インストール確認（旬レシピで導入済みのはず）
which gitleaks || brew install gitleaks

# pre-commit フック作成
mkdir -p .git/hooks 2>/dev/null
# Gitリポジトリはこの後初期化するので、フック設定は section 3 後に実施
```

### 2-4. .env.example 雛形

```bash
cat > .env.example << 'EOF'
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Gemini API（条例構造化用）
GEMINI_API_KEY=

# 国土地理院 API（Geocoding）
GSI_API_BASE=https://msearch.gsi.go.jp/

# Anthropic API（開発時のみ。本番はGeminiに統一）
ANTHROPIC_API_KEY=
EOF
```

✅ **完了確認**：`.gitignore`・`.claude/settings.json`・`.env.example` の3ファイルが存在すること。

---

## 3. Git初期化と GitHub リポジトリ作成（所要約5分）

### 3-1. ローカルGit初期化

```bash
git init
git branch -M main

# gh CLI で GitHub にプライベートリポジトリ作成
gh repo create nor-product/sanflight-mvp \
  --private \
  --source=. \
  --description "山陰の業務ドローン運用者向けコンプライアンス統合SaaS（米子・出雲起点）" \
  --remote=origin
```

### 3-2. 初回コミット

```bash
# README 仮置き
cat > README.md << 'EOF'
# SanFlightGuard

山陰の業務ドローン運用者向けコンプライアンス統合SaaS。
航空法・条例・民法・気象・緊急用務空域を1案件単位で統合判定します。

**Status**: PoC（Phase 0）
**起点**: 鳥取県米子市・境港市・島根県出雲市
**Stack**: Next.js 15 / Supabase (PostGIS) / Gemini 3 Flash-Lite / Vercel

## 開発開始

`docs/architecture/setup.md` を参照してください。

## License

Proprietary - All rights reserved.
EOF

git add .
git commit -m "chore: initial scaffold with security baseline"
git push -u origin main
```

### 3-3. Push Protection と Secret Scanning 有効化

```bash
gh api -X PATCH /repos/nor-product/sanflight-mvp \
  -f security_and_analysis='{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}'
```

### 3-4. gitleaks pre-commit 有効化

```bash
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
gitleaks protect --staged --redact --config-path=.gitleaks.toml || {
  echo "⛔ gitleaks: secrets detected. commit aborted."
  exit 1
}
EOF
chmod +x .git/hooks/pre-commit

# gitleaks 設定（旬レシピと同等）
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

✅ **完了確認**：`gh repo view nor-product/sanflight-mvp --web` でブラウザが開き、Privateバッジが付いていること。

---

## 4. Supabase プロジェクト作成（所要約10分）

ブラウザ作業＋CLIです。

### 4-1. Supabase プロジェクト新規作成

1. https://supabase.com/dashboard/projects へアクセス
2. 「New Project」クリック
3. 設定値：
   - **Project name**: `sanflight-mvp`
   - **Database Password**: 強力なものを生成し、1Passwordなどに保管
   - **Region**: `Northeast Asia (Tokyo)` を選択（地理院APIとレイテンシ最適）
   - **Pricing Plan**: Free（初期はFreeで十分）

### 4-2. PostGIS 拡張の有効化

1. 作成後、左メニュー「Database」→「Extensions」
2. `postgis` を検索して **Enable**
3. ついでに `pg_cron`（後でスクレイパー定期実行用）も Enable

### 4-3. ローカルから接続するための設定

```bash
# Supabase CLI インストール（旬レシピで導入済みなら不要）
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

## 5. データベーススキーマ作成（Claude Code に丸投げ）

ここから **Claude Code** に作業を渡します。VS Codeで Claude Code を起動してください。

### 5-1. Claude Code 起動

VS Codeのターミナルで：

```bash
# 現在地確認
pwd
# /Users/noriaki/プロダクト01/SanFlightGuard

# Claude Code 起動
claude
```

### 5-2. Claude Code に渡す初回プロンプト

以下を **そのままClaude Codeに貼り付け** てください。

```
あなたは SanFlightGuard プロジェクトの実装パートナーです。

# プロジェクト概要
山陰（鳥取県米子市・境港市、島根県出雲市）を起点とした、業務ドローン運用者向けコンプライアンス統合SaaSのPoCを構築します。最終形では航空法・小型無人機等飛行禁止法・自治体条例・民法・気象・緊急用務空域を統合判定しますが、Phase 0では「自治体例規集を構造化してPostGISに格納し、座標+日時を入れたら適用条例を返すAPI」までを作ります。

# 技術スタック
- Supabase (PostgreSQL 15 + PostGIS + pg_cron)
- Node.js 20 + TypeScript
- Playwright（例規集スクレイピング）
- Gemini 3 Flash-Lite（条文構造化）
- 国土地理院 Geocoding API
- pnpm workspace（モノレポ）

# モノレポ構成（既に作成済み）
apps/scraper - 例規集クローラー
apps/api     - Supabase Edge Functions
apps/web     - Next.js 15（Phase 1で着手、Phase 0では触らない）
packages/db  - Supabaseマイグレーション
packages/regulations - 共通型定義
packages/geo - Geocoding/PostGIS用ヘルパー

# 重要な制約
1. 特許出願前のため、外部への成果物公開・SNS投稿・ブログ化は一切禁止
2. .env は絶対にコミットしない（gitleaks pre-commit で防御済み）
3. Anthropic API キーは開発時のみ。本番ランタイムは Gemini に統一
4. コミットメッセージは Conventional Commits（feat: / fix: / chore: / docs:）
5. 全ファイルは TypeScript strict モード

# Phase 0 の最終ゴール
鳥取県米子市の特定の緯度経度（例：米子市役所 35.4283, 133.3309）と日時を入力すると、PostGIS の ST_Contains で適用される自治体条例規制を 0.5 秒以内に返す Edge Function。

# 今日のタスク（順番に実行してください）
1. ルート package.json を pnpm workspace 設定で作成
2. tsconfig.base.json を作成（strict, ES2022, NodeNext）
3. packages/db に Supabase マイグレーションファイル作成：
   - regulations テーブル（id, source_municipality, source_url, regulation_type, raw_text, structured, geom GEOGRAPHY, valid_from, valid_until, created_at）
   - regulation_categories enum（aviation_law, small_drone_law, municipal_ordinance, civil_law, road_traffic, radio_law）
   - 必要なPostGISインデックス（GIST on geom）
4. packages/regulations に共通型定義（Regulation, RegulationCategory, FlightContext, ComplianceResult）
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
git commit -m "feat: scaffold monorepo with PostGIS schema"
git push
```

✅ **完了確認**：Supabaseダッシュボードの Database > Tables で `regulations` テーブルが見えること。

---

## 6. スクレイパー実装（Day 2〜3）

Day 1（上記）が完了したら、翌日以降に Claude Code へ次のプロンプトを渡します。

```
SanFlightGuard Phase 0 の続きです。

今日のタスク：
apps/scraper に、米子市の例規集（https://www.city.yonago.lg.jp/）から
ドローン関連条文を抽出するスクレイパーを実装してください。

要件：
1. Playwright で例規集トップから条例一覧を取得
2. キーワード「ドローン」「無人航空機」「小型無人機」「飛行」で関連条例を抽出
3. 抽出した条文を Gemini 3 Flash-Lite に渡し、以下のJSON構造化：
   {
     "regulation_type": "...",
     "applicable_areas": [{"name": "...", "address": "...", "geometry_hint": "..."}],
     "applicable_drones": {"weight_min_g": 100, ...},
     "exceptions": [...],
     "penalty": "...",
     "source_article": "..."
   }
4. applicable_areas を国土地理院APIでジオコーディング
5. Supabase に upsert
6. 同じ構造で境港市・出雲市にも対応できるよう municipality を引数化

注意事項：
- robots.txt を必ず尊重
- アクセス間隔は最低3秒
- User-Agent に連絡先メールを含める
- 取得元URL・取得日時を必ずDBに記録（後で訴訟対応の証跡になる）

完了したら、米子市の3条例で動作確認の結果を見せてください。
```

✅ **完了確認**：`regulations` テーブルに米子市の3件以上のデータが入っていること。

---

## 7. 判定API実装（Day 4）

```
SanFlightGuard Phase 0 の最終ステップです。

apps/api に Supabase Edge Function を実装してください。

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
      "source": "米子市公園条例",
      "severity": "yellow",
      "summary": "...",
      "action_required": "公園管理者への事前申請"
    }
  ],
  "response_time_ms": 234
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

```bash
# 鳥取DDSのPoC現場で実際に出会った規制を手動で記録
# docs/decisions/phase0-validation.md を作成
```

### 8-2. 弁理士への初回連絡

このタイミングで以下を並行で進めます。

1. J-PlatPat で先行技術調査（キーワード：「例規集 構造化」「条例 地理情報」「無人航空機 規制 統合」）
2. 弁理士候補3社にメール送信（私からテンプレ提供可）
3. 島根よろず支援拠点に進捗報告

**この時点で外部への一切の情報開示を停止してください。**
以降、特許出願完了まで AIさんいんセミナー・SNS・ブログでの言及禁止。

---

## 9. 旬レシピと並行運用するためのVS Code設定

### 9-1. ワークスペース化（推奨）

VS Codeで両プロジェクトを快適に切り替えるため、マルチルートワークスペースを作成します。

```bash
cd ~/プロダクト01

cat > プロダクト01.code-workspace << 'EOF'
{
  "folders": [
    { "name": "🍳 旬レシピ", "path": "shunrecipe" },
    { "name": "🚁 SanFlightGuard", "path": "SanFlightGuard" }
  ],
  "settings": {
    "files.exclude": {
      "**/node_modules": true,
      "**/.next": true
    },
    "terminal.integrated.cwd": "${workspaceFolder}"
  }
}
EOF
```

> **注**：`shunrecipe` の部分は実際のディレクトリ名に合わせて修正してください。

VS Codeで開く：
```bash
code プロダクト01.code-workspace
```

### 9-2. ターミナル運用ルール

| ターミナル | 用途 | 起動コマンド |
|---|---|---|
| 1番目 | 旬レシピ開発 | （既存） |
| 2番目 | SanFlightGuard 開発 | `cd ~/プロダクト01/SanFlightGuard && claude` |
| 3番目 | Supabase ログ監視 | `cd ~/プロダクト01/SanFlightGuard && supabase functions serve` |

VS Codeのターミナルパネル右上の「分割」ボタンで横並び表示にすると、両プロジェクトを同時監視できます。

---

## 10. 完了チェックリスト（Day 1終了時点）

- [ ] `~/プロダクト01/SanFlightGuard/` ディレクトリ作成完了
- [ ] モノレポ構成（apps/, packages/, docs/）作成完了
- [ ] `.gitignore`・`.claude/settings.json`・`.env.example` 設置完了
- [ ] GitHub `nor-product/sanflight-mvp` プライベートリポジトリ作成完了
- [ ] gitleaks pre-commit / Push Protection 有効化完了
- [ ] Supabase プロジェクト作成・PostGIS有効化完了
- [ ] `.env` に Supabase キー設定完了
- [ ] Claude Codeでスキーマ・型定義のスキャフォールド完了
- [ ] 初回コミット・プッシュ完了
- [ ] VS Codeワークスペースで旬レシピと並行運用可能な状態

---

## 11. 困ったときの参照先

| 状況 | 参照先 |
|---|---|
| Supabase接続エラー | https://supabase.com/docs/guides/cli |
| PostGIS構文 | https://postgis.net/docs/reference.html |
| 国土地理院API | https://maps.gsi.go.jp/development/ichiran.html |
| DIPS2.0 仕様 | https://www.mlit.go.jp/koku/koku_fr10_000042.html |
| gitleaks 設定 | https://github.com/gitleaks/gitleaks |

---

## 12. 次のドキュメント

Day 1完了後、以下のドキュメントが順次必要になります。私に依頼してください。

1. **特許①請求項ドラフト**（弁理士への持ち込み資料）
2. **弁理士向け事業概要書**（A4 2〜3枚）
3. **鳥取県補助金継続申請書ドラフト**（ドローン社会実装モデル創出支援補助金）
4. **NDA テンプレ**（クローズドβテスター用、日本語・英語両対応）

---

**奥田様、ここまでで不明点や追加要望があれば即座に修正します。
特に「プロダクト01」配下の実際のディレクトリ名（旬レシピが英語名か日本語名か）と、gh CLIのログイン状態だけ最初にご確認ください。**
