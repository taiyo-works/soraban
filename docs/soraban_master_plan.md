# そらばん（Soraban）マスタープラン

> **作成者**：奥田憲章
> **作成日**：2026年4月25日
> **位置付け**：山陰の業務ドローン運用者向けコンプライアンス統合SaaS
> **開発フェーズ**：個人開発（社内検討段階）→ 将来的な事業化・特許出願・売却を視野
> **直近目標**：4/30 木曜午前にデモ完成

---

## 第I部：プロダクトの全体像

### 1. プロダクト名と命名意図

**そらばん（Soraban）**

- 「**空**（ドローンが飛ぶ空域）」
- 「**番**（守護・番人としての役割）」
- 「**算盤**（複雑な規制を瞬時に計算する）」

この三重の意味を、覚えやすい4音の和語に圧縮しています。日本人にも英語圏（Soraban）にも違和感なく響き、商標としての独自性も高い名前です。

### 2. 解決する課題

業務でドローンを飛ばす際、運用者は最低6階層の規制を確認する必要があります。

| 規制レイヤー | 既存ツール対応 |
|---|---|
| 航空法（DID・空港・150m） | カバーされている |
| 小型無人機等飛行禁止法 | 部分的にカバー（2026年改正で複雑化） |
| 緊急用務空域 | 別途国交省HP確認が必要 |
| **自治体条例** | **完全に空白地帯** |
| 民法（地権者上空権） | 未対応 |
| 道路交通法・電波法 | 未対応 |

特に**自治体条例レイヤーは既存サービス全社の盲点**です。例えば米子市内の公園で飛ばすにも条例上の制約があり得ますが、これを地理空間で即座に判定できるツールは存在しません。

### 3. プロダクト概要

業務ドローン運用者が、案件の予定地（緯度経度）と日時を入力すると、6階層の規制を**A〜Dリスクスコア（信号機UI）**で即時判定するWebサービス。

**4つのコアモジュール**：

- **Module A：統合規制マップ** — 規制を信号機UIで即時提示
- **Module B：条例AIスクレイパー（特許コア）** — 全自治体の例規集をLLMで構造化しPostGIS化
- **Module C：書類自動生成** — DIPS2.0申請書プリフィル、地権者承諾書、点検報告書PDF
- **Module D：ヒヤリハット共有DB** — 業界横断の事故・ヒヤリハットを匿名共有

### 4. 競合優位性

国交省自身も「民間アプリは便利だが最終判断は公的データを」と現状の限界を認めており、**条例レイヤーを公式DB化したサービスは存在しません**。これがそらばんの参入障壁になります。

2026年は規制の転換点で、小型無人機等飛行禁止法では重要施設周辺（おおむね300m）での飛行が制限され、違反には直罰が科されます。さらにレベル4（第三者上空の目視外飛行）の運用拡大やドローン航路の整備（航路登録制度は2026年度開始目標）が進み、DIPS2.0との連携も深化する方向です。**規制が複雑化し、エコシステムが立ち上がるこの瞬間が、参入の最適タイミング**です。

---

## 第II部：事業戦略

### 5. 段階的展開計画

| Phase | 期間 | カバレッジ | 目標 |
|---|---|---|---|
| Phase 0：PoC | 4月末 | 米子市3条例 | 動作デモ完成 |
| Phase 1：α版 | 〜7月 | 山陰主要12自治体 | 内部利用 |
| Phase 2：β版 | 〜10月 | 山陰全域38〜42自治体 | クローズドβ・課金開始 |
| Phase 3：公開 | 〜12月 | 山陰全域 | ぼうさいこくたい2026で正式発表 |
| Phase 4：拡張 | 2027年〜 | 中国地方→全国 | 本格事業化 |

**起点**：鳥取県米子市・境港市・島根県出雲市の3市。鳥取DDS PoC実績3件と完全に重なる地域で、初期教師データが豊富です。

### 6. 想定顧客と料金モデル

**初期ターゲット**（山陰）：

- 太陽光パネル保守業者
- ゼネコン下請（地元の藤井基礎、地元測量会社）
- 自治体（道路河川・上下水道管理部門）
- 損保代理店（ドローン保険引受時のリスク評価）

**料金モデル（仮）**：

- スターター：月額 ¥3,000（個人事業主向け、月20件まで）
- ビジネス：月額 ¥9,800（法人向け、月100件まで）
- 自治体・大企業：年間契約 ¥600,000〜（無制限＋API提供）

