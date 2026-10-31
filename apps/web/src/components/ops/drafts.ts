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

/**
 * 通報の画面の入力の下書き（Sprint 12b）。計画ごと・利用者ごと。末尾が利用者の ID なので、他の利用者の下書きは
 * clearOtherUsersDrafts が消す。例：soraban:ops-draft:report-<計画の ID>:<利用者の ID>
 */
export const reportDraftKey = (planId: string, memberId: string): string => `${PREFIX}report-${planId}:${memberId}`;

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

/** 送信待ち（現場の記録・点検・日誌、事故・ヒヤリハットの簡易記録）のキーか。 */
const isOutboxStorageKey = (k: string): boolean => k.startsWith(`${PREFIX}field-`) || k.startsWith(`${PREFIX}incident-`);

/**
 * 運航管理のすべての下書きを消す（ログアウト時）。
 * Sprint 15：keepOutboxOf を渡すと、その利用者の送信待ちだけは残す（未送信を警告したうえで「残してログアウト」を選んだとき）。
 * 同じ利用者が再びログインすると続きを送る。別の利用者がログインすると clearOtherUsersDrafts が消す。
 */
export const clearOpsDrafts = (opts: { readonly keepOutboxOf?: string } = {}): void => {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      if (opts.keepOutboxOf && isOutboxStorageKey(k) && k.endsWith(`:${opts.keepOutboxOf}`)) continue;
      keys.push(k);
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
