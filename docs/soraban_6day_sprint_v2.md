# そらばん（Soraban）- 6日間スプリント指示書

> **作成者**：奥田憲章
> **作成日**：2026年4月25日
> **目標**：4/30 木曜午前に岩荷所長へ動作デモ
> **ブランド**：そらばん（Soraban）
> **位置付け**：山陰の業務ドローン運用者向けコンプライアンス統合SaaS（社内開発中）

---

## 0. プロジェクト概要

### サービス命名

- **そらばん（Soraban）** ：「空（ドローン）」＋「番（守護）」＋「算盤（規制計算）」

### 開発体制

- 作成者：奥田憲章
- 開発フェーズ：社内開発中（PoC段階）
- 開発体制：奥田様（主開発）、岩荷所長（事業相談相手・了承済）、嘉藤さん・黒田さん（α/βテスター候補）

### 6日間スプリント目標

4/30 木曜午前のデモで、**米子市役所の緯度経度を入力 → 関連条例3件＋信号機UI**が表示される最小実装。

---

## 1. Day 1（4/25土 夜）：環境構築（所要1.5h）

### 1-1. ディレクトリ作成

```bash
# ローカル開発用ディレクトリ作成
mkdir -p ~/Dev/sanin
cd ~/Dev/sanin

# soraban プロジェクト作成
mkdir soraban
cd soraban
pwd
# 期待される出力：/Users/nori/Dev/sanin/soraban
```

### 1-2. OneDrive側の設計書置き場を作成

```bash
# 既存OneDriveパス内に soraban ディレクトリを作成（コードは置かない）
mkdir -p "/Users/nori/Library/CloudStorage/OneDrive-株式会社タイヨー通信/★My_Works/★★AIさんいん事業関連/★開発関連/soraban"

# 設計書サブディレクトリ
ONEDRIVE_DOCS="/Users/nori/Library/CloudStorage/OneDrive-株式会社タイヨー通信/★My_Works/★★AIさんいん事業関連/★開発関連/soraban"
mkdir -p "$ONEDRIVE_DOCS/01_事業企画"
mkdir -p "$ONEDRIVE_DOCS/02_議事録"
mkdir -p "$ONEDRIVE_DOCS/03_特許関連"
mkdir -p "$ONEDRIVE_DOCS/04_顧客資料"
mkdir -p "$ONEDRIVE_DOCS/05_デモ資料"
ls "$ONEDRIVE_DOCS"
```

### 1-3. モノレポ構成のスキャフォールド

```bash
cd ~/Dev/sanin/soraban

mkdir -p apps/web              # フロントUI（Next.js）
mkdir -p apps/scraper          # 例規集スクレイパー
mkdir -p apps/api              # Supabase Edge Functions
mkdir -p packages/db           # Supabaseマイグレーション
mkdir -p packages/regulations  # 共通型定義
mkdir -p packages/geo          # ジオコーディングヘルパー
mkdir -p docs                  # 簡易設計メモ（OneDriveの正本へのリンクのみ）
mkdir -p .claude
```

### 1-4. .gitignore と .claude/settings.json

```bash
cat > .gitignore << 'EOF'
.env
.env.*
!.env.example
node_modules/
dist/
build/
.next/
.turbo/
.DS_Store
__pycache__/
*.pyc
.venv/
.vscode/settings.json
.idea/
*.log
supabase/.branches
supabase/.temp
EOF

cat > .claude/settings.json << 'EOF'
{
  "permissions": {
    "deny": [
      "Read(.env)",
      "Read(.env.*)",
      "Bash(rm -rf*)",
      "Bash(git push --force*)",
      "Bash(git reset --hard*)",
      "Bash(sudo*)"
    ]
  }
}
EOF

cat > .env.example << 'EOF'
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GSI_API_BASE=https://msearch.gsi.go.jp/
ANTHROPIC_API_KEY=
EOF
```

### 1-5. README

```bash
cat > README.md << 'EOF'
# そらばん（Soraban）

山陰の業務ドローン運用者向けコンプライアンス統合SaaS。

## ブランド

- 名称：そらばん（Soraban）
- 由来：空（ドローン）＋ 番（守護）＋ 算盤（規制計算）

## 開発状況

**Phase 0**：6日間スプリント（4/25〜4/30）で米子市デモ版を作成中。
社内開発中（PoC段階）。

## 起点エリア

- 鳥取県米子市・境港市
- 島根県出雲市
- → 山陰全域 → 中国地方へ段階展開

## 技術スタック

- Next.js 15 + Tailwind v4 + MapLibre GL
- Supabase (PostgreSQL 15 + PostGIS + pg_cron)
- Gemini 3 Flash-Lite（条文構造化）
- TypeScript strict / pnpm workspace
- Vercel（デプロイ）

## 作成者

奥田憲章

## 設計書・議事録

OneDrive 側の設計書置き場を参照（パスはローカルメモを参照）。
EOF
```

