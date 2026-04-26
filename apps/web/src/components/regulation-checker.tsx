"use client";

import { useState, useTransition } from "react";
import { isValidLatLng, YONAGO_CITY_HALL, type LatLng } from "@soraban/geo";
import {
  CONFIDENCE_LABEL,
  STATUS_LABEL,
  type RegulationCheckResult,
  type RegulationStatus,
} from "@soraban/regulations";

import { searchAddress, type GeocodeResult } from "@/lib/geocode";
import { checkLocation } from "@/lib/check";
import { SignalLight } from "./signal-light";
import { RegulationCard } from "./regulation-card";
import { RegulationMap } from "./regulation-map";

const overallTone: Record<RegulationStatus, string> = {
  red: "text-rose-600 dark:text-rose-400",
  yellow: "text-amber-600 dark:text-amber-400",
  green: "text-emerald-600 dark:text-emerald-400",
  unknown: "text-zinc-600 dark:text-zinc-400",
};

const overallHelp: Record<RegulationStatus, string> = {
  red: "1件以上の規制で飛行不可。許可取得または別地点での運用を検討してください。",
  yellow: "要確認の規制があります。詳細を確認のうえ、必要に応じて許可申請してください。",
  green: "現在チェックした条例の範囲では、飛行可能です。",
  unknown: "判定可能な規制データが見つかりませんでした。管轄機関に直接ご確認ください。",
};

const round6 = (n: number): string => n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

export function RegulationChecker() {
  const [lat, setLat] = useState<string>(String(YONAGO_CITY_HALL.lat));
  const [lng, setLng] = useState<string>(String(YONAGO_CITY_HALL.lng));
  const [center, setCenter] = useState<LatLng>(YONAGO_CITY_HALL);
  const [address, setAddress] = useState<string>("");
  const [geocodeResults, setGeocodeResults] = useState<readonly GeocodeResult[]>([]);
  const [geocoding, setGeocoding] = useState<boolean>(false);
  const [result, setResult] = useState<RegulationCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefCode, setPrefCode] = useState<string>("31"); // 鳥取県デフォルト
  const [isChecking, startChecking] = useTransition();

  const applyLocation = (loc: LatLng): void => {
    setLat(round6(loc.lat));
    setLng(round6(loc.lng));
    setCenter(loc);
  };

  const runCheck = (loc: LatLng): void => {
    startChecking(async () => {
      try {
        const res = await checkLocation(loc);
        setResult(res);
        setError(null);
        const newPref = res.muniCode?.slice(0, 2);
        if (newPref && newPref !== prefCode) setPrefCode(newPref);
      } catch (err) {
        setError(`判定に失敗しました: ${(err as Error).message}`);
      }
    });
  };

  const handlePick = (loc: LatLng): void => {
    if (!isValidLatLng(loc)) return;
    applyLocation(loc);
    runCheck(loc);
  };

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
    setCenter({ lat: latNum, lng: lngNum });
    runCheck({ lat: latNum, lng: lngNum });
  };

  const handleGeocode = async () => {
    if (address.trim().length === 0) return;
    setGeocoding(true);
    setError(null);
    try {
      const found = await searchAddress(address);
      setGeocodeResults(found);
      if (found.length === 0) {
        setError("住所が見つかりませんでした。");
      } else if (found.length === 1) {
        const first = found[0]!;
        applyLocation({ lat: first.lat, lng: first.lng });
        runCheck({ lat: first.lat, lng: first.lng });
        setGeocodeResults([]);
      }
    } catch (err) {
      setError(`ジオコーディングに失敗: ${(err as Error).message}`);
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            住所から検索（国土地理院ジオコーダ）
          </span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleGeocode();
                }
              }}
              placeholder="例: 鳥取県米子市加茂町1-1"
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
            />
            <button
              type="button"
              onClick={() => void handleGeocode()}
              disabled={geocoding || address.trim().length === 0}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {geocoding ? "検索中…" : "住所で位置決定"}
            </button>
          </div>
          {geocodeResults.length > 1 ? (
            <ul className="mt-1 flex flex-col gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              {geocodeResults.map((r) => (
                <li key={`${r.addressCode}-${r.lat}-${r.lng}`}>
                  <button
                    type="button"
                    onClick={() => {
                      applyLocation({ lat: r.lat, lng: r.lng });
                      runCheck({ lat: r.lat, lng: r.lng });
                      setGeocodeResults([]);
                    }}
                    className="w-full rounded px-2 py-1.5 text-left hover:bg-white dark:hover:bg-zinc-800"
                  >
                    <span className="font-medium">{r.title}</span>
                    <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                      ({round6(r.lat)}, {round6(r.lng)})
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

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
            disabled={isChecking}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isChecking ? "判定中…" : "規制をチェック"}
          </button>
          <button
            type="button"
            onClick={() => {
              applyLocation(YONAGO_CITY_HALL);
              runCheck(YONAGO_CITY_HALL);
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

      <RegulationMap center={center} prefCode={prefCode} onPick={handlePick} />

      {result ? (
        <section
          className="flex flex-col gap-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-900/40"
          aria-live="polite"
        >
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <SignalLight status={result.overall === "unknown" ? "yellow" : result.overall} size="lg" />
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
                {result.resolvedAddress ? `（${result.resolvedAddress}）` : ""}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <span className="font-semibold">免責: </span>
            {result.disclaimer}
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

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <span>
              判定ID:{" "}
              <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                {result.evidenceId}
              </code>
            </span>
            <span>
              全体確信度:{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-200">
                {CONFIDENCE_LABEL[result.overallConfidence]}
              </span>
            </span>
            <span>エンジン: {result.engineVersion}</span>
            <span>判定時刻: {new Date(result.checkedAt).toLocaleString("ja-JP")}</span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
