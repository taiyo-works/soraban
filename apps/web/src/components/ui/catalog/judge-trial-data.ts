// Sample data for the judgement screen trial (`/ops/design?view=judge`). Everything here is made up for the trial: the
// place names, the areas on the sample map and the wording of the results. Nothing is read from the engine or a database.
import type { ItemVerdict } from "@soraban/regulations";

export type JudgeSp = "sheet" | "tabs" | "fold";
export const JUDGE_SP: readonly { readonly id: JudgeSp; readonly label: string }[] = [
  { id: "sheet", label: "シート" },
  { id: "tabs", label: "タブ" },
  { id: "fold", label: "折りたたみ" },
];

// The layer list follows the way DIPS groups its items (航空法 / 小型無人機等飛行禁止法 / その他), plus a group for what
// そらばん adds (ordinances). The group names are a proposal for the order of the list; the DIPS item names were not checked here.
export type LayerGroupId = "aviation" | "drone-law" | "other" | "soraban";
export const LAYER_GROUPS: readonly { readonly id: LayerGroupId; readonly label: string }[] = [
  { id: "aviation", label: "航空法" },
  { id: "drone-law", label: "小型無人機等飛行禁止法" },
  { id: "other", label: "その他" },
  { id: "soraban", label: "そらばん追加" },
];

export const JUDGE_LAYERS = [
  { id: "airport", group: "aviation", label: "空港等の周辺", short: "空港等" },
  { id: "did", group: "aviation", label: "人口集中地区（DID）", short: "DID" },
  { id: "industrial", group: "aviation", label: "工業専用地域（DID から除外）", short: "工専除外" },
  { id: "drone-law", group: "drone-law", label: "対象施設の周辺（おおむね 1,000m）", short: "対象施設" },
  { id: "park", group: "soraban", label: "都市公園", short: "都市公園" },
  { id: "heritage", group: "soraban", label: "指定文化財", short: "文化財" },
  { id: "crowd", group: "soraban", label: "公衆が密集する施設（100m）", short: "密集施設" },
] as const satisfies readonly { readonly id: string; readonly group: LayerGroupId; readonly label: string; readonly short: string }[];
export type JudgeLayerId = (typeof JUDGE_LAYERS)[number]["id"];

/** The "その他" group has no layer of its own in this sample: the emergency airspace is dynamic data the engine does not use. */
export const OTHER_GROUP_NOTE = "緊急用務空域は動的な情報のため、地図には出しません。";

export type Point = { readonly x: number; readonly y: number };
export const DEFAULT_POINT: Point = { x: 38, y: 52 };
/** Where the sample "current location" is (outside the sample DID area, so the result changes). */
export const GEO_POINT: Point = { x: 68, y: 40 };
export const ADDRESS_POINT: Point = { x: 44, y: 66 };

export type PointSource = "default" | "address" | "geo" | "map";

/** The sample DID area (the polygon drawn on the map, as a box). */
const inDid = (p: Point): boolean => p.x >= 25 && p.x <= 51 && p.y >= 30 && p.y <= 81;

export type JudgeRow = {
  readonly id: string;
  readonly group: LayerGroupId;
  readonly label: string;
  readonly state: string;
  readonly level: ItemVerdict;
  readonly basis: string;
};
export type JudgeOutcome = {
  readonly level: ItemVerdict;
  /** The line shown when the result is folded to one line. */
  readonly line: string;
  readonly procedures: readonly { readonly label: string; readonly due: string }[];
  readonly rows: readonly JudgeRow[];
};

const BASIS_DID = "航空法第132条の85。国土数値情報 A16（令和2年国勢調査）。確認日 2026-10-19（見本の文言）";

export function judgeAt(p: Point): JudgeOutcome {
  const did = inDid(p);
  const rows: readonly JudgeRow[] = [
    {
      id: "did",
      group: "aviation",
      label: "人口集中地区（DID）",
      state: did ? "要手続き" : "手続き不要",
      level: did ? "needs_procedure" : "no_procedure",
      basis: did ? `この地点は DID の中です。飛行には国土交通大臣の許可・承認が要ります。${BASIS_DID}` : `この地点は DID の外です。${BASIS_DID}`,
    },
    { id: "airport", group: "aviation", label: "空港等の周辺", state: "手続き不要", level: "no_procedure", basis: "最寄りの空港まで十分に離れています（見本の文言）。" },
    { id: "drone-law", group: "drone-law", label: "対象施設の周辺", state: "手続き不要", level: "no_procedure", basis: "対象施設の敷地・周辺 1,000m の外です（見本の文言）。" },
    {
      id: "park",
      group: "soraban",
      label: "都市公園条例",
      state: did ? "確認が要る" : "手続き不要",
      level: did ? "unknown" : "no_procedure",
      basis: did ? "公園の区域は概算です。公園管理者への確認を勧めます（見本の文言）。" : "該当する公園はありません（見本の文言）。",
    },
    { id: "heritage", group: "soraban", label: "指定文化財", state: "手続き不要", level: "no_procedure", basis: "該当する史跡はありません（見本の文言）。" },
    { id: "crowd", group: "soraban", label: "公衆が密集する施設", state: "手続き不要", level: "no_procedure", basis: "100m 以内に該当する施設はありません（見本の文言）。" },
  ];
  if (did) {
    return {
      level: "needs_procedure",
      line: "DID の上空。許可が要ります",
      procedures: [
        { label: "飛行許可（DID 上空）", due: "飛行予定日より前（見本）" },
        { label: "公園管理者への確認", due: "飛行前" },
      ],
      rows,
    };
  }
  return { level: "no_procedure", line: "該当する規制はありません", procedures: [], rows };
}

export const PLACE_LABEL: Readonly<Record<PointSource, string>> = {
  default: "加茂町（見本）",
  address: "試験町一丁目（見本）",
  geo: "現在地",
  map: "地図で指定した地点",
};

export const DISCLAIMER = "判定結果は参考情報です。飛行の可否は、国土交通省（DIPS 2.0）・警察・各自治体で最終確認してください。";
