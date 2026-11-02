# Sprint 16-1：変えた既存テストと理由（R-2）

寸法・文字の大きさ・比の下限・件数・文言の期待は弱めていない。意図して変えたものだけを書く。

| テスト | 変更 | 理由・弱めない根拠 |
|---|---|---|
| `apps/web/src/app/design-tokens.test.ts` | OS の暗（`@media (prefers-color-scheme: dark)`）の版の検査を、強制の暗（`data-theme="dark"`）だけに。値の検査（明の地・影）を新しい値に。`check-contrast-v2.mjs` の件数を 284 件＋日差しの模擬 136 件に。`color-scheme` は `light`（`.ds`） | D-2（OS の暗に従う宣言を外す）。暗の値のコントラスト検査（暗 2 通り）は `check-contrast-v2.mjs` で続く。OS の暗の宣言が 4 つのファイルに無いことを、新しい検査で固定した |
| `apps/web/src/lib/pwa.test.ts` | 追加：PWA の色が `--sb-base` と一致 | T-5 |
| `apps/web/src/lib/design-catalog.test.ts` | 見本の設定の検査を新しい見本（`mode`・`theme`・`veil`）に | 旧い見本（`components/ui/catalog`）の削除 |
| `apps/web/src/components/ops/ops-nav.test.ts` | 除外の注釈を `app/ops/design` に | 見本の場所の変更。走査の対象は減らしていない |
| `apps/web/src/components/ops/testids-baseline.test.ts` | 件数 1996→1877、ハッシュを更新 | 旧い見本だけが持っていた 265 件を一覧から外した（`sprint-16-removed-catalog-testids.txt` に別に残す。実画面の識別子は消えていない。`--write --reason` の記録は `sprint-17-testids-baseline-log.txt`）。`--check` は 0 |
| `e2e/sprint12g-1a.spec.ts`・`sprint12g-style.spec.ts`・`sprint12g-judge.spec.ts`・`sprint12g-ux2.spec.ts` | 削除 | 旧い 12g の見本・試作（`?view=style`・`menu`・`judge`）の検査。見本そのものを削除した。見本の 404・外部通信なし・noindex・横スクロールなし・現場の寸法・強制の暗・日差しの膜は `sprint16-1.spec.ts` が受ける。見本の部品（ダイアログ・コマンドパレットほか）は実画面では使われておらず、16-3 で部品ごと削除する |
| `e2e/ops-db/sprint12g-1a-db.spec.ts` | 検査 1 の `data-hydrated` の確認を外す。検査 4 の `/ops` の地を rgb(247,247,243)→rgb(255,255,255) | 新しい見本は水和する部品を持たない。H-1（ページの地は白） |
| `e2e/sprint11b.spec.ts`（6・7） | 空の暖色・グラデーションの確認を外す。検査 7 は「OS が暗でも空は明るいまま」 | Q2（線画。空は白の 1 色）と Q1（常に明）。見出しの文字と空の比 4.5:1 以上は残した |
| `e2e/sprint12h-pr2.spec.ts`（Q-11） | 空の色の集合から `--sb-art-sky-warm` を外す | 同上（空が 1 色） |
