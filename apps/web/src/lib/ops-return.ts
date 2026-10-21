// 保存後に戻る画面（returnTo。Sprint 12c 設計 G）の検査。ブラウザにもサーバーにも依らない純粋な関数。
// 現場モードから日常点検の入力を開くとき、保存後に現場モードへ戻るために使う。

const ORIGIN = "http://same.origin.invalid";

/**
 * 戻り先として使ってよいパスだけを返す（使えなければ undefined）。同じオリジンの /ops/ 配下のパスだけ許す。
 * 外部の URL・スキーム付き・プロトコル相対（//）・バックスラッシュ・制御文字・.. で /ops/ の外へ出るものは使わない（オープンリダイレクトの防止）。
 */
export const safeReturnTo = (raw: string | undefined | null): string | undefined => {
  if (!raw || raw.length > 300) return undefined;
  if (!raw.startsWith("/ops/")) return undefined;
  if (raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return undefined;
  try {
    const u = new URL(raw, ORIGIN);
    if (u.origin !== ORIGIN || !u.pathname.startsWith("/ops/")) return undefined;
  } catch {
    return undefined;
  }
  return raw;
};