ARR ¥3〜5M（30〜50社×平均月額¥10,000）が**山陰だけで現実的に取れる**規模感。これがβ版完了時点の目標値です。

### 7. 売却・出口戦略

| 優先度 | 買い手候補 | 買収理由 |
|---|---|---|
| ★★★ | 大手通信キャリア（NTT西／SoftBank／KDDI） | DIPS連携プレイヤーとして必須 |
| ★★★ | 電力系インフラ事業者 | 送電線・発電所点検ドローンの規制管理 |
| ★★ | 地域金融機関のスタートアップ投資枠 | 地元発SaaSへの投資意欲 |
| ★★ | ドローン専業上場企業（Terra Drone、ACSL等） | 機能内製化＋顧客基盤獲得 |
| ★★ | 損保系（東京海上、損保ジャパン、三井住友） | 引受リスク評価ツールとして |
| ★ | ゼネコン子会社のドローン部門 | インフラ点検案件の規制管理 |
| ★ | 自治体クラウドベンダー | 自治体側管理ツール展開 |

ARR ¥30〜50M到達時点で本格的なM&A検討の俎上に乗ります。SaaS価値評価（PSR3〜10倍）として、**売却価値¥100M〜¥500M**が現実的な期待レンジです。

### 8. 知財戦略（特許出願計画）

**特許①（本命）：例規集の自動構造化と地理空間DBへの変換システム**

請求項の核：

> 地方自治体が公開する例規データから、無人航空機の飛行に関する規制条文を大規模言語モデルにより抽出する工程と、抽出された規制条文に含まれる地名・施設名・地番・面積要件をジオコーディングして地理空間データベースに格納する工程と、利用者から入力された飛行予定地点の座標および日時に対し、前記地理空間データベースを参照して適用される規制を判定する工程と、を含むことを特徴とする無人航空機飛行可否判定システム。

新規性◎、進歩性○、産業上利用可能性◎。先行調査必須。

**特許②：マルチソース規制を統合した飛行可否スコアリング手法**

6規制レイヤーの重み付け統合アルゴリズム、機体重量・操縦士資格・保険有無による条件分岐。

**特許③（意匠権）：規制可視化マップUI**

信号機UIの配置・配色。

**商標**：そらばん／Soraban + ロゴ意匠

**出願タイミング**：Phase 0完了直後（5月中）。**外部公開（SNS・セミナー・ブログ）は出願日確保まで一切停止**が鉄則。

**費用感**：特許1件あたり弁理士費用30〜60万円（明細書品質次第）。商標1件3〜5万円。意匠1件5〜10万円。総額50〜100万円。

---

## 第III部：技術設計

### 9. 技術スタック（確定）

| 領域 | 採用技術 | 選定理由 |
|---|---|---|
| Frontend | Next.js 15 + Tailwind v4 + MapLibre GL | 既存スキル直結 |
| Backend | Supabase（PostGIS拡張）+ Edge Functions | PostGISが特許コアのDB |
| 条例構造化 | Gemini 3 Flash-Lite | 安価で高品質、日本語に強い |
| スクレイパー | Playwright + Cron | 自治体サイトの動的レンダリング対応 |
| 地図データ | 国土地理院ベクタータイル＋自前PostGIS | 公的データで信頼性確保 |
| 認証・課金 | Supabase Auth + Stripe | 標準構成 |
| デプロイ | Vercel | 既存運用と同じ |
| AI開発支援 | Claude Code + VS Code + GitHub | 既存運用 |
| 画像生成 | Antigravity（Claude Code補完） | 既存運用 |

### 10. ディレクトリ構成

**コード本体**（git管理・高速ローカル）：

```
~/Dev/sanin/soraban/
├── apps/
│   ├── web/        # Next.js フロント
│   ├── scraper/    # 例規集クローラー（Cron駆動）
│   └── api/        # Supabase Edge Functions
├── packages/
│   ├── db/         # Supabaseマイグレーション
│   ├── regulations/ # 共通型定義（内部DSL）
│   └── geo/        # Geocoding/PostGIS用ヘルパー
├── docs/
│   └── architecture/
└── .claude/
    └── settings.json
```

**設計書・議事録**（OneDrive既存パス・関係者と共有）：

