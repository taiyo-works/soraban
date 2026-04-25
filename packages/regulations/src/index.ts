export type RegulationSource = "国" | "都道府県" | "市町村";

export type RegulationStatus = "red" | "yellow" | "green";

export type Regulation = {
  readonly id: string;
  readonly source: RegulationSource;
  readonly authority: string;
  readonly title: string;
  readonly summary: string;
  readonly url?: string;
};

export type RegulationWithStatus = Regulation & {
  readonly status: RegulationStatus;
  readonly note: string;
};

export type RegulationCheckResult = {
  readonly overall: RegulationStatus;
  readonly regulations: readonly RegulationWithStatus[];
  readonly checkedAt: string;
};

const YONAGO_MOCK_REGULATIONS: readonly RegulationWithStatus[] = [
  {
    id: "aviation-law-did",
    source: "国",
    authority: "国土交通省",
    title: "航空法第132条 — 人口集中地区(DID)上空の飛行",
    summary:
      "国勢調査に基づく人口集中地区（DID）の上空での無人航空機の飛行は、原則として国土交通大臣の許可が必要。米子市役所周辺は DID に該当します。",
    url: "https://www.mlit.go.jp/koku/koku_fr10_000041.html",
    status: "red",
    note: "DID 上空での無許可飛行は禁止。事前に DIPS 経由で許可申請が必要です。",
  },
  {
    id: "miho-airbase-no-fly",
    source: "国",
    authority: "防衛省・警察庁",
    title: "小型無人機等飛行禁止法 — 自衛隊美保基地周辺",
    summary:
      "自衛隊美保基地は重要施設として小型無人機等飛行禁止法の対象。基地敷地および周囲おおむね 300m 上空での飛行は禁止。",
    url: "https://www.npa.go.jp/bureau/security/kogata_muzin/index.html",
    status: "yellow",
    note: "米子市役所は基地から離れていますが、ミッションエリアによっては禁止区域に入る可能性があるため要確認。",
  },
  {
    id: "yonago-park-ordinance",
    source: "市町村",
    authority: "米子市",
    title: "米子市都市公園条例 — 都市公園内での無人航空機の使用",
    summary:
      "米子市内の都市公園内では、利用者の安全確保のため無人航空機（ドローン）の飛行は原則として禁止または事前申請が必要。",
    url: "https://www.city.yonago.lg.jp/",
    status: "green",
    note: "現在の地点は都市公園に該当しないため、本条例の制限対象外です。",
  },
];

const computeOverall = (items: readonly RegulationWithStatus[]): RegulationStatus => {
  if (items.some((r) => r.status === "red")) return "red";
  if (items.some((r) => r.status === "yellow")) return "yellow";
  return "green";
};

export type LatLngInput = {
  readonly lat: number;
  readonly lng: number;
};

export const checkRegulations = (_location: LatLngInput): RegulationCheckResult => {
  const regulations = YONAGO_MOCK_REGULATIONS;
  return {
    overall: computeOverall(regulations),
    regulations,
    checkedAt: new Date().toISOString(),
  };
};

export const STATUS_LABEL: Readonly<Record<RegulationStatus, string>> = {
  red: "飛行不可",
  yellow: "要確認・要許可",
  green: "飛行可能",
};

export const SOURCE_LABEL: Readonly<Record<RegulationSource, string>> = {
  国: "国",
  都道府県: "都道府県",
  市町村: "市町村",
};
