// 許可の入力に対する表示の補足（Sprint 11c）。判定結果（note・status）は変えず、
// 画面のカードと PDF の表示だけに使う。画面と PDF で同じ文を出すため、文言はここ 1 か所に置く。

import type { RegulationWithStatus } from "./core";

/** 空港等周辺の規制の ID（航空法第132条の85第1項第1号）。 */
export const AIRPORT_REGULATION_ID = "aviation-law-airport";

/**
 * 「国交省 DIPS」の許可を入力しても空港等周辺の規制には当てない理由。
 *
 * 一次資料：
 * - 国土交通省「無人航空機の飛行許可・承認手続」 https://www.mlit.go.jp/koku/koku_fr10_000042.html
 * - 無人航空機に係る審査要領（国空航第690号・国空機第930号、令和8年4月1日最終改正 国空無機第350041号）
 * - 航空法第132条の85第1項第1号・同条第4項（空港等の周辺の飛行は国土交通大臣の許可を要する）
 * 確認日：2026-10-20（Sprint 11c 実装日）。
 *
 * ※要再確認：実装の当日、作業環境から上記 URL の本文を取得できず、「空港等周辺の飛行に
 *   空港の設置管理者等との調整が要ること」と「包括申請（包括許可）で空港等周辺を対象にできない
 *   扱い」を本文で照合できていない。文言は docs/spec.md §13.9.5（2026-10-20 ユーザー承認）に
 *   基づく。一次資料で確かめたら本コメントの確認日を更新し、※要再確認を外すこと。
 */
export const AIRPORT_MLIT_PERMIT_NOT_APPLIED_NOTE =
  "空港等周辺の飛行は、空港ごとの個別の許可と、空港の設置管理者等との調整が必要とされています。入力した DIPS の許可は空港等周辺には当てていません。";

/**
 * 空港等周辺の補足を出すか。DIPS（mlit）を入力し、空港等周辺の規制が red または yellow のとき。
 */
export const shouldShowAirportMlitNote = (
  regulation: Pick<RegulationWithStatus, "id" | "status">,
  pilotPermits: readonly string[] | undefined,
): boolean =>
  regulation.id === AIRPORT_REGULATION_ID &&
  (regulation.status === "red" || regulation.status === "yellow") &&
  (pilotPermits ?? []).includes("mlit");
