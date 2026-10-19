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

  return (
    <div className="flex flex-col gap-2 border border-rule bg-paper p-3 text-xs" data-testid="current-location">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void locate()}
          disabled={unavailableReason.length > 0 || locating}
          className="inline-flex h-11 items-center justify-center rounded-sharp border border-brand-700 bg-paper px-4 text-xs font-medium text-brand-700 hover:bg-paper-soft disabled:opacity-40"
          data-testid="current-location-button"
        >
          {locating ? "現在地を取得中…" : "現在地"}
        </button>
        <span className="flex-1 text-[11px] leading-relaxed text-ink-mute" data-testid="current-location-privacy">
          {CURRENT_LOCATION_PRIVACY_NOTE}
        </span>
      </div>
      {unavailableReason ? (
        <p className="text-[11px] text-ink-soft" role="status">
          {unavailableReason}
        </p>
      ) : null}
      {error ? (
        <p className="text-[11px] text-signal-red" role="alert" data-testid="current-location-error">
          {error}
        </p>
      ) : null}
      {candidate ? (
        <div className="flex flex-col gap-2" data-testid="current-location-candidate">
          <p className="font-medium text-ink">{formatAccuracy(candidate.accuracyM)}</p>
          {isLowAccuracy(candidate.accuracyM) ? (
            <p className="text-[11px] text-signal-amber" role="status">
              {LOW_ACCURACY_MESSAGE}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onConfirm(candidate)}
              className="inline-flex h-11 items-center justify-center rounded-sharp border border-brand-700 bg-brand-700 px-4 text-xs font-medium text-paper"
            >
              この地点で判定
            </button>
            <button
              type="button"
              onClick={() => onCandidate(null)}
              className="inline-flex h-11 items-center justify-center rounded-sharp border border-rule bg-paper px-4 text-xs font-medium text-ink-soft"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
