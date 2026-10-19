// 入力中の下書き（Sprint 11 設計 E・G）。端末のブラウザ（localStorage）にだけ保ち、サーバーには送らない。
// 再読み込み・通信の切断で入力が消えないようにするためのもの。保存に成功したとき・ログアウトしたときに消す。
// 保存できない環境（プライベートブラウズ・容量超過等）では、下書きを保たないだけで入力はできる。

const PREFIX = "soraban:ops-draft:";

export type DraftKind = "flight" | "inspection";

/**
 * 下書きのキー。利用者（内部 ID）ごとに分ける（共用の端末で、前の人の下書き・送信の識別子を次の人に引き継がないため）。
 * 例：soraban:ops-draft:flight:<利用者の ID>
 */
export const draftKey = (kind: DraftKind, memberId: string): string => `${PREFIX}${kind}:${memberId}`;

/** ある利用者のものでない下書き（他の利用者・利用者を区別していなかった旧形式）を消す。ログイン後の画面で呼ぶ。 */
export const clearOtherUsersDrafts = (memberId: string): void => {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX) && !k.endsWith(`:${memberId}`)) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {
    // 何もしない
  }
};

export const loadDraft = <T>(key: string): T | null => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const saveDraft = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できない環境では何もしない
  }
};

export const clearDraft = (key: string): void => {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 何もしない
  }
};

/** 運航管理のすべての下書きを消す（ログアウト時）。 */
export const clearOpsDrafts = (): void => {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {
    // 何もしない
  }
};

/** 下書きごとの送信の識別子（二重送信の防止）。 */
export const newRequestId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.floor(Math.random() * 256) & (15 >> (Number(c) / 4)))).toString(16),
      );
