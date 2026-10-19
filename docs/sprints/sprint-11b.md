# Sprint 11b: トップの見出しの線画（特定の機種に似ないオリジナルの図）

> 親文書：`docs/spec.md` §13.6（2026-10-20 差し込み）／ `docs/00_NORTH_STAR.md` §0.1.8
> 期間：1〜2 日（差し込み）。
> 前提：Sprint 10a・11a が `main` に入っていること。地点判定のロジック・`ENGINE_VERSION`・証跡 ID（地点判定・申請支援とも）は変えない。DB のマイグレーションは追加しない。PDF は変えない。
> ※ Next.js は破壊的変更を含むため、実装前に `node_modules/next/dist/docs/` を参照（`apps/web/AGENTS.md`）。本スプリントはサーバーコンポーネントでインライン SVG を返すだけで、`next/image` は使わない。

## 目的と位置付け

トップの見出しの右には、Sprint 10a までドローンの線画（`/drone-01.png`）を置いていた。この図は DJI Mavic 3 系の外形（三眼カメラ、折りたたみアーム）に忠実で、出所も記録されていなかったため、他社の意匠・著作権の懸念から Sprint 10a で外した（commit a3d1816。PNG 2 点と変換スクリプト `scripts/drone-png-alpha.mjs` も削除）。

外したあとの見出しは文字だけになり、PC 幅では右側が空いている。ユーザーは、特定の機種に似ないドローンの線画を新しく作ることを選んだ（2026-10-20、選択肢 3）。本スプリントは、見出しの見た目を取り戻しつつ、次の二点を満たす図を置く。

1. 出所が自明であること：リポジトリ内のコードとして、幾何学的な図形の組み合わせで描く。外部の画像・写真・製品図を取り込まない、なぞらない。
2. 特定の機種に似ないこと：どのメーカーの製品にも特徴的な意匠を持たない、一般化したクアッドコプターにする。

画面・PDF に特許・出願の表示を出さない方針（North Star §0.1.8）は本スプリントでも変わらない。図に文字・ロゴ・説明書きを入れない。

## 現状（2026-10-20、origin/main 時点）

| 箇所 | 現在 | 以前（a3d1816 の前） |
|---|---|---|
| `apps/web/src/app/page.tsx` の `<header>` | `flex flex-col`。見出し・本文（`site-lead`）・運航管理の一文（`site-ops-note`）・`site-facts`・`site-disclaimer` を縦に並べる。右側は空き | `grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12`。右の列に `next/image` で `/drone-01.png`（3047×1422）、`hidden lg:block`、`aria-hidden`、`pointer-events-none`、`opacity-60`、`dark:invert`、`priority`、`sizes="18rem"` |
| `apps/web/public/` | `fonts/` のみ。画像なし | `drone-01.png`・`drone-01.original.png` |
| デザイントークン（`apps/web/src/app/globals.css`） | 「測量野帳」の紙面調。紙 `--color-paper`、墨 `--color-ink`・`--color-ink-soft`・`--color-ink-mute`、罫 `--color-rule`。線は 1px の hairline、点線は等高線の語彙。ダークモードは `prefers-color-scheme: dark` で各トークンを置き換える（青図調） | 同じ |

以前の図は PNG を `dark:invert` で反転してダークモードに合わせていた。インライン SVG で線の色を `currentColor` にすれば、トークンの切り替えだけでダークモードに合い、反転は要らない。

## 実装する機能

### A. 線画のコンポーネント（generator）

- **A1. 置き場所と形式**：`apps/web/src/components/hero-line-art.tsx` に、インライン SVG を返す React コンポーネント（例：`HeroLineArt`）を置く。サーバーコンポーネントとし、`"use client"` を付けない。状態・効果・アニメーションを持たない。
  - `apps/web/public/` の SVG ファイルにしない理由：`<img>` で読み込んだ SVG は `currentColor` を継承できず、ダークモードで再び反転などの工夫が要るため。インラインならネットワーク要求も増えない。
- **A2. 描き方（出所を自明にする）**
  - `circle`・`ellipse`・`line`・`rect`・`polyline`・`path`・`g` だけで組み立てる。`image`・`use`・`foreignObject`・`text`・`title`・`desc`・`filter`・`pattern`・外部参照（`href`・`xlink:href`・`url(...)`）・`data:` URI・base64 を使わない。
  - 座標は人が読める整数か小数 1 桁の値で書き、`viewBox` を固定する（例：`0 0 240 240`）。`path` の `d` は 1 つあたり 200 文字以内とし、トレースした輪郭の長い点列を置かない。
  - ファイルの先頭のコメントに、図の構成（何をどの図形で描いたか）と、「外部の画像・製品図を参照せず、このファイル内の幾何図形だけで描いたオリジナルの図」である旨を書く。
  - 作図にあたって、市販機の写真・製品図・他社の図を見ながら描かない。図の形は下記 A3 の仕様から起こす。
