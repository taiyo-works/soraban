"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import {
  isValidLatLng,
  parseCombinedLatLng,
  YONAGO_CITY_HALL,
  type LatLng,
} from "@soraban/geo";
import {
  CONFIDENCE_LABEL,
  STATUS_LABEL,
  shouldWarnConfidence,
  FLIGHT_METHOD_FLAGS,
  AIRSPACE_FLAGS,
  SPECIFIC_FLIGHT_FLAG_LABEL,
  DIAGNOSIS_DISCLAIMER,
  type FlightContext,
  type RegulationCheckResult,
  type RegulationStatus,
  type SpecificFlightFlag,
} from "@soraban/regulations";

import { searchAddress, type GeocodeResult } from "@/lib/geocode";
import { checkLocation } from "@/lib/check";
import { diagnoseLocation, type DiagnoseResponse } from "@/lib/diagnose";
import {
  clearHistory,
  getHistoryServerSnapshot,
  getHistorySnapshot,
  removeHistory,
  saveHistory,
  subscribeHistory,
  type SavedCheck,
} from "@/lib/history";
import { SignalLight } from "./signal-light";
import { RegulationCard } from "./regulation-card";
import { RegulationMap } from "./regulation-map";
import { DiagnosisPanel } from "./diagnosis-panel";

const overallTone: Record<RegulationStatus, string> = {
  red: "text-signal-red",
  yellow: "text-signal-amber",
  green: "text-signal-green",
  unknown: "text-ink-mute",
};

const overallHelp: Record<RegulationStatus, string> = {
  red: "1件以上の規制で飛行不可。許可取得または別地点での運用を検討してください。",
  yellow: "要確認の規制があります。詳細を確認のうえ、必要に応じて許可申請してください。",
  green: "現在チェックした全ての規制で、適用外または例外節該当（飛行可能と判断できる状態）です。",
  unknown:
    "一部の規制でデータが未整備のため、飛行可否を確証できません。下記カードで「未整備」となっている項目を確認し、該当機関に直接ご確認ください。",
};

const round6 = (n: number): string => n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

type PresetGroup = "鳥取県" | "島根県";

type DemoPreset = {
  readonly id: string;
  readonly name: string;
  readonly loc: LatLng;
  readonly hint: string;
  readonly group: PresetGroup;
  // この地点で前提となる空域フラグ（DID・空港等）。プリセットの curated 知見
  // （hint と同じ出所）を申請支援診断に引き継ぐ。DID polygon データは未追跡で
  // エンジンが unknown 縮退するため、curated なプリセットで空域フラグを補完する。
  readonly airspaceFlags?: readonly SpecificFlightFlag[];
};

// デモシナリオ用の固定地点。県別にグルーピングし、特許コア（複数規制の同時 red）
// と自治体カバレッジ拡大（鳥取2市 + 島根1市）を端的に提示できるよう並べる。
// 先頭はユーザの本社拠点 (起点) を置き、現場運用で「拠点と出張先のコントラスト」を
// 1 タップで切り替えられるようにする。
const DEMO_PRESETS: readonly DemoPreset[] = [
  {
    id: "taiyo-tsushin-hq",
    name: "タイヨー通信本社（拠点）",
    loc: { lat: 35.434238, lng: 133.380508 },
    hint: "拠点 / 国法は green。日吉津村は自治体カバレッジ外（一部判定不能）",
    group: "鳥取県",
  },
  {
    id: "yonago-city-hall",
    name: "米子市役所",
    loc: YONAGO_CITY_HALL,
    hint: "DID + 県条例（庁舎0m）",
    group: "鳥取県",
    airspaceFlags: ["airspace_did"],
  },
  {
    id: "minatoyama-park",
    name: "湊山公園(米子城跡)",
    loc: { lat: 35.4267, lng: 133.322 },
    hint: "公園条例 × 文化財保護法 同時red",
    group: "鳥取県",
  },
  {
    id: "kaike-onsen",
    name: "皆生温泉",
    loc: { lat: 35.4538, lng: 133.3333 },
    hint: "公園条例 + 県条例（温泉街）",
    group: "鳥取県",
  },
  {
    id: "tottori-univ-hospital",
    name: "鳥取大学医学部附属病院",
    loc: { lat: 35.4495, lng: 133.343 },
    hint: "県条例（病院近接）",
    group: "鳥取県",
  },
  {
    id: "sakaiminato-station",
    name: "境港駅",
    // JR境港駅 (境港市大正町209-1): 35°32′41″N 133°13′37″E
    loc: { lat: 35.5447, lng: 133.2269 },
    hint: "境港市カバレッジ + 県条例（駅0m）",
    group: "鳥取県",
  },
  {
    id: "yonago-airport",
    name: "米子鬼太郎空港",
    loc: { lat: 35.4925, lng: 133.2364 },
    hint: "空港敷地内 + 美保基地 red（航空法 × 小型無人機等飛行禁止法）",
    group: "鳥取県",
    airspaceFlags: ["airspace_airport"],
  },
  {
    id: "yume-minato-park",
    name: "夢みなと公園(境港)",
    loc: { lat: 35.5455, lng: 133.2235 },
    hint: "境港市公園条例 red",
    group: "鳥取県",
  },
  {
    id: "tottori-castle",
    name: "鳥取城跡(久松公園)",
    loc: { lat: 35.504, lng: 134.244 },
    hint: "鳥取市公園条例 × 文化財保護法 同時red",
    group: "鳥取県",
  },
  {
    id: "uchibuki-park",
    name: "打吹公園(倉吉)",
    loc: { lat: 35.4250, lng: 133.8235 },
    hint: "倉吉市公園条例 + 県条例（白壁土蔵群近接）",
    group: "鳥取県",
  },
  {
    id: "matsue-castle",
    name: "松江城(国指定史跡・国宝)",
    // 松江城天守: 35°28′32″N 133°03′02″E
    loc: { lat: 35.4753, lng: 133.0506 },
    hint: "松江市公園条例 × 文化財保護法 同時red",
    group: "島根県",
  },
  {
    id: "izumo-taisha",
    name: "出雲大社",
    loc: { lat: 35.4019, lng: 132.6852 },
    hint: "島根県条例（参拝者密集地）",
    group: "島根県",
  },
  {
    id: "kojindani-historic-park",
    name: "荒神谷史跡公園(出雲)",
    loc: { lat: 35.387, lng: 132.844 },
    hint: "出雲公園条例 × 文化財保護法 同時red",
    group: "島根県",
  },
  {
    id: "izumo-station",
    name: "出雲市役所",
    // 出雲市今市町70: 35°22′06″N 132°45′24″E
    loc: { lat: 35.3683, lng: 132.7567 },
    hint: "DID + 島根県条例（庁舎0m）",
    group: "島根県",
    airspaceFlags: ["airspace_did"],
  },
  {
    id: "izumo-airport",
    name: "出雲縁結び空港",
    loc: { lat: 35.4133, lng: 132.8897 },
    hint: "空港敷地内 red（航空法 132 条）",
    group: "島根県",
    airspaceFlags: ["airspace_airport"],
  },
];

