# Sprint 11b: トップの見出しの線画（ユーザーが Adobe Firefly で生成したドローンの線画）

> 親文書：`docs/spec.md` §13.6（2026-10-20 差し込み、同日改訂）／ `docs/00_NORTH_STAR.md` §0.1.8
> 期間：1〜2 日（差し込み）。改訂後の作業は 1 日以内を見込む。
> 前提：Sprint 10a・11a が `main` に入っていること。地点判定のロジック・`ENGINE_VERSION`・証跡 ID（地点判定・申請支援とも）は変えない。DB のマイグレーションは追加しない。PDF は変えない。
> ※ Next.js は破壊的変更を含むため、実装前に `node_modules/next/dist/docs/` の `next/image`（`Image` コンポーネント、`sizes`・`priority`／`preload`・`loading`・`unoptimized`）の項を参照（`apps/web/AGENTS.md`）。

## 改訂の記録

- **2026-10-20 改訂（ユーザー承認）**：図を、インライン SVG のオリジナル線画から、**ユーザー自身が Adobe Firefly（商用利用可）で生成したドローンの線画 PNG** に差し替える方針に改めた。
  - 改訂前の方針（幾何図形だけで描く一般化したクアッドコプターのインライン SVG、`apps/web/src/components/hero-line-art.tsx`）は、commit c695e55（実装）・08f3f30（磨き込み）で実装し、evaluator の評価に合格していた。その契約（旧 1〜14）は本改訂で下記の契約に置き換える。旧方針の全文は commit d41cdd8 の本ファイルを参照。
  - 図は DJI の業務用機（Matrice 30／4 系）に外形が似ている。オーケストレーターがその点（特定のメーカーの機体に見えることで、サービスの中立性がどう見えるか）を説明したうえで、ユーザーが使うと判断した。権利の整理は次のとおり（ユーザー承認済み）：
    - 著作権：ユーザーが Adobe Firefly の商用利用可の条件で生成した画像であり、問題なし。
    - 意匠権：サイトの装飾イラストとしての掲載は、物品（機体）の製造・販売ではないため通常及ばない。
    - 商標：画像にロゴ・文字・型番がないため問題なし（契約 10 で確かめる）。
  - 変わらない点：PC（lg 以上）の見出しの右列だけに置く、スマホでは出さない、装飾として読み上げない、本文に重ねない、レイアウトのずれを出さない、画面・PDF に特許・出願の表示を出さない（North Star §0.1.8）。
  - 変わる点：図の出所（コードで描く → ユーザーが生成した画像）、形式（インライン SVG → `apps/web/public/` の PNG を `next/image` で表示）、ダークモードの合わせ方（`currentColor` → 反転または mask による着色）、出所・形・色の契約（旧 6・8・9・10 など）。

## 目的と位置付け

トップの見出しの右には、Sprint 10a までドローンの線画（`/drone-01.png`）を置いていた。この図は DJI Mavic 3 系の外形に忠実で、出所も記録されていなかったため、Sprint 10a で外した（commit a3d1816。PNG 2 点と変換スクリプト `scripts/drone-png-alpha.mjs` も削除）。

その後、本スプリントの当初の方針で、幾何図形だけで描くオリジナルの線画をインライン SVG で置いた（c695e55・08f3f30、評価合格）。ユーザーは見た目の好みから、自身が Adobe Firefly で生成したドローンの線画を使うことに決めた（2026-10-20）。本スプリントは、この画像を見出しの右に置き、次の二点を満たす。

1. 出所が記録されていること：誰が・どの道具で・いつ生成し、どう加工したかを、使用箇所のコメントに残す（以前の `drone-01.png` は出所の記録がなかったことが問題だった）。
2. ロゴ・文字・型番を含まないこと：商標・特定の製品名の表示にならないようにする。

画面・PDF に特許・出願の表示を出さない方針（North Star §0.1.8）は本スプリントでも変わらない。

## 素材

