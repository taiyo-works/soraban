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
  DRONE_THRESHOLD_G,
  MODEL_AIRCRAFT_WEIGHT_NOTE,
  MODEL_AIRCRAFT_WEIGHT_TAG,
  shouldWarnConfidence,
  FLIGHT_METHOD_FLAGS,
  AIRSPACE_FLAGS,
  formatDidDetermination,
  mergeAirspaceFlags,
  SPECIFIC_FLIGHT_FLAG_LABEL,
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
import { candidateToLocation, formatAccuracy, isLowAccuracy, type CurrentLocationCandidate } from "@/lib/current-location";
import { checkLocation } from "@/lib/check";
import { diagnoseLocation, type DiagnoseResponse } from "@/lib/diagnose";
import { DISCLAIMER_JUDGEMENT } from "@/lib/disclaimers";
import {
  buildRestorePlan,
  clearHistory,
  createHistoryRunId,
  getHistoryServerSnapshot,
  getHistorySnapshot,
  historyDiagnosisDetail,
  historyVerdictDisplay,
  clearHistoryDiagnosisVerdict,
  recordHistoryCheck,
  recordHistoryDiagnosis,
  removeHistory,
  subscribeHistory,
  type SavedCheck,
  type SavedDiagnosisInput,
} from "@/lib/history";
import { RegulationCard } from "./regulation-card";
import { VerdictSummary } from "./verdict-summary";
import { VERDICT_CHECK_FAILED_NOTE, VERDICT_LABEL } from "@/lib/verdict-display";
import {
  buildPilotPermits,
  EMPTY_DIPS_CHECKS,
  normalizeRestoredCtx,
  permitChecksFromPilotPermits,
  type DipsPermitChecks,
} from "@/lib/permits";
import { buildPlanHandoffHref } from "@/lib/plan-options";
import { useOpsEntryAvailable } from "@/lib/ops-entry";
import { RegulationMap, type MapPickMethod } from "./regulation-map";
import { DiagnosisPanel } from "./diagnosis-panel";
import { CurrentLocationNotes, useCurrentLocationRequest } from "./current-location-control";
import { PillButton, PillLink, VerdictSign, VerdictTag } from "./ui/sb-parts";

// Sprint 11d：結論は 4 段の判定（VerdictSummary）。信号の 3 灯と STATUS_LABEL・overallHelp は廃止した
// （段階の説明は @soraban/regulations の VERDICT_HELP）。

