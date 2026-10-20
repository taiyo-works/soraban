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
  DIPS_PERMIT_KINDS,
  DIPS_PERMIT_LABEL,
  shouldWarnConfidence,
  FLIGHT_METHOD_FLAGS,
  AIRSPACE_FLAGS,
  formatDidDetermination,
  mergeAirspaceFlags,
  SPECIFIC_FLIGHT_FLAG_LABEL,
  DIAGNOSIS_DISCLAIMER,
  type DiagnosisCategory,
  type FlightContext,
  type ManualChoice,
  type DipsPermitKind,
  type RegulationCheckResult,
  type SpecificFlightFlag,
} from "@soraban/regulations";

import {
  GEOCODE_LEVEL_NOTE,
  GEOCODE_SOURCE_LABEL,
  GEOCODE_SERVICE_UNAVAILABLE,
  searchAddress,
  type GeocodeResult,
} from "@/lib/geocode";
import { candidateToLocation, type CurrentLocationCandidate } from "@/lib/current-location";
import { checkLocation } from "@/lib/check";
import { diagnoseLocation, type DiagnoseResponse } from "@/lib/diagnose";
import {
  buildRestorePlan,
  clearHistory,
  createHistoryRunId,
  getHistoryServerSnapshot,
  getHistorySnapshot,
  historyVerdictDisplay,
  markHistoryDiagnosisFailed,
  recordHistoryCheck,
  recordHistoryDiagnosis,
  removeHistory,
  subscribeHistory,
  type SavedCheck,
  type SavedDiagnosisInput,
} from "@/lib/history";
import { RegulationCard } from "./regulation-card";
import { VerdictSummary } from "./verdict-summary";
import { VerdictMark } from "./verdict-mark";
import { VERDICT_CHECK_FAILED_NOTE } from "@/lib/verdict-display";
import {
  buildPilotPermits,
  EMPTY_DIPS_CHECKS,
  normalizeRestoredCtx,
  permitChecksFromPilotPermits,
  type DipsPermitChecks,
} from "@/lib/permits";
import { RegulationMap, type MapPickMethod } from "./regulation-map";
import { DiagnosisPanel } from "./diagnosis-panel";

// Sprint 11d：結論は 4 段の判定（VerdictSummary）。信号の 3 灯と STATUS_LABEL・overallHelp は廃止した
// （段階の説明は @soraban/regulations の VERDICT_HELP）。

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

const PICK_METHOD_LABEL: Readonly<Record<MapPickMethod, string>> = {
  click: "クリック",
  longpress: "長押し",
  contextmenu: "右クリック",
};

/** 地点の決め方の表示（判定の入力・証跡・履歴には含めない）。 */
type LocationNote = {
  readonly kind: "geocode" | "map";
  readonly text: string;
  readonly source?: string;
  readonly title?: string;
};

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

// 地点の例（固定地点）。県別にグルーピングし、複数規制が同時に red になる地点と
// 収録している自治体（鳥取・島根）の判定を端的に確かめられるよう並べる。
// 先頭の 3 地点は、社外の人が見ても判定の特徴（DID の許可・小型無人機等飛行禁止法・
// 工業専用地域による DID の除外）が分かる地点にする（Sprint 11a A2）。
// 社内拠点の座標・名前は公開のトップ画面のコードに持たない（Sprint 11a A5）。
// 地図の初期表示と最初の判定地点。収録済みの市町村で全カードが判定でき、
// DID の許可が要るという基本の特徴が初回から見える米子市役所にする（Sprint 11a A3）。
const INITIAL_LOCATION: LatLng = YONAGO_CITY_HALL;

// 履歴の一行に出す運航の目的の短い表記（選択肢の文言に合わせる）。
const PURPOSE_SHORT: Readonly<Record<string, string>> = {
  emergency: "緊急",
  public_duty: "公務",
  city_event: "市の行事",
};