| 項目 | 内容 |
|---|---|
| 生成者・道具 | ユーザー（フューチャーテック株式会社）が Adobe Firefly で生成。商用利用可の条件 |
| 生成日 | 2026-10-20 |
| 元画像 | `/root/.claude/uploads/58636bcc-343f-5334-8cae-4c39de496143/442e3ae3-image.png`（白地に黒い線）。リポジトリには入れない |
| 背景透過済み | `/tmp/claude-0/-home-user-soraban/58636bcc-343f-5334-8cae-4c39de496143/scratchpad/drone-firefly-alpha.png`（1904×1232、グレースケール＋アルファ、約 220KB）。加工は白地をアルファに変換（線の濃さを不透明度に移す）しただけで、図の形は変えていない |
| 見た目 | ドローンを斜め上から見た線画。DJI の業務用機（Matrice 30／4 系）に外形が似ている（ユーザーは承知のうえで採用） |

## 現状（2026-10-20、本ブランチ `claude/handoff-deployment-issue-rt8zvr` 時点）

| 箇所 | 現在（改訂前の方針の実装） |
|---|---|
| `apps/web/src/app/page.tsx` の `<header>` | `grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-16`。右の列に `<div aria-hidden="true" data-testid="hero-line-art" className="pointer-events-none hidden text-ink-mute opacity-60 lg:block">` と、その中の `<HeroLineArt className="block h-auto w-full" />` |
| `apps/web/src/components/hero-line-art.tsx` | インライン SVG（viewBox 0 0 240 240、circle・line・rect・g、`stroke="currentColor"`） |
| `apps/web/public/` | `fonts/` のみ。画像なし |
| `e2e/sprint11b.spec.ts` | 旧契約 1〜7 の E2E（svg 前提：`svg` が 1 つ、`stroke` が `currentColor`、算出 `filter` が `none` など） |
| デザイントークン（`apps/web/src/app/globals.css`） | 「測量野帳」の紙面調。紙 `--color-paper`、墨 `--color-ink`・`--color-ink-soft`・`--color-ink-mute`、罫 `--color-rule`。ダークモードは `prefers-color-scheme: dark` で各トークンを置き換える（青図調） |

## 実装する機能

### A. 画像とコンポーネント（generator）

- **A1. 画像の配置**：背景透過済みの PNG を `apps/web/public/hero-drone.png` として追加する（追加する画像はこの 1 枚だけ）。旧名 `drone-01*` は使わない。元画像（白地）はリポジトリに入れない。
  - 大きさ：300KB 以下。表示幅は最大 18rem 程度なので、幅 960〜1904px の範囲で縮小してよい（縦横比 1904:1232 を保つ。縮小した場合は実際の幅・高さを A2 の `width`・`height` に書く）。縮小にはリポジトリ外の道具（ローカルの Python など）を使い、変換スクリプトや依存をリポジトリに足さない。
  - アルファを保つ（白地を戻さない）。
- **A2. コンポーネントの差し替え**：`apps/web/src/components/hero-line-art.tsx` のインライン SVG を削除し、同名のコンポーネント（`HeroLineArt`）が PNG を表示するように置き換える。サーバーコンポーネントのままとし、`"use client"` を付けない。状態・効果・アニメーションを持たない。
  - 推奨：`next/image` の `Image` で `src="/hero-drone.png"`、`width`・`height`（画像の実寸）、`alt=""`、`sizes`（例：`"(min-width: 1024px) 18rem, 0px"` 相当。designer が列幅を決めたら合わせる）を指定する。`priority`（または相当の `preload`・`fetchPriority="high"`）は付けない。`loading` は既定（`lazy`）のままとする。
  - 画像の要素に `data-testid="hero-line-art-image"` を付ける（E2E がこれで図の要素を取る）。
  - 画像の最適化：デプロイ先・`pnpm build` で `next/image` の最適化が使えない場合は `unoptimized` を付けてよい（そのとき配信されるのは 300KB 以下の PNG そのもの）。依存（`sharp` など）は追加しない。
  - 別案（designer の判断で選んでよい）：`mask-image: url(/hero-drone.png)` と `bg-current`（`currentColor`）で線をトークンの色に塗る方式。この場合 `next/image` は使わず、要素に `aspect-ratio`（画像の縦横比）と幅を与えて描画前に大きさを確定させ、`data-testid="hero-line-art-image"` はマスクを掛けた要素に付ける。どちらの方式でも下記の契約 1〜7 をすべて満たすこと。
