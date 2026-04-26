import { RegulationChecker } from "@/components/regulation-checker";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10 sm:py-16">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          そらばん（Soraban）
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
          ドローン規制チェック
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          山陰の業務ドローン運用者向けコンプライアンス統合 SaaS。緯度・経度を入力すると、その地点で関係しそうな国・都道府県・市町村の条例を一覧化し、信号機 UI で総合判定を表示します。
        </p>
      </header>

      <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Phase 0
          </span>
          <span className="font-medium text-zinc-800 dark:text-zinc-200">現在のカバレッジ</span>
        </div>
        <ul className="ml-1 list-inside list-disc space-y-1">
          <li>
            <span className="font-medium">国レベル:</span>{" "}
            航空法第132条 DID（全国・国土数値情報 A16-15 / 平成27年国勢調査ベース）／
            航空法 空港等周辺（全国108空港・国土数値情報 C28-20）／
            小型無人機等飛行禁止法（美保基地のみ。全国170+施設対応はPhase 1で予定）
          </li>
          <li>
            <span className="font-medium">都道府県条例:</span> 未対応（Phase 1 で鳥取県・島根県から段階対応予定）
          </li>
          <li>
            <span className="font-medium">市町村条例:</span> 米子市のみ（湊山公園・東山公園の簡易ポリゴン）
          </li>
        </ul>
        <p className="text-zinc-600 dark:text-zinc-400">
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
          、警察庁、各自治体の最新情報をご確認ください。
        </p>
      </section>

      <RegulationChecker />

      <footer className="mt-auto border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        © 2026 そらばん（Soraban）— 社内開発中（PoC）／ 出典: 国土交通省「国土数値情報（人口集中地区 A16-15、空港 C28-20）」、国土地理院ジオコーダ
      </footer>
    </div>
  );
}