// 結論の着地を確定させる。判定中の間に始めた滑らかなスクロールは、下の詳細が流れ込んで頁の高さが変わる間や、
// 結論のカードが立ち上がる動き（transform）の間に、途中で止まる・数十 px ずれることがある（実測：地図のクリック後に約 3 割）。
// 動きが終わって位置が落ち着いたあと、上端が着地の位置（scroll-margin-top）から外れていれば、その場で合わせ直す。
// 利用者が要求のあとにスクロール・タッチ・キー操作をしたときは、合わせ直さない（要求の時点から監視する）。
// 入力の種類に依らず、頁が結論から離れる向きにスクロールされたとき（スクロールバーのドラッグ、ページ内の移動、
// スクリプトによる移動など）も、別の誰かが頁を動かしたとみなして合わせ直さない。結論へ向かう滑らかなスクロールは
// 離れる向きに動かないので、これで止まらない。立ち上がりの動き（24px）や頁の高さの変化による数 px の揺れは、
// 離れた量の合計が SCROLL_AWAY_PX を超えるまで数えない。
// 待ちは開始から SETTLE_MAX_MS で打ち切り、立ち上がりの動きが終わっていなければ合わせ直しを諦める（触らない方を選ぶ）。
// 失敗しても結論の表示は落とさない（getAnimations が無い環境では何もしない）。
const SETTLE_MAX_MS = 1500;
const SCROLL_AWAY_PX = 48;
const INPUT_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
const CONCLUSION_SELECTOR = '[data-testid="verdict-conclusion"]';
type ConclusionWatch = { readonly touched: () => boolean; readonly stop: () => void };
const watchUserInput = (): ConclusionWatch => {
  let touched = false;
  const on = (): void => {
    touched = true;
  };
  // 頁のスクロールが、結論の着地の位置から離れる向きに動いた量の合計を数える（要素の中のスクロールは window.scrollY が動かないので数えない）
  let prevY = window.scrollY;
  let away = 0;
  const onScroll = (): void => {
    try {
      const y = window.scrollY;
      const dy = y - prevY;
      const box = document.querySelector<HTMLElement>(CONCLUSION_SELECTOR);
      if (dy !== 0 && box) {
        const margin = parseFloat(getComputedStyle(box).scrollMarginTop) || 0;
        const target = y + box.getBoundingClientRect().top - margin;
        const toward = Math.sign(target - prevY);
        if (toward !== 0 && Math.sign(dy) !== toward) {
          away += Math.abs(dy);
          if (away > SCROLL_AWAY_PX) touched = true;
        }
      }
      prevY = y;
    } catch {
      /* 監視に失敗しても、結論の表示は落とさない */
    }
  };
  for (const e of INPUT_EVENTS) window.addEventListener(e, on, { passive: true, capture: true });
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  return {
    touched: () => touched,
    stop: () => {
      for (const e of INPUT_EVENTS) window.removeEventListener(e, on, { capture: true });
      window.removeEventListener("scroll", onScroll, { capture: true });
    },
  };
};
const settleConclusion = (box: HTMLElement, watch: ConclusionWatch): (() => void) => {
  let cancelled = false;
  let timer: number | undefined;
  let raf: number | undefined;
  // 打ち切り・合わせ直しの完了・取り消しのどれでも、利用者の操作の監視も外す
  const finish = (): void => {
    cancelled = true;
    if (timer !== undefined) window.clearTimeout(timer);
    if (raf !== undefined) cancelAnimationFrame(raf);
    watch.stop();
  };
  try {
    if (typeof box.getAnimations !== "function") {
      finish();
      return finish;
    }
    const started = performance.now();
    const running = box.getAnimations().filter((a) => a.playState === "running");
    const animationsDone = Promise.all(running.map((a) => a.finished.then(() => true, () => false)));
    const cap = new Promise<boolean>((resolve) => {
      timer = window.setTimeout(() => resolve(false), SETTLE_MAX_MS);
    });
    void Promise.race([animationsDone, cap])
      .then((done) => {
        if (cancelled || !done) {
          finish();
          return;
        }
        let prev = Number.NaN;
        let stable = 0;
        const tick = (): void => {
          try {
            if (cancelled || watch.touched() || !box.isConnected) {
              finish();
              return;
            }
            const top = box.getBoundingClientRect().top;
            stable = top === prev ? stable + 1 : 0;
            prev = top;
            if (stable < 3) {
              if (performance.now() - started >= SETTLE_MAX_MS) {
                finish();
                return;
              }
              raf = requestAnimationFrame(tick);
              return;
            }
            const margin = parseFloat(getComputedStyle(box).scrollMarginTop) || 0;
            // html の scroll-behavior: smooth に従わせないため、instant を明示する
            if (Math.abs(top - margin) > 2) box.scrollIntoView({ block: "start", behavior: "instant" });
            finish();
          } catch {
            /* 合わせ直しに失敗しても、結論の表示は落とさない */
            finish();
          }
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => finish());
  } catch {
    /* 同上 */
    finish();
  }
  return finish;
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

/** 判定の見分け方の並び（重い順）。 */
const VERDICT_LEGEND_ORDER = ["no_fly", "needs_procedure", "procedure_done", "no_procedure", "unknown"] as const;

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

type RegulationCheckerProps = {
  /** 住所検索の同梱索引（アドレス・ベース・レジストリ）にデータがあるか。空なら ABR の出典と見出しを出さない。 */
  readonly addressIndexAvailable?: boolean;
  /**
   * 申請支援（手続き診断のパネル・書類 PDF・プリフィル・マニュアル骨子・申請の期限のカレンダー）を描くか。
   * フラグ APPLICATION_SUPPORT_ENABLED（lib/boundary.ts。既定・本番は無効）。page.tsx がビルド時の値を渡す。既定は偽。
   */
  readonly applicationSupport?: boolean;
};

export function RegulationChecker({ addressIndexAvailable = false, applicationSupport = false }: RegulationCheckerProps = {}) {
  // 運航管理が有効でログイン済みのときだけ「この判定で飛行計画を作る」を出す（Sprint 12a J。無効のときは何も出さず通信もしない）。
  const opsEntryAvailable = useOpsEntryAvailable();
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
  // 精度 100m 以内で、そのまま判定した現在地（地図に精度の円を残す表示用。判定・保存には使わない）。地点が変わると消す。
  const [locatedCircle, setLocatedCircle] = useState<CurrentLocationCandidate | null>(null);
  // 住所の入力欄が、最後に位置を決めた後で書き換えられたか（「この地点を判定する」で先に住所検索をするかの判断）。
  const [addressDirty, setAddressDirty] = useState<boolean>(false);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const locateRef = useRef<HTMLButtonElement | null>(null);
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
  // 診断の応答を待っている実行の runId（Sprint 11f B1）。履歴の該当の行を「判定中」と出す。画面の状態だけで、保存しない。
  const [diagPendingRunId, setDiagPendingRunId] = useState<string | null>(null);
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

  // 100g 未満（模型航空機）の入力か（重さの欄の表示用。判定はサーバーが行う）。
  const isModelAircraftWeight =
    droneWeightInput.trim().length > 0 &&
    Number.isFinite(Number(droneWeightInput)) &&
    Number(droneWeightInput) >= 0 &&
    Number(droneWeightInput) < DRONE_THRESHOLD_G;

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
  // 結論の札（確認日・出典つき）：判定に使ったデータの確認日のうち最も新しい日と、出典のリンクを持つ規制の数。
  const evidenceSummary =
    showResultDetail && result
      ? {
          checkedDate: result.regulations
            .flatMap((r) => r.datasets.map((d) => d.verifiedAt))
            .filter((v) => v.length >= 10)
            .map((v) => v.slice(0, 10))
            .sort()
            .at(-1),
          sourced: result.regulations.filter((r) => Boolean(r.url)).length,
        }
      : undefined;
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

  // 利用者が地点を決めて判定したあと、結論へ移る（結論が画面に入る動線。Sprint 12h PR ② の評価 B1）。
  // 結論のカードの上端へスクロールし、結論の見出しへフォーカスを移す（読み上げ対応）。動きを減らす設定・現場モードでは瞬間移動。
  // 初回の自動判定・条件の変更による再判定では動かさない（goToLocation からだけ要求する）。
  const conclusionRequestRef = useRef<boolean>(false);
  const conclusionScrolledRef = useRef<boolean>(false);
  const conclusionSawPendingRef = useRef<boolean>(false);
  const conclusionSettleCancelRef = useRef<(() => void) | null>(null);
  const conclusionWatchRef = useRef<ConclusionWatch | null>(null);
  useEffect(
    () => () => {
      conclusionSettleCancelRef.current?.();
      conclusionWatchRef.current?.stop();
    },
    [],
  );
  const [conclusionTick, setConclusionTick] = useState<number>(0);
  const requestConclusion = (): void => {
    conclusionSettleCancelRef.current?.();
    conclusionSettleCancelRef.current = null;
    conclusionWatchRef.current?.stop();
    conclusionWatchRef.current = watchUserInput();
    conclusionRequestRef.current = true;
    conclusionScrolledRef.current = false;
    conclusionSawPendingRef.current = false;
    setConclusionTick((t) => t + 1);
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
    // 待っている間、この実行の履歴に前の入力での判定を残さない（Sprint 11f B1）。保存するのは判定を外した状態だけ。
    clearHistoryDiagnosisVerdict(runId);
    setDiagPendingRunId(runId);

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
      setDiagPendingRunId(null);
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
      setDiagPendingRunId(null);
      setDiagnoseError(`飛行の方法を含む判定に失敗しました: ${(err as Error).message}`);
      // 履歴に前の診断の判定や地点だけの判定を残さない（判定未確定。差し戻し 2 回目）。
      clearHistoryDiagnosisVerdict(runId);
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
    setLocatedCircle(null);
    setAddressDirty(false);
    applyLocation(loc);
    requestConclusion();
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

  useEffect(() => {
    if (!conclusionRequestRef.current) return;
    const box = document.querySelector<HTMLElement>(CONCLUSION_SELECTOR);
    if (!box) return;
    const instant =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-mode") === "field";
    if (!conclusionScrolledRef.current) {
      conclusionScrolledRef.current = true;
      box.scrollIntoView({ block: "start", behavior: instant ? "instant" : "smooth" });
    }
    // 判定中を一度見てから、結論が出た（または失敗が確定した）ら、見出しへフォーカスを移して要求を終える
    // （判定中の表示は別の要素なので、先に移すと、結論が出たときにフォーカスが外れる）
    if (verdictPending) conclusionSawPendingRef.current = true;
    if (conclusionFailed || (conclusionSawPendingRef.current && screenVerdict !== undefined && !verdictPending)) {
      document.getElementById("verdict-heading")?.focus({ preventScroll: true });
      conclusionRequestRef.current = false;
      const watch = conclusionWatchRef.current;
      if (watch) conclusionSettleCancelRef.current = settleConclusion(box, watch);
    }
  }, [conclusionTick, conclusionFailed, screenVerdict, verdictPending, result, checkError]);

  const handlePick = (loc: LatLng, method: MapPickMethod = "click"): void => {
    if (!isValidLatLng(loc)) return;
    goToLocation(loc);
    setLocationNote({ kind: "map", text: `地図で指定しました（${PICK_METHOD_LABEL[method]}）` });
  };

  // 現在地の判定：通常の地点と同じ流れで判定する（精度・取得時刻・指定方法は送らない。送るのは小数 6 桁の緯度・経度だけ）。
  // 結果には「現在地（精度 約 N m）」を添える（精度は整数の m の表示だけで、判定には送らない）。
  const confirmCurrentLocation = (c: CurrentLocationCandidate): void => {
    const loc = candidateToLocation(c);
    if (!isValidLatLng(loc)) return;
    goToLocation(loc);
    setLocationNote({ kind: "map", text: formatAccuracy(c.accuracyM) });
    setLocatedCircle(c);
  };

  // 「現在地で判定」を押して位置を取得できたとき：精度 100m 以内は続けて判定する。100m を超えるときだけ確認を 1 回（この間は通信しない）。
  const handleLocated = (c: CurrentLocationCandidate): void => {
    if (isLowAccuracy(c.accuracyM)) {
      setLocationNote(null);
      setLocatedCircle(null);
      setGeoCandidate(c);
      return;
    }
    confirmCurrentLocation(c);
  };
  const { unavailableReason, locating, error: locationError, locate } = useCurrentLocationRequest(handleLocated);

  // ホームのピルから来る入口（`/?start=here`・`/?start=search`）：位置は要求せず、フォーカスだけ移す（押すのは利用者）。
  useEffect(() => {
    const start = new URLSearchParams(window.location.search).get("start");
    if (start === "here") locateRef.current?.focus();
    else if (start === "search") addressRef.current?.focus();
  }, []);

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
    // 住所を入力して位置をまだ決めていないときは、先に住所で位置を決める（決まれば続けて判定する）
    if (addressDirty && address.trim().length > 0) {
      void handleGeocode();
      return;
    }
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

  // 座標欄（form の外）で Enter を押したときも、「この地点を判定する」と同じ動き
  const submitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== "Enter") return;
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
    // 座標や Google マップの URL が入っていたときは、住所検索ではなく座標として反映する
    if (parseCombinedLatLng(address) !== null) {
      setAddressDirty(false);
      applyCombined(address);
      return;
    }
    setAddressDirty(false);
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

  // 取得済み許可の項目。
  // 上段：単独で効く許可（DIPS・公園・文化財）。下段：飛行禁止法では同意と通報が一組で要るため、2 つを隣り合わせて見せる。
  const permitItems = [
    { state: hasParkPermit, set: setHasParkPermit, key: "park", label: "公園管理者", desc: "都市公園条例" },
    { state: hasBunkachoPermit, set: setHasBunkachoPermit, key: "bunkacho", label: "文化庁・教育委員会", desc: "文化財保護法 125 条" },
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

  // 共通スタイル（デザインシステム v2）：入力欄は 8px 角丸・縁 edge・高さ 52px、押す部品は 44px 以上。
  const fieldClass = "sb-input";

  const renderPermit = (p: {
    readonly state: boolean;
    readonly set: (v: boolean) => void;
    readonly key: string;
    readonly label: string;
    readonly desc: string;
  }) => (
    <label key={p.key} className={`sb-check-row ${p.state ? "is-on" : ""}`}>
      <input type="checkbox" checked={p.state} onChange={(e) => p.set(e.target.checked)} className="sb-check mt-0.5" />
      <span className="flex flex-1 flex-col gap-0.5 leading-snug">
        <span className="text-sm font-bold text-sb-ink">{p.label}</span>
        <span className="text-sm text-sb-ink-3">{p.desc}</span>
      </span>
    </label>
  );

  return (
    <div className="sb-check-grid">
      {/* ─── INPUT FORM ───────────────────────────────── */}
      <form onSubmit={handleSubmit} className="sb-block sb-area-input flex flex-col gap-3.5" data-testid="input-block">
        {/* 住所または緯度・経度（入力欄と 2 つのボタンは最初の画面に入る） */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="address-input" className="sb-label">
              住所または緯度・経度
            </label>
            <button
              type="button"
              onClick={() => void handleGeocode()}
              disabled={geocoding || address.trim().length === 0}
              className="sb-text-btn"
            >
              {geocoding ? "検索中…" : "住所で位置決定"}
            </button>
          </div>
          <input
            id="address-input"
            ref={addressRef}
            type="text"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setAddressDirty(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleGeocode();
              }
            }}
            placeholder="例: 鳥取県米子市加茂町1丁目1番地"
            className={fieldClass}
            autoComplete="off"
          />
          {geocodeResults.length > 1 ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-sb-ink-2">候補が {geocodeResults.length} 件あります。選ぶと判定します。</p>
              <ul className="flex flex-col gap-2">
                {geocodeResults.map((r) => (
                  <li key={`${r.source}-${r.level}-${r.lat}-${r.lng}`}>
                    <button
                      type="button"
                      data-testid="geocode-result"
                      data-source={r.source}
                      data-level={r.level}
                      onClick={() => selectGeocodeResult(r)}
                      className="sb-check-row w-full flex-col !gap-1 text-left"
                    >
                      <span className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-sm font-bold text-sb-ink">{r.title}</span>
                        <span className="sb-num text-sm text-sb-ink-3">
                          {round6(r.lat)}, {round6(r.lng)}
                        </span>
                      </span>
                      <span className="text-sm leading-relaxed text-sb-ink-2">{GEOCODE_LEVEL_NOTE[r.level]}</span>
                      <span className="text-sm text-sb-ink-3">出典：{GEOCODE_SOURCE_LABEL[r.source]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div data-testid="current-location" className="flex flex-col gap-3">
          <div className="sb-btn-row !mt-0">
            <PillButton type="submit" variant="primary" block disabled={isChecking}>
              {isChecking ? "判定中…" : "この地点を判定する"}
            </PillButton>
            <PillButton
              ref={locateRef}
              variant="secondary"
              block
              icon="locate"
              onClick={() => void locate()}
              disabled={unavailableReason.length > 0 || locating}
              aria-busy={locating}
              data-testid="current-location-button"
            >
              {locating ? "現在地を取得中…" : "現在地で判定"}
            </PillButton>
          </div>
          {error ? (
            <p className="sb-note-card is-error" role="alert">
              {error}
            </p>
          ) : null}
          <CurrentLocationNotes
            candidate={geoCandidate}
            unavailableReason={unavailableReason}
            error={locationError}
            onConfirm={confirmCurrentLocation}
            onCancel={() => setGeoCandidate(null)}
          />
        </div>
      </form>

      {/* ─── RESULT（結論）：入力の直下。判定したら、ここへ移る（見出しにフォーカスも移す） ─── */}
      {result || checkError ? (
        <section className="sb-area-result flex flex-col gap-6" aria-live="polite" data-testid="result-section" data-wording-scope="judgement">
          {/* 結論（4 段の判定）と段取り（Sprint 11d D1） */}
          <VerdictSummary
            part="conclusion"
            {...(evidenceSummary ? { evidence: evidenceSummary } : {})}
            verdict={screenVerdict}
            pending={verdictPending}
            failed={conclusionFailed}
            {...(checkFailed ? { failedNote: VERDICT_CHECK_FAILED_NOTE } : {})}
            onRetry={retryVerdict}
            meta={
              <p className="sb-num text-sm text-sb-ink-3">
                {lat}°N · {lng}°E
                {showResultDetail && result.resolvedAddress ? ` — ${result.resolvedAddress}` : ""}
              </p>
            }
            actions={
              <div className="flex flex-col gap-2 self-stretch sm:flex-row sm:flex-wrap sm:self-start">
                {opsEntryAvailable && canExportPdf ? (
                  // 判定の入力（座標・機体の重さ・フラグ・許可・予定日）だけを計画のフォームに引き継ぐ。結果は引き継がない（保存でサーバーが再実行する）。
                  <PillLink
                    variant="primary"
                    small
                    href={buildPlanHandoffHref({
                      lat,
                      lng,
                      weightG: droneWeightInput,
                      flags: [...methodFlags, ...userAirspaceFlags],
                      permits: buildCtx()?.pilotPermits ?? [],
                      plannedDate,
                      purpose,
                      access: accessMode,
                      observer: methodFlags.includes("method_bvlos") ? bvlosObserver : "",
                    })}
                    data-testid="create-plan-from-verdict"
                  >
                    この判定で飛行計画を作る
                  </PillLink>
                ) : null}
                <PillButton
                  variant="secondary"
                  small
                  icon="download"
                  onClick={() => void handlePdfExport()}
                  disabled={pdfBusy || isChecking || !canExportPdf}
                  title="この判定を A4 PDF レポートとして書き出し"
                >
                  {pdfBusy ? "PDF 生成中…" : "PDF 出力"}
                </PillButton>
              </div>
            }
          />

        </section>
      ) : null}

      {/* ─── MAP ───────────────────────────────── */}
      <div className="sb-area-map flex flex-col gap-2">
        {locationNote ? (
          <p className="sb-note-card is-ok flex flex-col gap-0.5 !text-sb-ink" role="status" data-testid="location-note">
            {locationNote.title ? <span className="text-sm font-bold">{locationNote.title}</span> : null}
            <span>{locationNote.text}</span>
            {locationNote.source ? <span className="text-sm text-sb-ink-3">出典：{locationNote.source}</span> : null}
          </p>
        ) : null}
        <RegulationMap center={center} prefCode={prefCode} onPick={handlePick} candidate={geoCandidate ?? locatedCircle} />
      </div>

      {/* ─── 手続き・規制ごとの判定・証跡（地図の下） ─── */}
      {result || checkError ? (
        <section className="sb-area-wide flex flex-col gap-6" data-testid="result-details" data-wording-scope="judgement" aria-label="手続きと規制ごとの判定">
          <VerdictSummary part="details" verdict={screenVerdict} pending={verdictPending} failed={conclusionFailed} />

          {!showResultDetail ? (
            <p data-testid="regulations-unavailable" className="sb-note-card border border-dashed border-sb-edge">
              この地点の地点判定の結果がまだありません（判定中、または失敗）。規制ごとの判定と証跡 ID は、地点判定が出てから表示します。
            </p>
          ) : null}

          {showResultDetail ? (
            <>
              {/* 低確信度警告 — 確信度が閾値未満のときだけ警告を出す */}
              {shouldWarnConfidence(result.overallConfidence) ? (
                <div className="sb-note-card is-warn">
                  <span className="font-bold text-sb-ink">確からしさ {CONFIDENCE_LABEL[result.overallConfidence]} — 現地での再確認を推奨</span>{" "}
                  この判定には、区域の位置または条文の読み取りの確からしさが低いデータが含まれます。飛行の前に、該当条文の原本（出典リンク）と現地状況をご確認ください。
                </div>
              ) : null}

              {/* disclaimer */}
              <div className="sb-note-card border-l-4 border-sb-ink !text-sb-ink-2">
                <span className="font-bold text-sb-ink">免責</span> {DISCLAIMER_JUDGEMENT}
              </div>

              {/* per-regulation cards */}
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-bold tracking-wide text-sb-ink">
                  関連条例（<span className="sb-num">{String(result.regulations.length).padStart(2, "0")}</span> 件）
                </h3>
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

              {/* 判定の見分け方（5 段。形と言葉をセットで。色だけに頼らない） */}
              <div className="sb-block-soft flex flex-col gap-2" aria-label="判定の見分け方" data-testid="verdict-legend" role="group">
                <p className="text-sm font-bold text-sb-ink">判定の見分け方</p>
                <div className="flex flex-wrap gap-2">
                  {VERDICT_LEGEND_ORDER.map((l) => (
                    <VerdictTag key={l} level={l}>
                      {VERDICT_LABEL[l]}
                    </VerdictTag>
                  ))}
                </div>
              </div>

              {/* audit meta */}
              <dl className="sb-block-soft grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-sb-ink-3 sm:grid-cols-4">
                <div className="col-span-2 flex flex-col gap-0.5">
                  <dt className="font-bold text-sb-ink-2">証跡 ID</dt>
                  <dd className="sb-num text-sm text-sb-ink" data-testid="evidence-id">
                    {result.evidenceId}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-bold text-sb-ink-2">確からしさ</dt>
                  <dd className="text-sm text-sb-ink">{CONFIDENCE_LABEL[result.overallConfidence]}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-bold text-sb-ink-2">判定の版</dt>
                  <dd className="sb-num text-sm text-sb-ink">{result.engineVersion}</dd>
                </div>
                <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-4">
                  <dt className="font-bold text-sb-ink-2">判定日時</dt>
                  <dd className="text-sm text-sb-ink">{new Date(result.checkedAt).toLocaleString("ja-JP")}</dd>
                </div>
              </dl>
            </>
          ) : null}
        </section>
      ) : null}

      {/* ─── 詳細な指定（座標・条件・飛行方法・地点の例）。入力欄は状態で動くので、form の外でも判定に使われる ─── */}
      <section className="sb-block sb-area-wide flex flex-col gap-5" aria-label="詳細な指定" data-testid="detail-block">
        <p className="sb-hint" data-testid="geocode-attribution">
            出典：
            {addressIndexAvailable
              ? "アドレス・ベース・レジストリ（デジタル庁）を加工して作成（鳥取県・島根県の町字・住居表示）／"
              : ""}
            国土地理院 住所検索
        </p>
        {/* 座標貼り付け・緯度経度の直接入力（住所のほかの指定方法） */}
        <fieldset className="flex flex-col gap-3">
          <legend className="sb-eyebrow">
            座標で指定する
            <span className="ml-2 font-normal text-sb-ink-3">（Google Maps 「座標をコピー」 / URL に対応）</span>
          </legend>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              aria-label="座標または Google マップの URL"
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
              className={`${fieldClass} sb-num`}
            />
            <button type="button" onClick={() => applyCombined(combined)} disabled={combined.trim().length === 0} className="sb-text-btn">
              反映
            </button>
          </div>
          {combinedStatus !== null ? (
            <p className={`sb-num text-sm font-bold ${combinedStatus.ok ? "text-sb-v-none-fg" : "text-sb-v-no-fg"}`} role="status">
              <span aria-hidden>{combinedStatus.ok ? "✓ " : "× "}</span>
              {combinedStatus.message}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="sb-field-text">緯度（北緯・度）</span>
              <input
                type="text"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                onKeyDown={submitOnEnter}
                onPaste={handleSplitPaste}
                className={`${fieldClass} sb-num`}
                placeholder="35.4278"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="sb-field-text">経度（東経・度）</span>
              <input
                type="text"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                onKeyDown={submitOnEnter}
                onPaste={handleSplitPaste}
                className={`${fieldClass} sb-num`}
                placeholder="133.3314"
              />
            </label>
          </div>
        </fieldset>

        {/* 機体・運航条件 — ClauseGraph の例外節と照合される。折りたたみが標準（上級設定）。
            既定 = 最も厳しい解釈でまず判定し、必要なときだけ展開する */}
        <details className="flex flex-col gap-3 border-t border-sb-rule pt-5 [&>summary::-webkit-details-marker]:hidden">
          <summary className="sb-eyebrow flex min-h-12 cursor-pointer select-none list-none items-center gap-1">
            機体・運航条件
            <span className="ml-2 font-normal text-sb-ink-3">（例外節を自動適用 / タップで展開）</span>
            <span aria-hidden className="ml-auto text-sm text-sb-ink-3 [details[open]_&]:rotate-90">
              ▸
            </span>
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* 機体重量 */}
              <label className="flex flex-col gap-1.5">
                <span className="sb-field-text">機体の重さ（g）</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={droneWeightInput}
                    onChange={(e) => setDroneWeightInput(e.target.value)}
                    className={`${fieldClass} sb-num flex-1`}
                    placeholder="例: 900／80（100g 未満の機体）"
                  />
                  {isModelAircraftWeight ? (
                    <span data-testid="model-aircraft-tag" className="sb-tag whitespace-nowrap font-bold text-sb-ink">
                      {MODEL_AIRCRAFT_WEIGHT_TAG}
                    </span>
                  ) : null}
                </div>
                <span
                  data-testid="model-aircraft-weight-note"
                  className={
                    isModelAircraftWeight
                      ? "sb-note-card is-warn "
                      : "text-sm leading-relaxed text-sb-ink-3"
                  }
                >
                  {isModelAircraftWeight
                    ? MODEL_AIRCRAFT_WEIGHT_NOTE
                    : "100g 未満の機体は模型航空機として判定します（航空法の無人航空機の規制は対象外。空港等の周辺と高い空域の手続き、小型無人機等飛行禁止法・条例は対象）"}
                </span>
              </label>

              {/* 運航目的 */}
              <label className="flex flex-col gap-1.5">
                <span className="sb-field-text">運航の目的</span>
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
                <span className="text-sm text-sb-ink-3">史跡・公園・県条例の例外節と照合</span>
              </label>
            </div>

            {/* 取得済み許可 */}
            <div className="flex flex-col gap-2">
              <span className="sb-field-text">取得済みの許可</span>
              <div data-testid="dips-permits" className="flex flex-col gap-2">
                <p className="text-sm leading-snug text-sb-ink-3">
                  国交省 DIPS の許可・承認（種類ごと。範囲・期間は照合しません。空港等周辺は個別の許可のため入力に含めません）
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{dipsItems.map(renderPermit)}</div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{permitItems.map(renderPermit)}</div>
              {/* 飛行禁止法では同意と通報が一組で要るため、2 つを隣り合わせて左の線でひとまとまりに見せる */}
              <div className="border-l-4 border-sb-edge pl-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{pairItems.map(renderPermit)}</div>
              </div>
            </div>
          </div>
        </details>

        {/* 飛行方法・運航条件（申請支援 診断の入力）
            既存フォームに地続きで追加。空港・DID 等の空域フラグは地点判定から自動導出されるため、
            ここではユーザーにしか分からない「飛行方法」と「立入管理措置／第三者上空」「飛行予定日」を集める。 */}
        <fieldset className="flex flex-col gap-3 border-t border-sb-rule pt-5">
          <legend className="sb-eyebrow">
            飛行の方法
            <span className="ml-2 font-normal text-sb-ink-3">（選ぶと判定に反映します）</span>
          </legend>

          {/* 空域フラグ（DID・空港等周辺・緊急用務空域）。判定由来の red は自動プリチェック。
              DID polygon データが未整備の環境でも、ここで手動チェックして診断できる。 */}
          <div className="flex flex-col gap-2">
            <span className="sb-field-text">空域（地点判定から自動／手動でも調整可）</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {AIRSPACE_FLAGS.map((flag) => {
                const isAuto = autoAirspaceFlags.includes(flag);
                const checked = effectiveAirspaceFlags.includes(flag);
                return (
                  <label key={flag} data-testid={`airspace-${flag}`} className={`sb-check-row ${checked ? "is-on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isAuto}
                      title={isAuto ? "地点判定から自動検出（この地点では外せません）" : undefined}
                      onChange={() => toggleAirspaceFlag(flag)}
                      className="sb-check mt-0.5"
                    />
                    <span className="text-sm font-bold leading-snug text-sb-ink">
                      {SPECIFIC_FLIGHT_FLAG_LABEL[flag]}
                      {isAuto ? <span className="sb-num ml-1 text-sm font-normal text-sb-ink-3">（自動検出）</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {/* DID 該当の三値（該当／非該当／未確認）。未確認は「申請不要」と判断しない。 */}
            {autoDidStatus !== undefined ? (
              <div className="sb-note-card flex flex-col gap-1.5" data-testid="did-status" data-wording-scope="judgement">
                <span>
                  DID 自動判定：
                  <span
                    className={`font-bold ${
                      autoDidStatus === "unverified" || diagnosis?.didDetail === "in_did_exclusion_unverified"
                        ? "text-sb-v-needs-fg"
                        : "text-sb-ink"
                    }`}
                  >
                    {formatDidDetermination(autoDidStatus, diagnosis?.didDetail, { droneWeightG: diagnosis?.droneWeightG })}
                  </span>
                  {autoDidStatus === "unverified"
                    ? "（DID データ未整備または判定不能。確認するまで要確認として扱います）"
                    : ""}
                </span>
                {autoDidStatus === "unverified" && !userAirspaceFlags.includes("airspace_did") ? (
                  <label className="flex min-h-12 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={didConfirmedNotApplicable}
                      onChange={(e) => setDidConfirmedNotApplicable(e.target.checked)}
                      className="sb-check"
                    />
                    地理院地図・DIPS で DID 非該当を確認済み
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 飛行方法チェックボックス群 */}
          <span className="sb-field-text">飛行方法（該当するものを選択）</span>
          <div className="grid grid-cols-2 gap-2">
            {FLIGHT_METHOD_FLAGS.map((flag) => {
              const checked = methodFlags.includes(flag);
              return (
                <label key={flag} className={`sb-check-row ${checked ? "is-on" : ""}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleMethodFlag(flag)} className="sb-check mt-0.5" />
                  <span className="text-sm font-bold leading-snug text-sb-ink">{SPECIFIC_FLIGHT_FLAG_LABEL[flag]}</span>
                </label>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* 飛行予定日 — 判定の条件に使う（申請支援が有効のときは、期限カレンダーの起算日にもなる）。 */}
            <label className="flex flex-col gap-1.5">
              <span className="sb-field-text flex items-center gap-2">飛行予定日</span>
              <input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} className={`${fieldClass} sb-num`} />
              <span className="text-sm leading-relaxed text-sb-ink-3">
                飛行の予定日（判定の条件に使います）
              </span>
            </label>

            {/* 立入管理措置／第三者上空（カテゴリー II/III 切り分け） */}
            <label className="flex flex-col gap-1.5">
              <span className="sb-field-text">立入管理措置／第三者上空</span>
              <select value={accessMode} onChange={(e) => setAccessMode(e.target.value as typeof accessMode)} className={fieldClass}>
                <option value="">未選択</option>
                <option value="yes">立入管理措置あり（第三者の上空で飛ばさない＝カテゴリー II）</option>
                <option value="no_third_party">立入管理措置なし（第三者の上空＝カテゴリー III／レベル4）</option>
              </select>
              <span className="text-sm leading-relaxed text-sb-ink-3">第三者上空はレベル4（一等＋第一種機体認証が必須）の切り分けに使用</span>
            </label>
          </div>

          {/* 目視外飛行を選んでいる場合のみ補助者の有無を尋ねる（プリフィルの運航条件に反映）。 */}
          {methodFlags.includes("method_bvlos") ? (
            <label className="flex flex-col gap-1.5">
              <span className="sb-field-text">目視外飛行の補助者</span>
              <select value={bvlosObserver} onChange={(e) => setBvlosObserver(e.target.value as typeof bvlosObserver)} className={fieldClass}>
                <option value="">未選択</option>
                <option value="with">補助者あり</option>
                <option value="without">補助者なし（より上位の運航要件）</option>
              </select>
              <span className="text-sm leading-relaxed text-sb-ink-3">補助者の有無を判定の条件に使います</span>
            </label>
          ) : null}

          {diagnoseError ? (
            <p className="sb-note-card is-error" role="alert">
              {diagnoseError}
            </p>
          ) : null}
        </fieldset>

        {/* 地点の例 */}
        <div className="flex flex-col gap-3 border-t border-sb-rule pt-5">
          <p className="sb-eyebrow">
            地点の例
            <span className="ml-2 font-normal text-sb-ink-3">（県別。押すとその地点で判定）</span>
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {EXAMPLE_LOCATIONS.map((preset) => (
              <li key={preset.id}>
                <button
                  type="button"
                  onClick={() => selectPreset(preset)}
                  title={preset.hint}
                  className="sb-check-row h-full w-full flex-col !gap-1 text-left"
                >
                  <span className="flex items-center gap-2">
                    <span className="sb-tag !min-h-6 !px-2  font-bold text-sb-ink">{preset.group}</span>
                    <span className="text-sm font-bold text-sb-ink">{preset.name}</span>
                  </span>
                  <span className="text-sm leading-snug text-sb-ink-3">{preset.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* 免責（入力前＝初期状態でも常に表示）。判定結果や診断パネルが出る前から、
            「本機能は補助であり最終確認は DIPS／航空局で」を画面に出しておく契約
            （sprint-4：免責を入力前・結果表示・チェックリスト・プリフィルの全画面状態に表示）。 */}
        <p className="sb-note-card border-l-4 border-sb-ink ">
          <span className="font-bold text-sb-ink">免責</span> {DISCLAIMER_JUDGEMENT}
        </p>
      </section>

      {/* ─── 申請支援 診断（必要手続きチェックリスト） ─────────────────────────────────
          フラグ APPLICATION_SUPPORT_ENABLED が無効（既定・本番）のときは描かない。/api/diagnose の呼び出しは続ける
          （4 段の結論はこの応答から作る）。止めたコードは消さない（Sprint 18 §4.5）。 */}
      {applicationSupport && diagnosis ? (
        <div className="sb-area-wide">
          <DiagnosisPanel
            diagnosis={diagnosis}
            plannedDate={plannedDate}
            doneMap={doneMap}
            onToggleDone={handleToggleProcedureDone}
            manualChoice={manualChoice}
            onManualChoiceChange={handleManualChoiceChange}
          />
        </div>
      ) : null}

      {/* ─── HISTORY ───────────────────────────────── */}
      {history.length > 0 ? (
        <section className="sb-block sb-area-wide flex flex-col gap-4" aria-labelledby="history-heading">
          <div className="flex items-end justify-between gap-3 border-b border-sb-rule pb-2">
            <div className="flex flex-col gap-0.5">
              <h3 id="history-heading" className="text-base font-bold text-sb-ink">
                判定履歴
                <span className="ml-2 text-sm font-normal text-sb-ink-3">（ローカル保存 / 最大 50 件）</span>
              </h3>
              <p className="sb-num text-sm text-sb-ink-3">{history.length} 件</p>
            </div>
            <button type="button" onClick={handleClearHistory} className="sb-text-btn">
              全削除
            </button>
          </div>
          <ul className="flex flex-col divide-y divide-sb-rule">
            {history.slice(0, 10).map((h) => {
              // 判定の表示（Sprint 11d C5）：新形式は 4 段の言葉、旧形式は旧版の値であることを明示する。
              const rowPending = h.runId !== undefined && h.runId === diagPendingRunId;
              const vd = historyVerdictDisplay(h, { pending: rowPending });
              // 判定中の行は、前の入力の診断から来た表示（カテゴリー・DID・手続きの件数・診断の証跡 ID）も出さない（Sprint 11f B3）。
              // 判定未確定の行（診断の失敗・時間切れ、開き直した行）も同じ。判定を外した診断の値（前の入力のもの）は出さない。
              // 保存値からの導出なので、画面を閉じて開き直しても出ない。旧形式（legacy）の表示は変えない。
              const ds = historyDiagnosisDetail(h, { pending: rowPending });
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
              const procCount = ds?.procedureCount;
              const methodCount = h.diagnosisInput?.methodFlags?.length ?? 0;
              return (
                <li key={h.runId ?? h.evidenceId} className="flex items-center gap-2 py-2" data-testid="history-item">
                  <button
                    type="button"
                    onClick={() => restoreFromHistory(h)}
                    className="flex min-h-12 flex-1 items-center gap-3 rounded-sb-m px-1 text-left transition-colors hover:bg-sb-hover"
                    title={
                      applicationSupport
                        ? `証跡 ${h.evidenceId} を復元して再判定（申請支援の条件・進捗も復元）`
                        : `証跡 ${h.evidenceId} を復元して再判定`
                    }
                  >
                    {vd.level ? (
                      <VerdictSign level={vd.level} />
                    ) : (
                      <span aria-hidden className="inline-block h-3.5 w-3.5 shrink-0 border border-dashed border-sb-ink-3" />
                    )}
                    <span className="flex flex-1 flex-col leading-tight">
                      <span
                        data-testid="history-verdict"
                        data-legacy={vd.legacy ? "true" : "false"}
                        {...(vd.pending ? { "data-pending": "true" } : {})}
                        data-level={vd.level ?? ""}
                        className="text-sm font-bold text-sb-ink-2"
                      >
                        {vd.label}
                        {vd.unknownCount !== undefined && vd.unknownCount > 0
                          ? `・判定不能 ${vd.unknownCount} 件`
                          : ""}
                      </span>
                      <span className="text-sm text-sb-ink">
                        {h.resolvedAddress ?? `${h.loc.lat.toFixed(4)}°N · ${h.loc.lng.toFixed(4)}°E`}
                      </span>
                      <span className="sb-num text-sm text-sb-ink-3">
                        {dateStr}
                        {h.ctx?.droneWeightG !== undefined ? ` · ${h.ctx.droneWeightG}g` : ""}
                        {h.ctx?.purpose && h.ctx.purpose !== "general" ? ` · ${PURPOSE_SHORT[h.ctx.purpose] ?? h.ctx.purpose}` : ""}
                        {h.ctx?.pilotPermits && h.ctx.pilotPermits.length > 0 ? ` · 許可${h.ctx.pilotPermits.length}件` : ""}
                        {applicationSupport && ds ? ` · ${catShort[ds.category] ?? ds.category}` : ""}
                        {ds?.didStatus
                          ? ` · DID:${formatDidDetermination(ds.didStatus, ds.didDetail, { droneWeightG: h.ctx?.droneWeightG })}`
                          : ""}
                        {applicationSupport && procCount !== undefined
                          ? completedCount > 0
                            ? ` · 手続き${completedCount}/${procCount}`
                            : ` · 手続き${procCount}件`
                          : ""}
                        {methodCount > 0 ? ` · 方法×${methodCount}` : ""}
                        {h.diagnosisInput?.plannedDate ? ` · 予定:${h.diagnosisInput.plannedDate}` : ""}
                        {" · "}
                        {h.evidenceId}
                        {ds?.diagnosisEvidenceId && ds.diagnosisEvidenceId !== h.evidenceId
                          ? ` / diag:${ds.diagnosisEvidenceId}`
                          : ""}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveHistory(h.evidenceId)}
                    className="sb-text-btn !min-w-12 !px-0"
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
            <p className="sb-num text-sm text-sb-ink-3">
              ... and {history.length - 10} more (oldest will be evicted at 50)
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
