
// 運航管理への入口を出してよいか（Sprint 12a 設計 J）。
// `/` は静的なシェルのまま保つ（cacheComponents）。運航管理が有効でログイン済みかは、Suspense の内側の動的な部分
// （components/ops-home-entry.tsx）がサーバーで決め、その部分が描かれたときにこの値を立てる。
// 判定結果の「この判定で飛行計画を作る」ボタンは、この値が立っているときだけ出す。
// 運航管理が無効のときは何も描かれず、追加の通信（404 のコンソールエラー）も起きない。
import { useSyncExternalStore } from "react";

let available = false;
const listeners = new Set<() => void>();

export const setOpsEntryAvailable = (value: boolean): void => {
  if (available === value) return;
  available = value;
  for (const l of listeners) l();
};

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useOpsEntryAvailable = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => available,
    () => false,
  );
