import { RegulationChecker } from "@/components/regulation-checker";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10 sm:py-16">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          そらばん（Soraban）
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
          ドローン規制チェック
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          山陰の業務ドローン運用者向けコンプライアンス統合 SaaS。緯度・経度を入力すると、その地点で関係しそうな国・都道府県・市町村の条例を一覧化し、信号機 UI で総合判定を表示します。
          <span className="ml-1 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            Phase 0 / mock データ
          </span>
        </p>
      </header>

      <RegulationChecker />

      <footer className="mt-auto border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        © 2026 そらばん（Soraban）— 社内開発中（PoC）
      </footer>
    </div>
  );
}
