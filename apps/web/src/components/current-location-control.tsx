"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
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
  /** 地図のキャンバス。ボタンと候補のパネルはこの上に重ねる。 */
  readonly children: ReactNode;
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

export function CurrentLocationControl({ candidate, onCandidate, onConfirm, children }: Props) {
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

  // 配置：ボタンと候補のパネルは地図に重ねる（押した後も地図が押し出されず、精度の円が画面内に残る）。
  //   - ボタン：右下。上のナビゲーション（右上）と下の出典表記（右下端）を避ける。48px 高。
  //   - 候補：地図の下端に重ねるパネル。出典表記を隠さないよう下に余白を取り、中央の印と円の大部分にかからないよう 1 行の見出し＋ボタンに詰める。
  //   - 説明文・失敗の案内：地図の直下（地図は動かさない）。種類は色だけでなく見出し語でも示す。
  const btnBase =
    "inline-flex h-12 items-center justify-center rounded-sharp border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-1 focus-visible:ring-offset-paper";
  return (
    <div className="flex flex-col" data-testid="current-location">
      <div className="relative">
        {children}
        {candidate ? (
          <div
            className="absolute inset-x-2 bottom-11 flex flex-col gap-2 rounded-sharp border border-rule bg-paper/95 p-2.5 sm:bottom-9 sm:p-3 text-xs shadow-[0_1px_0_rgba(14,20,33,0.08)] sm:left-auto sm:right-2.5 sm:w-[22rem]"
            data-testid="current-location-candidate"
          >
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-sm font-medium text-ink tnum">{formatAccuracy(candidate.accuracyM)}</span>
              <span className="text-[11px] text-ink-soft">まだ判定していません</span>
            </p>
            {isLowAccuracy(candidate.accuracyM) ? (
              <p className="border-l-2 border-signal-amber bg-signal-amber-soft/70 py-1 pl-2 pr-1 leading-snug text-ink" role="status">
                <span className="font-medium text-signal-amber">注意：</span>
                {LOW_ACCURACY_MESSAGE}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onConfirm(candidate)}
                className={`${btnBase} flex-1 border-brand-700 bg-brand-700 px-4 text-paper hover:bg-brand-900`}
              >
                この地点で判定
              </button>
              <button
                type="button"
                onClick={() => onCandidate(null)}
                className={`${btnBase} border-rule bg-paper px-4 text-ink-soft hover:border-ink-soft hover:bg-paper-soft`}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void locate()}
            disabled={unavailableReason.length > 0 || locating}
            aria-busy={locating}
            className={`${btnBase} absolute bottom-11 right-2.5 gap-2 sm:bottom-9 border-brand-700 bg-paper px-4 text-brand-700 shadow-[0_1px_2px_rgba(14,20,33,0.18)] hover:bg-brand-50 active:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60`}
            data-testid="current-location-button"
          >
            <span aria-hidden className="locate-mark" />
            {locating ? "現在地を取得中…" : "現在地"}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-rule bg-paper px-3 py-2.5 text-xs">
        <p className="leading-relaxed text-ink-soft" data-testid="current-location-privacy">
          {CURRENT_LOCATION_PRIVACY_NOTE}
        </p>
        {unavailableReason ? (
          <p className="border-l-2 border-rule pl-3 leading-relaxed text-ink-soft" role="status">
            {unavailableReason}
          </p>
        ) : null}
        {error ? (
          <p
            className="flex flex-col gap-0.5 border-l-2 border-signal-red bg-signal-red-soft/60 py-2 pl-3 pr-2 leading-relaxed text-ink"
            role="alert"
            data-testid="current-location-error"
          >
            <span className="text-[11px] font-medium text-signal-red">現在地を取得できませんでした</span>
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