- **A3. 形（一般化したクアッドコプター）**
  - 推奨：真上から見た平面図（製図の語彙に合い、立体の面取りやカメラの配置といった機種の特徴が出にくい）。斜めからの図にする場合も A3 の他の条件を守る。
  - 構成：中心の胴体（円、または角を丸めた正方形）／胴体から対角に伸びる、長さの等しいまっすぐな腕 4 本（X 字、左右上下に対称）／各腕の先のモーター（小円）／ロータの回転域を示す円（細線または点線。羽根の形は描かないか、2 枚羽根の直線に留める）。
  - 置かないもの（特定の機種に特徴的な意匠）：複数のレンズを並べたカメラ（二眼・三眼）、胴体前方の大きなジンバル付きカメラ、腕の折りたたみの継ぎ目・ヒンジ・前後で長さや角度の違う腕、胴体の面取り・稜線・吸排気口の造形、着陸脚・スキッドの特徴的な形、LED の配置、ロゴ・型番・文字。
  - 必要なら、等高線の語彙として回転域の円を点線にする、胴体の中心に十字の基準線を置く、など紙面調の範囲で抽象化してよい（designer が判断）。寸法線・英字の脇書き（Sprint 10a で減らした `Subject — UAV` の類）は置かない。
- **A4. 色と線**
  - 線は単色で `stroke="currentColor"`、塗りは `fill="none"`（または `currentColor` の薄い塗りを 1 か所まで）。色は親要素のテキスト色のトークン（`text-ink-mute` などの Tailwind クラス、または `--color-*`）で決める。16 進の色を SVG に直書きしない。
  - 線の太さは表示サイズで 1px 前後を基準にする（`vector-effect="non-scaling-stroke"` を使うか、`viewBox` と表示幅から逆算する）。
  - `dark:invert`・`filter`・`mix-blend-mode` などの反転・合成の工夫に頼らない。

### B. 配置（generator）

- **B1. 以前の配置を基準にする**：`<header>` を `grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_<幅>] lg:gap-12` に戻し、右の列に線画を置く。`<幅>` は以前の 18rem を初期値とし、designer が平面図の縦横比に合わせて調整する（14〜18rem 程度）。
- **B2. 装飾として扱う**：線画を包む要素に `aria-hidden="true"` と `pointer-events-none`、`data-testid="hero-line-art"` を付ける。SVG には `aria-hidden="true"` と `focusable="false"` を付ける。代替テキスト・`role="img"` は付けない（読み上げに意味を足さない）。
- **B3. 表示する幅**：`lg`（1024px）以上だけ表示し、それ未満では `hidden`（DOM には残ってよい）。スマホ・タブレット幅で見出しの並びや `site-disclaimer` の位置を変えない。
- **B4. 本文に重ねない**：左の列（見出し・本文・`site-facts`・`site-disclaimer`）と矩形が重ならない。`absolute` 配置で本文の背後に敷かない。
- **B5. 大きさの確定**：SVG に `viewBox` と幅（CSS で `w-full h-auto`、または `width`・`height` 属性）を与え、描画前に占める大きさが決まるようにする（読み込み後のレイアウトのずれを出さない）。

### C. 磨き込み（designer）

- 線の太さ・回転域の円の扱い（実線・点線・濃淡）・胴体と腕の比率・図の大きさ・左の列との余白と縦位置を、紙面調（罫線・書体・余白）に合わせて決める。
- 色のトークンと不透明度を、ライト・ダークの両方で「控えめだが見える」範囲に決める（下記契約 6 の数値の範囲内）。以前の `opacity-60` を参考値とする。
- 見出しの文字（h1、`site-lead`）より目立たせない。図が主役に見えたら小さく・薄くする。
- ロジック・ルート・`data-testid`・文言は変えない。

## スプリント契約（完了条件）

以下の全条件を満たした場合のみ、このスプリントは完了とする。「E2E」は Playwright（`pnpm test:e2e`、新規 `e2e/sprint11b.spec.ts`）、「grep」はリポジトリ直下での `rg` による確認、「目視」は evaluator が Playwright MCP で画面を開いて確かめる項目とする。ダークモードは Playwright の `colorScheme: "dark"`（`page.emulateMedia({ colorScheme: "dark" })`）で再現する。全 14 項目。