- **A3. 出所の記録**：`hero-line-art.tsx` の先頭のコメントに、次を書く（`apps/web/public/` に README を置くと `/README.md` として公開されるため、記録は使用箇所のコメントに置く）。
  - ユーザー（フューチャーテック株式会社）が Adobe Firefly（商用利用可）で生成した画像であること、生成日 2026-10-20
  - 加工：白地をアルファに変換（線の濃さを不透明度に移す）、必要なら縮小。形は変えていない
  - ロゴ・文字・型番を含まないこと
  - 特定の機種に外形が似ていることをユーザーが承知のうえで採用したこと（`docs/sprints/sprint-11b.md` の改訂の記録を参照）
- **A4. E2E の更新**：`e2e/sprint11b.spec.ts` を下記の契約 1〜7 に合わせて書き直す（svg・`stroke`・`filter: none` を前提とする旧テストは削除する）。先頭のコメントも画像の方針に改める。

### B. 配置（generator）

- **B1. 配置は改訂前と同じ**：`<header>` の grid（`grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_<幅>] lg:gap-<n>`）と右の列はそのまま使う。`<幅>` は画像の横長の縦横比（約 1.55:1）に合わせて designer が調整する（15〜20rem 程度）。
- **B2. 装飾として扱う**：包む要素に `aria-hidden="true"`・`pointer-events-none`・`data-testid="hero-line-art"` を付ける（維持）。画像は `alt=""` とし、代替テキスト・`role="img"` は付けない（読み上げに意味を足さない）。
- **B3. 表示する幅**：`lg`（1024px）以上だけ表示し、それ未満では `hidden`。`hidden` の間は画像を読み込まない（`loading="lazy"` と `display: none` の組み合わせで、スマホで約 220KB の転送を出さない）。スマホ・タブレット幅で見出しの並びや `site-disclaimer` の位置を変えない。
- **B4. 本文に重ねない**：左の列（見出し・本文・`site-facts`・`site-disclaimer`）と矩形が重ならない。`absolute` 配置で本文の背後に敷かない。
- **B5. 大きさの確定**：`next/image` の `width`・`height`（または別案の `aspect-ratio`）と CSS の `w-full h-auto` で、読み込み前に占める大きさを確定させる（読み込み後のレイアウトのずれを出さない）。
- **B6. LCP にしない**：画像を最大の描画（LCP）の要素にしない。`priority` を付けないのはこのため。表示幅を広げすぎて h1 より大きな描画面積にならないようにする（designer と共有）。

### C. 磨き込み（designer）

- 図の大きさ・右の列の幅・左の列との余白と縦位置を、紙面調（罫線・書体・余白）に合わせて決める。
- 色：
  - ライトは黒い線を不透明度で控えめにする（改訂前の `opacity-60` を参考値。線が細い画像なので、旧 SVG より薄く見える・濃く見える場合は調整する）。
  - ダークは線を明るくする。推奨は `dark:invert`（黒い線が白くなる）＋不透明度。別案の mask 方式なら `currentColor`（例：`text-ink-mute`）でトークンに追従させる。どちらでも、ダークの紙（青図調）の上で線が沈まず、浮きすぎない濃さにする。
  - 両モードで下記契約 6 の数値の範囲に収める。
- 見出しの文字（h1、`site-lead`）より目立たせない。図が主役に見えたら小さく・薄くする。
- 縁の処理：ダークで反転したときに線の周りに白い縁・矩形の地が出ていないかを確かめる（出る場合は generator に差し戻し、アルファの加工をやり直す）。
- ロジック・ルート・`data-testid`・`aria-*`・`alt`・文言は変えない。

## スプリント契約（完了条件）

以下の全条件を満たした場合のみ、このスプリントは完了とする。「E2E」は Playwright（`pnpm test:e2e`、`e2e/sprint11b.spec.ts` を書き直す）、「grep」はリポジトリ直下での `rg`・`git` による確認、「目視」は evaluator が Playwright MCP で画面を開いて確かめる項目とする。ダークモードは Playwright の `colorScheme: "dark"`（`page.emulateMedia({ colorScheme: "dark" })`）で再現する。「図の要素」は `data-testid="hero-line-art-image"` の要素を指す。全 14 項目。

