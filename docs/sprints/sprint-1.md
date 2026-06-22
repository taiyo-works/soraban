# Sprint 1: 手続き診断ロジック ＋ 制度データモデル ＋ チェックリスト出力

> 親文書：`docs/spec.md`（§4 コアロジック・§6 データモデル・§7 UI 構成）
> 対象構成：Next.js (App Router) + API Routes + 静的 JSON（`packages/regulations/data/...`）。Supabase / PostGIS は使わない。
> ※ Next.js は破壊的変更を含むため、実装前に `node_modules/next/dist/docs/` を参照（`apps/web/AGENTS.md`）。

## 実装する機能

- **機能A：制度データモデル（出典付き）** — `RequiredProcedure` / `SpecificFlightFlag` / `FlightMethodContext` / `ApplicationDiagnosis` 型を `@soraban/regulations` に追加し、手続き定義を `packages/regulations/data/procedures/*.json`（出典 URL・法的根拠つき）として保持する。コードに直書きしない。
- **機能B：判定理由 → 手続き導出ロジック** — spec §4 のマッピング表を実装。既存 `RegulationCheckResult` の空域フラグ（DID・空港）＋ 新規の飛行方法フラグ（夜間・目視外・30m・催し・危険物・投下・150m）＋ 機体重量から、必要手続き配列を機械的に導出する純関数。
- **機能C：診断 API ＋ 飛行方法入力 UI ＋ チェックリスト出力** — 診断エンドポイント（spec §10-1 推奨に従い新規 `/api/diagnose`）と、既存 `RegulationChecker` への飛行方法チェックボックス群の追加、必要手続きチェックリストの表示。

## スプリント契約（完了条件）

以下の全条件を満たした場合のみ、このスプリントは完了とする。

- [ ] `@soraban/regulations` に `RequiredProcedure`・`SpecificFlightFlag`・`FlightMethodContext`・`ApplicationDiagnosis` 型がエクスポートされ、`pnpm -r typecheck`（または当プロジェクトの typecheck コマンド）が通る。
- [ ] 手続き定義が `packages/regulations/data/procedures/` 配下の JSON（または出典付き TS データモジュール）として存在し、各レコードに `legalBasis`（法的根拠）と `sourceUrl`（出典 URL）が空でなく入っている。
- [ ] 飛行方法フラグ（夜間・目視外・30m未満・催し上空・危険物・物件投下・150m以上）が UI 上のチェックボックス／トグルとして表示され、操作できる。
- [ ] 地図またはプリセットで **米子市役所** を選び、飛行方法で「夜間」「目視外」をチェックすると、必要手続きチェックリストに少なくとも次の 4 項目が表示される：「飛行許可（DID）」相当・「飛行承認（夜間）」相当・「飛行承認（目視外）」相当・「機体登録（DRS）」相当。
- [ ] 特定飛行に該当する判定では、横断手続きとして「飛行計画通報」「飛行日誌」がチェックリストに常に追加される。
- [ ] 機体重量に **80（< 100g）** を入力すると、航空法系の手続き（飛行許可・飛行承認・機体登録）がチェックリストから消える（条例系の協議が残るのは可）。
- [ ] 各手続きカードに、システム系統（DRS / DIPS2.0 / 条例）と出典 URL が表示され、URL がクリック可能なリンクである。
- [ ] 機体重量を未指定にすると（最も厳しい解釈）、100g 以上前提の手続きが表示される（フェイルセーフ：不明時は厳しい側）。
- [ ] 診断 API（`/api/diagnose` 等）に米子市役所の座標 ＋ 夜間・目視外フラグを POST すると、`procedures` 配列を含む JSON が 200 で返る。
- [ ] 既存の `/api/check`・信号機判定・既存フロー（住所検索・座標貼り付け・PDF 出力）が引き続き動作し、リグレッションがない。
- [ ] 全画面に免責文（「最終確認は DIPS／航空局で」を含む）が表示されている。
