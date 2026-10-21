// /api/check・/api/diagnose の処理本体（Sprint 7）。
// 地点判定（runCheck）を引数で受け取り、統合テストでデータの読み込み口を差し替えられるようにする。
// route.ts は本番の runRegulationCheck を渡すだけ。
import { NextResponse } from "next/server";
import { isValidLatLng } from "@soraban/geo";
import {
  SPECIFIC_FLIGHT_FLAG_LABEL,
  type FlightContext,
  type SpecificFlightFlag,
} from "@soraban/regulations";
import { isEvidenceLogEnabled, type DbEnv } from "@soraban/db";
import { runDiagnosis, type RunCheck } from "./diagnose-core";
import { runEvidenceWriteSafely, type WriteEvidence } from "./evidence-log";

export type { RunCheck } from "./diagnose-core";

// FlightContext を信頼境界で正規化する。
// 不正値はサニタイズし、type 安全な形に直してから評価器へ渡す。
const parseFlightContext = (raw: unknown): FlightContext | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const ctx: { -readonly [K in keyof FlightContext]: FlightContext[K] } = {};

  if (typeof obj["droneWeightG"] === "number" && Number.isFinite(obj["droneWeightG"]) && obj["droneWeightG"] >= 0) {
    ctx.droneWeightG = obj["droneWeightG"];
  }
  if (Array.isArray(obj["pilotPermits"])) {
    const permits = obj["pilotPermits"].filter((p): p is string => typeof p === "string");
    if (permits.length > 0) ctx.pilotPermits = permits;
  }
  if (typeof obj["purpose"] === "string" && obj["purpose"].length > 0) {
    ctx.purpose = obj["purpose"];
  }
  if (typeof obj["droneClass"] === "string" && obj["droneClass"].length > 0) {
    ctx.droneClass = obj["droneClass"];
  }
  return Object.keys(ctx).length > 0 ? ctx : undefined;
};

/** 応答後に実行する処理の登録口。route.ts は Next.js の after を渡す。 */
export type ScheduleAfterResponse = (task: () => Promise<void>) => void;

export type CheckPostOptions = {
  /** 証跡の書き込み（Sprint 8）。未指定なら書かない（DB 未設定時は route.ts が渡さない）。 */
  readonly writeEvidence?: WriteEvidence;
  /** 応答後の実行方法。未指定なら待たずに起動するだけ（テスト用）。 */
  readonly schedule?: ScheduleAfterResponse;
  /** EVIDENCE_LOG を読む環境変数（既定は process.env）。 */
  readonly env?: DbEnv;
};

const fireAndForget: ScheduleAfterResponse = (task) => {
  void task();
};

export const handleCheckPost = async (
  req: Request,
  runCheck: RunCheck,
  options: CheckPostOptions = {},
): Promise<Response> => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const lat = Number((body as { lat?: unknown })?.lat);
  const lng = Number((body as { lng?: unknown })?.lng);
  if (!isValidLatLng({ lat, lng })) {
    return NextResponse.json({ error: "invalid lat/lng" }, { status: 400 });
  }
  const ctx = parseFlightContext((body as { ctx?: unknown })?.ctx);
  const result = await runCheck({ lat, lng }, ctx);

  // 証跡の書き込みは応答を待たせない。失敗しても応答の本文・状態コードは変えない。
  const write = options.writeEvidence;
  if (write && isEvidenceLogEnabled(options.env ?? process.env)) {
    try {
      (options.schedule ?? fireAndForget)(() => runEvidenceWriteSafely(write, result, { lat, lng }));
    } catch (e) {
      console.error(`[evidence_log] schedule failed: ${e instanceof Error ? e.name : "Error"}`);
    }
  }
  return NextResponse.json(result);
};

// 既存 /api/check を壊さず、診断は /api/diagnose に分離する（spec §10-1 推奨）。
//
// 入力: { lat, lng, droneWeightG?, flags?, plannedDate?, accessControl?, thirdPartyOverflight?,
//        pilotPermits?, purpose? }
//   - pilotPermits・purpose（Sprint 11d B2）は地点判定と判定（verdict）に当てる。手続きの一覧は消さない。
//   - flags はユーザーが選んだ飛行方法フラグ（夜間・目視外・30m・催し・危険物・投下・150m）と、
//     ユーザー指定（プリセットの curated 値を含む）の空域フラグ。
//   - 空域フラグ（DID・空港）はサーバ側で信号機判定から自動導出して合流する。
//     エンジンの DID 判定が「該当」「非該当」のときは、ユーザー指定の airspace_did を使わない（Sprint 7）。
// 出力: ApplicationDiagnosis（procedures 配列を含む）。
const VALID_FLAGS = new Set<SpecificFlightFlag>(
  Object.keys(SPECIFIC_FLIGHT_FLAG_LABEL) as SpecificFlightFlag[],
);

// 信頼境界で flags をサニタイズ。未知の文字列は捨てる。
const parseFlags = (raw: unknown): SpecificFlightFlag[] => {
  if (!Array.isArray(raw)) return [];
  const out: SpecificFlightFlag[] = [];
  for (const v of raw) {
    if (typeof v === "string" && VALID_FLAGS.has(v as SpecificFlightFlag)) {
      out.push(v as SpecificFlightFlag);
    }
  }
  return out;
};

const parseWeight = (raw: unknown): number | undefined => {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  return undefined;
};

const parseBool = (raw: unknown): boolean | undefined =>
  typeof raw === "boolean" ? raw : undefined;

// ISO 日付（YYYY-MM-DD）の最低限の形式チェック。
const parsePlannedDate = (raw: unknown): string | undefined =>
  typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;

export const handleDiagnosePost = async (req: Request, runCheck: RunCheck): Promise<Response> => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const obj = (body ?? {}) as Record<string, unknown>;
  const lat = Number(obj["lat"]);
  const lng = Number(obj["lng"]);
  if (!isValidLatLng({ lat, lng })) {
    return NextResponse.json({ error: "invalid lat/lng" }, { status: 400 });
  }

  const droneWeightG = parseWeight(obj["droneWeightG"]);
  const accessControl = parseBool(obj["accessControl"]);
  const thirdPartyOverflight = parseBool(obj["thirdPartyOverflight"]);
  const bvlosWithObserver = parseBool(obj["bvlosWithObserver"]);
  const plannedDate = parsePlannedDate(obj["plannedDate"]);
  // 許可・目的（Sprint 11d B2）。判定の組み立ては diagnose-core.ts（runDiagnosis）。
  const permitCtx = parseFlightContext({
    pilotPermits: obj["pilotPermits"],
    purpose: obj["purpose"],
  });

  const { response } = await runDiagnosis(
    {
      lat,
      lng,
      ...(droneWeightG !== undefined ? { droneWeightG } : {}),
      flags: parseFlags(obj["flags"]),
      ...(plannedDate !== undefined ? { plannedDate } : {}),
      ...(accessControl !== undefined ? { accessControl } : {}),
      ...(thirdPartyOverflight !== undefined ? { thirdPartyOverflight } : {}),
      ...(bvlosWithObserver !== undefined ? { bvlosWithObserver } : {}),
      // ユーザーが地理院地図等で「DID 非該当」を確認済みと明示した場合のみ true。
      didConfirmedNotApplicable: obj["didConfirmedNotApplicable"] === true,
      ...(permitCtx?.pilotPermits !== undefined ? { pilotPermits: permitCtx.pilotPermits } : {}),
      ...(permitCtx?.purpose !== undefined ? { purpose: permitCtx.purpose } : {}),
    },
    runCheck,
  );
  return NextResponse.json(response);
};