const EXAMPLE_LOCATIONS: readonly DemoPreset[] = [
  {
    id: "yonago-city-hall",
    name: "米子市役所",
    loc: YONAGO_CITY_HALL,
    hint: "人口集中地区（航空法の許可が必要）＋鳥取県条例（庁舎）",
    group: "鳥取県",
    airspaceFlags: ["airspace_did"],
  },
  {
    id: "miho-airbase-vicinity",
    name: "美保基地の周辺（境港市）",
    loc: { lat: 35.4936, lng: 133.26604 },
    hint: "小型無人機等飛行禁止法（対象施設の周囲おおむね 1,000m）。空港の周辺は要確認",
    group: "鳥取県",
  },
  {
    id: "tottori-industrial",
    name: "鳥取市の工業専用地域",
    loc: { lat: 35.474926, lng: 134.222963 },
    hint: "人口集中地区の中でも工業専用地域は DID の許可が不要（2026-07-01 から）",
    group: "鳥取県",
  },
  {
    id: "minatoyama-park",
    name: "湊山公園(米子城跡)",
    loc: { lat: 35.4267, lng: 133.322 },
    hint: "米子市の公園条例と文化財保護法の両方に該当",
    group: "鳥取県",
  },
  {
    id: "kaike-onsen",
    name: "皆生温泉",
    loc: { lat: 35.4538, lng: 133.3333 },
    hint: "米子市の公園条例＋鳥取県条例（温泉街）",
    group: "鳥取県",
  },
  {
    id: "tottori-univ-hospital",
    name: "鳥取大学医学部附属病院",
    loc: { lat: 35.4495, lng: 133.343 },
    hint: "鳥取県条例（病院の周辺）",
    group: "鳥取県",
  },
  {
    id: "sakaiminato-station",
    name: "境港駅",
    // JR境港駅 (境港市大正町209-1): 35°32′41″N 133°13′37″E
    loc: { lat: 35.5447, lng: 133.2269 },
    hint: "境港市の条例＋鳥取県条例（駅）",
    group: "鳥取県",
  },
  {
    id: "yonago-airport",
    name: "米子鬼太郎空港",
    loc: { lat: 35.4925, lng: 133.2364 },
    hint: "空港の敷地と美保基地の周辺（航空法と小型無人機等飛行禁止法）",
    group: "鳥取県",
    airspaceFlags: ["airspace_airport"],
  },
  {
    id: "yume-minato-park",
    name: "夢みなと公園(境港)",
    loc: { lat: 35.5455, lng: 133.2235 },
    hint: "境港市の公園条例に該当",
    group: "鳥取県",
  },
  {
    id: "tottori-castle",
    name: "鳥取城跡(久松公園)",
    loc: { lat: 35.504, lng: 134.244 },
    hint: "鳥取市の公園条例と文化財保護法の両方に該当",
    group: "鳥取県",
  },
  {
    id: "uchibuki-park",
    name: "打吹公園(倉吉)",
    loc: { lat: 35.4250, lng: 133.8235 },
    hint: "倉吉市の公園条例＋鳥取県条例（白壁土蔵群の周辺）",
    group: "鳥取県",
  },
  {
    id: "matsue-castle",
    name: "松江城(国指定史跡・国宝)",
    // 松江城天守: 35°28′32″N 133°03′02″E
    loc: { lat: 35.4753, lng: 133.0506 },
    hint: "松江市の公園条例と文化財保護法の両方に該当",
    group: "島根県",
  },
  {
    id: "izumo-taisha",
    name: "出雲大社",
    loc: { lat: 35.4019, lng: 132.6852 },
    hint: "島根県条例（参拝者が集まる場所）",
    group: "島根県",
  },
  {
    id: "kojindani-historic-park",
    name: "荒神谷史跡公園(出雲)",
    loc: { lat: 35.387, lng: 132.844 },
    hint: "出雲市の公園条例と文化財保護法の両方に該当",
    group: "島根県",
  },
  {
    id: "izumo-station",
    name: "出雲市役所",
    // 出雲市今市町70: 35°22′06″N 132°45′24″E
    loc: { lat: 35.3683, lng: 132.7567 },
    hint: "人口集中地区＋島根県条例（庁舎）",
    group: "島根県",
    airspaceFlags: ["airspace_did"],
  },
  {
    id: "izumo-airport",
    name: "出雲縁結び空港",
    loc: { lat: 35.4133, lng: 132.8897 },
    hint: "空港の敷地（航空法第132条の85）",
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

type RegulationCheckerProps = {
  /** 住所検索の同梱索引（アドレス・ベース・レジストリ）にデータがあるか。空なら ABR の出典と見出しを出さない。 */
  readonly addressIndexAvailable?: boolean;
};

export function RegulationChecker({ addressIndexAvailable = false }: RegulationCheckerProps = {}) {
  const [lat, setLat] = useState<string>(String(INITIAL_LOCATION.lat));
  const [lng, setLng] = useState<string>(String(INITIAL_LOCATION.lng));
  const [center, setCenter] = useState<LatLng>(INITIAL_LOCATION);
  const [combined, setCombined] = useState<string>("");
  // 結合入力フィールドのフィードバック。null=未入力、true=反映成功、false=形式エラー
  const [combinedStatus, setCombinedStatus] = useState<{
    readonly ok: boolean;
    readonly message: string;
  } | null>(null);
  const [address, setAddress] = useState<string>("");
  const [geocodeResults, setGeocodeResults] = useState<readonly GeocodeResult[]>([]);
  const [geocoding, setGeocoding] = useState<boolean>(false);
  const [locationNote, setLocationNote] = useState<LocationNote | null>(null);
  // 現在地の候補（端末内の表示だけに使う。「この地点で判定」まで送信・保存しない）
  const [geoCandidate, setGeoCandidate] = useState<CurrentLocationCandidate | null>(null);
  const [result, setResult] = useState<RegulationCheckResult | null>(null);
  // result を求めたときの ctx（カードの補足・PDF の「取得済み許可」を判定結果と揃えるため）。
  const [resultCtx, setResultCtx] = useState<FlightContext | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // 地点判定（/api/check）の失敗と、result を求めた地点（差し戻し 3 回目 F3：前の地点の結果を混ぜない）。
  const [checkError, setCheckError] = useState<string | null>(null);
  const [resultLoc, setResultLoc] = useState<LatLng | null>(null);
  const [prefCode, setPrefCode] = useState<string>("31"); // 鳥取県デフォルト
  const [isChecking, startChecking] = useTransition();
  const [pdfBusy, setPdfBusy] = useState<boolean>(false);

  // ── FlightContext: 機体・運航条件 ──
  // 空文字 = "未指定"。最も厳しい解釈になる。
  // 数値 < 100 で 100g 未満例外がマッチし、DID/空港 → green に降格（飛行禁止法は 100g 未満も対象）。
  const [droneWeightInput, setDroneWeightInput] = useState<string>("");
  // 国交省 DIPS の許可・承認（種類ごと。Sprint 11d B1）。空港等周辺は入力に含めない。
  const [dipsChecks, setDipsChecks] = useState<DipsPermitChecks>(EMPTY_DIPS_CHECKS);
  // 施設管理者の同意と公安委員会への通報（飛行禁止法）は別の入力（Sprint 11c）。
  const [hasFacilityConsent, setHasFacilityConsent] = useState<boolean>(false);
  const [hasPubsafetyNotice, setHasPubsafetyNotice] = useState<boolean>(false);
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
  // /api/diagnose の応答待ち（画面の結論は診断の判定を使い、届くまで「判定中」とする。未決 5）。
  const [diagPending, setDiagPending] = useState<boolean>(true);
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
  // 画面の結論に使う判定（未決 5）：現在の入力で成功した診断の判定（飛行の方法を含む）だけを使う。
  // 届くまでは「判定中」。診断が失敗したときは「判定できません」とし、古い診断の判定も、飛行の方法を含まない
  // 地点だけの判定（/api/check）も使わない（差し戻し 2 回目。見落としゼロ）。
  const diagnosisIsCurrent = diagnosis !== null && sameLoc(center, diagnosis);
  const verdictFailed = diagnoseError !== null && !diagPending;
  const screenVerdict =
    diagnosisIsCurrent && !diagPending && !verdictFailed && diagnosis.verdict !== undefined
      ? diagnosis.verdict
      : undefined;
  // 地点判定の結果が現在の地点のものか。地点判定が失敗している間は、前の地点の規制・証跡 ID を出さない。
  const resultIsCurrent = result !== null && resultLoc !== null && sameLoc(center, resultLoc);
  const checkFailed = checkError !== null && !isChecking;
  const conclusionFailed = verdictFailed || checkFailed;
  const verdictPending =
    !conclusionFailed &&
    (diagPending || isChecking || screenVerdict === undefined || !resultIsCurrent);
  const canExportPdf =
    screenVerdict !== undefined && !verdictPending && !conclusionFailed && resultIsCurrent;
  const showResultDetail = result !== null && resultIsCurrent && !checkFailed;
  // 再試行：地点判定が失敗していれば地点判定と診断を新しい実行としてやり直し、診断だけの失敗なら診断をやり直す。
  const retryVerdict = (): void => {
    if (checkFailed) {
      const runId = startNewRun();
      runCheck(center, undefined, undefined, runId);
      void runDiagnose(center, {}, runId);
    } else {
      void runDiagnose(center);
    }
  };

  // エンジンの DID 判定が確定（該当・非該当）しているときは、プリセットの curated DID フラグを使わない。
  const effectiveAirspaceFlags: readonly SpecificFlightFlag[] = mergeAirspaceFlags({
    derivedFlags: autoAirspaceFlags,
    userFlags: userAirspaceFlags,
    autoDidStatus: autoDidStatus ?? "unverified",
  });

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
    // 旧形式・旧規制 ID を含むエントリでも例外を出さないよう、純関数で正規化してから戻す（Sprint 7）。
    const plan = buildRestorePlan(entry);
    // 旧形式の許可（facility_manager_and_pref_pubsafety）をそのまま送らないよう、
    // 現在の規則で組み直した ctx を判定・表示・履歴の保存に使う（Sprint 11c）。
    const restoredCtx = normalizeRestoredCtx(plan.ctx);
    const weightStr =
      plan.ctx?.droneWeightG !== undefined ? String(plan.ctx.droneWeightG) : "";
    setDroneWeightInput(weightStr);
    // 旧形式（facility_manager_and_pref_pubsafety）からは通報を済み扱いに戻さない（Sprint 11c）。
    const permitChecks = permitChecksFromPilotPermits(restoredCtx?.pilotPermits);
    setDipsChecks(permitChecks.dips);
    setHasFacilityConsent(permitChecks.facilityConsent);
    setHasPubsafetyNotice(permitChecks.pubsafetyNotice);
    setHasParkPermit(permitChecks.park);
    setHasBunkachoPermit(permitChecks.bunkacho);
    setPurpose((plan.ctx?.purpose as typeof purpose) ?? "general");

    const nextMethodFlags = plan.methodFlags;
    const nextAirspaceFlags = plan.userAirspaceFlags;
    const nextDidConfirmed = plan.didConfirmedNotApplicable;
    const nextPlannedDate = plan.plannedDate;
    const nextAccessMode = plan.accessMode;
    const nextBvlosObserver = plan.bvlosObserver;
    const nextManualChoice = plan.manualChoice;
    const nextCompletedIds = plan.completedProcedureIds;

    setMethodFlags(nextMethodFlags);
    setUserAirspaceFlags(nextAirspaceFlags);
    setDidConfirmedNotApplicable(nextDidConfirmed);
    setPlannedDate(nextPlannedDate);
    setAccessMode(nextAccessMode);
    setBvlosObserver(nextBvlosObserver);
    setManualChoice(nextManualChoice);
    setDoneMap(completedIdsToDoneMap(nextCompletedIds));
    applyLocation(plan.loc);

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
    runCheck(plan.loc, restoredCtx ?? null, restoredDiagInput, runId);
    void runDiagnose(plan.loc, {
      userAirspaceFlags: nextAirspaceFlags,
      didConfirmedNotApplicable: nextDidConfirmed,
      methodFlags: nextMethodFlags,
      plannedDate: nextPlannedDate,
      accessMode: nextAccessMode,
      bvlosObserver: nextBvlosObserver,
      droneWeightG: plan.ctx?.droneWeightG ?? null,
      ctx: restoredCtx ?? null,
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
    // 再判定の応答待ちの間・診断が失敗した間は、画面の入力と食い違う旧い結果で PDF を出さない。
    if (
      !result ||
      isChecking ||
      !canExportPdf ||
      !resultIsCurrent ||
      checkError !== null ||
      screenVerdict === undefined ||
      diagnosis === null
    )
      return;
    setPdfBusy(true);
    try {
      const [{ pdf }, { RegulationPdfDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./regulation-pdf"),
      ]);
      // 画面に出ている判定結果を求めたときの ctx を使う（入力の変更と再判定の間でずれないように）。
      const ctx = resultCtx;
      // 結論・段取りは画面と同じ判定（診断の判定。飛行の方法を含む）を使い、その診断の証跡 ID で出す
      // （診断だけの入力を変えたとき、内容の違う PDF が同じ ID・同じファイル名にならないように。PR #23 P1）。
      const diagnosisEvidenceId = diagnosis.evidenceId;
      const blob = await pdf(
        <RegulationPdfDocument
          result={result}
          loc={center}
          ctx={ctx}
          verdict={screenVerdict}
          diagnosisEvidenceId={diagnosisEvidenceId}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `soraban-${diagnosisEvidenceId}.pdf`;
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
    const permits = buildPilotPermits({
      dips: dipsChecks,
      park: hasParkPermit,
      facilityConsent: hasFacilityConsent,
      pubsafetyNotice: hasPubsafetyNotice,
      bunkacho: hasBunkachoPermit,
    });
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
      try {
        const res = await checkLocation(loc, ctx, controller.signal);
        if (seq !== checkSeqRef.current) return; // 古い応答は無視
        setResult(res);
        setResultCtx(ctx);
        setResultLoc(loc);
        setCheckError(null);
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
          ...(res.verdict
            ? { verdict: res.verdict.level, verdictUnknownCount: res.verdict.unknownCount }
            : {}),
          resolvedAddress: res.resolvedAddress,
          engineVersion: res.engineVersion,
          checkedAt: res.checkedAt,
          muniCode: res.muniCode,
          diagnosisInput: diagInput,
        });
      } catch (err) {
        if (isAbortError(err) || seq !== checkSeqRef.current) return;
        setCheckError((err as Error).message);
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
    /** 許可・目的を取り出す ctx（履歴の復元。未指定は画面の入力から組み立てる）。 */
    readonly ctx?: FlightContext | null;
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
    // 許可・目的（Sprint 11d B2）。地点判定と同じ ctx から取り出す。
    const effCtx = overrides.ctx !== undefined ? (overrides.ctx ?? undefined) : buildCtx();

    diagAbortRef.current?.abort();
    const controller = new AbortController();
    diagAbortRef.current = controller;
    const seq = ++diagSeqRef.current;
    setDiagPending(true);

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
          ...(effCtx?.pilotPermits ? { pilotPermits: effCtx.pilotPermits } : {}),
          ...(effCtx?.purpose ? { purpose: effCtx.purpose } : {}),
        },
        controller.signal,
      );
      if (seq !== diagSeqRef.current) return; // 古い応答は無視
      setDiagnosis(res);
      setDiagnoseError(null);
      setDiagPending(false);
      // 自動検出の空域フラグは state に書き戻さない（表示は diagnosis から導出）。
      const effectiveAirspace = mergeAirspaceFlags({
        derivedFlags: res.derivedAirspaceFlags,
        userFlags: effUserAirspace,
        autoDidStatus: res.autoDidStatus,
      });
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
          ...(res.didDetail !== undefined ? { didDetail: res.didDetail } : {}),
          // 飛行の方法を含む判定（画面の結論と同じ）。履歴の表示はこれを使う（PR #23 P1）。
          ...(res.verdict
            ? { verdict: res.verdict.level, verdictUnknownCount: res.verdict.unknownCount }
            : {}),
        },
      });
    } catch (err) {
      if (isAbortError(err) || seq !== diagSeqRef.current) return;
      setDiagPending(false);
      setDiagnoseError(`申請支援の診断に失敗しました: ${(err as Error).message}`);
      // 履歴に前の診断の判定や地点だけの判定を残さない（判定未確定。差し戻し 2 回目）。
      markHistoryDiagnosisFailed(runId);
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
  }, [
    droneWeightInput,
    dipsChecks,
    hasFacilityConsent,
    hasPubsafetyNotice,
    hasParkPermit,
    hasBunkachoPermit,
    purpose,
  ]);

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
    runCheck(INITIAL_LOCATION, undefined, undefined, runId);
    void runDiagnose(INITIAL_LOCATION, { userAirspaceFlags: [] }, runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 地点変更の共通処理。空域フラグ（ユーザー指定分）と DID 確認状態は地点ごとにリセットし、
  // 飛行方法・予定日などのユーザー条件だけを引き継ぐ。新しい runId で判定と診断を開始する。
  const goToLocation = (
    loc: LatLng,
    seedAirspace: readonly SpecificFlightFlag[] = [],
  ): void => {
    // 地点の決め方の表示と現在地の候補は、地点が変わるたびに消す（呼び出し元が必要なら設定し直す）
    setLocationNote(null);
    setGeoCandidate(null);
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

  const handlePick = (loc: LatLng, method: MapPickMethod = "click"): void => {
    if (!isValidLatLng(loc)) return;
    goToLocation(loc);
    setLocationNote({ kind: "map", text: `地図で指定しました（${PICK_METHOD_LABEL[method]}）` });
  };

  // 現在地の「この地点で判定」：通常の地点と同じ流れで判定する（精度・取得時刻・指定方法は送らない）
  const confirmCurrentLocation = (c: CurrentLocationCandidate): void => {
    const loc = candidateToLocation(c);
    if (!isValidLatLng(loc)) return;
    goToLocation(loc);
  };

  const selectGeocodeResult = (r: GeocodeResult): void => {
    goToLocation({ lat: r.lat, lng: r.lng });
    setGeocodeResults([]);
    setLocationNote({
      kind: "geocode",
      text: GEOCODE_LEVEL_NOTE[r.level],
      source: GEOCODE_SOURCE_LABEL[r.source],
      title: r.title,
    });
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
      const { results: found, serviceError } = await searchAddress(address);
      setGeocodeResults(found);
      if (found.length === 0) {
        // 該当なしと、住所検索サービスに接続できない場合を出し分ける
        setError(serviceError ? GEOCODE_SERVICE_UNAVAILABLE : "住所が見つかりませんでした。");
      } else if (found.length === 1) {
        selectGeocodeResult(found[0]!);
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
    "inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-sharp border border-brand-700 bg-paper px-5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 active:bg-brand-50 disabled:cursor-not-allowed disabled:border-rule disabled:bg-paper-soft disabled:text-ink-mute disabled:hover:bg-paper-soft";

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
          <span className="eyebrow !text-[11px] shrink-0 not-italic">免責</span>
          <span>{DIAGNOSIS_DISCLAIMER}</span>
        </p>

        {/* address geocode */}
        <fieldset className="flex flex-col gap-2">
          <legend className="eyebrow">
            <span aria-hidden className="bearing-mark" />
            01 — 住所から位置決定
            <span className="ml-2 normal-case tracking-normal text-ink-mute/70 not-italic">
              {addressIndexAvailable ? "（アドレス・ベース・レジストリ → 国土地理院）" : "（国土地理院）"}
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
              placeholder="例: 鳥取県米子市加茂町1丁目1番地"
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
            <div className="mt-1 flex flex-col gap-1">
              <p className="text-xs text-ink-soft">候補が {geocodeResults.length} 件あります。選ぶと判定します。</p>
              <ul className="flex flex-col divide-y divide-rule border border-rule bg-paper">
                {geocodeResults.map((r) => (
                  <li key={`${r.source}-${r.level}-${r.lat}-${r.lng}`}>
                    <button
                      type="button"
                      data-testid="geocode-result"
                      data-source={r.source}
                      data-level={r.level}
                      onClick={() => selectGeocodeResult(r)}
                      className="flex min-h-12 w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-paper-soft active:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
                    >
                      <span className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-sm font-medium text-ink">{r.title}</span>
                        <span className="font-mono text-[11px] tnum text-ink-mute">
                          {round6(r.lat)}, {round6(r.lng)}
                        </span>
                      </span>
                      <span className="text-xs leading-relaxed text-ink-soft">{GEOCODE_LEVEL_NOTE[r.level]}</span>
                      <span className="text-[11px] text-ink-mute">出典：{GEOCODE_SOURCE_LABEL[r.source]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-[11px] leading-relaxed text-ink-mute" data-testid="geocode-attribution">
            出典：
            {addressIndexAvailable
              ? "アドレス・ベース・レジストリ（デジタル庁）を加工して作成（鳥取県・島根県の町字・住居表示）／"
              : ""}
            国土地理院 住所検索
          </p>
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
              placeholder="例: 35.4278, 133.3314 ／ Google マップの URL（https://maps.google.com/...@35.4283,133.3306,15z）"
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
              <span className="text-[11px] tracking-wide text-ink-mute">
                緯度（北緯・度）
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                onPaste={handleSplitPaste}
                className={`${fieldClass} font-mono`}
                placeholder="35.4278"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] tracking-wide text-ink-mute">
                経度（東経・度）
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                onPaste={handleSplitPaste}
                className={`${fieldClass} font-mono`}
                placeholder="133.3314"
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
              <span className="text-[11px] tracking-wide text-ink-mute">
                機体の重さ（g）
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={droneWeightInput}
                  onChange={(e) => setDroneWeightInput(e.target.value)}
                  className={`${fieldClass} flex-1 font-mono`}
                  placeholder="例: 900／80（100g 未満の機体）"
                />
                {droneWeightInput.trim().length > 0 && Number(droneWeightInput) < 100 ? (
                  <span className="text-[11px] tracking-wide text-signal-green whitespace-nowrap">
                    100g 未満の例外
                  </span>
                ) : null}
              </div>
              <span className="text-[10px] leading-tight text-ink-mute">
                100g 未満は航空法上の無人航空機に非該当（DID / 空港が対象外。小型無人機等飛行禁止法は 100g 未満も対象）
              </span>
            </label>

            {/* 運航目的 */}
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] tracking-wide text-ink-mute">
                運航の目的
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
            <span className="text-[11px] tracking-wide text-ink-mute">
              取得済みの許可
            </span>
            {(() => {
              /* 5 つのチェックを 2 段に組む。
                 上段：単独で効く許可（DIPS・公園・文化財）の 3 枡。
                 下段：飛行禁止法では同意と通報が一組で要るため、2 枡を隣り合わせて
                 左の罫と枡の間の「＋」でひとまとまりに見せる。 */
              const permitItems = [
                {
                  state: hasParkPermit,
                  set: setHasParkPermit,
                  key: "park",
                  label: "公園管理者",
                  desc: "都市公園条例",
                },
                {
                  state: hasBunkachoPermit,
                  set: setHasBunkachoPermit,
                  key: "bunkacho",
                  label: "文化庁・教育委員会",
                  desc: "文化財保護法 125 条",
                },
              ];
              const pairItems = [
                {
                  state: hasFacilityConsent,
                  set: setHasFacilityConsent,
                  key: "facility-consent",
                  label: "施設管理者の同意",
                  desc: "県条例の事前調整・飛行禁止法の対象施設の同意",
                },
                {
                  state: hasPubsafetyNotice,
                  set: setHasPubsafetyNotice,
                  key: "pubsafety-notice",
                  label: "公安委員会への通報（飛行禁止法）",
                  desc: "飛行の 48 時間前までに通報済み（飛行禁止法の対象施設の周辺だけで使う）",
                },
              ];
              const renderPermit = (p: {
                readonly state: boolean;
                readonly set: (v: boolean) => void;
                readonly key: string;
                readonly label: string;
                readonly desc: string;
              }) => (
                <label
                  key={p.key}
                  className={`flex min-h-[52px] cursor-pointer items-start gap-2 px-3 py-3 transition-colors ${p.state ? "bg-brand-50" : "bg-paper active:bg-paper-soft sm:hover:bg-paper-soft"}`}
                >
                  <input
                    type="checkbox"
                    checked={p.state}
                    onChange={(e) => p.set(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand-700"
                  />
                  <span className="flex flex-1 flex-col gap-0.5 leading-tight">
                    <span className="text-sm font-medium text-ink sm:text-xs">{p.label}</span>
                    <span className="text-[11px] leading-snug tracking-wide text-ink-mute">
                      {p.desc}
                    </span>
                  </span>
                </label>
              );
              // 国交省 DIPS の許可・承認（種類ごと。Sprint 11d B1）。空港等周辺は入力に含めない
              // （空港ごとの個別の許可と空港の設置管理者等との調整が要るため）。
              const DIPS_DESC: Readonly<Record<DipsPermitKind, string>> = {
                did: "航空法 DID（人口集中地区）の許可",
                "150m": "地表・水面から 150m 以上の空域",
                night: "日没後から日出まで",
                bvlos: "目視の範囲外",
                "30m": "人・物件から 30m 未満",
                event: "祭礼・催しの場所の上空",
                dangerous: "危険物の輸送",
                drop: "物件の投下",
              };
              const dipsItems = DIPS_PERMIT_KINDS.map((k) => ({
                state: dipsChecks[k],
                set: (v: boolean) => setDipsChecks((prev) => ({ ...prev, [k]: v })),
                key: `dips-${k}`,
                label: `国交省 DIPS：${DIPS_PERMIT_LABEL[k]}`,
                desc: DIPS_DESC[k],
              }));
              return (
                <div className="flex flex-col gap-px overflow-hidden bg-rule">
                  <div data-testid="dips-permits" className="flex flex-col gap-px bg-rule">
                    <p className="bg-paper px-3 pt-2 text-[11px] leading-snug text-ink-mute">
                      国交省 DIPS の許可・承認（種類ごと。範囲・期間は照合しません。空港等周辺は個別の許可のため入力に含めません）
                    </p>
                    <div className="grid grid-cols-1 gap-px sm:grid-cols-2 lg:grid-cols-4">
                      {dipsItems.map(renderPermit)}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-px sm:grid-cols-2">
                    {permitItems.map(renderPermit)}
                  </div>
                  <div className="relative border-l-2 border-brand-700 bg-rule">
                    <div className="grid grid-cols-1 gap-px sm:grid-cols-2">
                      {pairItems.map(renderPermit)}
                    </div>
                    <span
                      aria-hidden
                      className="pointer-events-none absolute left-1/2 top-1/2 hidden h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-rule bg-paper font-mono text-xs leading-none text-brand-700 sm:flex"
                    >
                      +
                    </span>
                  </div>
                </div>
              );
            })()}
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
            <span className="text-[11px] tracking-wide text-ink-mute">
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
                        <span className="ml-1 font-mono text-[11px] uppercase tracking-wider text-ink-mute">
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
                    className={`font-medium ${
                      autoDidStatus === "unverified" ||
                      diagnosis?.didDetail === "in_did_exclusion_unverified"
                        ? "text-signal-amber"
                        : "text-ink"
                    }`}
                  >
                    {formatDidDetermination(autoDidStatus, diagnosis?.didDetail)}
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
          <span className="text-[11px] tracking-wide text-ink-mute">
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
              <span className="flex items-center gap-2 text-[11px] tracking-wide text-ink-mute">
                飛行予定日
                <span
                  aria-hidden
                  className="inline-flex items-center gap-1 border border-rule px-1.5 py-px text-[11px] tracking-[0.18em] text-ink-mute/80"
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
              <span className="text-[11px] tracking-wide text-ink-mute">
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
              <span className="text-[11px] tracking-wide text-ink-mute">
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
            04 — 地点の例
            <span className="ml-2 normal-case tracking-normal text-ink-mute/70 not-italic">
              （県別<span className="sm:hidden"> ／ 横スクロール</span>）
            </span>
          </p>
          {/* モバイル: 横スクロール scroll-snap */}
          <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 sm:hidden">
            {EXAMPLE_LOCATIONS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPreset(preset)}
                title={preset.hint}
                className="flex w-[16.5rem] max-w-[78vw] shrink-0 snap-start flex-col items-start gap-1.5 border border-rule bg-paper px-4 py-3 text-left transition-colors active:bg-paper-soft"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center border px-1.5 py-px text-[11px] font-medium uppercase tracking-wider ${PRESET_GROUP_TONE[preset.group]}`}
                  >
                    {preset.group}
                  </span>
                  <span className="font-display text-sm font-medium text-ink">
                    {preset.name}
                  </span>
                </div>
                <span className="text-[11px] leading-snug text-ink-mute">
                  {preset.hint}
                </span>
              </button>
            ))}
          </div>
          {/* sm 以上: 既存のグリッド */}
          {/* 罫線は各ボタンの右・下と外枠の左・上で引く（最後の行が欠けても空きの升が灰色で埋まらないように）。 */}
          <div className="hidden grid-cols-2 border-l border-t border-rule sm:grid lg:grid-cols-3">
            {EXAMPLE_LOCATIONS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPreset(preset)}
                title={preset.hint}
                className="flex flex-col items-start gap-1.5 border-b border-r border-rule bg-paper px-4 py-3 text-left transition-colors hover:bg-paper-soft"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center border px-1.5 py-px text-[11px] font-medium uppercase tracking-wider ${PRESET_GROUP_TONE[preset.group]}`}
                  >
                    {preset.group}
                  </span>
                  <span className="font-display text-sm font-medium text-ink">
                    {preset.name}
                  </span>
                </div>
                <span className="text-[11px] leading-snug text-ink-mute">
                  {preset.hint}
                </span>
              </button>
            ))}
          </div>
        </div>
      </form>

      {/* ─── MAP ───────────────────────────────── */}
      <div className="flex flex-col gap-2">
        {locationNote ? (
          <p
            className="flex flex-col gap-0.5 border-l-2 border-brand-700 bg-paper-soft py-2 pl-3 pr-2 text-xs leading-relaxed text-ink"
            role="status"
            data-testid="location-note"
          >
            {locationNote.title ? <span className="text-sm font-medium">{locationNote.title}</span> : null}
            <span>{locationNote.text}</span>
            {locationNote.source ? <span className="text-[11px] text-ink-mute">出典：{locationNote.source}</span> : null}
          </p>
        ) : null}
        <RegulationMap
          center={center}
          prefCode={prefCode}
          onPick={handlePick}
          candidate={geoCandidate}
          onCandidate={setGeoCandidate}
          onConfirmCandidate={confirmCurrentLocation}
        />
      </div>

      {/* ─── RESULT ───────────────────────────────── */}
      {result || checkError ? (
        <section
          className="flex flex-col gap-6 border-y border-double border-rule bg-paper-soft/40 p-4 sm:gap-7 sm:p-6"
          aria-live="polite"
        >
          {/* 結論（4 段の判定）と段取り（Sprint 11d D1） */}
          <VerdictSummary
            verdict={screenVerdict}
            pending={verdictPending}
            failed={conclusionFailed}
            {...(checkFailed ? { failedNote: VERDICT_CHECK_FAILED_NOTE } : {})}
            onRetry={retryVerdict}
            meta={
              <p className="font-mono text-[11px] tnum text-ink-mute">
                {lat}°N · {lng}°E
                {showResultDetail && result.resolvedAddress ? ` — ${result.resolvedAddress}` : ""}
              </p>
            }
            actions={
              <button
                type="button"
                onClick={() => void handlePdfExport()}
                disabled={pdfBusy || isChecking || !canExportPdf}
                className="inline-flex h-11 items-center gap-2 self-stretch rounded-sharp border border-brand-700 bg-paper px-4 text-xs font-medium uppercase tracking-wider text-brand-700 transition-colors hover:bg-brand-50 active:bg-brand-50 disabled:opacity-40 sm:self-start"
                title="この判定を A4 PDF レポートとして書き出し"
              >
                <span aria-hidden className="font-mono text-[10px] tracking-[0.2em] opacity-70">▾</span>
                {pdfBusy ? "PDF 生成中…" : "PDF 出力"}
              </button>
            }
          />

          {!showResultDetail ? (
            <p
              data-testid="regulations-unavailable"
              className="border border-dashed border-rule bg-paper px-4 py-3 text-xs leading-relaxed text-ink-soft"
            >
              この地点の地点判定の結果がまだありません（判定中、または失敗）。規制ごとの判定と証跡 ID は、地点判定が出てから表示します。
            </p>
          ) : null}

          {showResultDetail ? (
          <>
          {/* 低確信度警告 — 確信度が閾値未満のときだけ警告を出す */}
          {shouldWarnConfidence(result.overallConfidence) ? (
            <div className="border-l-2 border-signal-amber bg-signal-amber-soft px-4 py-3 text-xs leading-relaxed text-ink-soft">
              <span className="eyebrow !text-[11px] !text-signal-amber">
                確からしさ {CONFIDENCE_LABEL[result.overallConfidence]} — 現地での再確認を推奨
              </span>{" "}
              この判定には、区域の位置または条文の読み取りの確からしさが低いデータが含まれます。引受・許可申請の前に、該当条文の原本（出典リンク）と現地状況をご確認ください。
            </div>
          ) : null}

          {/* disclaimer — brand outlined, never amber */}
          <div className="border-l-2 border-brand-700 bg-paper px-4 py-3 text-xs leading-relaxed text-ink-soft">
            <span className="eyebrow !text-[11px]">免責</span>{" "}
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
                <RegulationCard
                  key={r.id}
                  regulation={r}
                  pilotPermits={resultCtx?.pilotPermits}
                  verdictItem={result.verdict?.items.find((i) => i.id === r.id)}
                  provisional={screenVerdict === undefined || verdictPending || conclusionFailed}
                />
              ))}
            </div>
          </div>

          {/* audit meta — designed as drafter's stamp block */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-rule pt-4 text-xs text-ink-mute sm:grid-cols-4">
            <div className="flex flex-col gap-0.5 col-span-2">
              <dt className="eyebrow !text-[11px]">証跡 ID</dt>
              <dd className="font-mono tnum text-ink" data-testid="evidence-id">
                {result.evidenceId}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="eyebrow !text-[11px]">確からしさ</dt>
              <dd className="normal-case tracking-normal text-ink">
                {CONFIDENCE_LABEL[result.overallConfidence]}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="eyebrow !text-[11px]">判定の版</dt>
              <dd className="tnum normal-case tracking-normal text-ink">
                {result.engineVersion}
              </dd>
            </div>
            <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-4">
              <dt className="eyebrow !text-[11px]">判定日時</dt>
              <dd className="normal-case tracking-normal text-ink">
                {new Date(result.checkedAt).toLocaleString("ja-JP")}
              </dd>
            </div>
          </dl>
          </>
          ) : null}
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
                {history.length} 件
              </p>
            </div>
            <button
              type="button"
              onClick={handleClearHistory}
              className="text-[11px] tracking-wide text-ink-mute hover:text-signal-red"
            >
              全削除
            </button>
          </div>
          <ul className="flex flex-col divide-y divide-rule">
            {history.slice(0, 10).map((h) => {
              // 判定の表示（Sprint 11d C5）：新形式は 4 段の言葉、旧形式は旧版の値であることを明示する。
              const vd = historyVerdictDisplay(h);
              const checkedDate = new Date(h.checkedAt);
              const dateStr = `${String(checkedDate.getMonth() + 1).padStart(2, "0")}/${String(checkedDate.getDate()).padStart(2, "0")} ${String(checkedDate.getHours()).padStart(2, "0")}:${String(checkedDate.getMinutes()).padStart(2, "0")}`;
              const catShort: Record<DiagnosisCategory, string> = {
                I: "cat:I",
                needs_verification: "要確認",
                II_A: "cat:IIA相当",
                II_B_eligible: "cat:IIB相当",
                III_level4: "cat:III(Lv4)",
                emergency_no_fly: "飛行不可(緊急用務空域)",
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
                    title={`証跡 ${h.evidenceId} を復元して再判定（申請支援の条件・進捗も復元）`}
                  >
                    {vd.level ? (
                      <VerdictMark level={vd.level} size="sm" decorative />
                    ) : (
                      <span aria-hidden className="inline-block h-3.5 w-3.5 shrink-0 border border-dashed border-ink-mute" />
                    )}
                    <span className="flex flex-1 flex-col leading-tight">
                      <span
                        data-testid="history-verdict"
                        data-legacy={vd.legacy ? "true" : "false"}
                        data-level={vd.level ?? ""}
                        className="text-[11px] font-medium text-ink-soft"
                      >
                        {vd.label}
                        {vd.unknownCount !== undefined && vd.unknownCount > 0
                          ? `・判定不能 ${vd.unknownCount} 件`
                          : ""}
                      </span>
                      <span className="text-sm text-ink">
                        {h.resolvedAddress ?? `${h.loc.lat.toFixed(4)}°N · ${h.loc.lng.toFixed(4)}°E`}
                      </span>
                      <span className="font-mono text-[10px] tnum text-ink-mute">
                        {dateStr}
                        {h.ctx?.droneWeightG !== undefined ? ` · ${h.ctx.droneWeightG}g` : ""}
                        {h.ctx?.purpose && h.ctx.purpose !== "general" ? ` · ${PURPOSE_SHORT[h.ctx.purpose] ?? h.ctx.purpose}` : ""}
                        {h.ctx?.pilotPermits && h.ctx.pilotPermits.length > 0 ? ` · 許可${h.ctx.pilotPermits.length}件` : ""}
                        {h.diagnosisSummary ? ` · ${catShort[h.diagnosisSummary.category] ?? h.diagnosisSummary.category}` : ""}
                        {h.diagnosisSummary?.didStatus
                          ? ` · DID:${formatDidDetermination(h.diagnosisSummary.didStatus, h.diagnosisSummary.didDetail)}`
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
