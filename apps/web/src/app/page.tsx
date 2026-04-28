import { RegulationChecker } from "@/components/regulation-checker";

const COVERAGE_LAYERS: ReadonlyArray<{
  readonly source: "国" | "都道府県" | "市町村";
  readonly title: string;
  readonly coverage: string;
  readonly dataset: string;
  readonly count: string;
}> = [
  {
    source: "国",
    title: "航空法第132条 — DID（人口集中地区）",
    coverage: "全国",
    dataset: "国土数値情報 A16-15 / 平成27年国勢調査ベース",
    count: "47都道府県・約 4,800 ポリゴン",
  },
  {
    source: "国",
    title: "航空法 — 空港等周辺",
    coverage: "全国",
    dataset: "国土数値情報 C28-20",
    count: "108 空港",
  },
  {
    source: "国",
    title: "小型無人機等飛行禁止法 — 重要施設",
    coverage: "美保基地のみ（Phase 0）",
    dataset: "300m / 1.5km バッファ",
    count: "1 件（Phase 1 で 170+ 施設対応）",
  },
  {
    source: "市町村",
    title: "都市公園条例（自治体レジストリ方式）",
    coverage: "米子市・境港市（Phase 1 拡大中）",
    dataset: "公園台帳簡易ポリゴン",
    count: "12 公園（米子8 + 境港4、Phase 1 で正規ポリゴン置換）",
  },
  {
    source: "市町村",
    title: "文化財保護法125条 / 米子市文化財条例",
    coverage: "米子市",
    dataset: "国指定史跡 + 県指定",
    count: "2 件（米子城跡、福市遺跡）",
  },
  {
    source: "都道府県",
    title: "鳥取県迷惑行為等防止条例",
    coverage: "鳥取県全域",
    dataset: "公衆密集地 100m バッファ",
    count: "7 施設（米子4 + 境港3：市役所・病院・駅・温泉街）",
  },
];