### A. 表示と配置

- [ ] 1. （E2E）幅 1280px・高さ 800px で、`data-testid="hero-line-art"` が `<header>`（h1 を含むもの）の中にあって表示され、その中に図の要素がちょうど 1 つある。図の要素が `img` の場合は読み込みが終わっている（`complete` が真で `naturalWidth` が 0 より大きい）。線画の矩形の右端がビューポート内にあり、`h1`・`site-lead`・`site-ops-note`・`site-facts`・`site-disclaimer` のどの矩形とも重ならない。
- [ ] 2. （E2E）幅 1024px で表示され、幅 1023px・768px・375px では表示されない（`toBeHidden`）。幅 375px・高さ 812px で `site-disclaimer` が初期表示のビューポート内にあり、`document.documentElement.scrollWidth` が `clientWidth` を超えない。幅 1280px でも横スクロールが出ない。幅 375px でページを開いて初回の判定が終わるまでに、URL に `hero-drone` を含む要求（`/hero-drone.png` と `/_next/image?url=%2Fhero-drone.png…` の両方）が 1 件も出ない。
- [ ] 3. （E2E）幅 1280px でページを開いてから初回の判定（`/api/check`・`/api/diagnose`）が終わり、図の読み込みが終わるまでの `layout-shift` の記録（`PerformanceObserver`、`buffered: true`）のうち、`sources` の要素が `<header>` 内にあるものの値の合計が 0。最大の描画（`largest-contentful-paint`）の要素が `hero-line-art` の中の要素でない。図の要素が `img` の場合、`fetchpriority` が `high` でなく、`loading` が `lazy`（`priority` を付けていない）。

### B. 装飾としての扱い

- [ ] 4. （E2E）`hero-line-art` に `aria-hidden="true"` がある。図の要素が `img` の場合は `alt` が空文字。`<header>` の中に `role="img"` の要素がなく、`hero-line-art` の外に `img` 要素がない（`<header>` 内の `img` は図の要素の 1 つだけ、または別案なら 0）。
- [ ] 5. （E2E）線画が文字を足さない：`hero-line-art` の `textContent` が空白を除いて空で、中に `svg` 要素がない（旧インライン SVG が残っていない）。`e2e/sprint10a.spec.ts` の契約 1〜7 と `e2e/sprint11a.spec.ts` の契約 7〜9 が緑のまま。

### C. 色とダークモード

- [ ] 6. （E2E）ライトとダークの両方で、線の見かけの色と `--color-paper` のコントラスト比が 1.8 以上 4.5 未満で、かつ `site-lead` の文字色と `--color-paper` のコントラスト比より小さい（線が見え、本文より弱い）。線の見かけの色は次のように求める：
  - 図の要素が `img`：線の元の色を黒（`rgb(0,0,0)`）とし、図の要素の算出 `filter` に `invert(1)`（または `invert(100%)`）が含まれるときは白（`rgb(255,255,255)`）とする。`invert` 以外の `filter`（`brightness` など）を使う場合は、E2E にその換算を加える。
  - 別案（mask 方式）：図の要素の算出 `background-color`。
  - これを、図の要素から `<html>` までの算出 `opacity` の積（と色のアルファ）で `--color-paper` に重ねた色とする。designer は両モードの実測値を報告する。
- [ ] 7. （E2E）ライトとダークで、契約 6 で求めた線の見かけの色が異なる（ダークモードに追従している）。ダークでは線の見かけの色の相対輝度が `--color-paper` より高い（紙より明るい線になっている）。

### D. 出所と画像

