export type ScrapeSource = {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly authority: string;
  readonly source: "国" | "都道府県" | "市町村";
};

export const SOURCES: readonly ScrapeSource[] = [
  {
    id: "mlit-uav-rules",
    label: "国土交通省・無人航空機の飛行ルール",
    url: "https://www.mlit.go.jp/koku/koku_fr10_000041.html",
    authority: "国土交通省",
    source: "国",
  },
  {
    id: "npa-laws-index",
    label: "警察庁・法令一覧（小型無人機等飛行禁止法 探索）",
    url: "https://www.npa.go.jp/laws/index.html",
    authority: "警察庁",
    source: "国",
  },
  {
    id: "tottori-pref",
    label: "鳥取県・無人航空機関連ページ（検索）",
    url: "https://www.pref.tottori.lg.jp/site/search.html?cx=&cof=&ie=UTF-8&q=%E3%83%89%E3%83%AD%E3%83%BC%E3%83%B3",
    authority: "鳥取県",
    source: "都道府県",
  },
  {
    id: "yonago-city",
    label: "米子市・公式サイトトップ（探索）",
    url: "https://www.city.yonago.lg.jp/",
    authority: "米子市",
    source: "市町村",
  },
];

export const KEYWORD_PATTERN = /(無人航空機|ドローン|UAV|飛行禁止|飛行ルール|飛行許可|条例)/u;