// 県別チップは色相で差別化せず、ブランド藍の塗り (鳥取県) / 抜き (島根県) で
// "1色のみ" 縛りを守る。長期的なカラーパレット汚染を防ぐ。
const PRESET_GROUP_TONE: Record<PresetGroup, string> = {
  鳥取県: "bg-brand-700 text-paper border-brand-700",
  島根県: "border-brand-700 text-brand-700 bg-transparent",
};

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
  const [pdfBusy, setPdfBusy] = useState<boolean>(false);

  // ── FlightContext: 機体・運航条件 ──
  // 空文字 = "未指定"。最も厳しい解釈になる。
  // 数値 < 100 で 100g 未満例外がマッチし、DID/空港/美保 → green に降格。
  const [droneWeightInput, setDroneWeightInput] = useState<string>("");
  const [hasMlitPermit, setHasMlitPermit] = useState<boolean>(false);
  const [hasFacilityPermit, setHasFacilityPermit] = useState<boolean>(false);
  const [hasParkPermit, setHasParkPermit] = useState<boolean>(false);
  const [hasBunkachoPermit, setHasBunkachoPermit] = useState<boolean>(false);
  const [purpose, setPurpose] = useState<"general" | "emergency" | "public_duty" | "city_event">("general");

  // ── 申請支援（DIPS 飛行許可・承認 診断）の入力 ──
  // 飛行方法フラグ（夜間・目視外・30m未満・催し上空・危険物・物件投下・150m以上）= ユーザー選択。
  const [methodFlags, setMethodFlags] = useState<readonly SpecificFlightFlag[]>([]);
  // 空域フラグ（DID・空港等周辺・緊急用務空域）。原則は信号機判定の red から自動プリチェック、
  // プリセット選択時は curated な airspaceFlags でも補完し、ユーザーが手動で増減もできる。
  const [airspaceFlags, setAirspaceFlags] = useState<readonly SpecificFlightFlag[]>([]);
  const [plannedDate, setPlannedDate] = useState<string>(""); // ISO 日付（任意）。S1 では保持のみ。
  // 立入管理措置の有無／第三者上空か（カテゴリー II / III 切り分け用）。
  // "yes" = 立入管理措置あり, "no_third_party" = 措置なし＝第三者上空（III）, "" = 未選択
  const [accessMode, setAccessMode] = useState<"" | "yes" | "no_third_party">("");
  // 目視外飛行時の補助者の有無（プリフィルの運航条件に反映）。"" = 未選択
  const [bvlosObserver, setBvlosObserver] = useState<"" | "with" | "without">("");
  const [diagnosis, setDiagnosis] = useState<DiagnoseResponse | null>(null);
  const [diagnoseError, setDiagnoseError] = useState<string | null>(null);

  const toggleMethodFlag = (flag: SpecificFlightFlag): void => {
    setMethodFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag],
    );
  };
  const toggleAirspaceFlag = (flag: SpecificFlightFlag): void => {
    setAirspaceFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag],
    );
  };

  // ── 履歴 ──
  // localStorage を外部ストアとして React に同期。
  // 別タブからの 'storage' イベントと、同タブ内の save/remove/clear から
  // 発火するカスタムイベントの両方を購読することで自動再描画される。
  const history = useSyncExternalStore(
    subscribeHistory,
    getHistorySnapshot,
    getHistoryServerSnapshot,
  );

  // 履歴から SavedCheck を復元: ctx の各フィールドを state に戻し、loc に飛ぶ。
  // ctx 復元 → useEffect で再判定 が走るため、明示的に runCheck は呼ばない。
  const restoreFromHistory = (entry: SavedCheck): void => {
    setDroneWeightInput(entry.ctx?.droneWeightG !== undefined ? String(entry.ctx.droneWeightG) : "");
    const permits = entry.ctx?.pilotPermits ?? [];
    setHasMlitPermit(permits.includes("mlit"));
    setHasFacilityPermit(permits.includes("facility_manager"));
    setHasParkPermit(permits.includes("park_manager"));
    setHasBunkachoPermit(permits.includes("bunkacho_or_kyoiku"));
    setPurpose(
      (entry.ctx?.purpose as typeof purpose) ?? "general",
    );
    // 申請支援の入力は履歴に保存していないため、復元時はリセットする。
    setMethodFlags([]);
    setAirspaceFlags([]);
    setAccessMode("");
    setBvlosObserver("");
    setPlannedDate("");
    applyLocation(entry.loc);
    // ctx 変更で useEffect の自動再判定が走るのを待たず、明示的に呼んで即時反映
    setTimeout(() => {
      runCheck(entry.loc);
      void runDiagnose(entry.loc, []);
    }, 0);
  };

  const handleRemoveHistory = (evidenceId: string): void => {
    removeHistory(evidenceId);
  };

  const handleClearHistory = (): void => {
    if (typeof window !== "undefined" && !window.confirm("判定履歴を全削除しますか？")) return;
    clearHistory();
  };

  // PDF ダウンロード。@react-pdf/renderer は ~4MB あるので動的 import で
  // 初期バンドルに含めない（ボタン押下時に 1 度だけ取得）。
  const handlePdfExport = async (): Promise<void> => {
    if (!result) return;
    setPdfBusy(true);
    try {
      const [{ pdf }, { RegulationPdfDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./regulation-pdf"),
      ]);
      const ctx = buildCtx();
      const blob = await pdf(
        <RegulationPdfDocument
          result={result}
          loc={center}
          ctx={ctx}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `soraban-${result.evidenceId}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      // フォントを CDN から取り直す副作用が次回も起きるが、
      // ブラウザ HTTP cache で実質ゼロコスト
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (err) {
      setError(`PDF 生成に失敗しました: ${(err as Error).message}`);
    } finally {
      setPdfBusy(false);
    }
  };

  // ctx 構築。空 / デフォルト値しかなければ undefined を返す（API もそれで処理する）。
  const buildCtx = (): FlightContext | undefined => {
    const ctx: { -readonly [K in keyof FlightContext]: FlightContext[K] } = {};
    const w = Number(droneWeightInput);
    if (droneWeightInput.trim().length > 0 && Number.isFinite(w) && w >= 0) {
      ctx.droneWeightG = w;
    }
    const permits: string[] = [];
    if (hasMlitPermit) permits.push("mlit");
    if (hasFacilityPermit) {
      permits.push("facility_manager");
      permits.push("facility_manager_and_pref_pubsafety");
    }
    if (hasParkPermit) permits.push("park_manager");
    if (hasBunkachoPermit) permits.push("bunkacho_or_kyoiku");
    if (permits.length > 0) ctx.pilotPermits = permits;
    if (purpose !== "general") ctx.purpose = purpose;
    return Object.keys(ctx).length > 0 ? ctx : undefined;
  };

  const applyLocation = (loc: LatLng): void => {
    setLat(round6(loc.lat));
    setLng(round6(loc.lng));
    setCenter(loc);
  };

  const runCheck = (loc: LatLng): void => {
    const ctx = buildCtx();
    startChecking(async () => {
      const t0 = performance.now();
      try {
        const res = await checkLocation(loc, ctx);
        setResult(res);
        setResponseMs(Math.round(performance.now() - t0));
        setError(null);
        const newPref = res.muniCode?.slice(0, 2);
        if (newPref && newPref !== prefCode) setPrefCode(newPref);
        // 履歴に自動保存。同一 evidenceId は idempotent (= 重複しない)。
        // useSyncExternalStore がイベント経由で再描画してくれるので setHistory 不要。
        saveHistory({
          evidenceId: res.evidenceId,
          savedAt: new Date().toISOString(),
          loc,
          ctx,
          overall: res.overall,
          resolvedAddress: res.resolvedAddress,
          engineVersion: res.engineVersion,
          checkedAt: res.checkedAt,
          muniCode: res.muniCode,
        });
      } catch (err) {
        setError(`判定に失敗しました: ${(err as Error).message}`);
      }
    });
  };

  // 申請支援診断を実行。/api/diagnose は信号機判定を内部で再実行し、
  // 空域フラグ（DID・空港）を自動導出する。クライアント側でも飛行方法フラグ＋空域フラグ
  // （プリチェック済み）を送り、サーバ側導出と合流させる（DID データ縮退時の保険）。
  // 引数で flags を明示注入できるようにし、プリセット選択直後の state 反映待ちを避ける。
  const runDiagnose = async (
    loc: LatLng,
    overrideAirspace?: readonly SpecificFlightFlag[],
  ): Promise<void> => {
    const w = Number(droneWeightInput);
    const weight =
      droneWeightInput.trim().length > 0 && Number.isFinite(w) && w >= 0 ? w : undefined;
    const air = overrideAirspace ?? airspaceFlags;
    try {
      const res = await diagnoseLocation(loc, {
        droneWeightG: weight,
        flags: [...methodFlags, ...air],
        plannedDate: plannedDate.trim().length > 0 ? plannedDate : undefined,
        accessControl: accessMode === "" ? undefined : accessMode === "yes",
        thirdPartyOverflight: accessMode === "no_third_party" ? true : undefined,
        bvlosWithObserver: bvlosObserver === "" ? undefined : bvlosObserver === "with",
      });
      setDiagnosis(res);
      setDiagnoseError(null);
      // サーバ側で判定由来の空域フラグ（DID・空港 red）が導出されていれば、
      // UI のチェックボックスにも反映してプリチェック状態を一致させる。
      if (res.derivedAirspaceFlags.length > 0) {
        setAirspaceFlags((prev) => {
          const merged = new Set<SpecificFlightFlag>([...prev, ...res.derivedAirspaceFlags]);
          return Array.from(merged);
        });
      }
    } catch (err) {
      setDiagnoseError(`申請支援の診断に失敗しました: ${(err as Error).message}`);
    }
  };

  // ctx の値が変わったら、現在の中心地点で再判定して画面に即反映する。
  // 最低限の依存配列（重量・運航種別・各許可フラグ）だけに絞る。
  useEffect(() => {
    if (!result) return; // 初回オートランより前は走らせない
    runCheck(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droneWeightInput, hasMlitPermit, hasFacilityPermit, hasParkPermit, hasBunkachoPermit, purpose]);

  // 申請支援の入力（飛行方法フラグ・飛行予定日・立入管理措置）が変わったら、
  // 信号機判定は変わらないので診断だけを再実行する（無駄な /api/check 呼び出しを避ける）。
  useEffect(() => {
    if (!result) return; // 初回オートランより前は走らせない
    void runDiagnose(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methodFlags, airspaceFlags, plannedDate, accessMode, bvlosObserver, droneWeightInput]);

  // デモ初動短縮: 米子市役所で初期判定をプリロードして
  // 「ページが開いた瞬間に red 信号機」が見える状態にする。
  const didAutoRunRef = useRef<boolean>(false);
  useEffect(() => {
    if (didAutoRunRef.current) return;
    didAutoRunRef.current = true;
    runCheck(YONAGO_CITY_HALL);
    void runDiagnose(YONAGO_CITY_HALL, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePick = (loc: LatLng): void => {
    if (!isValidLatLng(loc)) return;
    applyLocation(loc);
    runCheck(loc);
    void runDiagnose(loc);
  };

  // プリセット選択: 位置適用 + 信号機判定に加えて、curated な空域フラグ（DID・空港）を
  // 申請支援診断に引き継ぐ。state 反映を待たずに override で即座に診断へ渡す。
  const selectPreset = (preset: DemoPreset): void => {
    applyLocation(preset.loc);
    const seeded = preset.airspaceFlags ?? [];
    const mergedAirspace = Array.from(new Set<SpecificFlightFlag>([...airspaceFlags, ...seeded]));
    setAirspaceFlags(mergedAirspace);
    runCheck(preset.loc);
    // override 付きで明示的に診断を回し、state 反映前でも preset の空域フラグを確実に反映する。
    void runDiagnose(preset.loc, mergedAirspace);
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
    void runDiagnose(parsed);
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
    void runDiagnose(parsed);
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
    void runDiagnose({ lat: latNum, lng: lngNum });
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
        void runDiagnose({ lat: first.lat, lng: first.lng });
        setGeocodeResults([]);
      }
    } catch (err) {
      setError(`ジオコーディングに失敗: ${(err as Error).message}`);
    } finally {
      setGeocoding(false);
    }
  };

  // 共通スタイル: 紙地のフィールドカード ＋ シャープ角丸
  // モバイルでもタップ精度が出るよう、高さ 44px 以上を確保。
  const fieldClass =
    "w-full rounded-sharp border border-rule bg-paper px-3 py-3 text-base text-ink outline-none transition-colors placeholder:text-ink-mute/70 focus:border-brand-700 focus:ring-2 focus:ring-brand-700 focus:ring-offset-1 focus:ring-offset-paper sm:py-2.5 sm:text-sm";
  const ghostBtn =
    "inline-flex h-11 items-center justify-center rounded-sharp border border-rule bg-paper px-4 text-xs font-medium uppercase tracking-wider text-ink-soft transition-colors hover:border-ink-soft hover:bg-paper-soft active:bg-paper-soft disabled:opacity-40";

  return (
    <div className="flex flex-col gap-10">
      {/* ─── INPUT FORM ───────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-6 border border-rule bg-paper-soft/50 p-4 sm:gap-7 sm:p-6"
      >
        {/* 免責（入力前＝初期状態でも常に表示）。判定結果や診断パネルが出る前から、
            「本機能は補助であり最終確認は DIPS／航空局で」を画面に出しておく契約
            （sprint-4：免責を入力前・結果表示・チェックリスト・プリフィルの全画面状態に表示）。
            入力前の段階では「これから記入する野帳の前書き」の位置づけ。結果・診断パネルに出る
            同文の免責より一段控えめ（細字・補助色・薄い左罫）にして、全画面表示がくどくならない
            ようにしつつ、可読性と趣旨は維持する。 */}
        <p className="flex gap-2 border-l border-brand-700/60 pl-3 text-[11px] leading-relaxed text-ink-mute">
          <span className="eyebrow !text-[9px] shrink-0 not-italic">disclaimer</span>
          <span>{DIAGNOSIS_DISCLAIMER}</span>
        </p>

        {/* address geocode */}
        <fieldset className="flex flex-col gap-2">
          <legend className="eyebrow">
            <span aria-hidden className="bearing-mark" />
            01 — 住所から位置決定
            <span className="ml-2 normal-case tracking-normal text-ink-mute/70 not-italic">
              （国土地理院ジオコーダ）
            </span>
          </legend>
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
              placeholder="例: 鳥取県西伯郡日吉津村日吉津45番地3（タイヨー通信本社）"
              className={fieldClass}
            />
            <button
              type="button"
              onClick={() => void handleGeocode()}
              disabled={geocoding || address.trim().length === 0}
              className={ghostBtn}
            >
              {geocoding ? "検索中…" : "住所で位置決定"}
            </button>
          </div>
          {geocodeResults.length > 1 ? (
            <ul className="mt-1 flex flex-col divide-y divide-rule border border-rule bg-paper">
              {geocodeResults.map((r) => (
                <li key={`${r.addressCode}-${r.lat}-${r.lng}`}>
                  <button
                    type="button"
                    onClick={() => {
                      applyLocation({ lat: r.lat, lng: r.lng });
                      runCheck({ lat: r.lat, lng: r.lng });
                      void runDiagnose({ lat: r.lat, lng: r.lng });
                      setGeocodeResults([]);
                    }}
                    className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left hover:bg-paper-soft"
                  >
                    <span className="text-sm font-medium text-ink">{r.title}</span>
                    <span className="font-mono text-[11px] tnum text-ink-mute">
                      {round6(r.lat)}, {round6(r.lng)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </fieldset>

        {/* combined coords */}
        <fieldset className="flex flex-col gap-2">
          <legend className="eyebrow">
            <span aria-hidden className="bearing-mark" />
            02 — 座標貼り付け
            <span className="ml-2 normal-case tracking-normal text-ink-mute/70 not-italic">
              （Google Maps 「座標をコピー」 / URL に対応）
            </span>
          </legend>
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
                void runDiagnose(parsed);
                setCombinedStatus({
                  ok: true,
                  message: `反映: ${round6(parsed.lat)}, ${round6(parsed.lng)}`,
                });
              }}
              placeholder="拠点（本社）35.434238, 133.380508 ／ 移動先（Google Maps URL）https://maps.google.com/...@35.4283,133.3306,15z"
              className={`${fieldClass} font-mono`}
            />
            <button
              type="button"
              onClick={() => applyCombined(combined)}
              disabled={combined.trim().length === 0}
              className={ghostBtn}
            >
              反映
            </button>
          </div>
          {combinedStatus !== null ? (
            <p
              className={`font-mono text-[11px] ${combinedStatus.ok ? "text-signal-green" : "text-signal-red"}`}
              role="status"
            >
              <span aria-hidden>{combinedStatus.ok ? "✓ " : "× "}</span>
              {combinedStatus.message}
            </p>
          ) : null}
        </fieldset>

        {/* lat / lng */}
        <fieldset className="flex flex-col gap-2">
          <legend className="eyebrow">
            <span aria-hidden className="bearing-mark" />
            03 — 緯度 / 経度 直接入力
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                lat (N°)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                onPaste={handleSplitPaste}
                className={`${fieldClass} font-mono`}
                placeholder="35.4342"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                lng (E°)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                onPaste={handleSplitPaste}
                className={`${fieldClass} font-mono`}
                placeholder="133.3805"
              />
            </label>
          </div>
        </fieldset>

        {/* 機体・運航条件 — ClauseGraph の例外節と照合される
            モバイルでは折りたたみが標準（"上級設定" 扱い）。デフォルト = 最も厳しい解釈で
            まず判定し、必要なときだけ展開する流れ */}
        <details className="flex flex-col gap-3 border-t border-rule pt-5 [&>summary::-webkit-details-marker]:hidden">
          <summary className="eyebrow flex cursor-pointer items-center gap-1 select-none list-none">
            <span aria-hidden className="bearing-mark" />
            05 — 機体・運航条件
            <span className="ml-2 normal-case tracking-normal text-ink-mute/70 not-italic">
              （例外節を自動適用 / タップで展開）
            </span>
            <span aria-hidden className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute transition-transform group-open:rotate-90 [details[open]_&]:rotate-90">
              ▸
            </span>
          </summary>
          <div className="mt-3 flex flex-col gap-3">

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* 機体重量 */}
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                drone weight (g)
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={droneWeightInput}
                  onChange={(e) => setDroneWeightInput(e.target.value)}
                  className={`${fieldClass} flex-1 font-mono`}
                  placeholder="例: 900（DJI Mavic）／ 80（マイクロ機）"
                />
                {droneWeightInput.trim().length > 0 && Number(droneWeightInput) < 100 ? (
                  <span className="font-mono text-[10px] uppercase tracking-wider text-signal-green whitespace-nowrap">
                    ▸ &lt;100g 例外
                  </span>
                ) : null}
              </div>
              <span className="text-[10px] leading-tight text-ink-mute">
                100g 未満は航空法上の無人航空機に非該当（DID / 空港 / 美保基地が対象外）
              </span>
            </label>

            {/* 運航目的 */}
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                purpose
              </span>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as typeof purpose)}
                className={fieldClass}
              >
                <option value="general">通常運航</option>
                <option value="emergency">緊急（災害復旧・人命救助）</option>
                <option value="public_duty">公務（警察・消防・自治体）</option>
                <option value="city_event">市が主催・後援する行事</option>
              </select>
              <span className="text-[10px] leading-tight text-ink-mute">
                史跡・公園・県条例の例外節と照合
              </span>
            </label>
          </div>

          {/* 取得済み許可 */}
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              permits held
            </span>
            <div className="grid grid-cols-1 gap-px overflow-hidden bg-rule sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  state: hasMlitPermit,
                  set: setHasMlitPermit,
                  key: "mlit",
                  label: "国交省 DIPS",
                  desc: "航空法 DID / 空港",
                },
                {
                  state: hasParkPermit,
                  set: setHasParkPermit,
                  key: "park",
                  label: "公園管理者",
                  desc: "都市公園条例",
                },
                {
                  state: hasFacilityPermit,
                  set: setHasFacilityPermit,
                  key: "facility",
                  label: "施設管理者",
                  desc: "県条例 / 美保基地",
                },
                {
                  state: hasBunkachoPermit,
                  set: setHasBunkachoPermit,
                  key: "bunkacho",
                  label: "文化庁・教育委員会",
                  desc: "文化財保護法 125 条",
                },
              ].map((p) => (
                <label
                  key={p.key}
                  className={`flex min-h-[52px] cursor-pointer items-start gap-2 px-3 py-3 transition-colors ${p.state ? "bg-brand-50" : "bg-paper active:bg-paper-soft sm:hover:bg-paper-soft"}`}
                >
                  <input
                    type="checkbox"
                    checked={p.state}
                    onChange={(e) => p.set(e.target.checked)}
                    className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-700"
                  />
                  <span className="flex flex-1 flex-col leading-tight">
                    <span className="text-sm font-medium text-ink sm:text-xs">{p.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                      {p.desc}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          </div>
        </details>

        {/* 飛行方法・運航条件（申請支援 診断の入力）
            既存フォームに地続きで追加。空港・DID 等の空域フラグは地点判定から自動導出されるため、
            ここではユーザーにしか分からない「飛行方法」と「立入管理措置／第三者上空」「飛行予定日」を集める。 */}
        <fieldset className="flex flex-col gap-3 border-t border-rule pt-5">
          <legend className="eyebrow flex items-center gap-1">
            <span aria-hidden className="bearing-mark" />
            06 — 飛行方法（申請支援）
            <span className="ml-2 normal-case tracking-normal text-ink-mute/70 not-italic">
              （該当する方法を選ぶと必要手続きを診断）
            </span>
          </legend>

          {/* 空域フラグ（DID・空港等周辺・緊急用務空域）。判定由来の red は自動プリチェック。
              DID polygon データが未整備の環境でも、ここで手動チェックして診断できる。 */}
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              空域（地点判定から自動／手動でも調整可）
            </span>
            <div className="grid grid-cols-1 gap-px overflow-hidden bg-rule sm:grid-cols-3">
              {AIRSPACE_FLAGS.map((flag) => {
                const checked = airspaceFlags.includes(flag);
                return (
                  <label
                    key={flag}
                    className={`flex min-h-[52px] cursor-pointer items-start gap-2 px-3 py-3 transition-colors ${checked ? "bg-brand-50" : "bg-paper active:bg-paper-soft sm:hover:bg-paper-soft"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAirspaceFlag(flag)}
                      className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                    />
                    <span className="text-sm font-medium leading-tight text-ink sm:text-xs">
                      {SPECIFIC_FLIGHT_FLAG_LABEL[flag]}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 飛行方法チェックボックス群 */}
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
            飛行方法（該当するものを選択）
          </span>
          <div className="grid grid-cols-1 gap-px overflow-hidden bg-rule sm:grid-cols-2 lg:grid-cols-3">
            {FLIGHT_METHOD_FLAGS.map((flag) => {
              const checked = methodFlags.includes(flag);
              return (
                <label
                  key={flag}
                  className={`flex min-h-[52px] cursor-pointer items-start gap-2 px-3 py-3 transition-colors ${checked ? "bg-brand-50" : "bg-paper active:bg-paper-soft sm:hover:bg-paper-soft"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMethodFlag(flag)}
                    className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                  />
                  <span className="text-sm font-medium leading-tight text-ink sm:text-xs">
                    {SPECIFIC_FLIGHT_FLAG_LABEL[flag]}
                  </span>
                </label>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* 飛行予定日 — 提出期限カレンダーの「起算日」。ここから各手続きの期限を逆算する。 */}
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                飛行予定日
                <span
                  aria-hidden
                  className="inline-flex items-center gap-1 border border-rule px-1.5 py-px text-[9px] tracking-[0.18em] text-ink-mute/80"
                >
                  <span className="inline-block h-1 w-1 rotate-45 bg-ink-mute" />
                  起算日
                </span>
              </span>
              <input
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
                className={`${fieldClass} font-mono tnum`}
              />
              <span className="text-[10px] leading-tight text-ink-mute">
                提出期限の逆算に使用（飛行開始の 10 開庁日以上前。土日・国民の祝日を除いた具体的な期限日を算出）
              </span>
            </label>

            {/* 立入管理措置／第三者上空（カテゴリー II/III 切り分け） */}
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                立入管理措置／第三者上空
              </span>
              <select
                value={accessMode}
                onChange={(e) => setAccessMode(e.target.value as typeof accessMode)}
                className={fieldClass}
              >
                <option value="">未選択</option>
                <option value="yes">立入管理措置あり（第三者の上空で飛ばさない＝カテゴリー II）</option>
                <option value="no_third_party">
                  立入管理措置なし（第三者の上空＝カテゴリー III／レベル4）
                </option>
              </select>
              <span className="text-[10px] leading-tight text-ink-mute">
                第三者上空はレベル4（一等＋第一種機体認証が必須）の切り分けに使用
              </span>
            </label>
          </div>

          {/* 目視外飛行を選んでいる場合のみ補助者の有無を尋ねる（プリフィルの運航条件に反映）。 */}
          {methodFlags.includes("method_bvlos") ? (
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                目視外飛行の補助者
              </span>
              <select
                value={bvlosObserver}
                onChange={(e) => setBvlosObserver(e.target.value as typeof bvlosObserver)}
                className={fieldClass}
              >
                <option value="">未選択</option>
                <option value="with">補助者あり</option>
                <option value="without">補助者なし（より上位の運航要件）</option>
              </select>
              <span className="text-[10px] leading-tight text-ink-mute">
                補助者の有無で運航条件が変わるため、プリフィル表に反映します
              </span>
            </label>
          ) : null}

          {diagnoseError ? (
            <p className="text-xs text-signal-red" role="alert">
              {diagnoseError}
            </p>
          ) : null}
        </fieldset>

        {/* primary action */}
        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
          <button
            type="submit"
            disabled={isChecking}
            className="group inline-flex h-11 items-center gap-2 rounded-sharp bg-brand-700 px-6 text-sm font-medium text-paper transition-colors hover:bg-brand-900 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2 focus:ring-offset-paper disabled:opacity-40"
          >
            <span aria-hidden className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-70">
              ▸
            </span>
            {isChecking ? "判定中…" : "規制をチェック"}
          </button>
          {error ? (
            <p className="text-xs text-signal-red" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        {/* presets — モバイルでは snap-x の横スクロール、sm 以上はグリッド */}
        <div className="flex flex-col gap-3 border-t border-rule pt-5">
          <p className="eyebrow">
            <span aria-hidden className="bearing-mark" />
            04 — デモ用プリセット
            <span className="ml-2 normal-case tracking-normal text-ink-mute/70 not-italic">
              （県別 ／ 横スクロール）
            </span>
          </p>
          {/* モバイル: 横スクロール scroll-snap */}
          <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 sm:hidden">
            {DEMO_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPreset(preset)}
                title={preset.hint}
                className="flex min-w-[14rem] shrink-0 snap-start flex-col items-start gap-1 border border-rule bg-paper px-4 py-3 text-left transition-colors active:bg-paper-soft"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center border px-1.5 py-px text-[9px] font-medium uppercase tracking-wider ${PRESET_GROUP_TONE[preset.group]}`}
                  >
                    {preset.group}
                  </span>
                  <span className="font-display text-sm font-medium text-ink">
                    {preset.name}
                  </span>
                </div>
                <span className="text-[11px] leading-tight text-ink-mute">
                  {preset.hint}
                </span>
              </button>
            ))}
          </div>
          {/* sm 以上: 既存のグリッド */}
          <div className="hidden grid-cols-2 gap-px overflow-hidden bg-rule sm:grid lg:grid-cols-3">
            {DEMO_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPreset(preset)}
                title={preset.hint}
                className="flex flex-col items-start gap-1 bg-paper px-4 py-3 text-left transition-colors hover:bg-paper-soft"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center border px-1.5 py-px text-[9px] font-medium uppercase tracking-wider ${PRESET_GROUP_TONE[preset.group]}`}
                  >
                    {preset.group}
                  </span>
                  <span className="font-display text-sm font-medium text-ink">
                    {preset.name}
                  </span>
                </div>
                <span className="text-[11px] leading-tight text-ink-mute">
                  {preset.hint}
                </span>
              </button>
            ))}
          </div>
        </div>
      </form>

      {/* ─── MAP ───────────────────────────────── */}
      <RegulationMap center={center} prefCode={prefCode} onPick={handlePick} />

      {/* ─── RESULT ───────────────────────────────── */}
      {result ? (
        <section
          className="flex flex-col gap-6 border-y border-double border-rule bg-paper-soft/40 p-4 sm:gap-7 sm:p-6"
          aria-live="polite"
        >
          {/* signal + headline */}
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            <SignalLight status={result.overall === "unknown" ? "yellow" : result.overall} size="lg" />
            <div className="flex flex-1 flex-col gap-1">
              <p className="eyebrow">
                <span aria-hidden className="bearing-mark" />
                総合判定
              </p>
              <p className={`font-display text-3xl font-light tracking-tight ${overallTone[result.overall]}`}>
                {STATUS_LABEL[result.overall]}
              </p>
              <p className="text-sm leading-relaxed text-ink-soft">
                {overallHelp[result.overall]}
              </p>
              <p className="font-mono text-[11px] tnum text-ink-mute">
                {lat}°N · {lng}°E
                {result.resolvedAddress ? ` — ${result.resolvedAddress}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handlePdfExport()}
              disabled={pdfBusy}
              className="inline-flex h-11 items-center gap-2 self-stretch rounded-sharp border border-brand-700 bg-paper px-4 text-xs font-medium uppercase tracking-wider text-brand-700 transition-colors hover:bg-brand-50 active:bg-brand-50 disabled:opacity-40 sm:self-start"
              title="この判定を A4 1 枚 PDF レポートとして書き出し"
            >
              <span aria-hidden className="font-mono text-[10px] tracking-[0.2em] opacity-70">▾</span>
              {pdfBusy ? "PDF 生成中…" : "PDF 出力"}
            </button>
          </div>

          {/* 低確信度警告 — 特許①従属項8 の実施例。閾値未満のときだけ出る */}
          {shouldWarnConfidence(result.overallConfidence) ? (
            <div className="border-l-2 border-signal-amber bg-signal-amber-soft px-4 py-3 text-xs leading-relaxed text-ink-soft">
              <span className="eyebrow !text-[9px] !text-signal-amber">
                confidence · {CONFIDENCE_LABEL[result.overallConfidence]} — 現地での再確認を推奨
              </span>{" "}
              本判定はジオメトリ精度または条文抽出精度が低いレコードを含みます。引受・許可申請の前に、該当条文の原本（出典リンク）と現地状況をご確認ください。
            </div>
          ) : null}

          {/* disclaimer — brand outlined, never amber */}
          <div className="border-l-2 border-brand-700 bg-paper px-4 py-3 text-xs leading-relaxed text-ink-soft">
            <span className="eyebrow !text-[9px]">disclaimer</span>{" "}
            {result.disclaimer}
          </div>

          {/* per-regulation cards */}
          <div className="flex flex-col gap-3">
            <p className="eyebrow">
              <span aria-hidden className="bearing-mark" />
              関連条例 (
              <span className="tnum">{String(result.regulations.length).padStart(2, "0")}</span>
              {" "}件)
            </p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {result.regulations.map((r) => (
                <RegulationCard key={r.id} regulation={r} />
              ))}
            </div>
          </div>

          {/* audit meta — designed as drafter's stamp block */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-rule pt-4 font-mono text-[10px] uppercase tracking-wider text-ink-mute sm:grid-cols-5">
            <div className="flex flex-col gap-0.5 col-span-2">
              <dt className="eyebrow !text-[9px]">Evidence ID</dt>
              <dd className="tnum normal-case tracking-normal text-ink">
                {result.evidenceId}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="eyebrow !text-[9px]">Confidence</dt>
              <dd className="normal-case tracking-normal text-ink">
                {CONFIDENCE_LABEL[result.overallConfidence]}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="eyebrow !text-[9px]">Engine</dt>
              <dd className="tnum normal-case tracking-normal text-ink">
                {result.engineVersion}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="eyebrow !text-[9px]">Latency</dt>
              <dd className="tnum normal-case tracking-normal text-ink">
                {responseMs !== null ? `${responseMs} ms` : "—"}
              </dd>
            </div>
            <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-5">
              <dt className="eyebrow !text-[9px]">Checked at</dt>
              <dd className="normal-case tracking-normal text-ink">
                {new Date(result.checkedAt).toLocaleString("ja-JP")}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {/* ─── 申請支援 診断（必要手続きチェックリスト） ───────────────────────────────── */}
      {diagnosis ? <DiagnosisPanel diagnosis={diagnosis} plannedDate={plannedDate} /> : null}

      {/* ─── HISTORY ───────────────────────────────── */}
      {history.length > 0 ? (
        <section
          className="flex flex-col gap-4 border border-rule bg-paper p-4 sm:p-6"
          aria-labelledby="history-heading"
        >
          <div className="flex items-end justify-between gap-3 border-b border-rule pb-2">
            <div className="flex flex-col gap-0.5">
              <p id="history-heading" className="eyebrow">
                <span aria-hidden className="bearing-mark" />
                判定履歴
                <span className="ml-2 normal-case tracking-normal text-ink-mute/70 not-italic">
                  （ローカル保存 / 最大 50 件）
                </span>
              </p>
              <p className="font-mono text-[10px] tnum text-ink-mute">
                {history.length} entr{history.length === 1 ? "y" : "ies"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClearHistory}
              className="font-mono text-[10px] uppercase tracking-wider text-ink-mute hover:text-signal-red"
            >
              全削除
            </button>
          </div>
          <ul className="flex flex-col divide-y divide-rule">
            {history.slice(0, 10).map((h) => {
              const dotTone =
                h.overall === "red"
                  ? "bg-signal-red"
                  : h.overall === "yellow"
                    ? "bg-signal-amber"
                    : h.overall === "green"
                      ? "bg-signal-green"
                      : "bg-signal-mute";
              const checkedDate = new Date(h.checkedAt);
              const dateStr = `${String(checkedDate.getMonth() + 1).padStart(2, "0")}/${String(checkedDate.getDate()).padStart(2, "0")} ${String(checkedDate.getHours()).padStart(2, "0")}:${String(checkedDate.getMinutes()).padStart(2, "0")}`;
              return (
                <li key={h.evidenceId} className="flex items-center gap-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => restoreFromHistory(h)}
                    className="flex flex-1 items-center gap-3 text-left transition-colors hover:bg-paper-soft"
                    title={`Evidence ${h.evidenceId} を復元して再判定`}
                  >
                    <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-ink/20 ${dotTone}`} />
                    <span className="flex flex-1 flex-col leading-tight">
                      <span className="text-sm text-ink">
                        {h.resolvedAddress ?? `${h.loc.lat.toFixed(4)}°N · ${h.loc.lng.toFixed(4)}°E`}
                      </span>
                      <span className="font-mono text-[10px] tnum text-ink-mute">
                        {dateStr}
                        {h.ctx?.droneWeightG !== undefined ? ` · ${h.ctx.droneWeightG}g` : ""}
                        {h.ctx?.purpose && h.ctx.purpose !== "general" ? ` · ${h.ctx.purpose}` : ""}
                        {h.ctx?.pilotPermits && h.ctx.pilotPermits.length > 0 ? ` · permit×${h.ctx.pilotPermits.length}` : ""}
                        {" · "}
                        {h.evidenceId}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveHistory(h.evidenceId)}
                    className="font-mono text-[10px] text-ink-mute hover:text-signal-red"
                    aria-label="この履歴を削除"
                    title="削除"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          {history.length > 10 ? (
            <p className="font-mono text-[10px] tnum text-ink-mute">
              ... and {history.length - 10} more (oldest will be evicted at 50)
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