const ROADMAP: ReadonlyArray<{
  readonly phase: string;
  readonly when: string;
  readonly scope: string;
  readonly status: "current" | "next" | "future";
}> = [
  {
    phase: "Phase 0",
    when: "4月末",
    scope: "米子市 PoC",
    status: "current",
  },
  {
    phase: "Phase 1",
    when: "〜7月",
    scope: "山陰主要 12 自治体・α版",
    status: "next",
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
  { category: "Frontend", value: "Next.js 16 (App Router / React Server Components) / TypeScript strict / Tailwind v4" },
  {
    category: "キャッシュ戦略",
    value:
      "Next.js 16 Cache Components（'use cache' ディレクティブ + cacheLife('days') + cacheTag によるタグ無効化）。Phase 1 のスクレイパ更新時に updateTag/revalidateTag で即時反映",
  },
  { category: "Map", value: "MapLibre GL + 国土地理院ベクタータイル / 6 レイヤー個別トグル" },
  { category: "Geo", value: "ハーバサイン距離・Ray-casting Point-in-Polygon・PostGIS互換ポリゴン" },
  { category: "判定エンジン", value: "soraban-0.2.0-clausegraph（条文の例外節を機械可読 ClauseGraph 化）" },
  { category: "監査トレイル", value: "SHA-256 evidenceId 採番（座標・時刻・適用規制IDを正規化してハッシュ）" },
  { category: "ジオコーディング", value: "国土地理院 LonLatToAddress / アドレス検索 API" },
  { category: "データ整形", value: "Shell + jq による国土数値情報 (GML/Shapefile) → GeoJSON パイプライン" },
  {
    category: "アーキテクチャ",
    value:
      "Jamstack（静的 Markup + クライアント JS + サーバレス Route Handlers）／pnpm monorepo (web / regulations / geo / db / scraper)",
  },
];

const sourceTone = {
  国: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:ring-indigo-800",
  都道府県:
    "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800",
  市町村:
    "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-950 dark:text-teal-200 dark:ring-teal-800",
} as const;

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10 sm:py-16">
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-50 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            社内限定 / Phase 0 PoC
          </span>
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            特許出願準備中
          </span>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-500">
            engine: soraban-0.2.0-clausegraph
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
            そらばん ／ Soraban
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
            山陰の業務ドローン、6 規制レイヤーを 1 クリック判定。
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            航空法（DID・空港）、小型無人機等飛行禁止法、自治体条例（都市公園・指定史跡・公衆密集地）を地理空間ポリゴンで重ね、信号機で総合判定。<span className="text-zinc-500 dark:text-zinc-400">「空（飛行空域）×&nbsp;番（守護）×&nbsp;算盤（瞬時計算）」を 4 音に圧縮した造語。</span>
          </p>
        </div>
        <p className="max-w-2xl text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          自治体条例レイヤーは既存サービス全社の盲点。米子市 3 カテゴリ条例（都市公園・文化財保護・県迷惑行為）を機械可読化し、特許コアの「マルチソース規制を地理空間 DB で統合判定する手法」の実証実装を行っています。
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            現在のカバレッジ（6 規制レイヤー）
          </h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            国 3 / 都道府県 1 / 市町村 2
          </span>
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {COVERAGE_LAYERS.map((layer) => (
            <li
              key={layer.title}
              className="flex flex-col gap-1 rounded-lg border border-zinc-100 p-3 dark:border-zinc-900"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${sourceTone[layer.source]}`}
                >
                  {layer.source}
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {layer.coverage}
                </span>
              </div>
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                {layer.title}
              </p>
              <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                {layer.dataset} ・ {layer.count}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900/40">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          段階展開ロードマップ
        </h2>
        <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {ROADMAP.map((r) => (
            <li
              key={r.phase}
              className={`flex flex-col gap-0.5 rounded-lg border p-3 ${
                r.status === "current"
                  ? "border-zinc-900 bg-white shadow-sm dark:border-zinc-100 dark:bg-zinc-950"
                  : r.status === "next"
                    ? "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950"
                    : "border-dashed border-zinc-300 bg-transparent dark:border-zinc-700"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-xs font-semibold ${
                    r.status === "current"
                      ? "text-zinc-900 dark:text-zinc-50"
                      : "text-zinc-600 dark:text-zinc-300"
                  }`}
                >
                  {r.phase}
                </span>
                {r.status === "current" ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0 text-[9px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                    NOW
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{r.when}</p>
              <p className="text-xs leading-snug text-zinc-700 dark:text-zinc-200">
                {r.scope}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <RegulationChecker />

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          採用技術 / 判定アルゴリズム
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {TECH_STACK.map((item) => (
            <div key={item.category} className="flex flex-col gap-0.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
                {item.category}
              </dt>
              <dd className="text-xs leading-snug text-zinc-700 dark:text-zinc-300">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
        <p>
          <span className="font-semibold">免責: </span>
          本ツールは参考情報であり、飛行可否を最終的に保証するものではありません。緊急用務空域等の動的情報は反映していません。実運用前に必ず{" "}
          <a
            href="https://www.dips.mlit.go.jp/portal/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            国土交通省 DIPS
          </a>
          、警察庁、各自治体の最新情報をご確認ください。Phase 0 段階の自治体条例データは手動シードを含み、verifiedAt と確信度（low/medium/high）で監査可能性を担保しています。
        </p>
      </section>

      <footer className="mt-auto flex flex-col gap-1 border-t border-zinc-200 pt-6 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
        <p>© 2026 そらばん（Soraban）／ 奥田憲章 ・ 個人開発・社内検討段階</p>
        <p>
          出典: 国土交通省「国土数値情報（人口集中地区 A16-15、空港 C28-20）」、国土地理院ジオコーダ・ベクタータイル、警察庁・防衛省（小型無人機等飛行禁止法）、米子市例規集、鳥取県例規集、文化庁国指定文化財等データベース
        </p>
      </footer>
    </div>
  );
}