```
/Users/nori/Library/CloudStorage/OneDrive-[既存]/[既存]/[既存]/soraban/
├── 01_事業企画/
├── 02_議事録/
├── 03_特許関連/
├── 04_顧客資料/
└── 05_デモ資料/
```

**重要な分離原則**：コードはローカル `~/Dev/sanin/soraban/` 配下のみ。OneDrive配下にはコードを一切置かない（同期競合・パフォーマンス劣化を防ぐ）。

### 11. データベーススキーマ（regulations テーブル）

```sql
CREATE TYPE regulation_category AS ENUM (
  'aviation_law',
  'small_drone_law',
  'municipal_ordinance',
  'civil_law',
  'road_traffic_law',
  'radio_law',
  'emergency_use_airspace'
);

CREATE TYPE severity_level AS ENUM ('green', 'yellow', 'red');

CREATE TABLE regulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_article TEXT,
  regulation_category regulation_category NOT NULL,
  severity severity_level NOT NULL DEFAULT 'yellow',
  raw_text TEXT NOT NULL,
  structured JSONB NOT NULL,
  geom GEOGRAPHY(POLYGON, 4326),
  applicable_drone_weight_g_min INTEGER,
  applicable_drone_weight_g_max INTEGER,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_regulations_geom ON regulations USING GIST (geom);
CREATE INDEX idx_regulations_structured ON regulations USING GIN (structured);
CREATE INDEX idx_regulations_municipality ON regulations (municipality);
```

### 12. APIエンドポイント設計

**POST /functions/v1/check-compliance**

入力：
```json
{
  "lat": 35.4283,
  "lng": 133.3309,
  "datetime": "2026-05-01T10:00:00+09:00",
  "drone_weight_g": 900,
  "pilot_license": "level_2"
}
```

出力：
```json
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
```

---

## 第IV部：6日間スプリント実行計画（4/25〜4/30）

### 全体ロードマップ

| Day | 日付 | 作業 | 完了の証 | 所要時間 |
|---|---|---|---|---|
| D1 | 4/25(土)夜 | 環境構築・Supabase起動・スキーマ | regulationsテーブル作成済 | 1.5h |
| D2 | 4/26(日) | 米子市例規集スクレイパー＋Gemini構造化 | DBに米子市3条例格納 | 4〜5h |
| D3 | 4/27(月)夜 | ジオコーディング・PostGIS格納完了 | 緯度経度クエリで条例ヒット | 2〜3h |
| D4 | 4/28(火)夜 | 判定API（Edge Function）実装 | curl で JSON応答取得 | 3h |
| D5 | 4/29(水・祝) | 最小UI（地図ピン＋結果カード） | localhost:3000で動作 | 4〜5h |
| D6 | 4/30(木)午前 | デモ最終調整 | デモ実施・OK取得 | 2h |

---

### Day 1 詳細手順（4/25 土夜）

#### Step 1-1：ディレクトリ作成

VS Codeで新規ターミナルを開いて実行：

```bash
mkdir -p ~/Dev/sanin
cd ~/Dev/sanin
mkdir soraban
cd soraban
pwd
# 期待出力：/Users/nori/Dev/sanin/soraban
```

#### Step 1-2：OneDrive側の設計書置き場を作成

```bash
ONEDRIVE_DOCS="/Users/nori/Library/CloudStorage/OneDrive-株式会社タイヨー通信/★My_Works/★★AIさんいん事業関連/★開発関連/soraban"
mkdir -p "$ONEDRIVE_DOCS/01_事業企画"
mkdir -p "$ONEDRIVE_DOCS/02_議事録"
mkdir -p "$ONEDRIVE_DOCS/03_特許関連"
mkdir -p "$ONEDRIVE_DOCS/04_顧客資料"
mkdir -p "$ONEDRIVE_DOCS/05_デモ資料"
```

#### Step 1-3：モノレポ構成

```bash
cd ~/Dev/sanin/soraban
mkdir -p apps/web apps/scraper apps/api
mkdir -p packages/db packages/regulations packages/geo
mkdir -p docs .claude
```

#### Step 1-4：設定ファイル一式

```bash
# .gitignore
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

# .claude/settings.json
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

# .env.example
cat > .env.example << 'EOF'
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GSI_API_BASE=https://msearch.gsi.go.jp/
ANTHROPIC_API_KEY=
EOF
```

#### Step 1-5：README

