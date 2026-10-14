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
  AIRSPACE_DETERMINATION_LABEL,
  SPECIFIC_FLIGHT_FLAG_LABEL,
  DIAGNOSIS_DISCLAIMER,
  type DiagnosisCategory,
  type FlightContext,
  type ManualChoice,
  type RegulationCheckResult,
  type RegulationStatus,
  type SpecificFlightFlag,
} from "@soraban/regulations";

import { searchAddress, type GeocodeResult } from "@/lib/geocode";
import { checkLocation } from "@/lib/check";
import { diagnoseLocation, type DiagnoseResponse } from "@/lib/diagnose";
import {
  clearHistory,
  createHistoryRunId,
  getHistoryServerSnapshot,
  getHistorySnapshot,
  recordHistoryCheck,
  recordHistoryDiagnosis,
  removeHistory,
  subscribeHistory,
  type SavedCheck,
  type SavedDiagnosisInput,
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

// 空域フラグ集合の順序非依存比較（等しければ state 更新をスキップする）。
const sameFlagSet = (
  a: readonly SpecificFlightFlag[],
  b: readonly SpecificFlightFlag[],
): boolean => a.length === b.length && a.every((f) => b.includes(f));

const sameLoc = (a: LatLng, b: { readonly lat: number; readonly lng: number }): boolean =>
  Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;

const isAbortError = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError";

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
  // 空域フラグ（DID・空港等周辺・緊急用務空域）は「ユーザー指定分」だけを state に持つ。
  // 地点判定由来（自動検出）の空域フラグは diagnosis レスポンスから都度導出し、state に保存しない
  // （保存→effect→再診断→保存…のループと、別地点への持ち越しを防ぐ）。
  // ユーザー指定分も地点に紐づくため、地点が変わるたびにリセット（プリセットは curated 値で初期化）。
  const [userAirspaceFlags, setUserAirspaceFlags] = useState<readonly SpecificFlightFlag[]>([]);
  // DID 自動判定が「未確認」のとき、ユーザーが地理院地図等で非該当を確認済みかどうか。
  const [didConfirmedNotApplicable, setDidConfirmedNotApplicable] = useState<boolean>(false);
  const [plannedDate, setPlannedDate] = useState<string>(""); // ISO 日付（任意）。
  // 立入管理措置の有無／第三者上空か（カテゴリー II / III 切り分け用）。
  // "yes" = 立入管理措置あり, "no_third_party" = 措置なし＝第三者上空（III）, "" = 未選択
  const [accessMode, setAccessMode] = useState<"" | "yes" | "no_third_party">("");
  // 目視外飛行時の補助者の有無（プリフィルの運航条件に反映）。"" = 未選択
  const [bvlosObserver, setBvlosObserver] = useState<"" | "with" | "without">("");
  // 飛行マニュアル方針（標準／独自）と手続き完了チェック状態（手続き id → done）。
  // 履歴にも保存し、案件ごとの進捗を復元できるようにする。
  const [manualChoice, setManualChoice] = useState<ManualChoice>("custom");
  const [doneMap, setDoneMap] = useState<Readonly<Record<string, boolean>>>({});
  const [diagnosis, setDiagnosis] = useState<DiagnoseResponse | null>(null);
  const [diagnoseError, setDiagnoseError] = useState<string | null>(null);
  // 履歴復元中の useEffect 二重発火を抑止するフラグ。
  const isRestoringRef = useRef<boolean>(false);
  // 地点変更ハンドラが空域 state をリセットした直後の診断 effect を 1 回だけ抑止する
  // （ハンドラ側で明示的に診断済みのため）。
  const skipDiagEffectRef = useRef<boolean>(false);
  // チェック実行（地点判定＋診断）ごとの履歴 ID。両結果は応答順に関係なくこの ID に書く。
  const runIdRef = useRef<string>("");
  // 古い応答を捨てるための AbortController とリクエスト連番。
  const checkAbortRef = useRef<AbortController | null>(null);
  const diagAbortRef = useRef<AbortController | null>(null);
  const checkSeqRef = useRef<number>(0);
  const diagSeqRef = useRef<number>(0);

  const startNewRun = (): string => {
    const id = createHistoryRunId();
    runIdRef.current = id;
    return id;
  };

  // 表示中の診断が現在地点のものである場合に限り、自動検出の空域フラグを導出する。
  const autoAirspaceFlags: readonly SpecificFlightFlag[] =
    diagnosis && sameLoc(center, diagnosis) ? diagnosis.derivedAirspaceFlags : [];
  const autoDidStatus =
    diagnosis && sameLoc(center, diagnosis) ? diagnosis.autoDidStatus : undefined;
  const effectiveAirspaceFlags: readonly SpecificFlightFlag[] = Array.from(
    new Set<SpecificFlightFlag>([...autoAirspaceFlags, ...userAirspaceFlags]),
  );

  const doneMapToCompletedIds = (
    map: Readonly<Record<string, boolean>>,
  ): readonly string[] =>
    Object.entries(map)
      .filter(([, v]) => v)
      .map(([k]) => k);

  const completedIdsToDoneMap = (
    ids: readonly string[] | undefined,
  ): Readonly<Record<string, boolean>> => {
    const out: Record<string, boolean> = {};
    for (const id of ids ?? []) out[id] = true;
    return out;
  };

  const buildDiagnosisInput = (
    overrides?: Partial<SavedDiagnosisInput>,
  ): SavedDiagnosisInput => {
    const pd = (overrides?.plannedDate ?? plannedDate).trim();
    return {
      methodFlags: overrides?.methodFlags ?? methodFlags,
      // airspaceFlags は表示・後方互換用（自動＋ユーザー）。復元には userAirspaceFlags を使う。
      airspaceFlags: overrides?.airspaceFlags ?? effectiveAirspaceFlags,
      userAirspaceFlags: overrides?.userAirspaceFlags ?? userAirspaceFlags,
      didConfirmedNotApplicable:
        overrides?.didConfirmedNotApplicable ?? didConfirmedNotApplicable,
      ...(pd.length > 0 ? { plannedDate: pd } : {}),
      accessMode: overrides?.accessMode ?? accessMode,
      bvlosObserver: overrides?.bvlosObserver ?? bvlosObserver,
      manualChoice: overrides?.manualChoice ?? manualChoice,
      completedProcedureIds:
        overrides?.completedProcedureIds ?? doneMapToCompletedIds(doneMap),
    };
  };

  const toggleMethodFlag = (flag: SpecificFlightFlag): void => {
    setMethodFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag],
    );
  };
  const toggleAirspaceFlag = (flag: SpecificFlightFlag): void => {
    // 自動検出の空域フラグはユーザー操作で外せない（表示上も disabled）。
    if (autoAirspaceFlags.includes(flag)) return;
    setUserAirspaceFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag],
    );
  };

  const handleToggleProcedureDone = (id: string, done: boolean): void => {
    const next = { ...doneMap, [id]: done };
    setDoneMap(next);
    if (runIdRef.current) {
      recordHistoryDiagnosis(runIdRef.current, {
        diagnosisInput: { completedProcedureIds: doneMapToCompletedIds(next) },
      });
    }
  };

  const handleManualChoiceChange = (choice: ManualChoice): void => {
    setManualChoice(choice);
    if (runIdRef.current) {
      recordHistoryDiagnosis(runIdRef.current, { diagnosisInput: { manualChoice: choice } });
    }
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

  // 履歴から SavedCheck を復元: ctx と申請支援の入力・完了状態をすべて state に戻し、
  // 明示的 override 引数で runCheck / runDiagnose を即時実行する（state 反映前の古いクロージャ参照を防ぐ）。
  const restoreFromHistory = (entry: SavedCheck): void => {
    isRestoringRef.current = true;
    const weightStr =
      entry.ctx?.droneWeightG !== undefined ? String(entry.ctx.droneWeightG) : "";
    setDroneWeightInput(weightStr);
    const permits = entry.ctx?.pilotPermits ?? [];
    setHasMlitPermit(permits.includes("mlit"));
    setHasFacilityPermit(permits.includes("facility_manager"));
    setHasParkPermit(permits.includes("park_manager"));
    setHasBunkachoPermit(permits.includes("bunkacho_or_kyoiku"));
    setPurpose((entry.ctx?.purpose as typeof purpose) ?? "general");

    const nextMethodFlags = entry.diagnosisInput?.methodFlags ?? [];
    // 新形式はユーザー指定分のみ復元。旧形式（userAirspaceFlags なし）は当該地点の airspaceFlags を
    // ユーザー指定扱いで復元する（同一地点なので別地点への持ち越しは起きない）。
    const nextAirspaceFlags =
      entry.diagnosisInput?.userAirspaceFlags ?? entry.diagnosisInput?.airspaceFlags ?? [];
    const nextDidConfirmed = entry.diagnosisInput?.didConfirmedNotApplicable === true;
    const nextPlannedDate = entry.diagnosisInput?.plannedDate ?? "";
    const nextAccessMode = entry.diagnosisInput?.accessMode ?? "";
    const nextBvlosObserver = entry.diagnosisInput?.bvlosObserver ?? "";
    const nextManualChoice = entry.diagnosisInput?.manualChoice ?? "custom";
    const nextCompletedIds = entry.diagnosisInput?.completedProcedureIds ?? [];

    setMethodFlags(nextMethodFlags);
    setUserAirspaceFlags(nextAirspaceFlags);
    setDidConfirmedNotApplicable(nextDidConfirmed);
    setPlannedDate(nextPlannedDate);
    setAccessMode(nextAccessMode);
    setBvlosObserver(nextBvlosObserver);
    setManualChoice(nextManualChoice);
    setDoneMap(completedIdsToDoneMap(nextCompletedIds));
    applyLocation(entry.loc);

    const restoredDiagInput: SavedDiagnosisInput = {
      methodFlags: nextMethodFlags,
      airspaceFlags: nextAirspaceFlags,
      userAirspaceFlags: nextAirspaceFlags,
      didConfirmedNotApplicable: nextDidConfirmed,
      ...(nextPlannedDate.trim().length > 0 ? { plannedDate: nextPlannedDate.trim() } : {}),
      accessMode: nextAccessMode,
      bvlosObserver: nextBvlosObserver,
      manualChoice: nextManualChoice,
      completedProcedureIds: nextCompletedIds,
    };

    const runId = startNewRun();
    runCheck(entry.loc, entry.ctx ?? null, restoredDiagInput, runId);
    void runDiagnose(entry.loc, {
      userAirspaceFlags: nextAirspaceFlags,
      didConfirmedNotApplicable: nextDidConfirmed,
      methodFlags: nextMethodFlags,
      plannedDate: nextPlannedDate,
      accessMode: nextAccessMode,
      bvlosObserver: nextBvlosObserver,
      droneWeightG: entry.ctx?.droneWeightG ?? null,
      manualChoice: nextManualChoice,
      completedProcedureIds: nextCompletedIds,
    }, runId).finally(() => {
      isRestoringRef.current = false;
    });
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

  const runCheck = (
    loc: LatLng,
    overrideCtx?: FlightContext | null,
    overrideDiagInput?: SavedDiagnosisInput,
    runId: string = runIdRef.current,
  ): void => {
    const ctx = overrideCtx !== undefined ? (overrideCtx ?? undefined) : buildCtx();
    const diagInput = overrideDiagInput ?? buildDiagnosisInput();
    // 先行リクエストを中断し、連番で古い応答を確実に捨てる。
    checkAbortRef.current?.abort();
    const controller = new AbortController();
    checkAbortRef.current = controller;
    const seq = ++checkSeqRef.current;
    startChecking(async () => {
      const t0 = performance.now();
      try {
        const res = await checkLocation(loc, ctx, controller.signal);
        if (seq !== checkSeqRef.current) return; // 古い応答は無視
        setResult(res);
        setResponseMs(Math.round(performance.now() - t0));
        setError(null);
        const newPref = res.muniCode?.slice(0, 2);
        if (newPref && newPref !== prefCode) setPrefCode(newPref);
        // 履歴に自動保存。runId 単位で書き込み、診断結果との到着順に依存しない。
        // 同一 evidenceId は idempotent (= 重複しない)。
        recordHistoryCheck(runId, {
          evidenceId: res.evidenceId,
          savedAt: new Date().toISOString(),
          loc,
          ctx,
          overall: res.overall,
          resolvedAddress: res.resolvedAddress,
          engineVersion: res.engineVersion,
          checkedAt: res.checkedAt,
          muniCode: res.muniCode,
          diagnosisInput: diagInput,
        });
      } catch (err) {
        if (isAbortError(err) || seq !== checkSeqRef.current) return;
        setError(`判定に失敗しました: ${(err as Error).message}`);
      }
    });
  };

  type RunDiagnoseOverrides = {
    readonly userAirspaceFlags?: readonly SpecificFlightFlag[];
    readonly didConfirmedNotApplicable?: boolean;
    readonly methodFlags?: readonly SpecificFlightFlag[];
    readonly plannedDate?: string;
    readonly accessMode?: "" | "yes" | "no_third_party";
    readonly bvlosObserver?: "" | "with" | "without";
    readonly droneWeightG?: number | null;
    readonly manualChoice?: ManualChoice;
    readonly completedProcedureIds?: readonly string[];
  };

  // 申請支援診断を実行。/api/diagnose は信号機判定を内部で再実行し、
  // 空域フラグ（DID・空港）を自動導出する。クライアント側でも飛行方法フラグ＋空域フラグ
  // （プリチェック済み）を送り、サーバ側導出と合流させる（DID データ縮退時の保険）。
  // 引数で flags / 条件を明示注入できるようにし、プリセット選択や履歴復元直後の state 反映待ちを避ける。
  const runDiagnose = async (
    loc: LatLng,
    overrides: RunDiagnoseOverrides = {},
    runId: string = runIdRef.current,
  ): Promise<void> => {
    const w = Number(droneWeightInput);
    const weight =
      overrides.droneWeightG !== undefined
        ? (overrides.droneWeightG ?? undefined)
        : droneWeightInput.trim().length > 0 && Number.isFinite(w) && w >= 0
          ? w
          : undefined;
    const effMethodFlags = overrides.methodFlags ?? methodFlags;
    const effUserAirspace = overrides.userAirspaceFlags ?? userAirspaceFlags;
    const effDidConfirmed = overrides.didConfirmedNotApplicable ?? didConfirmedNotApplicable;
    const effPlannedDate = overrides.plannedDate ?? plannedDate;
    const effAccessMode = overrides.accessMode ?? accessMode;
    const effBvlosObserver = overrides.bvlosObserver ?? bvlosObserver;

    diagAbortRef.current?.abort();
    const controller = new AbortController();
    diagAbortRef.current = controller;
    const seq = ++diagSeqRef.current;

    try {
      const res = await diagnoseLocation(
        loc,
        {
          droneWeightG: weight,
          // サーバ側で地点判定由来の空域フラグ（自動検出）が合流される。ここではユーザー指定分のみ送る。
          flags: [...effMethodFlags, ...effUserAirspace],
          plannedDate: effPlannedDate.trim().length > 0 ? effPlannedDate.trim() : undefined,
          accessControl: effAccessMode === "" ? undefined : effAccessMode === "yes",
          thirdPartyOverflight: effAccessMode === "no_third_party" ? true : undefined,
          bvlosWithObserver: effBvlosObserver === "" ? undefined : effBvlosObserver === "with",
          didConfirmedNotApplicable: effDidConfirmed,
        },
        controller.signal,
      );
      if (seq !== diagSeqRef.current) return; // 古い応答は無視
      setDiagnosis(res);
      setDiagnoseError(null);
      // 自動検出の空域フラグは state に書き戻さない（表示は diagnosis から導出）。
      const effectiveAirspace = Array.from(
        new Set<SpecificFlightFlag>([...res.derivedAirspaceFlags, ...effUserAirspace]),
      );
      recordHistoryDiagnosis(runId, {
        diagnosisInput: buildDiagnosisInput({
          methodFlags: effMethodFlags,
          airspaceFlags: effectiveAirspace,
          userAirspaceFlags: effUserAirspace,
          didConfirmedNotApplicable: effDidConfirmed,
          plannedDate: effPlannedDate,
          accessMode: effAccessMode,
          bvlosObserver: effBvlosObserver,
          manualChoice: overrides.manualChoice,
          completedProcedureIds: overrides.completedProcedureIds,
        }),
        diagnosisSummary: {
          diagnosisEvidenceId: res.evidenceId,
          category: res.category,
          isSpecificFlight: res.isSpecificFlight,
          procedureCount: res.procedures.length,
          didStatus: res.didStatus,
        },
      });
    } catch (err) {
      if (isAbortError(err) || seq !== diagSeqRef.current) return;
      setDiagnoseError(`申請支援の診断に失敗しました: ${(err as Error).message}`);
    }
  };

  // ctx の値が変わったら、現在の中心地点で再判定して画面に即反映する。
  // 最低限の依存配列（重量・運航種別・各許可フラグ）だけに絞る。
  // 機体条件が変わると地点判定の evidenceId も変わるため、新しいチェック実行（runId）として
  // 地点判定と診断を両方やり直す。
  useEffect(() => {
    if (!result || isRestoringRef.current) return; // 初回オートランより前、または履歴復元中は走らせない
    const runId = startNewRun();
    runCheck(center, undefined, undefined, runId);
    void runDiagnose(center, {}, runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droneWeightInput, hasMlitPermit, hasFacilityPermit, hasParkPermit, hasBunkachoPermit, purpose]);

  // 申請支援の入力（飛行方法フラグ・飛行予定日・立入管理措置）が変わったら、
  // 信号機判定は変わらないので診断だけを再実行する（無駄な /api/check 呼び出しを避ける）。
  // 自動検出の空域フラグは依存に含めない（state に保存しないのでループしない）。
  useEffect(() => {
    if (skipDiagEffectRef.current) {
      skipDiagEffectRef.current = false;
      return;
    }
    if (!result || isRestoringRef.current) return; // 初回オートランより前、または履歴復元中は走らせない
    void runDiagnose(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methodFlags, userAirspaceFlags, didConfirmedNotApplicable, plannedDate, accessMode, bvlosObserver]);

  // デモ初動短縮: 米子市役所で初期判定をプリロードして
  // 「ページが開いた瞬間に red 信号機」が見える状態にする。
  const didAutoRunRef = useRef<boolean>(false);
  useEffect(() => {
    if (didAutoRunRef.current) return;
    didAutoRunRef.current = true;
    const runId = startNewRun();
    runCheck(YONAGO_CITY_HALL, undefined, undefined, runId);
    void runDiagnose(YONAGO_CITY_HALL, { userAirspaceFlags: [] }, runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 地点変更の共通処理。空域フラグ（ユーザー指定分）と DID 確認状態は地点ごとにリセットし、
  // 飛行方法・予定日などのユーザー条件だけを引き継ぐ。新しい runId で判定と診断を開始する。
  const goToLocation = (
    loc: LatLng,
    seedAirspace: readonly SpecificFlightFlag[] = [],
  ): void => {
    applyLocation(loc);
    const airspaceChanged = !sameFlagSet(userAirspaceFlags, seedAirspace);
    const didChanged = didConfirmedNotApplicable;
    if (airspaceChanged) setUserAirspaceFlags(seedAirspace);
    if (didChanged) setDidConfirmedNotApplicable(false);
    // state 変更で発火する診断 effect は、ここで明示実行するので 1 回だけ抑止する。
    if (airspaceChanged || didChanged) skipDiagEffectRef.current = true;
    const runId = startNewRun();
    runCheck(
      loc,
      undefined,
      buildDiagnosisInput({
        airspaceFlags: seedAirspace,
        userAirspaceFlags: seedAirspace,
        didConfirmedNotApplicable: false,
      }),
      runId,
    );
    void runDiagnose(
      loc,
      { userAirspaceFlags: seedAirspace, didConfirmedNotApplicable: false },
      runId,
    );
  };

  const handlePick = (loc: LatLng): void => {
    if (!isValidLatLng(loc)) return;
    goToLocation(loc);
  };

  // プリセット選択: curated な空域フラグ（DID・空港）を「その地点のユーザー指定分」として初期化する。
  // 前の地点の空域フラグは引き継がない。
  const selectPreset = (preset: DemoPreset): void => {
    goToLocation(preset.loc, preset.airspaceFlags ?? []);
  };

  // 結合形式（"lat,lng" や Google Maps URL）を反映する。
  // 成功時は lat/lng を埋め、判定までトリガする（デモ・現場での「貼って即判定」UX）。
  const applyCombined = (text: string): boolean => {
    const parsed = parseCombinedLatLng(text);
    if (!parsed) {
      setCombinedStatus({ ok: false, message: "形式を認識できませんでした" });
      return false;
    }
    goToLocation(parsed);
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
    goToLocation(parsed);
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
    goToLocation({ lat: latNum, lng: lngNum });
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
        goToLocation({ lat: first.lat, lng: first.lng });
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
                      goToLocation({ lat: r.lat, lng: r.lng });
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
                goToLocation(parsed);
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
                const isAuto = autoAirspaceFlags.includes(flag);
                const checked = effectiveAirspaceFlags.includes(flag);
                return (
                  <label
                    key={flag}
                    data-testid={`airspace-${flag}`}
                    className={`flex min-h-[52px] cursor-pointer items-start gap-2 px-3 py-3 transition-colors ${checked ? "bg-brand-50" : "bg-paper active:bg-paper-soft sm:hover:bg-paper-soft"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isAuto}
                      title={isAuto ? "地点判定から自動検出（この地点では外せません）" : undefined}
                      onChange={() => toggleAirspaceFlag(flag)}
                      className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                    />
                    <span className="text-sm font-medium leading-tight text-ink sm:text-xs">
                      {SPECIFIC_FLIGHT_FLAG_LABEL[flag]}
                      {isAuto ? (
                        <span className="ml-1 font-mono text-[9px] uppercase tracking-wider text-ink-mute">
                          （自動検出）
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {/* DID 該当の三値（該当／非該当／未確認）。未確認は「申請不要」と判断しない。 */}
            {autoDidStatus !== undefined ? (
              <div
                className="flex flex-col gap-1.5 border-l-2 border-rule pl-3 text-[11px] leading-relaxed text-ink-soft"
                data-testid="did-status"
              >
                <span>
                  DID 自動判定：
                  <span
                    className={`font-medium ${autoDidStatus === "unverified" ? "text-signal-amber" : "text-ink"}`}
                  >
                    {AIRSPACE_DETERMINATION_LABEL[autoDidStatus]}
                  </span>
                  {autoDidStatus === "unverified"
                    ? "（DID データ未整備または判定不能。確認するまで要確認として扱います）"
                    : ""}
                </span>
                {autoDidStatus === "unverified" && !userAirspaceFlags.includes("airspace_did") ? (
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={didConfirmedNotApplicable}
                      onChange={(e) => setDidConfirmedNotApplicable(e.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-brand-700"
                    />
                    地理院地図・DIPS で DID 非該当を確認済み
                  </label>
                ) : null}
              </div>
            ) : null}
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
      {diagnosis ? (
        <DiagnosisPanel
          diagnosis={diagnosis}
          plannedDate={plannedDate}
          doneMap={doneMap}
          onToggleDone={handleToggleProcedureDone}
          manualChoice={manualChoice}
          onManualChoiceChange={handleManualChoiceChange}
        />
      ) : null}

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
              const catShort: Record<DiagnosisCategory, string> = {
                I: "cat:I",
                needs_verification: "要確認",
                II_A: "cat:IIA相当",
                II_B_eligible: "cat:IIB相当",
                III_level4: "cat:III(Lv4)",
              };
              const completedCount = h.diagnosisInput?.completedProcedureIds?.length ?? 0;
              const procCount = h.diagnosisSummary?.procedureCount;
              const methodCount = h.diagnosisInput?.methodFlags?.length ?? 0;
              return (
                <li key={h.runId ?? h.evidenceId} className="flex items-center gap-3 py-2.5" data-testid="history-item">
                  <button
                    type="button"
                    onClick={() => restoreFromHistory(h)}
                    className="flex flex-1 items-center gap-3 text-left transition-colors hover:bg-paper-soft"
                    title={`Evidence ${h.evidenceId} を復元して再判定（申請支援の条件・進捗も復元）`}
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
                        {h.diagnosisSummary ? ` · ${catShort[h.diagnosisSummary.category] ?? h.diagnosisSummary.category}` : ""}
                        {h.diagnosisSummary?.didStatus
                          ? ` · DID:${AIRSPACE_DETERMINATION_LABEL[h.diagnosisSummary.didStatus]}`
                          : ""}
                        {procCount !== undefined
                          ? completedCount > 0
                            ? ` · 手続き${completedCount}/${procCount}`
                            : ` · 手続き${procCount}件`
                          : ""}
                        {methodCount > 0 ? ` · 方法×${methodCount}` : ""}
                        {h.diagnosisInput?.plannedDate ? ` · 予定:${h.diagnosisInput.plannedDate}` : ""}
                        {" · "}
                        {h.evidenceId}
                        {h.diagnosisSummary?.diagnosisEvidenceId &&
                        h.diagnosisSummary.diagnosisEvidenceId !== h.evidenceId
                          ? ` / diag:${h.diagnosisSummary.diagnosisEvidenceId}`
                          : ""}
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
