import Image from "next/image";
import {
  COVERAGE_SUMMARY,
  DATASET_IDS,
  getDataset,
  SENSITIVE_FACILITY_BUFFER_M,
  SMALL_DRONE_LAW_FACILITIES,
} from "@soraban/regulations";
import { RegulationChecker } from "@/components/regulation-checker";

// 自治体別の件数を「米子8 + 境港4 + 出雲5」のような短い列に整形する。
// レジストリに自治体を1行追加するだけで COVERAGE_SUMMARY 経由で自動反映される。
const formatMuniBreakdown = (
  entries: ReadonlyArray<readonly [string, number]>,
): string =>
  entries
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name.replace(/[市区町村]$/, "")}${n}`)
    .join(" + ");

const PARK_MUNI_LABEL = COVERAGE_SUMMARY.municipalParkNames.join("・");
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
    dataset: "空港 手描き seed（国土数値情報 C28 へ置換予定）",
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
    title: "都市公園条例（自治体レジストリ方式）",
    coverage: `${COVERAGE_SUMMARY.municipalParkNames.length} 市町村（Phase 1 拡大中）`,
    dataset: "公園台帳簡易ポリゴン",
    count: `計 ${COVERAGE_SUMMARY.totalParks} 公園（${PARK_BREAKDOWN}、Phase 1 で正規ポリゴン置換）`,
  },
  {
    source: "市町村",
    title: "文化財保護法125条 / 自治体文化財条例",
    coverage: `${COVERAGE_SUMMARY.municipalHeritageCounts.length} 市町村`,
    dataset: "国指定史跡 + 県指定",
    count: `計 ${COVERAGE_SUMMARY.totalHeritage} 件（${HERITAGE_BREAKDOWN}）`,
  },
  {
    source: "都道府県",
    title: `${PREF_NUISANCE_LABEL} 迷惑行為等防止条例`,
    coverage: `${PREF_NUISANCE_LABEL}全域`,
    dataset: `公衆密集地 ${SENSITIVE_FACILITY_BUFFER_M}m バッファ`,
    count: `計 ${COVERAGE_SUMMARY.totalSensitive} 施設（${SENSITIVE_BREAKDOWN}：市役所・病院・駅・温泉街・大社）`,
  },
];

const ROADMAP: ReadonlyArray<{
  readonly phase: string;
  readonly when: string;
  readonly scope: string;
  readonly status: "done" | "current" | "next" | "future";
}> = [
  {
    phase: "Phase 0",
    when: "4月末",
    scope: "米子市 PoC",
    status: "done",
  },
  {
    phase: "Phase 1",
    when: "〜7月",
    scope: `山陰主要自治体 α 版（現在 ${COVERAGE_SUMMARY.municipalParkNames.length} 市 / 目標 12 市）`,
    status: "current",
  },
  {
    phase: "Phase 2",
    when: "〜10月",
    scope: "山陰全域 38〜42 自治体・β版・課金開始",
    status: "future",
  },
  {
    phase: "Phase 3",
    when: "〜12月",
    scope: "正式公開・ぼうさいこくたい 2026",
    status: "future",
  },
  {
    phase: "Phase 4",
    when: "2027〜",
    scope: "中国地方 → 全国",
    status: "future",
  },
];

const TECH_STACK: ReadonlyArray<{
  readonly category: string;
  readonly value: string;
}> = [
  {
    category: "Frontend",
    value:
      "Next.js 16 (App Router / RSC) / TypeScript strict / Tailwind v4 / Cache Components",
  },
  {
    category: "キャッシュ戦略",
    value:
      "'use cache' + cacheLife('days') + cacheTag。Phase 1 のスクレイパ更新時に updateTag/revalidateTag で即時反映",
  },
  {
    category: "Map",
    value: "MapLibre GL + 国土地理院ベクタータイル / 6 レイヤー個別トグル",
  },
  {
    category: "Geo",
    value: "ハーバサイン距離・Ray-casting Point-in-Polygon・PostGIS互換ポリゴン",
  },
  {
    category: "判定エンジン",
    value:
      "soraban-0.2.0-clausegraph（条文の例外節を機械可読 ClauseGraph 化）",
  },
  {
    category: "監査トレイル",
    value:
      "SHA-256 evidenceId 採番（座標・時刻・適用規制IDを正規化してハッシュ）",
  },
  {
    category: "ジオコーディング",
    value: "国土地理院 LonLatToAddress / アドレス検索 API",
  },
  {
    category: "データ整形",
    value: "Shell + jq による国土数値情報 (GML/Shapefile) → GeoJSON パイプライン",
  },
  {
    category: "アーキテクチャ",
    value:
      "Jamstack (静的 Markup + クライアント JS + サーバレス Route Handlers) / pnpm monorepo (web / regulations / geo / db / scraper)",
  },
];

// 出典・管轄を表す細い角バッジ。色は付けずインクの濃淡だけで階層を作る。
const sourceTone: Record<CoverageRow["source"], string> = {
  国: "border-ink/40 text-ink",
  都道府県: "border-brand-500 text-brand-700",
  市町村: "border-rule text-ink-soft",
};

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

        {/* 製図の title block — ドローンの右肩に被せる小さな脇書き。
            z-30 で透かしより前。 */}
        <aside
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 z-30 hidden flex-col items-end gap-0.5 font-mono text-[10px] uppercase tracking-[0.3em] text-ink-mute sm:flex"
        >
          <span className="text-[8px]">Subject — UAV / aerial unit</span>
          <span>N 35°26′03″</span>
          <span>E 133°22′50″</span>
          <span className="text-[8px]">Hiezu / Tottori</span>
        </aside>

        <div className="relative z-10 flex flex-col gap-3">
          <p className="eyebrow">Soraban — Aerial Compliance Atlas</p>
          <div className="flex items-end gap-2 sm:gap-3">
            <h1 className="font-display text-4xl font-light leading-[0.95] tracking-tight text-ink sm:text-6xl">
              そらばん
            </h1>
            <span className="font-display pb-1 text-sm italic text-ink-mute sm:pb-2 sm:text-base">
              / Soraban
            </span>
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-ink-soft sm:text-base">
            山陰の業務ドローン、6 規制レイヤーを 1 クリックで判定。
            <br className="hidden sm:block" />
            航空法（DID・空港）／小型無人機等飛行禁止法／自治体条例（都市公園・指定史跡・公衆密集地）を地理空間ポリゴンで重ね、信号機で総合判定します。
          </p>
        </div>

        {/* メタ表示。バッジ感を減らし、ドラフター文書の脇書きとして配置 */}
        <dl className="relative z-10 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-rule pt-4 text-xs font-mono text-ink-mute sm:grid-cols-4">
          <div className="flex flex-col gap-0.5">
            <dt className="eyebrow !text-[9px]">Status</dt>
            <dd className="text-ink-soft">社内限定 PoC ／ Phase 1</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="eyebrow !text-[9px]">Engine</dt>
            <dd className="tnum text-ink-soft">soraban-0.2.0-clausegraph</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="eyebrow !text-[9px]">Patent</dt>
            <dd className="text-ink-soft">
              <span aria-hidden className="bearing-mark" />
              出願準備中
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="eyebrow !text-[9px]">Coverage</dt>
            <dd className="tnum text-ink-soft">
              {COVERAGE_LAYERS.length} layers ／ {COVERAGE_SUMMARY.municipalParkNames.length} cities
            </dd>
          </div>
        </dl>

        <p className="relative z-10 max-w-3xl border-l-2 border-brand-700 bg-paper/40 pl-4 text-xs leading-relaxed text-ink-mute">
          自治体条例レイヤーは既存サービス全社の盲点。{PARK_MUNI_LABEL} 3 カテゴリ条例（都市公園・文化財保護・県迷惑行為）を機械可読化し、特許コアの「マルチソース規制を地理空間 DB で統合判定する手法」の実証実装を行っています。自治体は registry に 1 行追加するだけで判定エンジン・地図・カバレッジ表示すべてに自動反映。
        </p>
      </header>

      {/* ============================ COVERAGE ============================ */}
      <section className="flex flex-col gap-5">
        <div className="flex items-end justify-between border-b border-rule pb-3">
          <div className="flex flex-col gap-1">
            <p className="eyebrow">§01 — Coverage</p>
            <h2 className="font-display text-xl font-light text-ink sm:text-2xl">
              <span aria-hidden className="bearing-mark" />
              現在のカバレッジ
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
            <p className="eyebrow">§02 — Compliance check</p>
            <h2 className="font-display text-xl font-light text-ink sm:text-2xl">
              <span aria-hidden className="bearing-mark" />
              判定する
            </h2>
          </div>
          <p className="font-mono text-[11px] text-ink-mute">
            click map · paste coords · search address
          </p>
        </div>
        <RegulationChecker />
      </section>

      {/* ============================ ROADMAP ============================ */}
      <section className="flex flex-col gap-5">
        <div className="flex items-end justify-between border-b border-rule pb-3">
          <div className="flex flex-col gap-1">
            <p className="eyebrow">§03 — Roadmap</p>
            <h2 className="font-display text-xl font-light text-ink sm:text-2xl">
              <span aria-hidden className="bearing-mark" />
              段階展開
            </h2>
          </div>
        </div>

        <ol className="grid grid-cols-1 gap-px overflow-hidden bg-rule sm:grid-cols-2 lg:grid-cols-5">
          {ROADMAP.map((r) => {
            const tone =
              r.status === "current"
                ? "bg-brand-700 text-paper"
                : r.status === "done"
                  ? "bg-paper-soft text-ink"
                  : r.status === "next"
                    ? "bg-paper text-ink"
                    : "bg-paper text-ink-mute";
            return (
              <li
                key={r.phase}
                className={`flex min-h-[8rem] flex-col gap-1.5 px-4 py-4 ${tone}`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-xs uppercase tracking-wider">
                    {r.phase}
                  </span>
                  {r.status === "current" ? (
                    <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-paper/70">
                      ▸ now
                    </span>
                  ) : r.status === "done" ? (
                    <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-mute">
                      ✓ done
                    </span>
                  ) : null}
                </div>
                <p
                  className={`font-mono text-[10px] tnum ${r.status === "current" ? "text-paper/80" : "text-ink-mute"}`}
                >
                  {r.when}
                </p>
                <p
                  className={`mt-auto text-xs leading-snug ${r.status === "current" ? "text-paper" : ""}`}
                >
                  {r.scope}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ============================ TECH STACK ============================ */}
      <section className="flex flex-col gap-5">
        <div className="flex items-end justify-between border-b border-rule pb-3">
          <div className="flex flex-col gap-1">
            <p className="eyebrow">§04 — Implementation</p>
            <h2 className="font-display text-xl font-light text-ink sm:text-2xl">
              <span aria-hidden className="bearing-mark" />
              採用技術 / 判定アルゴリズム
            </h2>
          </div>
        </div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {TECH_STACK.map((item) => (
            <div key={item.category} className="flex flex-col gap-1 border-l border-rule pl-3">
              <dt className="eyebrow">{item.category}</dt>
              <dd className="text-xs leading-relaxed text-ink-soft">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ============================ DISCLAIMER + FOOTER ============================ */}
      <section className="border-t border-double border-rule pt-5">
        <p className="text-[11px] leading-relaxed text-ink-mute">
          <span className="eyebrow !text-[9px]">Disclaimer ·</span>{" "}
          本ツールは参考情報であり、飛行可否を最終的に保証するものではありません。緊急用務空域等の動的情報は反映していません。実運用前に必ず{" "}
          <a
            href="https://www.dips.mlit.go.jp/portal/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-700 underline-offset-2 hover:underline"
          >
            国土交通省 DIPS
          </a>
          、警察庁、各自治体の最新情報をご確認ください。Phase 0/1 段階の自治体条例データは手動シードを含み、verifiedAt と確信度（low/medium/high）で監査可能性を担保しています。
        </p>
      </section>

      <footer className="mt-auto flex flex-col gap-2 border-t border-rule pt-5 text-[10px] font-mono text-ink-mute">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>© 2026 Soraban</span>
          <span aria-hidden>—</span>
          <span>奥田憲章 · 個人開発・社内検討段階</span>
          <span aria-hidden>—</span>
          <span className="tnum">base · 35°26′03″N · 133°22′50″E（鳥取県西伯郡日吉津村）</span>
        </div>
        <p className="text-[10px] leading-relaxed text-ink-mute/80">
          出典: 国土交通省「国土数値情報（人口集中地区 A16 令和2年、用途地域 A29 令和元年度）」、空港は公開地形図・空港要覧からの目視取り（Soraban 作成）、国土地理院ジオコーダ・ベクタータイル、警察庁・防衛省（小型無人機等飛行禁止法）、鳥取県・島根県内 12 市町村例規集（鳥取・米子・倉吉・境港・三朝・湯梨浜・八頭・松江・出雲・安来・雲南・大田）、鳥取県・島根県例規集、文化庁国指定文化財等データベース
        </p>
      </footer>
    </div>
  );
}