```bash
cat > README.md << 'EOF'
# そらばん（Soraban）

山陰の業務ドローン運用者向けコンプライアンス統合SaaS。

## ブランド
名称：そらばん（Soraban）
由来：空 ＋ 番 ＋ 算盤

## 開発状況
Phase 0：6日間スプリント（4/25〜4/30）で米子市デモ版を作成中。

## 起点エリア
鳥取県米子市・境港市、島根県出雲市
→ 山陰全域 → 中国地方へ段階展開

## 技術スタック
Next.js 15 / Supabase (PostGIS) / Gemini 3 Flash-Lite / TypeScript strict

## 作成者
奥田憲章
EOF
```

#### Step 1-6：Git 初期化と GitHub リポジトリ

```bash
git init
git branch -M main
git config user.name "Noriaki Okuda"
git config user.email "<普段使っているメールアドレス>"

gh repo create nor-product/soraban \
  --private \
  --source=. \
  --description "そらばん（Soraban）山陰の業務ドローン運用者向けコンプライアンス統合SaaS" \
  --remote=origin

git add .
git commit -m "chore: initial scaffold for soraban (Day 1)"
git push -u origin main

gh api -X PATCH /repos/nor-product/soraban \
  -f security_and_analysis='{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}'
```

#### Step 1-7：Supabase プロジェクト作成

ブラウザで以下を実施：

1. https://supabase.com/dashboard/projects → 「New Project」
2. 設定：
   - Project name：`soraban`
   - Database Password：強力なものを生成、1Password等に保管
   - Region：`Northeast Asia (Tokyo)`
   - Plan：Free
3. 作成後、Database > Extensions で `postgis` と `pg_cron` を **Enable**

#### Step 1-8：.env と Supabase CLI

```bash
cp .env.example .env
# Supabaseダッシュボード Settings > API から取得して .env に貼る
# - SUPABASE_URL
# - SUPABASE_ANON_KEY
# - SUPABASE_SERVICE_ROLE_KEY

which supabase || brew install supabase/tap/supabase
supabase login
supabase link --project-ref <ProjectRef>
```

#### Step 1-9：Claude Code 起動

```bash
claude
```

以下のプロンプトをClaude Codeに貼り付け：

```
あなたは「そらばん（Soraban）」プロジェクトの実装パートナーです。

# プロジェクト概要
- 山陰の業務ドローン運用者向けコンプライアンス統合システム
- 作成者：奥田憲章（個人開発・社内検討段階）
- 4/30に米子市デモ版を完成させる超タイトなスケジュール
- 将来的に特許出願・事業化・売却を視野

# 6日間スプリントゴール
4/30木曜の朝までに、米子市役所の緯度経度を入力すると、
米子市の関連条例3件以上が信号機形式（green/yellow/red）で表示される
動作デモを完成させる。

# Day 1（今日）のタスク
1. ルート package.json を pnpm workspace 設定で作成
2. tsconfig.base.json を作成（strict, ES2022, NodeNext）
3. packages/db に Supabase マイグレーション作成：
   - regulations テーブル（マスタープラン Section 11参照）
   - regulation_categories enum
   - severity_level enum
   - GIST/GINインデックス
4. packages/regulations に共通型定義
5. packages/geo に国土地理院 Geocoding API ラッパー

# 重要な制約
- 全ファイル TypeScript strict
- コミットメッセージは Conventional Commits
- 4/30に動くものを最優先。完璧主義は捨てる
- .env は絶対にコミットしない

各ステップ完了後、私に確認してから次に進んでください。
不明点があれば必ず質問してください。勝手に推測で進めないこと。
```

#### Step 1-10：Day 1 完了確認

```bash
pnpm install
pnpm -r typecheck
supabase db push

git add .
git commit -m "feat(db): add regulations schema with PostGIS support"
git push
```

✅ Supabaseダッシュボード Database > Tables で `regulations` テーブルが見えればDay 1完了。

---

### Day 2〜Day 6 のClaude Codeへのプロンプト

#### Day 2（4/26 日）：スクレイパー実装

