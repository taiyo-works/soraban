# Sprint 6: 信頼性強化（空域フラグの状態設計・DID 三値・25kg 境界・履歴レース解消・CI/E2E）

> 親文書：`docs/spec.md`（§3.3 カテゴリー・§3.6/§11 要再確認事項・§6.3 証跡・§9 履歴）
> 前提：Sprint 1〜5 が完了していること。

## 実装した機能

- **A. 空域フラグの状態分離（無限ループ・地点間持ち越しの解消）**
  - 地点判定由来（自動検出）の空域フラグは state に保存せず、`/api/diagnose` レスポンスの `derivedAirspaceFlags` から都度導出する。
  - state に持つのはユーザー指定の空域フラグ（`userAirspaceFlags`）のみ。地点が変わるたびにリセットし、プリセットは curated 値で初期化する。飛行方法・予定日などのユーザー条件は引き継ぐ。
  - `/api/check`・`/api/diagnose` とも AbortController ＋ リクエスト連番で古い応答を破棄する。
- **B. DID の三値化（該当／非該当／未確認）**
  - DID ポリゴンデータが読み込めない場合、`evaluateDid` は従来の「DID 外＝green」ではなく `unknown` を返す。
  - 診断（`deriveDiagnosis`）は `didStatus` を受け、特定飛行フラグなし＋DID 未確認のとき新カテゴリー `needs_verification`（要確認）を返す。「申請不要（カテゴリー I）」とは表示しない。
  - UI（申請支援入力・診断パネル・履歴行）、申請支援 PDF、履歴サマリに DID 三値を表示・保存する。DID 未確認時はユーザーが「非該当を確認済み」と明示できる。
- **C. 25kg 境界と第三者賠償責任保険**
  - 総重量 25kg 以上は IIB（申請不要化）の対象外 → IIA 相当（許可・承認が必要）。
  - 25kg 以上で許可・承認申請が必要（または要確認）な場合、手続き `insurance-third-party-25kg` を付与（令和7年10月1日以降の新規申請。国交省 https://www.mlit.go.jp/koku/koku_fr10_000042.html 、2026-10-14 確認）。
  - spec の「2026/10/1」記載は誤り（正しくは 2025/10/1）として訂正。
- **D. 履歴のレース解消**
  - チェック実行ごとに `runId` を採番し、地点判定（`recordHistoryCheck`）と診断（`recordHistoryDiagnosis`）を応答順に関係なく同じ ID に書き込む。診断が先に届いた場合は pending として保管し合流する。座標一致での更新は行わない。
- **E. CI / E2E**
  - GitHub Actions（typecheck / lint / test / build ＋ Playwright E2E）。
  - Playwright：地点切替 → 条件変更 → 履歴復元 → PDF 出力。

## 完了条件

- [x] 診断 → 空域 state 更新 → 再診断 のループが起きない（E2E でアイドル時の `/api/diagnose` 増加なしを確認）
- [x] 地点切替で前地点の空域フラグが持ち越されない（E2E）
- [x] DID 未確認で「カテゴリー I」にならない（単体テスト）
- [x] 99/100g・24.99/25kg の境界テスト
- [x] 履歴：判定→診断／診断→判定 の両順序テスト、同一座標の旧エントリを更新しないテスト
