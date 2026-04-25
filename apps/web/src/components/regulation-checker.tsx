"use client";

import { useState } from "react";
import { isValidLatLng, YONAGO_CITY_HALL } from "@soraban/geo";
import {
  checkRegulations,
  STATUS_LABEL,
  type RegulationCheckResult,
  type RegulationStatus,
} from "@soraban/regulations";

import { SignalLight } from "./signal-light";
import { RegulationCard } from "./regulation-card";

const overallTone: Record<RegulationStatus, string> = {
  red: "text-rose-600 dark:text-rose-400",
  yellow: "text-amber-600 dark:text-amber-400",
  green: "text-emerald-600 dark:text-emerald-400",
};

const overallHelp: Record<RegulationStatus, string> = {
  red: "1件以上の規制で飛行不可。許可取得または別地点での運用を検討してください。",
  yellow: "要確認の規制があります。詳細を確認のうえ、必要に応じて許可申請してください。",
  green: "現在チェックした条例の範囲では、飛行可能です。",
};

export function RegulationChecker() {
  const [lat, setLat] = useState<string>(String(YONAGO_CITY_HALL.lat));
  const [lng, setLng] = useState<string>(String(YONAGO_CITY_HALL.lng));
  const [result, setResult] = useState<RegulationCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!isValidLatLng({ lat: latNum, lng: lngNum })) {
      setError("緯度・経度の値が正しくありません。緯度は -90〜90、経度は -180〜180 の数値で入力してください。");
      setResult(null);
      return;
    }
    setError(null);
    setResult(checkRegulations({ lat: latNum, lng: lngNum }));
  };

  return (
    <div className="flex flex-col gap-8">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">緯度 (lat)</span>
            <input
              type="text"
              inputMode="decimal"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
              placeholder="35.4283"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">経度 (lng)</span>
            <input
              type="text"
              inputMode="decimal"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
              placeholder="133.3306"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            規制をチェック
          </button>
          <button
            type="button"
            onClick={() => {
              setLat(String(YONAGO_CITY_HALL.lat));
              setLng(String(YONAGO_CITY_HALL.lng));
            }}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            米子市役所
          </button>
        </div>
        {error ? (
          <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {result ? (
        <section
          className="flex flex-col gap-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-900/40"
          aria-live="polite"
        >
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <SignalLight status={result.overall} size="lg" />
            <div className="flex flex-col gap-1">
              <p className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                総合判定
              </p>
              <p className={`text-2xl font-semibold ${overallTone[result.overall]}`}>
                {STATUS_LABEL[result.overall]}
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                {overallHelp[result.overall]}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                判定地点 緯度 {lat} / 経度 {lng}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              関連条例 ({result.regulations.length} 件)
            </p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {result.regulations.map((r) => (
                <RegulationCard key={r.id} regulation={r} />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