- [ ] 8. （grep）`rg -n "drone-01|drone-png-alpha" apps scripts e2e -g '!**/node_modules/**'` が 0 件。`git diff --name-only origin/main -- apps/web/public` の出力が `apps/web/public/hero-drone.png` の 1 行だけ。そのファイルが PNG でアルファを持ち（`file` などで確認）、大きさが 300KB（307,200 バイト）以下、幅が 960〜1904px で縦横比が 1904:1232 から 1% 以内。`git diff --name-only origin/main -- scripts` が空（変換スクリプトを足していない）。
- [ ] 9. （grep）`apps/web/src/components/hero-line-art.tsx` に `<svg`・`"use client"`・`priority`・`preload`・`data:`・`base64` がなく、`hero-drone.png` を参照している。先頭のコメントに「Adobe Firefly」「2026-10-20」、ユーザーが生成した旨、白地をアルファに変換した旨、ロゴ・文字を含まない旨がある。`e2e/sprint11b.spec.ts` に旧契約の `stroke`・`currentColor` の検査が残っていない。
- [ ] 10. （目視）表示されている図が、ユーザーの元画像（`/root/.claude/uploads/58636bcc-343f-5334-8cae-4c39de496143/442e3ae3-image.png`）と同じ図で、形が変わっていない（縮小以外の加工がない）。図の中にロゴ・文字・型番・数字・透かし（Firefly のバッジ等）がない。ライトで矩形の地（白い背景）が見えず、ダークで線の周りに白い縁・矩形の地が出ない。evaluator はレポートに 1280px のライト・ダークのスクリーンショットを添え、各項目の有無を書く。

### E. デザイン

- [ ] 11. （目視）evaluator のデザイン 4 基準で合格。特に、線の濃さが罫線（`border-rule`）や本文と並べて違和感がない、図が見出しの文字より目立たない、左の列との余白と縦位置が整っている、ダークモードで線が沈まず浮きすぎない、図の大きさが右の列に収まり窮屈でも間延びでもない。

### F. 範囲の確認と回帰

- [ ] 12. （grep）`git diff --name-only origin/main` に `apps/web/src/components/regulation-pdf.tsx`・`apps/web/src/components/application-pdf.tsx` と、`packages/` 以下（`packages/db/migrations/` を含む）のファイルが含まれない。`rg -n "特許|Patent|patent|出願" apps packages e2e scripts -g '!**/node_modules/**' -g '!packages/db/migrations/**' -g '!e2e/sprint10a.spec.ts'` が 0 件のまま。
- [ ] 13. `apps/web/package.json` とルートの `package.json` の依存に追加がない（`sharp` も足さない）。`ENGINE_VERSION` が `soraban-0.3.0-regulations-2026-07` のままで、`apps/web/src/server/sprint10a.test.ts` の地点判定の証跡 ID の期待値と、申請支援の証跡 ID の期待値を持つ既存の単体テストが変更なしで通る。
- [ ] 14. `docs/spec.md` §13.6 の表の「11b」の行が画像（Adobe Firefly で生成した線画）を置く内容になっていて、変更記録に 2026-10-20 の改訂がある。

### 回帰（全項目に共通）

既存の E2E（`e2e/reliability.spec.ts`・`sprint7`〜`sprint11a`、`e2e/ops-db/`）と CI がすべて緑で、`pnpm typecheck`・`pnpm lint`・`pnpm test`・`pnpm build` が通ること。これは各項目の前提とし、項目数に数えない。

## 担当と順序

| 順 | 担当 | 行うこと | 渡すもの |
|---|---|---|---|
| 1 | generator | A1（PNG を `apps/web/public/hero-drone.png` に配置。必要なら縮小）、A2（`hero-line-art.tsx` を `next/image` の表示に置き換え）、A3（出所のコメント）、A4（`e2e/sprint11b.spec.ts` の書き直し：契約 1〜7）、B1〜B6 の配置の確認。見た目は最低限でよい（ライトは `opacity-60`、ダークは `dark:invert` を初期値に） | 変更ファイルの一覧、PNG の大きさ（バイト・px）、ライト・ダークのスクリーンショット（1280px） |
| 2 | designer | C の磨き込み（右の列の幅・図の大きさ・余白と縦位置・不透明度・ダークの見え方。反転か mask かの判断）。`hero-line-art.tsx` の表示部分のクラス・`sizes` と `page.tsx` の `<header>` のクラスだけを触る。`data-testid`・`aria-*`・`alt`・文言は変えない。mask 方式に切り替える場合は契約 6 の求め方が変わるため、E2E の換算が合っているかを確かめる | 変更点と、契約 6 のコントラスト比の実測値（ライト・ダーク、`site-lead` の比も） |
| 3 | evaluator | Playwright MCP で 1280px・1024px・768px・375px、ライト・ダークを開き、契約 1〜14 を確かめる。契約 10・11 は目視で採点 | 合否レポート（不合格なら差し戻し先：画像・出所・配置・ARIA・読み込み（LCP・スマホの転送）の不備は generator、大きさ・色・余白の不備は designer） |

