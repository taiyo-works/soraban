"use client";

import { useState, useSyncExternalStore } from "react";
import {
  CURRENT_LOCATION_JUDGE_NOTE,
  formatAccuracy,
  geolocationAvailability,
  isLowAccuracy,
  LOW_ACCURACY_MESSAGE,
  requestCurrentLocation,
  type CurrentLocationCandidate,
} from "@/lib/current-location";

// 現在地での判定（12h §1：押したらすぐ判定。精度が 100m を超えるときだけ確認を 1 回）。
// - 開いただけでは位置を要求しない。「現在地で判定」を押したときに getCurrentPosition を 1 回だけ呼ぶ（追跡・自動の再取得はしない）。
// - 取得に失敗したら判定せず、地点と前の結果は変えない（失敗の表示だけ）。
// - 精度 100m 以内は続けて判定する（呼び出し側）。100m を超えるときは、ここの確認のパネルを 1 回出し、「この地点で判定」で初めて判定する。
// - 判定に送るのは緯度・経度（小数 6 桁）だけ。精度・時刻・方法は送らない（candidateToLocation）。

const noopSubscribe = () => () => {};
// 位置情報が使えるか（SSR では判定しない）。値は理由の文字列（使えるときは空文字）。
const availabilitySnapshot = (): string => {
  const a = geolocationAvailability({
    geolocation: typeof navigator !== "undefined" ? navigator.geolocation : undefined,
    isSecureContext: typeof window !== "undefined" ? window.isSecureContext : undefined,
  });
  return a.available ? "" : a.reason;
};

/** 「現在地で判定」を押したときの取得。成功したら onLocated に渡し、失敗したら理由を返す（地点と結果には触れない）。 */
export function useCurrentLocationRequest(onLocated: (c: CurrentLocationCandidate) => void) {
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
    if (outcome.ok) onLocated(outcome.candidate);
    else setError(outcome.message);
  };

  return { unavailableReason, locating, error, locate, clearError: () => setError(null) };
}

type NotesProps = {
  /** 精度が 100m を超えた現在地（確認待ち）。 */
  readonly candidate: CurrentLocationCandidate | null;
  readonly unavailableReason: string;
  readonly error: string | null;
  readonly onConfirm: (c: CurrentLocationCandidate) => void;
  readonly onCancel: () => void;
};

/** 現在地の説明・確認（100m 超）・失敗の案内。ボタンの直下に置く。 */
export function CurrentLocationNotes({ candidate, unavailableReason, error, onConfirm, onCancel }: NotesProps) {
  return (
    <div className="flex flex-col gap-2">
      {candidate ? (
        <div className="sb-note-card is-warn flex flex-col gap-2" data-testid="current-location-candidate" role="group" aria-label="現在地の確認">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="sb-num font-bold text-sb-ink">{formatAccuracy(candidate.accuracyM)}</span>
            <span>です。この位置で判定しますか（まだ判定していません）</span>
          </p>
          {isLowAccuracy(candidate.accuracyM) ? (
            <p role="status">
              <span className="font-bold">注意：</span>
              {LOW_ACCURACY_MESSAGE}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onConfirm(candidate)} className="sb-text-btn !bg-sb-primary !border-sb-primary !text-sb-on-primary">
              この地点で判定
            </button>
            <button type="button" onClick={onCancel} className="sb-text-btn">
              取消
            </button>
          </div>
        </div>
      ) : null}
      <p className="sb-hint" data-testid="current-location-privacy">
        {CURRENT_LOCATION_JUDGE_NOTE}
      </p>
      {unavailableReason ? (
        <p className="sb-note-card" role="status">
          {unavailableReason}
        </p>
      ) : null}
      {error ? (
        <p className="sb-note-card is-error flex flex-col gap-0.5" role="alert" data-testid="current-location-error">
          <span className="text-sm font-bold text-sb-v-no-fg">現在地を取得できませんでした</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
