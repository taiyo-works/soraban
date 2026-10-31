"use client";

// ホーム（今日）を開いたときの先読み（Sprint 15 設計 3・契約 B-1）と、送信待ちの続き（契約 E-7）、ホーム画面への追加の案内。
//   - 通信できれば、今日と明日の、利用者が操縦者の計画の束を取り、端末（IndexedDB）に利用者ごとのキーで保存する。
//   - 端末に残っている送信待ち（再ログインの後など）を、計画ごとに順番に送る。
//   - 保存した計画の数と時刻を小さく出す。圏外の現場で開き直せる計画が分かるように。
import { useEffect, useState } from "react";
import { jstTime } from "@/lib/ops-time";
import { flushOutbox, planIdsWithOutbox } from "./field-outbox";
import { fetchBundles, listBundles, setCurrentMember } from "./field-store";
import { reportServerBuild } from "./pwa-register";

export function FieldPrefetch({ memberId }: { readonly memberId: string }) {
  const [status, setStatus] = useState<{ readonly count: number; readonly at: string | null; readonly failed: boolean } | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      setStandalone(window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true);
      setIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    }, 0);
    setCurrentMember(memberId);
    void (async () => {
      const r = navigator.onLine ? await fetchBundles(memberId) : null;
      if (r) reportServerBuild(r.build);
      const saved = await listBundles(memberId);
      const latest = saved.map((b) => b.fetchedAt).sort().pop() ?? null;
      if (!cancelled) setStatus({ count: saved.length, at: latest, failed: r === null });
      // 端末に残っている送信待ち（ログインし直した後など）を送る
      for (const planId of planIdsWithOutbox(memberId)) await flushOutbox(planId, memberId);
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [memberId]);
  return (
    <div className="flex flex-col gap-2 text-[13px] text-sb-ink-2">
      {status ? (
        <p data-testid="pwa-prefetch-status" data-count={status.count}>
          圏外用に端末へ保存した計画：{status.count} 件{status.at ? `（${jstTime(new Date(status.at))} 更新）` : ""}
          {status.failed ? "。いまは更新できませんでした（前回の保存を使います）" : ""}
        </p>
      ) : null}
      {!standalone ? (
        <details data-testid="pwa-install-guide">
          <summary className="cursor-pointer py-2">ホーム画面に追加する（圏外の現場で開くため）</summary>
          <p>
            {ios
              ? "Safari の共有ボタンから「ホーム画面に追加」を選びます。"
              : "ブラウザのメニューから「ホーム画面に追加」または「アプリをインストール」を選びます。"}
            電波のある場所でこのホームを開くと、今日と明日の計画が端末に保存され、圏外でも現場の画面を開けます。
          </p>
        </details>
      ) : null}
    </div>
  );
}
