import {
  COVERAGE_SUMMARY,
  DATASET_IDS,
  getDataset,
  SENSITIVE_FACILITY_BUFFER_M,
  SMALL_DRONE_LAW_FACILITIES,
} from "@soraban/regulations";
import { addressIndexAvailable } from "@soraban/regulations/address";
import { RegulationChecker } from "@/components/regulation-checker";

// 自治体別の件数を「米子8 + 境港4 + 出雲5」のような短い列に整形する。
// 自治体の件数は COVERAGE_SUMMARY から出す（収録を増やすと自動で反映される）。
const formatMuniBreakdown = (
  entries: ReadonlyArray<readonly [string, number]>,
): string =>
  entries
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name.replace(/[市区町村]$/, "")}${n}`)
    .join(" + ");

const PREF_NUISANCE_LABEL = COVERAGE_SUMMARY.prefectureNuisanceNames.join("・");
const PARK_BREAKDOWN = formatMuniBreakdown(COVERAGE_SUMMARY.municipalParkCounts);
const HERITAGE_BREAKDOWN = formatMuniBreakdown(
  COVERAGE_SUMMARY.municipalHeritageCounts,
);
const SENSITIVE_BREAKDOWN = formatMuniBreakdown(
  COVERAGE_SUMMARY.municipalSensitiveCounts,
);

type CoverageRow = {
  readonly source: "国" | "都道府県" | "市町村";
  readonly title: string;
  readonly coverage: string;
  readonly dataset: string;
  readonly count: string;
};

const COVERAGE_LAYERS: readonly CoverageRow[] = [
  {
    source: "国",
    title: "航空法第132条の85 — DID（人口集中地区）",
    coverage: "鳥取県・島根県",
    dataset: `国土数値情報 A16 令和2年国勢調査ベース（工業専用地域を除外：告示第435号、2026-07-01 適用）`,
    count: `本体データ ${getDataset(DATASET_IDS.did).bundled ? "同梱済み" : "未同梱（判定は未確認に縮退）"}・確認日 ${getDataset(DATASET_IDS.did).verifiedAt}`,
  },
  {
    source: "国",
    title: "航空法第132条の85 — 空港等周辺",
    coverage: "山陰・但馬",
    dataset: "空港の周辺区域は公開資料からの概算",
    count: "6 空港",
  },
  {
    source: "国",
    title: "小型無人機等飛行禁止法 — 対象施設の周辺地域",
    coverage: "鳥取県・島根県で指定を確認した施設",
    dataset: "敷地境界からおおむね 1,000m（改正法 2026-07-14 施行）。敷地形状は概算",
    count: `${SMALL_DRONE_LAW_FACILITIES.length} 施設・確認日 ${getDataset(DATASET_IDS.smallDroneLawFacilities).verifiedAt}`,
  },
  {
    source: "市町村",
    title: "都市公園条例",
    coverage: `${COVERAGE_SUMMARY.municipalParkNames.length} 市町村（収録を拡大中）`,
    dataset: "公園の区域は公開資料からの概算",
    count: `計 ${COVERAGE_SUMMARY.totalParks} 公園（${PARK_BREAKDOWN}）`,
  },
  {
    source: "市町村",
    title: "文化財保護法125条 / 自治体文化財条例",
    coverage: `${COVERAGE_SUMMARY.municipalHeritageCounts.length} 市町村`,
    dataset: "国指定史跡・県指定史跡（区域は概算）",
    count: `計 ${COVERAGE_SUMMARY.totalHeritage} 件（${HERITAGE_BREAKDOWN}）`,
  },
  {
    source: "都道府県",
    title: `${PREF_NUISANCE_LABEL} 迷惑行為等防止条例`,
    coverage: `${PREF_NUISANCE_LABEL}全域`,
    dataset: `公衆が密集する施設の周辺 ${SENSITIVE_FACILITY_BUFFER_M}m（施設の位置は概算）`,
    count: `計 ${COVERAGE_SUMMARY.totalSensitive} 施設（${SENSITIVE_BREAKDOWN}：市役所・病院・駅・温泉街・大社）`,
  },
];

// 出典・管轄を表す細い角バッジ。色は付けずインクの濃淡と文字（国・都道府県・市町村）で区別する。
const sourceTone: Record<CoverageRow["source"], string> = {
  国: "border-ink/40 text-ink",
  都道府県: "border-brand-500 text-brand-700",
  市町村: "border-rule text-ink-soft",
};

// 住所検索の同梱索引（アドレス・ベース・レジストリ）が空なら、その出典を示さない（使っていない出典を出さない）。
const ADDRESS_INDEX_AVAILABLE = addressIndexAvailable();

// 運営者・利用の範囲・対象地域。スマホでは「項目名｜内容」の 2 列、PC では 3 段の並びにする。
const SITE_FACTS: ReadonlyArray<readonly [string, string]> = [
  ["運営者", "フューチャーテック株式会社"],
  ["利用の範囲", "現在は社内での試験運用中"],
  [
    "対象地域",
    `現在は鳥取県・島根県（条例データを収録した市町村 ${COVERAGE_SUMMARY.municipalParkNames.length}）`,
  ],
];

/** 節の見出し。日本語の見出しだけを置き、補足は右（スマホでは下）に小さく添える。 */
function SectionHeading({
  id,
  title,
  note,
}: {
  readonly id: string;
  readonly title: string;
  readonly note?: string;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-rule pb-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <h2 id={id} className="text-lg font-medium tracking-wide text-ink sm:text-xl">
        {title}
      </h2>
      {note ? <p className="text-xs text-ink-mute">{note}</p> : null}
    </div>
  );
}

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-10 px-4 py-8 sm:gap-14 sm:px-6 sm:py-14">
      {/* ============================ 見出し ============================
          サービス名 → 目的 → できること → 運営者・利用の範囲・対象地域 → 免責 の順に読ませ、
          そのすぐ下に判定の入口（住所・座標の入力と地図）を置く。 */}
      <header className="flex flex-col">
        <div className="flex min-w-0 flex-col gap-5">
          <h1 className="flex flex-col gap-1.5 text-ink">
            <span className="text-4xl font-medium leading-tight tracking-[0.06em] sm:text-5xl">
              そらばん
            </span>
            <span className="text-base font-medium leading-snug text-ink-soft sm:text-xl">
              ドローン飛行の可否判定と運航管理
            </span>
          </h1>
          {/* 誰のための道具で、使うと何が得られるか（Sprint 11a B1）。地域名はここに書かず site-facts の対象地域にだけ書く。 */}
          {/* 1 文目（対象）を墨、2 文目（得られること）を薄墨にして、誰のための道具か→何ができるかの順に読ませる。
              運航管理の一文は本文と同じ幅で一段小さく添え、細い罫で本文と分ける（提供中の機能と読まれないように）。 */}
          <div className="flex max-w-3xl flex-col gap-3">
            <p
              data-testid="site-lead"
              className="text-[15px] leading-[1.9] text-ink-soft [word-break:auto-phrase] sm:text-base sm:leading-[1.95]"
            >
              <span className="text-ink">業務でドローンを飛ばす事業者・操縦者のための道具です。</span>
              飛ばす前に、その地点がどの法令・条例に当たり、どの手続きが要るかを一度に確かめ、出典つきの記録として残せます。
            </p>
            {/* 運航管理の位置付け（Sprint 11a B2）。提供中の機能として画面名・件数・予定の日付は書かない。 */}
            <p
              data-testid="site-ops-note"
              className="border-l border-rule pl-3 text-xs leading-relaxed text-ink-mute [word-break:auto-phrase]"
            >
              運航管理（飛行計画・通報・飛行日誌）は、社内で試験運用しながら整えています。
            </p>
          </div>

          <dl
            data-testid="site-facts"
            className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-y border-rule py-3 text-[13px] sm:grid-cols-3 sm:gap-x-6 sm:gap-y-0 sm:py-4"
          >
            {SITE_FACTS.map(([label, value]) => (
              <div key={label} className="contents sm:flex sm:flex-col sm:gap-1">
                <dt className="text-xs text-ink-mute">{label}</dt>
                <dd className="text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          <p
            data-testid="site-disclaimer"
            className="max-w-2xl border-l-2 border-brand-700 pl-3 text-[13px] leading-relaxed text-ink-soft"
          >
            判定結果は参考情報です。飛行の可否は、国土交通省（DIPS 2.0）・警察・各自治体で最終確認してください。
          </p>
        </div>

      </header>

      {/* ============================ 判定 ============================ */}
      <section aria-labelledby="checker-heading" className="flex flex-col gap-5">
        <SectionHeading
          id="checker-heading"
          title="地点を判定する"
          note="住所・座標・地図のクリックで地点を指定できます"
        />
        <RegulationChecker addressIndexAvailable={ADDRESS_INDEX_AVAILABLE} />
      </section>

      {/* ============================ 収録範囲 ============================ */}
      <section aria-labelledby="coverage-heading" className="flex flex-col gap-5">
        <SectionHeading
          id="coverage-heading"
          title="収録している規制とデータ"
          note="件数と確認日は現在の収録内容から表示しています"
        />
        <p className="max-w-2xl text-sm leading-relaxed text-ink-soft">
          地点を指定すると、航空法（人口集中地区・空港等周辺）、小型無人機等飛行禁止法、都道府県と市町村の条例に照らした判定を、データの出典と確認日とともに表示します。
        </p>

        <ul className="grid grid-cols-1 gap-px overflow-hidden border border-rule bg-rule lg:grid-cols-2">
          {COVERAGE_LAYERS.map((layer) => (
            <li key={layer.title} className="flex flex-col gap-2 bg-paper px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className={`inline-flex shrink-0 items-center border px-1.5 py-px text-[11px] font-medium ${sourceTone[layer.source]}`}
                >
                  {layer.source}
                </span>
                <span className="text-xs text-ink-mute">{layer.coverage}</span>
              </div>
              <p className="text-[15px] font-medium leading-snug text-ink">{layer.title}</p>
              <p className="text-xs leading-relaxed text-ink-mute">
                {layer.dataset}
                <span aria-hidden className="mx-1.5 text-rule">
                  ／
                </span>
                <span className="tnum">{layer.count}</span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ============================ 免責・フッター ============================ */}
      <section aria-labelledby="disclaimer-heading" className="flex flex-col gap-2 border-t border-rule pt-5">
        <h2 id="disclaimer-heading" className="text-xs font-medium text-ink-soft">
          免責事項
        </h2>
        <p className="text-xs leading-relaxed text-ink-mute">
          本ツールは参考情報であり、飛行可否を最終的に保証するものではありません。緊急用務空域等の動的情報は反映していません。実運用前に必ず{" "}
          <a
            href="https://www.dips.mlit.go.jp/portal/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-700 underline underline-offset-2"
          >
            国土交通省 DIPS
          </a>
          、警察庁、各自治体の最新情報をご確認ください。自治体の条例データの一部は手作業で収録しており、各データに確認日と確からしさ（低・中・高）を付けています。
        </p>
      </section>

      <footer className="mt-auto flex flex-col gap-2 border-t border-rule pt-5 text-[11px] text-ink-mute">
        <p className="text-xs text-ink-soft">
          © 2026 フューチャーテック株式会社
          <span className="ml-3 text-ink-mute">鳥取県西伯郡日吉津村</span>
        </p>
        <p className="leading-relaxed">
          出典：国土交通省「国土数値情報（人口集中地区 A16 令和2年、用途地域 A29 令和元年度）」、空港は公開資料（地形図・空港要覧）からの概算（そらばん作成）、国土地理院ジオコーダ・住所検索・ベクタータイル、{ADDRESS_INDEX_AVAILABLE ? "アドレス・ベース・レジストリ（デジタル庁）を加工して作成（住所検索の索引、公共データ利用規約 第1.0版）、" : ""}警察庁・防衛省（小型無人機等飛行禁止法）、鳥取県・島根県内 12 市町村例規集（鳥取・米子・倉吉・境港・三朝・湯梨浜・八頭・松江・出雲・安来・雲南・大田）、鳥取県・島根県例規集、文化庁国指定文化財等データベース
        </p>
      </footer>
    </div>
  );
}
