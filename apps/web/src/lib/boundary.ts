// サービスの境界（Sprint 18-1）。
//
// 申請支援の機能フラグ APPLICATION_SUPPORT_ENABLED と、境界の短い文を 1 か所に置く。
//
// 【フラグ】申請支援（手続き診断のパネル・書類 PDF・プリフィル・マニュアル骨子・申請の期限のカレンダー）は、
// 専門家の確認（legal-info-plan.md Q-L2）が出るまで止める。コードは消さずに、このフラグの裏に残す。
// 真になるのは APPLICATION_SUPPORT_ENABLED が "1" ちょうど、かつ Vercel の環境でないとき（VERCEL が未設定で VERCEL_ENV が production でない）だけ。
// 未設定・"0"・"true"・空は偽。Vercel のどの環境（production・preview を含む）でも "1" は常に偽（外部提供しない。戻すときはコードの変更で、記録が残る）。
// 理由：preview の URL が保護されていないと外から見え、再ビルドなしの昇格で静的な `/` に有効が残るおそれがあるため（Sprint 18 §12 の追記）。
// 有効にできるのは Vercel 以外（ローカル・自前ホスト）だけ。Vercel のどの環境にもこの変数を設定しない（docs/runbooks/local-verification.md）。
//
// 【評価の時点】公開の `/`（app/page.tsx）は cacheComponents の下で静的に描かれる（ビルドの出力で ◐ Partial Prerender）。
// page.tsx は process.env を読むだけで動的な API を使わないため、値は **ビルドのとき（next build の環境）に固まる**。
// `next start` の環境変数を後から変えても `/` の見え方は変わらない（変えるには再ビルドが要る）。
// `/api/diagnose`（route.ts）は要求ごとにサーバーの環境を読む。ただし本番のデプロイは常に偽。
// このため、フラグを有効にした E2E は作らない（ビルドごとに値が 1 つで、別のビルドが要る）。
// 止めたコードの回帰は、packages/regulations の既存の単体テストと、ルートの層の単体テストで保つ。

export const isApplicationSupportEnabled = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean =>
  env["APPLICATION_SUPPORT_ENABLED"] === "1" && env["VERCEL_ENV"] !== "production" && !env["VERCEL"];

// 境界の文（暫定版。専門家の確認の前。画面には「暫定」と出さない）。
// 「代行」「代理」の語は使わない（Sprint 18 §6.1 で全面禁止にするため、例外を作らない）。
/** 判定の結論の直下（責任の注記）に出す短い文。 */
export const BOUNDARY_SHORT =
  "許可・承認などの申請は、ご本人が DIPS 2.0 などで行います。そらばんは、申請の作成・提出とその支援を行いません。";

/** このアプリについて（/ops/about）に出す、境界の全文（Sprint 18-3 §5.2）。 */
export const BOUNDARY_FULL =
  "そらばんは、許可・承認、機体登録、操縦者登録などの申請の作成・提出とその支援を行いません。飛行計画の通報は、利用者本人が DIPS 2.0 の認証と最終確認のもとで行います。そらばんは、通報の内容の整理と、通報した結果の記録を扱います。";

/** 機体・操縦者の一覧と、通報の作業台に出す 1 行（Sprint 18-3 §5.2）。 */
export const BOUNDARY_REGISTRATION = "機体・操縦者の DIPS への登録は、利用者本人が DIPS で行います。";