### 1-6. Git 初期化と GitHub リポジトリ作成

```bash
git init
git branch -M main

# Git author 設定（普段お使いのメールアドレスで設定）
git config user.name "Noriaki Okuda"
git config user.email "<普段の開発で使うメールアドレス>"
git config user.email
# 設定確認

# GitHub プライベートリポジトリ作成
gh repo create nor-product/soraban \
  --private \
  --source=. \
  --description "そらばん（Soraban）山陰の業務ドローン運用者向けコンプライアンス統合SaaS。" \
  --remote=origin

# 初回コミット
git add .
git commit -m "chore: initial scaffold for soraban (Day 1)"
git push -u origin main

# Push Protection 有効化
gh api -X PATCH /repos/nor-product/soraban \
  -f security_and_analysis='{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}'
```

### 1-7. Supabase プロジェクト作成

ブラウザ作業：

1. https://supabase.com/dashboard/projects へアクセス
2. 「New Project」
3. 設定：
   - **Project name**：`soraban`
   - **Database Password**：強力なものを生成 → 1Password等に保管
   - **Region**：`Northeast Asia (Tokyo)`
   - **Pricing Plan**：Free

4. 作成後、左メニュー「Database」→「Extensions」で `postgis` と `pg_cron` を **Enable**

### 1-8. .env 作成と Supabase CLI ログイン

```bash
cp .env.example .env
# Supabaseダッシュボードの Settings > API から SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY を取得して .env に貼る

# Supabase CLI（旬レシピで導入済みなら不要）
which supabase || brew install supabase/tap/supabase
supabase login
supabase link --project-ref <ProjectRef>
```

### 1-9. Claude Code 起動 & スキーマ作成プロンプト

```bash
claude
```

以下を Claude Code に貼り付け：

```
あなたは「そらばん（Soraban）」プロジェクトの実装パートナーです。

# プロジェクト概要
- 山陰の業務ドローン運用者向けコンプライアンス統合システム
- 作成者：奥田憲章
- 現在は社内開発中（PoC段階）
- 4/30に米子市デモ版を完成させる超タイトなスケジュール

# 6日間スプリントゴール
4/30木曜の朝までに、米子市役所の緯度経度を入力すると、
米子市の関連条例3件以上が信号機形式（green/yellow/red）で表示される
動作デモを完成させる。

# Day 1（今日）のタスク
1. ルート package.json を pnpm workspace 設定で作成
2. tsconfig.base.json を作成（strict, ES2022, NodeNext）
3. packages/db に Supabase マイグレーション作成：
   - regulations テーブル：
     - id (uuid, primary key, default gen_random_uuid())
     - municipality (text, not null) // 例: '鳥取県米子市'
     - source_url (text, not null)
     - source_article (text) // 例: '米子市公園条例第3条'
     - regulation_category (enum)
     - severity (enum: 'green', 'yellow', 'red')
     - raw_text (text, not null)
     - structured (jsonb, not null)
     - geom (GEOGRAPHY(POLYGON, 4326)) // PostGIS
     - applicable_drone_weight_g_min (integer)
     - applicable_drone_weight_g_max (integer)
     - valid_from (timestamptz)
     - valid_until (timestamptz)
     - last_verified_at (timestamptz, not null)
     - created_at (timestamptz, default now())
     - updated_at (timestamptz, default now())
   - regulation_categories enum:
     - aviation_law, small_drone_law, municipal_ordinance,
       civil_law, road_traffic_law, radio_law, emergency_use_airspace
   - GIST インデックス on geom
   - GIN インデックス on structured

4. packages/regulations に共通型定義：
   - Regulation, RegulationCategory, FlightContext, ComplianceResult

5. packages/geo に国土地理院 Geocoding API ラッパー

# 重要な制約
- 全ファイル TypeScript strict
- コミットメッセージは Conventional Commits
- 4/30に動くものを最優先。完璧主義は捨てる
- .env は絶対にコミットしない

各ステップ完了後、私に確認してから次に進んでください。
```

### 1-10. Day 1 完了確認

```bash
pnpm install
pnpm -r typecheck
supabase db push

git add .
git commit -m "feat(db): add regulations schema with PostGIS support"
git push
```

✅ Supabaseダッシュボードの Database > Tables に `regulations` テーブルが見えていればOK。

---

## 2. Day 2（4/26日）：米子市スクレイパー実装（所要4〜5h）

Claude Code に以下のプロンプトを渡す：

