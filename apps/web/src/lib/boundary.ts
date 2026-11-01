// サービスの境界（Sprint 18-1）。
//
// 申請支援の機能フラグ APPLICATION_SUPPORT_ENABLED と、境界の短い文を 1 か所に置く。
//
// 【フラグ】申請支援（手続き診断のパネル・書類 PDF・プリフィル・マニュアル骨子・申請の期限のカレンダー）は、
// 専門家の確認（legal-info-plan.md Q-L2）が出るまで止める。コードは消さずに、このフラグの裏に残す。
// 真になるのは APPLICATION_SUPPORT_ENABLED が "1" ちょうど、かつ VERCEL_ENV が "production" でないときだけ。
// 未設定・"0"・"true"・空は偽。本番のデプロイでは、"1" でも常に偽（外部提供しない。戻すときはコードの変更で、記録が残る）。
// 作法は lib/design-catalog.ts（DESIGN_CATALOG）と同じ。
//
// 【評価の時点】公開の `/`（app/page.tsx）は cacheComponents の下で静的に描かれる（ビルドの出力で ◐ Partial Prerender）。
// page.tsx は process.env を読むだけで動的な API を使わないため、値は **ビルドのとき（next build の環境）に固まる**。
// `next start` の環境変数を後から変えても `/` の見え方は変わらない（変えるには再ビルドが要る）。
// `/api/diagnose`（route.ts）は要求ごとにサーバーの環境を読む。ただし本番のデプロイは常に偽。
// このため、フラグを有効にした E2E は作らない（ビルドごとに値が 1 つで、別のビルドが要る）。
// 止めたコードの回帰は、packages/regulations の既存の単体テストと、ルートの層の単体テストで保つ。

export const isApplicationSupportEnabled = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean => env["APPLICATION_SUPPORT_ENABLED"] === "1" && env["VERCEL_ENV"] !== "production";

// 境界の文（暫定版。専門家の確認の前。画面には「暫定」と出さない）。
// 「代行」「代理」の語は使わない（Sprint 18 §6.1 で全面禁止にするため、例外を作らない）。
/** 判定の結論の直下（責任の注記）に出す短い文。 */
export const BOUNDARY_SHORT =
  "許可・承認などの申請は、ご本人が DIPS 2.0 などで行います。そらばんは、申請の作成・提出とその支援を行いません。";