## 既存の E2E を壊さないための注意

- `<header>`（h1 を含むもの）の中の文言と `data-testid`（`site-lead`・`site-ops-note`・`site-facts`・`site-disclaimer`）は変えない。`e2e/sprint10a.spec.ts`・`e2e/sprint11a.spec.ts` は `page.locator("header", { has: page.locator("h1") })` で見出し領域を取り、その `innerText()` に禁止語がないことを確かめている。`alt=""` の画像は `innerText` に何も足さない（契約 5）。
- 幅 375px の `site-disclaimer` の初期表示（Sprint 10a 契約 4）を保つため、`lg` 未満では線画が高さを取らないようにする（`hidden`）。
- `<header>` の左の列の `min-w-0` を保ち、長い語で横にはみ出さないようにする（Sprint 10a 契約 7）。
- 旧 `e2e/sprint11b.spec.ts` の svg 前提のテスト（旧契約 1・4〜7）は、そのままでは赤になる。A4 で書き直す。

## 範囲外

- PDF（地点判定・申請支援）への線画の掲載
- トップ以外の画面（運航管理 `/ops` など）への線画の配置
- アニメーション、ホバーでの変化、テーマの切り替えボタン
- ファビコン・`icon.svg`・OG 画像の変更
- 画像の作り直し・描き直し（形はユーザーの生成した図のまま）
- 地点判定のロジック・`ENGINE_VERSION`・証跡 ID・DB マイグレーションの変更

## リスク

| リスク | 対応 |
|---|---|
| 図が DJI の業務用機（Matrice 30／4 系）に似ており、特定のメーカーに寄ったサービスに見える | ユーザーが説明を受けたうえで採用を判断した（改訂の記録）。ロゴ・文字・型番がないこと（契約 10）と、装飾として控えめに置くこと（契約 6・11）で、製品の紹介に見えないようにする。将来、DIPS 2.0 の申請先などから指摘があれば、ユーザーの判断で改訂前のインライン SVG（c695e55・08f3f30）に戻せる |
| 出所が再び分からなくなる（以前の `drone-01.png` の問題の再発） | 使用箇所の先頭コメントに生成者・道具・日付・加工を書く（A3、契約 9）。本ファイルの「素材」にも残す |
| 画像の読み込みで LCP が遅れる、スマホで不要な転送が出る | `priority` を付けない・`lazy` のまま・`lg` 未満は `hidden`（B3・B6）。契約 2・3 で確かめる |
| ダークで反転したときに縁や地が浮く | アルファ化した PNG を使い（A1）、契約 10 の目視と designer の確認（C）で見る。出る場合は generator が加工をやり直す |
| 線画が見出しの文字と競合し、サービスの顔が装飾的になる | コントラスト比の上限と本文との比較（契約 6）と designer の判断（C）で控えめにする |

## ユーザー作業

- 完成した見出し（1280px のライト・ダークのスクリーンショット）を見て、図の大きさ・濃さが好みに合うかを確認する。

## 未決事項（推奨つき）

1. **ダークモードの合わせ方**。推奨：`dark:invert`＋不透明度（改訂前の `drone-01.png` と同じで、`next/image` をそのまま使える）。mask 方式はトークンの色に厳密に合うが、`next/image` を使わない形になる。designer が見え方で判断する。
2. **画像の縮小**。推奨：220KB のままで契約 8 の上限に収まるため、縮小は任意。`next/image` の最適化が使えない配信（`unoptimized`）になる場合は、幅 960px 程度に縮小して転送量を減らす。