```
そらばん Day 2 のタスクです。

apps/scraper に、米子市の例規集
https://www.city.yonago.lg.jp/
からドローン関連条例を抽出するスクレイパーを実装してください。

要件：
1. Playwrightで例規集トップから条例一覧を取得
2. キーワード「ドローン」「無人航空機」「小型無人機」「飛行」「ラジコン」で関連条例を抽出（最低3件以上）
3. 抽出した条文を Gemini 3 Flash-Lite で構造化
4. applicable_areas を国土地理院APIでジオコーディング → POLYGON生成
5. Supabase に upsert
6. CLI実行可能：pnpm --filter scraper run scrape -- --municipality "鳥取県米子市"

注意事項：
- robots.txt 尊重
- アクセス間隔 最低3秒
- User-Agent: "Soraban Scraper / contact: <連絡用メール>"
- last_verified_at に取得日時を必ず記録

完了したら、米子市3条例の格納結果を見せてください。
動かない条文は手動INSERTでもOK。デモ優先。
```

#### Day 3（4/27 月夜）：ジオコーディング精度向上

```
そらばん Day 3 のタスクです。

Day 2でスクレイパーは動きましたが、ジオコーディング結果のPOLYGONが
不正確な可能性があります。以下を改善してください：

1. 米子市内の主要公園・施設のPOLYGONを手動データとして packages/geo/seed.ts に登録：
   - 米子城跡公園、湊山公園、米子市民球場、米子総合公園 等
   - 概算POLYGONで構いません（ST_Bufferで半径200mの円でも可）

2. 上記とジオコーディング結果のマージ処理

3. テストAPIで動作確認：
   curl http://localhost:54321/functions/v1/check \
     -d '{"lat":35.4283,"lng":133.3309,"datetime":"2026-05-01T10:00:00+09:00","drone_weight_g":900}'

   米子市役所座標で米子市条例3件がヒットすれば成功。

4. 鳥取DDS PoC実績の3地点でも動作確認（座標は私から後で渡します）
```

#### Day 4（4/28 火夜）：判定API実装

```
そらばん Day 4 のタスクです。

apps/api に Supabase Edge Function 「check-compliance」を実装してください。

エンドポイント：POST /functions/v1/check-compliance

入出力スキーマはマスタープラン Section 12 を参照。

処理：
1. 緯度経度から PostGIS ST_Contains で該当 regulations を検索
2. datetime が valid_from <= datetime <= valid_until に該当するか判定
3. drone_weight_g, pilot_license が適用条件にマッチするか判定
4. 結果を信号機形式でスコアリング（green/yellow/red）
5. overall は最も厳しいレベルを返す

完了したら、米子市役所＋鳥取DDS3地点で動作確認してください。
```

#### Day 5（4/29 水・祝）：最小UI実装

```
そらばん Day 5 のタスクです。

apps/web に Next.js 15 + Tailwind v4 + MapLibre GL で最小UIを作成してください。

機能：
1. 中央に米子市を表示する地図(国土地理院ベクタータイル)
2. 地図クリックで緯度経度取得 → check-compliance API 呼び出し
3. 結果を右サイドカードで表示：
   - overall を信号機アイコンで大きく表示
   - applicable_regulations を1件ずつカード表示
   - 各カードに source / summary / action_required
4. 機体重量・操縦士資格の入力フォーム（簡易）

デザイン要件：
- シンプルで実用的なデザイン（PoCのため装飾は最小限）
- 「そらばん」ロゴはテキストロゴで仮置き
- 配色：白基調＋アクセントカラー（後で調整）

ローカル起動：
pnpm dev
→ http://localhost:3000 で動作確認

完成形：
- 米子市役所をクリックすると条例3件が表示される
- 鳥取DDS PoC地点でも動作する
```

---

### Day 6（4/30 木午前）：デモ実施

#### 最終チェック

```bash
pnpm dev
# 米子市役所 + 鳥取DDS3地点で動作確認

# 任意：Vercelデプロイ
vercel deploy
```

#### デモシナリオ（5分版）

1. **オープニング**（30秒）
   - 「ドローン規制は航空法だけで7階層、自治体条例まで含めると現状確認に毎回30分以上かかる」
   - 「これを30秒に圧縮します」

2. **デモ実演**（2分）
   - 米子市役所をクリック → 条例3件が信号機UIで表示
   - 鳥取DDS PoC地点をクリック → 同じく即時判定
   - 機体重量変更 → 結果が動的に変化

3. **本質的価値**（1分）
   - 山陰の業務ドローン運用者の課題を解決
   - 山陰38市町村→中国地方→全国へ段階展開可能
   - 損保・自治体・ゼネコンへの展開可能性

