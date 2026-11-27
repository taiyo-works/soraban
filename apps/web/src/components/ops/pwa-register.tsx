"use client";

// 運航管理の Service Worker の登録と、新しい版の知らせ（Sprint 15 設計 5・契約 A-2・A-4）。
//   - /ops の画面（app/ops/layout.tsx）からだけ登録する。公開の判定画面 / では登録しない（scope も /ops）。
//     OPS_ENABLED が無効なら /ops は 404 で、この部品は描かれない。開発サーバー（next dev）では登録しない（ビルドの無い資産をキャッシュしない）。
//   - 新しい版が待機したら「新しい版があります」を出す。入力中の画面を勝手に再読み込みしない。
//     「更新する」を押したときだけ切り替えて再読み込みする。押さなければ、次に開いたときに反映される。
//   - 画面の版と API の版の食い違い（古い画面から新しい API を呼ぶ）も、同じ知らせで再読み込みを促す（PWA_NEW_VERSION_EVENT）。
import { useEffect, useRef, useState } from "react";
import { SW_SCOPE, SW_URL } from "@/lib/pwa";

/** 画面の版（ビルドの識別子。next.config の env で埋め込む）。 */
export const CLIENT_BUILD_ID = process.env.SORABAN_BUILD_ID ?? "dev";
/** API の応答の版が画面の版と違うとき、画面の部品がこのイベントを送る。 */
export const PWA_NEW_VERSION_EVENT = "soraban:new-version";

/** API の応答の版を比べ、違えば新しい版の知らせを出す。 */
export const reportServerBuild = (build: string | null | undefined): void => {
  if (typeof window === "undefined" || !build || build === CLIENT_BUILD_ID || CLIENT_BUILD_ID === "dev") return;
  window.dispatchEvent(new CustomEvent(PWA_NEW_VERSION_EVENT, { detail: { build } }));
};

export function PwaRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const userAsked = useRef(false);

  useEffect(() => {
    const onMismatch = () => setMismatch(true);
    window.addEventListener(PWA_NEW_VERSION_EVENT, onMismatch);
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return () => window.removeEventListener(PWA_NEW_VERSION_EVENT, onMismatch);
    }
    let cancelled = false;
    const sw = navigator.serviceWorker;
    // 利用者が「更新する」を押したときだけ再読み込みする（新しい版が勝手に画面を入れ替えない）
    const onControllerChange = () => {
      if (userAsked.current) window.location.reload();
    };
    sw.addEventListener("controllerchange", onControllerChange);
    const watch = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && sw.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener("statechange", () => {
          // 既存の版が画面を受け持っているときだけ「新しい版」（最初の登録では知らせない）
          if (w.state === "installed" && sw.controller && !cancelled) setWaiting(w);
        });
      });
    };
    const register = async () => {
      try {
        const reg = await sw.register(`${SW_URL}?v=${encodeURIComponent(CLIENT_BUILD_ID)}`, { scope: SW_SCOPE, updateViaCache: "none" });
        if (!cancelled) watch(reg);
      } catch {
        // 登録できない環境（非対応・HTTPS でない・無効化）では何もしない。送信待ちは従来どおり動く
      }
    };
    void register();
    // E2E・別の画面から登録された版も見張る
    void sw.getRegistration(SW_SCOPE).then((reg) => {
      if (reg && !cancelled) watch(reg);
    });
    return () => {
      cancelled = true;
      sw.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener(PWA_NEW_VERSION_EVENT, onMismatch);
    };
  }, []);

  if (!waiting && !mismatch) return null;
  const update = () => {
    userAsked.current = true;
    if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
    else window.location.reload();
  };
  return (
    <div role="status" className="opx-box mx-4 mt-3 flex-row flex-wrap items-center text-sb-ink" data-testid="pwa-update">
      <p className="min-w-0 flex-1">新しい版があります。入力中の内容は消えません。区切りのよいときに更新してください（次に開いたときにも反映されます）。</p>
      <button type="button" className="opx-btn" onClick={update} data-testid="pwa-update-button">
        更新する
      </button>
    </div>
  );
}