```
そらばん Day 2 のタスクです。

apps/scraper に、米子市の例規集
https://www.city.yonago.lg.jp/
からドローン関連条例を抽出するスクレイパーを実装してください。

要件：
1. Playwright で例規集トップから条例一覧を取得
2. キーワード「ドローン」「無人航空機」「小型無人機」「飛行」「ラジコン」で
   関連条例を抽出（最低3件以上）
3. 抽出した条文を Gemini 3 Flash-Lite で構造化：
   {
     "regulation_category": "municipal_ordinance",
     "severity": "yellow",
     "applicable_areas": [{"name": "...", "address": "...", "geometry_hint": "..."}],
     "applicable_drones": {"weight_min_g": 100, "weight_max_g": null},
     "exceptions": [...],
     "penalty": "...",
     "source_article": "..."
   }
4. applicable_areas を国土地理院APIでジオコーディング → POLYGON生成
5. Supabase に upsert
6. CLI として実行可能：
   pnpm --filter scraper run scrape -- --municipality "鳥取県米子市"

注意事項：
- robots.txt 尊重
- アクセス間隔 最低3秒
- User-Agent: "Soraban Scraper / contact: <連絡用メールアドレス>"
- last_verified_at に取得日時を必ず記録

完了したら、米子市の3条例の格納結果を見せてください。
動かない条文は「penalty」「source_article」だけでもOK。
4/30デモのため完璧主義は捨て、まず動かす。
```

✅ regulations テーブルに米子市3件以上のデータが入っていればOK。

---

## 3. Day 3（4/27月 夜）：ジオコーディング精度向上（所要2〜3h）

```
そらばん Day 3 のタスクです。

Day 2でスクレイパーは動きましたが、ジオコーディング結果のPOLYGONが
不正確な可能性があります。以下を改善してください：

1. 米子市内の主要公園・施設のPOLYGONを手動データとして packages/geo/seed.ts に登録：
   - 米子城跡公園、湊山公園、米子市民球場、米子城址、米子総合公園 等
   - 概算POLYGONで構いません（ST_Buffer で半径200mの円でも可）

2. 上記とジオコーディング結果のマージ処理

3. 動作確認用にテストAPIを作成：
   curl http://localhost:54321/functions/v1/check \
     -d '{"lat":35.4283,"lng":133.3309,"datetime":"2026-05-01T10:00:00+09:00","drone_weight_g":900}'

   米子市役所座標で米子市条例3件がヒットすれば成功。

4. 鳥取DDS PoC実績の3地点でも動作確認（座標は私から後で渡します）
```

---

## 4. Day 4（4/28火 夜）：判定API実装（所要3h）

```
そらばん Day 4 のタスクです。

apps/api に Supabase Edge Function 「check-compliance」を実装してください。

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
2. datetime が valid_from <= datetime <= valid_until に該当するか判定
3. drone_weight_g, pilot_license が適用条件にマッチするか判定
4. 結果を信号機形式でスコアリング（green/yellow/red）
5. overall は最も厳しいレベルを返す

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

完了したら、米子市役所＋鳥取DDS3地点で動作確認。
```

---

## 5. Day 5（4/29水・祝）：最小UI実装（所要4〜5h）

```
そらばん Day 5 のタスクです。

apps/web に Next.js 15 + Tailwind v4 + MapLibre GL で最小UIを作成してください。

機能：
1. 中央に米子市を表示する地図（MapLibre GL、国土地理院ベクタータイル）
2. 地図クリックで緯度経度取得 → check-compliance API 呼び出し
3. 結果を右サイドカードで表示：
   - overall を信号機アイコンで大きく表示
   - applicable_regulations を1件ずつカード表示
   - 各カードに source / summary / action_required
4. 機体重量・操縦士資格の入力フォーム（簡易）

デザイン要件：
- シンプルで実用的なデザイン（PoCのため装飾は最小限）
- 「そらばん」ロゴはテキストロゴで仮置き（後日デザイナー対応）
- フッターは省略可（PoCのため）

ローカル起動：
pnpm dev
→ http://localhost:3000 で動作確認

完成形：
- 米子市役所をクリックすると条例3件が表示される
- 鳥取DDS PoC地点でも動作する
```

---

## 6. Day 6（4/30木 午前）：デモ最終調整＋岩荷所長デモ

```bash
# デモ前最終チェック
pnpm dev
# 鳥取DDS3地点 + 米子市役所 で動作確認

# Vercel デプロイ（任意、ローカルデモでも可）
vercel deploy
```

### デモシナリオ（5分版）

1. **オープニング**（30秒）
   - 「ドローン規制は航空法だけで7階層、自治体条例まで含めると現状確認に毎回30分以上かかる」
   - 「これを30秒に圧縮します」

2. **デモ実演**（2分）
   - 米子市役所をクリック → 条例3件が信号機UIで表示
   - 鳥取DDS PoC地点をクリック → 同じく即時判定
   - 機体重量変更 → 結果が動的に変化