### A. 表示と配置

- [ ] 1. （E2E）幅 1280px・高さ 800px で、`data-testid="hero-line-art"` が `<header>`（h1 を含むもの）の中にあって表示され、その中に `svg` が 1 つある。線画の矩形の右端がビューポート内にあり、`h1`・`site-lead`・`site-ops-note`・`site-facts`・`site-disclaimer` のどの矩形とも重ならない。
- [ ] 2. （E2E）幅 1024px で表示され、幅 1023px・768px・375px では表示されない（`toBeHidden`）。幅 375px・高さ 812px で `site-disclaimer` が初期表示のビューポート内にあり、`document.documentElement.scrollWidth` が `clientWidth` を超えない。幅 1280px でも横スクロールが出ない。
- [ ] 3. （E2E）幅 1280px でページを開いてから初回の判定（`/api/check`・`/api/diagnose`）が終わるまでの `layout-shift` の記録（`PerformanceObserver`、`buffered: true`）のうち、`sources` の要素が `<header>` 内にあるものの値の合計が 0。最大の描画（`largest-contentful-paint`）の要素が線画の中の要素でない。

### B. 装飾としての扱い

- [ ] 4. （E2E）`hero-line-art` と、その中の `svg` に `aria-hidden="true"` があり、`svg` に `focusable="false"` がある。`<header>` の中に `role="img"` の要素と `img` 要素がない。
- [ ] 5. （E2E）線画が文字を足さない：`hero-line-art` の `textContent` が空白を除いて空で、`svg` の中に `text`・`title`・`desc` 要素がない。`e2e/sprint10a.spec.ts` の契約 1〜7 と `e2e/sprint11a.spec.ts` の契約 7〜9 が緑のまま。

### C. 色とダークモード

- [ ] 6. （E2E）ライトとダークの両方で、線画の `svg` の算出 `filter` が `none`、`mix-blend-mode` が `normal`。`svg` 内のすべての `stroke` 属性が `currentColor` か `none`。線の色（`svg` の算出 `color` を、線画と祖先の不透明度で `--color-paper` に重ねた色）と `--color-paper` のコントラスト比が 1.8 以上 4.5 未満（見えるが、本文より弱い）。
- [ ] 7. （E2E）ライトとダークで `svg` の算出 `color` が異なる（トークンの切り替えに追従している）。

### D. 出所と形

- [ ] 8. （grep）`rg -n "drone-01|drone-png-alpha" apps scripts e2e -g '!**/node_modules/**'` が 0 件。`git diff --name-only origin/main -- apps/web/public` が空（`public/` に画像を足していない）。
- [ ] 9. （grep）`apps/web/src/components/hero-line-art.tsx` に `<image`・`<use`・`foreignObject`・`href`・`url(`・`data:`・`base64`・`<text`・`<title`・`"use client"`・`#` で始まる 16 進の色がない。ファイルの大きさが 6KB 以下で、各 `d` 属性が 200 文字以内。先頭のコメントに図の構成と「外部の画像・製品図を参照せず」の旨がある。
- [ ] 10. （目視）図が一般化したクアッドコプターで、A3 の「置かないもの」（複数レンズのカメラ、ジンバル付きカメラ、折りたたみのヒンジ、前後で異なる腕、胴体の面取り・稜線、特徴的な着陸脚、LED、ロゴ・文字）がどれも描かれていない。4 本の腕の長さが等しく、図が上下・左右に対称（平面図の場合）。evaluator はレポートに 1280px のライト・ダークのスクリーンショットを添え、各項目の有無を書く。

### E. デザイン

- [ ] 11. （目視）evaluator のデザイン 4 基準で合格。特に、線の太さが罫線（`border-rule`）と並べて違和感がない、図が見出しの文字より目立たない、左の列との余白と縦位置が整っている、ダークモードで線が沈まず浮きすぎない。

### F. 範囲の確認と回帰

- [ ] 12. （grep）`git diff --name-only origin/main` に `apps/web/src/components/regulation-pdf.tsx`・`apps/web/src/components/application-pdf.tsx` と、`packages/` 以下（`packages/db/migrations/` を含む）のファイルが含まれない。`rg -n "特許|Patent|patent|出願" apps packages e2e scripts -g '!**/node_modules/**' -g '!packages/db/migrations/**' -g '!e2e/sprint10a.spec.ts'` が 0 件のまま。
- [ ] 13. `apps/web/package.json` とルートの `package.json` の依存に追加がない。`ENGINE_VERSION` が `soraban-0.3.0-regulations-2026-07` のままで、`apps/web/src/server/sprint10a.test.ts` の地点判定の証跡 ID の期待値と、申請支援の証跡 ID の期待値を持つ既存の単体テストが変更なしで通る。
- [ ] 14. `docs/spec.md` §13.6 の表に「11b（見出しの線画、差し込み）」の行がある。

