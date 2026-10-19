"use client";

import { useState, useSyncExternalStore } from "react";
import {
  CURRENT_LOCATION_PRIVACY_NOTE,
  formatAccuracy,
  geolocationAvailability,
  isLowAccuracy,
  LOW_ACCURACY_MESSAGE,
  requestCurrentLocation,
  type CurrentLocationCandidate,
} from "@/lib/current-location";

type Props = {
  readonly candidate: CurrentLocationCandidate | null;
  readonly onCandidate: (c: CurrentLocationCandidate | null) => void;
  /** 「この地点で判定」。ここで初めて判定（座標の送信）が行われる。 */
  readonly onConfirm: (c: CurrentLocationCandidate) => void;
};

const noopSubscribe = () => () => {};
// 位置情報が使えるか（SSR では判定しない）。値は理由の文字列（使えるときは空文字）。
const availabilitySnapshot = (): string => {
  const a = geolocationAvailability({
    geolocation: typeof navigator !== "undefined" ? navigator.geolocation : undefined,
    isSecureContext: typeof window !== "undefined" ? window.isSecureContext : undefined,
  });
  return a.available ? "" : a.reason;
};

export function CurrentLocationControl({ candidate, onCandidate, onConfirm }: Props) {
  const unavailableReason = useSyncExternalStore(noopSubscribe, availabilitySnapshot, () => "");
  const [locating, setLocating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const locate = async (): Promise<void> => {
    if (unavailableReason || locating) return;
    setLocating(true);
    setError(null);
    // 押したときに 1 回だけ取得する（追跡・自動の再試行はしない）
    const outcome = await requestCurrentLocation(navigator.geolocation);
    setLocating(false);
    if (outcome.ok) {
      onCandidate(outcome.candidate);
    } else {
      // 失敗しても、それまでの地点と判定結果は変えない
      setError(outcome.message);
    }
  };

  // 屋外・片手での操作を想定し、主ボタンは 48px 高・スマートフォンでは横幅いっぱいにする。
  // 案内文は日差しの下でも読めるよう 12px・本文色に寄せ、種類は色だけでなく見出し語でも示す。
  return (
    <div
      className="flex flex-col gap-3 border border-rule bg-paper p-3 text-xs sm:p-4"
      data-testid="current-location"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <button
          type="button"
          onClick={() => void locate()}
          disabled={unavailableReason.length > 0 || locating}
          aria-busy={locating}
          className="inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-sharp border border-brand-700 bg-paper px-5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 active:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-1 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          data-testid="current-location-button"
        >
          <span aria-hidden className="locate-mark" />
          {locating ? "現在地を取得中…" : "現在地"}
        </button>
        <span
          className="flex-1 text-xs leading-relaxed text-ink-soft"
          data-testid="current-location-privacy"
        >
          {CURRENT_LOCATION_PRIVACY_NOTE}
        </span>
      </div>
      {unavailableReason ? (
        <p className="border-l-2 border-rule pl-3 text-xs leading-relaxed text-ink-soft" role="status">
          {unavailableReason}
        </p>
      ) : null}
      {error ? (
        <p
          className="flex flex-col gap-0.5 border-l-2 border-signal-red bg-signal-red-soft/60 py-2 pl-3 pr-2 text-xs leading-relaxed text-ink"
          role="alert"
          data-testid="current-location-error"
        >
          <span className="text-[11px] font-medium text-signal-red">取得できませんでした</span>
          <span>{error}</span>
        </p>
      ) : null}
      {candidate ? (
        <div className="flex flex-col gap-2 border-t border-rule pt-3" data-testid="current-location-candidate">
          <p className="text-sm font-medium text-ink tnum">{formatAccuracy(candidate.accuracyM)}</p>
          <p className="text-xs leading-relaxed text-ink-soft">
            地図の円が位置の誤差の範囲です。まだ判定していません。
          </p>
          {isLowAccuracy(candidate.accuracyM) ? (
            <p
              className="flex flex-col gap-0.5 border-l-2 border-signal-amber bg-signal-amber-soft/60 py-2 pl-3 pr-2 text-xs leading-relaxed text-ink"
              role="status"
            >
              <span className="text-[11px] font-medium text-signal-amber">注意</span>
              <span>{LOW_ACCURACY_MESSAGE}</span>
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onConfirm(candidate)}
              className="inline-flex h-12 flex-1 items-center justify-center rounded-sharp border border-brand-700 bg-brand-700 px-5 text-sm font-medium text-paper transition-colors hover:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:flex-none"
            >
              この地点で判定
            </button>
            <button
              type="button"
              onClick={() => onCandidate(null)}
              className="inline-flex h-12 items-center justify-center rounded-sharp border border-rule bg-paper px-5 text-sm font-medium text-ink-soft transition-colors hover:border-ink-soft hover:bg-paper-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-1 focus-visible:ring-offset-paper"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