3. **本質的価値**（1分）
   - 山陰の業務ドローン運用者の課題を解決
   - 将来的に山陰全38市町村→中国地方→全国へ
   - 損保・自治体・ゼネコンへの展開可能性

4. **次の一手**（1分30秒）
   - 5月：出雲市・境港市追加、特許出願準備
   - 6月：βテスト開始（鳥取DDS関係者・近隣顧客）
   - 10月：ぼうさいこくたい2026での発表検討
   - 補助金：鳥取県ドローン社会実装モデル創出支援補助金の継続申請

---

## 7. デモ後（5月以降）に着手する事項

| 時期 | 事項 | 主担当 |
|---|---|---|
| 5月上旬 | 出雲市・境港市の例規集追加 | 奥田様 |
| 5月中旬 | 特許①出願準備（J-PlatPat先行調査、弁理士アサイン） | 奥田様＋弁理士 |
| 5月下旬 | 上層部への正式報告（必要に応じて） | 岩荷所長＋奥田様 |
| 5月末 | 鳥取県補助金継続申請（必要に応じて） | 奥田様 |
| 6月 | βテスター10〜20社のクローズドβ | 全員 |
| 7月 | 価格設定・課金開始 | 経営判断 |
| 8月 | 関連セミナーで初公開（タイミング次第） | 奥田様 |
| 10月 | ぼうさいこくたい2026 倉吉での発表検討 | 関係者調整 |

---

## 8. リスク管理（4/30デモまでに詰まったら）

| 障害 | 対処法 |
|---|---|
| Day 2でスクレイパーが動かない | 米子市3条例を**手動でDBに直接INSERT**して先に進む（デモ優先） |
| Day 3でジオコーディングが不正確 | 主要公園を手動POLYGONで登録（精度80%でOK） |
| Day 4でAPIが遅い | キャッシュ・インデックスはデモ後に最適化 |
| Day 5でUIがダサい | Tailwind UI のテンプレを流用、ロゴはテキストのみ |
| 4/30デモに間に合わない | 4/30夜→5/1朝に延期、岩荷所長に正直に報告 |

**完璧主義は完全に捨ててください。** 4/30は「動作確認デモ」であり、製品リリースではありません。岩荷所長との信頼関係を考えれば、「動くもの」を見せるほうが「美しいPowerPoint」より100倍説得力があります。

---

## 9. 着手前の最終確認3点

### 9-1. gh CLI ログイン確認

```bash
gh auth status
```

未ログインの場合：
```bash
gh auth login
# GitHub.com → HTTPS → Login with web browser
```

### 9-2. 旬レシピディレクトリのパス確認

```bash
ls ~/プロダクト01/
# 旬レシピのフォルダ名を確認
```

VS Code ワークスペース定義に反映するため：

```bash
cat > ~/Dev/sanin/sanin.code-workspace << 'EOF'
{
  "folders": [
    { "name": "🚁 そらばん", "path": "soraban" }
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

code ~/Dev/sanin/sanin.code-workspace
```

### 9-3. Git author 設定確認

```bash
git config user.email
# 設定したメールアドレスが返ること
```

---

## 10. デモ用 1ページ説明資料（OneDrive側で別途作成）

岩荷所長デモ時の補助資料を、OneDriveの `05_デモ資料/` 配下にA4 1枚で作成します。これは**4/29水曜日の作業合間**に作成。

内容：
- そらばんとは何か（30秒で読める）
- 解決する課題（3つ）
- 競合との差分（条例レイヤー独自対応）
- ビジネスモデル（月額課金・自治体ライセンス）
- 今後のロードマップ（5月〜10月）

このA4資料の作成も、私に依頼してください。pro-biz-doc-ja スキルでプロ品質の完成版を作成します。

---

## 11. 旬レシピとの並行運用

VS Code でターミナル分割：

| ターミナル | 用途 | 起動コマンド |
|---|---|---|
| 1 | 旬レシピ開発 | （既存） |
| 2 | そらばん開発 | `cd ~/Dev/sanin/soraban && claude` |
| 3 | Supabase ログ | `cd ~/Dev/sanin/soraban && supabase functions serve` |
| 4 | Next.js 開発サーバー | `cd ~/Dev/sanin/soraban && pnpm dev` |

---

## 12. 今すぐの一手

VS Code で別ターミナルを開いて、Section 1-1 のコマンドから順に実行してください。

```bash
mkdir -p ~/Dev/sanin
cd ~/Dev/sanin
mkdir soraban
cd soraban
pwd
```

これで Day 1 がスタートします。**約1.5時間で Section 1-10 まで完走できます。**

詰まったら、エラーメッセージごと貼り付けて私に質問してください。即座に解決策を返します。

岩荷所長への4/30デモ、確実に成功させましょう。
