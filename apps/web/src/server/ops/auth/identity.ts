// 本人確認の結果（Sprint 10 設計 A）。アプリの他の部分は getCurrentIdentity() が返すこの型だけを使う。
import type { AuthProviderName } from "../availability";

export type Identity = {
  readonly provider: AuthProviderName;
  readonly authUserId: string;
  /** 小文字に正規化したメールアドレス。 */
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
};

/** ログ用に例外を 1 行にする（メッセージ本文には個人情報が含まれうるため、種別とコードだけ）。 */
export const describeError = (e: unknown): string => {
  if (e && typeof e === "object") {
    const o = e as { name?: unknown; code?: unknown };
    const name = typeof o.name === "string" ? o.name : "Error";
    const code = typeof o.code === "string" || typeof o.code === "number" ? String(o.code) : "-";
    return `${name} code=${code}`;
  }
  return "UnknownError code=-";
};
