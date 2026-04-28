"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  isValidLatLng,
  parseCombinedLatLng,
  YONAGO_CITY_HALL,
  type LatLng,
} from "@soraban/geo";
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

type DemoPreset = {
  readonly id: string;
  readonly name: string;
  readonly loc: LatLng;
  readonly hint: string;
};

// デモシナリオ用の固定地点。市役所→湊山公園→皆生温泉→医療センター→境港駅 の順で
// 6 規制レイヤーのコントラストが最大になるよう選定。
const DEMO_PRESETS: readonly DemoPreset[] = [
  {
    id: "yonago-city-hall",
    name: "米子市役所",
    loc: YONAGO_CITY_HALL,
    hint: "DID + 県条例（庁舎0m）",
  },
  {
    id: "minatoyama-park",
    name: "湊山公園（米子城跡）",
    loc: { lat: 35.4267, lng: 133.322 },
    hint: "公園条例 × 文化財保護法 同時red",
  },
  {
    id: "kaike-onsen",
    name: "皆生温泉",
    loc: { lat: 35.4538, lng: 133.3333 },
    hint: "公園条例 + 県条例（温泉街）",
  },
  {
    id: "tottori-univ-hospital",
    name: "鳥取大学医学部附属病院",
    loc: { lat: 35.4495, lng: 133.343 },
    hint: "県条例（病院近接）",
  },
  {
    id: "sakaiminato-station",
    name: "境港駅（市外）",
    loc: { lat: 35.543, lng: 133.228 },
    hint: "米子限定条例が unknown、空港バッファ要確認",
  },
];

export function RegulationChecker() {
  const [lat, setLat] = useState<string>(String(YONAGO_CITY_HALL.lat));
  const [lng, setLng] = useState<string>(String(YONAGO_CITY_HALL.lng));
  const [center, setCenter] = useState<LatLng>(YONAGO_CITY_HALL);
  const [combined, setCombined] = useState<string>("");
  // 結合入力フィールドのフィードバック。null=未入力、true=反映成功、false=形式エラー
  const [combinedStatus, setCombinedStatus] = useState<{
    readonly ok: boolean;
    readonly message: string;
  } | null>(null);
  const [address, setAddress] = useState<string>("");
  const [geocodeResults, setGeocodeResults] = useState<readonly GeocodeResult[]>([]);
  const [geocoding, setGeocoding] = useState<boolean>(false);
  const [result, setResult] = useState<RegulationCheckResult | null>(null);
  const [responseMs, setResponseMs] = useState<number | null>(null);
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
      const t0 = performance.now();
      try {
        const res = await checkLocation(loc);
        setResult(res);
        setResponseMs(Math.round(performance.now() - t0));
        setError(null);
        const newPref = res.muniCode?.slice(0, 2);
        if (newPref && newPref !== prefCode) setPrefCode(newPref);
      } catch (err) {
        setError(`判定に失敗しました: ${(err as Error).message}`);
      }
    });
  };

  // デモ初動短縮: 米子市役所で初期判定をプリロードして
  // 「ページが開いた瞬間に red 信号機」が見える状態にする。
  const didAutoRunRef = useRef<boolean>(false);
  useEffect(() => {
    if (didAutoRunRef.current) return;
    didAutoRunRef.current = true;
    runCheck(YONAGO_CITY_HALL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePick = (loc: LatLng): void => {
    if (!isValidLatLng(loc)) return;
    applyLocation(loc);
    runCheck(loc);
  };

  // 結合形式（"lat,lng" や Google Maps URL）を反映する。
  // 成功時は lat/lng を埋め、判定までトリガする（デモ・現場での「貼って即判定」UX）。
  const applyCombined = (text: string): boolean => {
    const parsed = parseCombinedLatLng(text);
    if (!parsed) {
      setCombinedStatus({ ok: false, message: "形式を認識できませんでした" });
      return false;
    }
    applyLocation(parsed);
    runCheck(parsed);
    setCombinedStatus({
      ok: true,
      message: `✓ 反映: ${round6(parsed.lat)}, ${round6(parsed.lng)}`,
    });
    return true;
  };

  // 緯度/経度の単一フィールドに結合形式が貼られた場合、自動で2値に分割して即判定。
  // 単一数値を貼っているだけのケースは default の貼り付け挙動に任せる。
  const handleSplitPaste = (e: React.ClipboardEvent<HTMLInputElement>): void => {
    const pasted = e.clipboardData.getData("text");
    const parsed = parseCombinedLatLng(pasted);
    if (!parsed) return;
    e.preventDefault();
    applyLocation(parsed);
    runCheck(parsed);
    setCombinedStatus({
      ok: true,
      message: `✓ 自動分割: ${round6(parsed.lat)}, ${round6(parsed.lng)}`,
    });
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

        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            座標を貼り付け（Google Maps の「座標をコピー」や URL に対応）
          </span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={combined}
              onChange={(e) => {
                setCombined(e.target.value);
                if (combinedStatus !== null) setCombinedStatus(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyCombined(combined);
                }
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                const parsed = parseCombinedLatLng(pasted);
                if (!parsed) return;
                e.preventDefault();
                setCombined(pasted.trim());
                applyLocation(parsed);
                runCheck(parsed);
                setCombinedStatus({
                  ok: true,
                  message: `✓ 反映: ${round6(parsed.lat)}, ${round6(parsed.lng)}`,
                });
              }}
              placeholder="例: 35.428303, 133.330614 ／ https://maps.google.com/...@35.428303,133.330614,15z"
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
            />
            <button
              type="button"
              onClick={() => applyCombined(combined)}
              disabled={combined.trim().length === 0}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              反映
            </button>
          </div>
          {combinedStatus !== null ? (
            <p
              className={
                combinedStatus.ok
                  ? "text-xs text-emerald-600 dark:text-emerald-400"
                  : "text-xs text-rose-600 dark:text-rose-400"
              }
              role="status"
            >
              {combinedStatus.message}
            </p>
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
              onPaste={handleSplitPaste}
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
              onPaste={handleSplitPaste}
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
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            デモ用プリセット
          </span>
          <div className="flex flex-wrap gap-2">
            {DEMO_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  applyLocation(preset.loc);
                  runCheck(preset.loc);
                }}
                title={preset.hint}
                className="inline-flex flex-col items-start gap-0.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-xs transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
              >
                <span className="font-medium text-zinc-800 dark:text-zinc-100">
                  {preset.name}
                </span>
                <span className="text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">
                  {preset.hint}
                </span>
              </button>
            ))}
          </div>
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
            {responseMs !== null ? (
              <span>
                応答:{" "}
                <span className="font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
                  {responseMs} ms
                </span>
              </span>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