4. **次の一手**（1分30秒）
   - 5月：出雲市・境港市追加、特許出願準備
   - 6月：βテスト開始
   - 10月：ぼうさいこくたい2026での発表検討
   - 補助金：鳥取県ドローン社会実装モデル創出支援補助金の継続申請

---

## 第V部：5月以降のロードマップ

| 時期 | 事項 |
|---|---|
| 5月上旬 | 出雲市・境港市の例規集追加 |
| 5月中旬 | J-PlatPat先行調査、弁理士アサイン、特許①出願準備 |
| 5月下旬 | 特許①出願（出願日確保が最優先）、関係者への正式報告 |
| 5月末 | 鳥取県補助金継続申請（必要に応じて） |
| 6月 | βテスター10〜20社のクローズドβ開始、Stripe課金組み込み |
| 7月 | 価格設定の最終決定、課金開始 |
| 8月 | 関連セミナーで初公開（タイミング次第） |
| 9月 | 山陰全域38〜42自治体カバレッジ完了 |
| 10月 | ぼうさいこくたい2026 倉吉での発表、プレスリリース |
| 11月以降 | 中国地方拡張、買い手候補へのアプローチ開始 |

---

## 第VI部：リスク管理と運用ルール

### リスクと対処法

| 障害 | 対処法 |
|---|---|
| Day 2でスクレイパーが動かない | 米子市3条例を手動でDB INSERT |
| Day 3でジオコーディング不正確 | 主要公園を手動POLYGON登録（精度80%でOK） |
| Day 4でAPIが遅い | キャッシュ・インデックスはデモ後に最適化 |
| Day 5でUIがダサい | Tailwind UIテンプレ流用 |
| 4/30デモに間に合わない | 5/1朝に延期、関係者に正直報告 |

**完璧主義は完全に捨てる**。4/30は「動作確認デモ」であり、製品リリースではありません。

### 特許出願前の情報統制

特許①出願完了まで（5月下旬目標）、以下を厳守：

- SNS投稿禁止（Twitter／Facebook／LinkedIn等）
- ブログ記事禁止
- 外部セミナー・勉強会での言及禁止
- 関連セミナーでの開示禁止
- GitHub公開リポジトリ禁止（Privateで運用）

新規性喪失の例外（特許法30条、12ヶ月）はありますが、**国際出願時に各国でばらつきがある**ため、「外部の誰かに見せる前に出願日を押さえる」が鉄則です。

### 並行運用設定（VS Code）

旬レシピと並行作業のため、ターミナル分割：

| ターミナル | 用途 | 起動コマンド |
|---|---|---|
| 1 | 旬レシピ開発 | （既存） |
| 2 | そらばん開発 | `cd ~/Dev/sanin/soraban && claude` |
| 3 | Supabase ログ | `cd ~/Dev/sanin/soraban && supabase functions serve` |
| 4 | Next.js 開発サーバー | `cd ~/Dev/sanin/soraban && pnpm dev` |

VS Code ワークスペース定義：

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

---

## 第VII部：今すぐの一手

VS Codeで別ターミナルを開いて、以下3行から開始してください。

```bash
mkdir -p ~/Dev/sanin
cd ~/Dev/sanin && mkdir soraban && cd soraban
pwd
```

`pwd` で `/Users/nori/Dev/sanin/soraban` が返れば、Day 1の Step 1-1 が完了です。

その後、**第IV部「Day 1 詳細手順」の Step 1-2 から順に実行**してください。約1.5時間で Step 1-10（Day 1完了）まで到達します。

詰まったらエラーメッセージごと貼り付けて、私にお声掛けください。即座に解決策を返します。

---

## 第VIII部：今後依頼できる成果物

以下を必要なタイミングで私に依頼してください。

| タイミング | 成果物 | 形式 |
|---|---|---|
| 4/29水夜 | デモ用A4 1枚説明資料 | docx または pdf |
| 5月上旬 | 特許①請求項ドラフト（弁理士持込用） | docx |
| 5月中旬 | 弁理士向け事業概要書（A4 2〜3枚） | docx |
| 5月中旬 | NDA テンプレ（クローズドβ用、日本語） | docx |
| 5月下旬 | 鳥取県補助金継続申請書ドラフト | docx |
| 6月 | プレスリリース原稿 | docx |
| 6月 | βテスター募集LP原稿 | md |
| 10月 | ぼうさいこくたい2026プレゼン資料 | pptx |

---

**作成者：奥田憲章**
**最終更新：2026年4月25日**
