import Image from "next/image";
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
    title: "航空法第132条 — DID（人口集中地区）",
    coverage: "鳥取県・島根県",
    dataset: `国土数値情報 A16 令和2年国勢調査ベース（工業専用地域を除外：告示第435号、2026-07-01 適用）`,
    count: `本体データ ${getDataset(DATASET_IDS.did).bundled ? "同梱済み" : "未同梱（判定は未確認に縮退）"}・確認日 ${getDataset(DATASET_IDS.did).verifiedAt}`,
  },
  {
    source: "国",
    title: "航空法 — 空港等周辺",
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

// 出典・管轄を表す細い角バッジ。色は付けずインクの濃淡だけで階層を作る。
const sourceTone: Record<CoverageRow["source"], string> = {
  国: "border-ink/40 text-ink",
  都道府県: "border-brand-500 text-brand-700",
  市町村: "border-rule text-ink-soft",
};

// 住所検索の同梱索引（アドレス・ベース・レジストリ）が空なら、その出典を示さない（使っていない出典を出さない）。
const ADDRESS_INDEX_AVAILABLE = addressIndexAvailable();

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-10 px-4 py-8 sm:gap-16 sm:px-6 sm:py-20">
      {/* ============================ HERO ============================ */}
      <header className="relative flex flex-col gap-5 sm:gap-8">
        {/* ドローン線画 — hero の主題として敷く透かし。
            z-0 で文字より背後。PNG 側に alpha が焼き込み済（scripts/drone-png-alpha.mjs）
            なので白地は完全に透明、blend mode 不要。dark:invert でダークモード時は
            線を白色に反転（paper が暗い時もコントラストを確保）。
            幅は viewport に合わせて連続的に拡大: モバイル w-40 (160px) →
            sm w-[28rem] → md w-[40rem] → lg w-[52rem] → xl w-[60rem]。
            h-auto で 2:1 アスペクトを保つので、どの幅でもクリッピングなし。 */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 z-0"
        >
          <Image
            src="/drone-01.png"
            alt=""
            width={3047}
            height={1422}
            priority
            sizes="(min-width: 1280px) 30rem, (min-width: 1024px) 26rem, (min-width: 768px) 20rem, (min-width: 640px) 14rem, 20vw"
            className="h-auto w-20 opacity-80 dark:invert sm:w-[14rem] md:w-[20rem] lg:w-[26rem] xl:w-[30rem]"
          />
        </div>

        <div className="relative z-10 flex flex-col gap-3">
          <h1 className="flex flex-col gap-2 text-ink">
            <span className="font-display text-4xl font-light leading-[0.95] tracking-tight sm:text-6xl">
              そらばん
            </span>
            <span className="text-base font-medium leading-snug sm:text-xl">
              山陰のドローン飛行の可否判定と運航管理
            </span>
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-ink-soft sm:text-base">
            地点を指定すると、航空法（人口集中地区・空港等周辺）、小型無人機等飛行禁止法、鳥取県・島根県と県内市町村の条例に照らした判定を、データの出典と確認日とともに表示します。
          </p>
          <p
            data-testid="site-disclaimer"
            className="max-w-2xl border-l-2 border-brand-700 pl-3 text-xs leading-relaxed text-ink-soft sm:text-sm"
          >
            判定結果は参考情報です。飛行の可否は、国土交通省（DIPS 2.0）・警察・各自治体で最終確認してください。
          </p>
        </div>

        <dl
          data-testid="site-facts"
          className="relative z-10 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-rule pt-4 text-xs text-ink-mute sm:grid-cols-3"
        >
          <div className="flex flex-col gap-0.5">
            <dt className="eyebrow !text-[9px]">運営者</dt>
            <dd className="text-ink-soft">フューチャーテック株式会社</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="eyebrow !text-[9px]">利用の範囲</dt>
            <dd className="text-ink-soft">現在は社内での試験運用中</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="eyebrow !text-[9px]">対象地域</dt>
            <dd className="text-ink-soft">
              鳥取県・島根県（条例データを収録した市町村 {COVERAGE_SUMMARY.municipalParkNames.length}）
            </dd>
          </div>
        </dl>
      </header>

      {/* ============================ COVERAGE ============================ */}
      <section className="flex flex-col gap-5">
        <div className="flex items-end justify-between border-b border-rule pb-3">
          <div className="flex flex-col gap-1">
            <p className="eyebrow">§01</p>
            <h2 className="font-display text-xl font-light text-ink sm:text-2xl">
              <span aria-hidden className="bearing-mark" />
              収録している規制とデータ
            </h2>
          </div>
          <p className="font-mono text-[11px] tnum text-ink-mute">
            国 {COVERAGE_LAYERS.filter((l) => l.source === "国").length} / 都道府県 {COVERAGE_LAYERS.filter((l) => l.source === "都道府県").length} / 市町村 {COVERAGE_LAYERS.filter((l) => l.source === "市町村").length}
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-px overflow-hidden bg-rule lg:grid-cols-2">
          {COVERAGE_LAYERS.map((layer, idx) => (
            <li
              key={layer.title}
              className="flex flex-col gap-2 bg-paper px-5 py-4"
            >
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[10px] tnum text-ink-mute">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span
                  className={`inline-flex items-center border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider ${sourceTone[layer.source]}`}
                >
                  {layer.source}
                </span>
                <span className="text-[11px] text-ink-mute">{layer.coverage}</span>
              </div>
              <p className="font-display text-base font-medium leading-snug text-ink">
                {layer.title}
              </p>
              <p className="text-[11px] leading-relaxed text-ink-mute">
                {layer.dataset}
                <span className="mx-1.5 text-rule">·</span>
                {layer.count}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ============================ CHECKER ============================ */}
      <section className="flex flex-col gap-5">
        <div className="flex items-end justify-between border-b border-rule pb-3">
          <div className="flex flex-col gap-1">
            <p className="eyebrow">§02</p>
            <h2 className="font-display text-xl font-light text-ink sm:text-2xl">
              <span aria-hidden className="bearing-mark" />
              判定する
            </h2>
          </div>
          <p className="font-mono text-[11px] text-ink-mute">
            地図をクリック · 座標を貼り付け · 住所を検索
          </p>
        </div>
        <RegulationChecker addressIndexAvailable={ADDRESS_INDEX_AVAILABLE} />
      </section>

      {/* ============================ DISCLAIMER + FOOTER ============================ */}
      <section className="border-t border-double border-rule pt-5">
        <p className="text-[11px] leading-relaxed text-ink-mute">
          <span className="eyebrow !text-[9px]">免責 ·</span>{" "}
          本ツールは参考情報であり、飛行可否を最終的に保証するものではありません。緊急用務空域等の動的情報は反映していません。実運用前に必ず{" "}
          <a
            href="https://www.dips.mlit.go.jp/portal/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-700 underline-offset-2 hover:underline"
          >
            国土交通省 DIPS
          </a>
          、警察庁、各自治体の最新情報をご確認ください。自治体の条例データの一部は手作業で収録しており、各データに確認日と確からしさ（低・中・高）を付けています。
        </p>
      </section>

      <footer className="mt-auto flex flex-col gap-2 border-t border-rule pt-5 text-[10px] font-mono text-ink-mute">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>© 2026 フューチャーテック株式会社</span>
          <span aria-hidden>—</span>
          <span className="tnum">base · 35°26′03″N · 133°22′50″E（鳥取県西伯郡日吉津村）</span>
        </div>
        <p className="text-[10px] leading-relaxed text-ink-mute/80">
          出典: 国土交通省「国土数値情報（人口集中地区 A16 令和2年、用途地域 A29 令和元年度）」、空港は公開地形図・空港要覧からの目視取り（Soraban 作成）、国土地理院ジオコーダ・住所検索・ベクタータイル、{ADDRESS_INDEX_AVAILABLE ? "アドレス・ベース・レジストリ（デジタル庁）を加工して作成（住所検索の索引、公共データ利用規約 第1.0版）、" : ""}警察庁・防衛省（小型無人機等飛行禁止法）、鳥取県・島根県内 12 市町村例規集（鳥取・米子・倉吉・境港・三朝・湯梨浜・八頭・松江・出雲・安来・雲南・大田）、鳥取県・島根県例規集、文化庁国指定文化財等データベース
        </p>
      </footer>
    </div>
  );
}