### 回帰（全項目に共通）

既存の E2E（`e2e/reliability.spec.ts`・`sprint7`〜`sprint11a`、`e2e/ops-db/`）と CI がすべて緑で、`pnpm typecheck`・`pnpm lint`・`pnpm test`・`pnpm build` が通ること。これは各項目の前提とし、項目数に数えない。

## 担当と順序

| 順 | 担当 | 行うこと | 渡すもの |
|---|---|---|---|
| 1 | generator | A1〜A4 の図の作成（A3 の推奨＝平面図で最小の構成）、B1〜B5 の配置、`e2e/sprint11b.spec.ts`（契約 1〜9・12〜13 の自動化できる項目）、spec §13.6 の行（契約 14）。見た目は最低限でよい | 変更ファイルの一覧、ライト・ダークのスクリーンショット（1280px） |
| 2 | designer | C の磨き込み（線・比率・大きさ・余白・色と不透明度）。`hero-line-art.tsx` の図形と `page.tsx` の `<header>` のクラスだけを触る。`data-testid`・`aria-*`・文言は変えない | 変更点と、契約 6 のコントラスト比の実測値（ライト・ダーク） |
| 3 | evaluator | Playwright MCP で 1280px・1024px・768px・375px、ライト・ダークを開き、契約 1〜14 を確かめる。契約 10・11 は目視で採点 | 合否レポート（不合格なら差し戻し先：形・出所・配置・ARIA の不備は generator、線・色・余白の不備は designer） |

## 既存の E2E を壊さないための注意

- `<header>`（h1 を含むもの）の中の文言と `data-testid`（`site-lead`・`site-ops-note`・`site-facts`・`site-disclaimer`）は変えない。`e2e/sprint10a.spec.ts`・`e2e/sprint11a.spec.ts` は `page.locator("header", { has: page.locator("h1") })` で見出し領域を取り、その `innerText()` に禁止語がないことを確かめている。線画が文字を持たないこと（契約 5）で影響しない。
- 幅 375px の `site-disclaimer` の初期表示（Sprint 10a 契約 4）を保つため、`lg` 未満では線画が高さを取らないようにする（`hidden`）。
- `<header>` を grid にしても、左の列の `min-w-0` を保ち、長い語で横にはみ出さないようにする（Sprint 10a 契約 7）。

## 範囲外

- PDF（地点判定・申請支援）への線画の掲載
- トップ以外の画面（運航管理 `/ops` など）への線画の配置
- アニメーション、ホバーでの変化、テーマの切り替えボタン
- ファビコン・`icon.svg`・OG 画像の変更
- 地点判定のロジック・`ENGINE_VERSION`・証跡 ID・DB マイグレーションの変更

## リスク

| リスク | 対応 |
|---|---|
| 一般化しても、結果として既存の機種に似て見える | X 字の対称な平面図という、多数の機種に共通する最小の構成にとどめ、機種を識別させる部分（カメラ、アームの機構、胴体の造形）を描かない（A3）。evaluator が契約 10 で確かめ、ユーザーが最終確認する |
| 作図の過程で既存の製品図をなぞる | 図形の種類・座標の書き方・`d` の長さを制限し（A2、契約 9）、先頭のコメントに構成を書く。トレースした点列はこの制限に収まらない |
| 線画が見出しの文字と競合し、サービスの顔が装飾的になる | コントラスト比の上限（契約 6）と designer の判断（C）で控えめにする。目立つ場合は小さく・薄くする方向で直す |
| `<header>` の grid 化で、スマホの初期表示や横スクロールが崩れる | `lg` 未満は 1 列・線画は `hidden`（B3）。Sprint 10a の契約 4・7 と本スプリントの契約 2 で確かめる |

## ユーザー作業

- 完成した線画（1280px のライト・ダークのスクリーンショット）を見て、特定の機種を連想させないことを確認する。気になる点があれば、どの部分か（胴体・腕・ロータ等）を指示する。

## 未決事項（推奨つき）

1. **図の向き**。推奨：真上から見た平面図（A3）。斜めからの図は立体感が出る一方、胴体の造形・カメラの位置など機種の特徴が出やすい。
2. **置き場所**。推奨：コンポーネントとしてインライン SVG（A1）。`public/` の SVG ファイルは `currentColor` が効かず、ダークモードに別の手当てが要る。
