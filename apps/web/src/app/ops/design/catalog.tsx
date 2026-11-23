import { VERDICT_LABEL } from "@soraban/regulations";
import type { ItemVerdict } from "@soraban/regulations";
import "./catalog.css";
import { HeroIllustration } from "@/components/hero-illustration";
import { PillButton, SectionHead, StatusLabel, VerdictBig, VerdictTag } from "@/components/ui/sb-parts";
import { SkeletonCard } from "@/components/ui/skeleton";
import { CatalogAttrs } from "./catalog-attrs";
import { CatalogChecks, CatalogChoices, CatalogInputs, CatalogSheet, CatalogStates } from "./catalog-parts";
import { BottomNavSample, CardArrowCandidates, DotShapeCandidates, LineChips, LogoCandidates, PrepSection, PrimaryChips, StateKinds, TypeScale, WizardOrder } from "./catalog-specimens";

// デザイン見本 v2（Sprint 16-1。G-1 でユーザーが配色を決める）。認証・DB・外部通信なし。静的な部品の並べだけで、操作の状態は持たない。
// 設定は URL: ?mode=field（現場の値）／?theme=dark（休眠している暗の確認用）／?veil=1（日差しの模擬：白い膜 rgba(255,255,255,.35)）。

export type CatalogConfig = { readonly mode: "field" | null; readonly theme: "dark" | null; readonly veil: boolean };

export const parseCatalogConfig = (q: Readonly<Record<string, string | string[] | undefined>>): CatalogConfig => {
  const one = (k: string): string | undefined => (Array.isArray(q[k]) ? q[k][0] : (q[k] as string | undefined));
  return { mode: one("mode") === "field" ? "field" : null, theme: one("theme") === "dark" ? "dark" : null, veil: one("veil") === "1" };
};

const href = (c: CatalogConfig, over: Partial<Record<"mode" | "theme" | "veil", string | null>>): string => {
  const p = new URLSearchParams();
  const m = "mode" in over ? over.mode : c.mode;
  const t = "theme" in over ? over.theme : c.theme;
  const v = "veil" in over ? over.veil : c.veil ? "1" : null;
  if (m) p.set("mode", m);
  if (t) p.set("theme", t);
  if (v) p.set("veil", v);
  const s = p.toString();
  return s ? `/ops/design?${s}` : "/ops/design";
};

const LEVELS: readonly ItemVerdict[] = ["no_fly", "needs_procedure", "procedure_done", "no_procedure", "unknown"];
const GROUNDS = [
  ["base", "ページの地（薄いグレー）", "--sb-base"],
  ["surface", "面（白。カード・ブロック）", "--sb-surface"],
  ["sunken", "くぼみ（入力欄・表の見出し・注記）", "--sb-sunken"],
] as const;

function Band({ online, stale }: { readonly online: boolean; readonly stale: boolean }) {
  return (
    <section aria-label="接続と送信の状況（見本）" className="sbx-band" data-testid="cat-band" data-online={online ? "true" : "false"}>
      <span className="font-bold">{online ? "● 接続あり" : "× 接続なし（圏外）"}</span>
      <span className="font-bold">送信待ち {online ? 0 : 2} 件</span>
      <span>最後に保存 11/02 09:41</span>
      <span>
        先読みの最終更新 11/02 07:10
        {stale ? <strong className="ml-1">（古い可能性）</strong> : null}
      </span>
    </section>
  );
}

export function DesignCatalogV2({ config }: { readonly config: CatalogConfig }) {
  return (
    <div className="sbx-catalog" data-testid="design-catalog" data-mode={config.mode ?? "normal"} data-theme-forced={config.theme ?? "light"}>
      <CatalogAttrs mode={config.mode} theme={config.theme} />
      {config.veil ? <div className="sbx-veil" data-testid="cat-veil" aria-hidden="true" /> : null}
      <header className="flex flex-col gap-2">
        <h1>デザイン見本（静かな管制室）</h1>
        <p className="sbx-note">地は薄いグレー、面は白、くぼみは一段濃いグレー。影は使わず罫で分ける。主色は空色の 1 色で、操作と現在地だけに使う。判定色は状態色から引き、形・言葉は変えない。</p>
        {config.mode ? (
          <p className="sbx-note" data-testid="cat-field-note">
            現場の見本：色・罫・押す部品の大きさ・文字の大きさ（本文 18px、状態の語 20px）を現場の基準に合わせて並べています。挿絵や帯など一部の部品は通常と同じ寸法のままなので、現場の最終の見え方は実画面で確かめてください。
          </p>
        ) : null}
        <nav aria-label="見本の設定" className="sbx-nav" data-testid="cat-nav">
          <a className="sb-pill sb-pill-sm sb-pill-secondary" href={href(config, { mode: null })} aria-current={config.mode ? undefined : "true"} data-testid="cat-normal">
            <span className="sb-pill-label">通常</span>
          </a>
          <a className="sb-pill sb-pill-sm sb-pill-secondary" href={href(config, { mode: "field" })} aria-current={config.mode ? "true" : undefined} data-testid="cat-field">
            <span className="sb-pill-label">現場</span>
          </a>
          <a className="sb-pill sb-pill-sm sb-pill-secondary" href={href(config, { veil: config.veil ? null : "1" })} aria-current={config.veil ? "true" : undefined} data-testid="cat-veil-toggle">
            <span className="sb-pill-label">日差しの模擬（白い膜）{config.veil ? "：入" : "：切"}</span>
          </a>
        </nav>
      </header>

      <section className="sbx-section" aria-labelledby="cat-grounds" data-testid="cat-grounds">
        <h2 id="cat-grounds">地と面（地の三段・罫・縁）</h2>
        <div className="sbx-grid">
          {GROUNDS.map(([key, label, token]) => (
            <div key={key} className="sbx-ground" data-ground={key}>
              <strong>{label}</strong>
              <span className="sbx-note">{token}</span>
              <p>本文（墨）。ひらがなと漢字の混ざった文を、この地の上で読む。</p>
              <p style={{ color: "var(--sb-ink-2)" }}>第二の文字。補助の説明に使う。</p>
              <p style={{ color: "var(--sb-ink-3)" }}>注釈の文字。小さな補足に使う。</p>
            </div>
          ))}
        </div>
        <LineChips />
      </section>

      <section className="sbx-section" aria-labelledby="cat-type" data-testid="cat-type">
        <h2 id="cat-type">文字の段</h2>
        <TypeScale />
      </section>

      <section className="sbx-section" aria-labelledby="cat-primary-use" data-testid="cat-primary-use">
        <h2 id="cat-primary-use">主色（操作と現在地だけ）</h2>
        <PrimaryChips />
        <SectionHead id="cat-primary-head" as="h3" title="見出し（左に墨の太い線だけ）" note="背後の大きな数字はやめた" />
        <p>
          <span className="sbx-dot" aria-hidden="true" /> 現在地の印（小さな主色の丸）。
        </p>
      </section>

      <section className="sbx-section" aria-labelledby="cat-status-h" data-testid="cat-status">
        <h2 id="cat-status-h">状態 5 種と未確認（記号と文字を併用する）</h2>
        <StateKinds />
      </section>

      <section className="sbx-section" aria-labelledby="cat-buttons" data-testid="cat-buttons">
        <h2 id="cat-buttons">ボタン 5 種（主・副・文字・危険・無効）</h2>
        <div className="sbx-row" data-specimen-group="pill">
          <PillButton variant="primary" data-testid="cat-primary">主ボタン（保存する）</PillButton>
          <PillButton data-testid="cat-secondary">副ボタン</PillButton>
          <PillButton variant="text" data-testid="cat-text">文字ボタン</PillButton>
          <PillButton variant="danger" data-testid="cat-danger">取り消す</PillButton>
          <PillButton disabled aria-describedby="cat-disabled-reason" data-testid="cat-disabled">押せない</PillButton>
        </div>
        <p data-note="" className="sb-disabled-reason" id="cat-disabled-reason" data-testid="cat-disabled-reason">必須の項目がまだ入力されていません。</p>
        <div className="sbx-row" data-specimen-group="opx">
          <button type="button" className="opx-btn opx-btn-primary" data-variant="primary" data-testid="cat-opx-primary">運航管理の主ボタン</button>
          <button type="button" className="opx-btn" data-testid="cat-opx-secondary">副ボタン</button>
          <button type="button" className="opx-btn opx-btn-text" data-testid="cat-opx-text">文字ボタン</button>
          <button type="button" className="opx-btn opx-btn-danger" data-testid="cat-opx-danger">取り消す</button>
          <button type="button" className="opx-btn" disabled aria-describedby="cat-opx-disabled-reason" data-testid="cat-opx-disabled">押せない</button>
        </div>
        <p data-note="" className="opx-disabled-reason" id="cat-opx-disabled-reason" data-testid="cat-opx-disabled-reason">必須の項目がまだ入力されていません。</p>
        <p className="sbx-note">主色の面と地の比は 5:1 以上（現場は 7:1 以上）。面だけで境界を満たす。押すと主色が濃くなり、少し縮む（120ms）。</p>
      </section>

      <section className="sbx-section" aria-labelledby="cat-cards" data-testid="cat-cards">
        <h2 id="cat-cards">カード 3 種</h2>
        <div className="sbx-grid">
          <div className="sb-card" data-testid="cat-card">
            <strong>通常のカード</strong>
            <p className="sbx-note">白い面・角丸 16・1px の罫・内側 16。</p>
          </div>
          <a className="sb-card sb-card-list" href="#cat-cards" data-testid="cat-card-list">
            <strong>一覧のカード（見出し）</strong>
            <span>13:00〜14:00　機体 JU0000（試験機）</span>
            <span data-note="" className="sbx-note">最小の高さ 72・全体が押せる</span>
          </a>
          <div className="sb-card sb-card-state" data-state="warn" data-testid="cat-card-state">
            <strong>状態のカード</strong>
            <p className="sbx-note">状態の面と、左端 6px の状態の印の色の帯。</p>
          </div>
        </div>
        <h3 className="sbx-h3">一覧のカードの矢印（G-1 で決める）</h3>
        <CardArrowCandidates />
      </section>

      <section className="sbx-section" aria-labelledby="cat-labels-h" data-testid="cat-state-labels">
        <h2 id="cat-labels-h">状態ラベル</h2>
        <div className="sbx-row">
          <StatusLabel tone="info" testId="cat-state-info">待機中</StatusLabel>
          <StatusLabel tone="flying" testId="cat-state-flying">飛行中</StatusLabel>
          <StatusLabel tone="safe" testId="cat-state-safe">飛行済</StatusLabel>
          <StatusLabel tone="danger" testId="cat-state-danger">中止</StatusLabel>
          <a className="sb-state sb-state-info" href="#cat-cards" data-testid="cat-state-link">
            <span className="sb-state-dot" aria-hidden="true" />
            <span>押せるラベル</span>
          </a>
        </div>
        <h3 className="sbx-h3">点の形（G-1 で決める）</h3>
        <DotShapeCandidates />
      </section>

      <section className="sbx-section" aria-labelledby="cat-forms" data-testid="cat-forms">
        <h2 id="cat-forms">面と罫・入力欄・選択中の面</h2>
        <div className="sbx-grid">
          <div className="sb-block" data-testid="cat-block">
            <strong>ブロック（罫で分ける）</strong>
            <p className="sbx-note">影なし。罫は 1px（現場 1.5px）。</p>
          </div>
          <div className="sb-block-soft" data-testid="cat-block-soft">
            <strong>ごく薄いグレーの面</strong>
            <p className="sbx-note">注記・補足に使う。</p>
          </div>
          <div className="sb-check-row is-on" data-testid="cat-selected" style={{ padding: "12px" }}>
            <span>選択中の面（薄い主色の面＋縁）</span>
          </div>
        </div>
      </section>

      <section className="sbx-section" aria-labelledby="cat-inputs-h" data-testid="cat-inputs-section">
        <h2 id="cat-inputs-h">入力欄（ラベルは常に上・エラーは記号付き 1 行）</h2>
        <CatalogInputs />
      </section>

      <section className="sbx-section" aria-labelledby="cat-checks-h" data-testid="cat-checks-section">
        <h2 id="cat-checks-h">チェック行と群（完了数/総数・折りたたみ）・チェックとラジオ</h2>
        <CatalogChecks />
        <CatalogChoices />
      </section>

      <section className="sbx-section" aria-labelledby="cat-sheet-h" data-testid="cat-sheet-section">
        <h2 id="cat-sheet-h">ボトムシート（3 段）</h2>
        <CatalogSheet />
      </section>

      <section className="sbx-section" aria-labelledby="cat-skel-h" data-testid="cat-skeleton-section">
        <h2 id="cat-skel-h">スケルトン（静止）</h2>
        <SkeletonCard testId="cat-skeleton" />
      </section>

      <section className="sbx-section" aria-labelledby="cat-states-h" data-testid="cat-states-section">
        <h2 id="cat-states-h">空の状態と通信エラー</h2>
        <div data-specimen-group="empty">
          <CatalogStates />
        </div>
      </section>

      <section className="sbx-section" aria-labelledby="cat-verdict" data-testid="cat-verdict">
        <h2 id="cat-verdict">判定の五段（値・形・言葉は変えない）</h2>
        <div className="sbx-row">
          {LEVELS.map((l) => (
            <VerdictTag key={l} level={l} testId={`cat-verdict-${l}`}>
              {VERDICT_LABEL[l]}
            </VerdictTag>
          ))}
        </div>
        <div className="sbx-row">
          {LEVELS.map((l) => (
            <VerdictBig key={l} level={l} />
          ))}
        </div>
      </section>

      <section className="sbx-section" aria-labelledby="cat-logo-h" data-testid="cat-logo">
        <h2 id="cat-logo-h">ロゴの丸（G-1 で決める）</h2>
        <LogoCandidates />
      </section>

      <section className="sbx-section" aria-labelledby="cat-order-h" data-testid="cat-order">
        <h2 id="cat-order-h">計画作成の段の順（G-1 で決める）</h2>
        <p className="sbx-note">現行の計画作成は、段に分けない 1 画面の縦長フォームです。下の 2 つはどちらも案で、見本の中だけに置きます。</p>
        <WizardOrder />
      </section>

      <section className="sbx-section" aria-labelledby="cat-bottomnav-h" data-testid="cat-bottomnav-sec" id="cat-bottomnav-sec">
        <h2 id="cat-bottomnav-h">下部ナビ（4 項目の見本）</h2>
        <BottomNavSample />
        <p className="sbx-note">高さ 64 以上・文字 14 以上。現在地は主色のアイコンと文字・薄い主色の面・aria-current。影は浮くものだけが持つ（現場では無し）。</p>
      </section>

      <section className="sbx-section" aria-labelledby="cat-prep-h" data-testid="cat-prep">
        <h2 id="cat-prep-h">準備カードの文言案（§8 の全状態）</h2>
        <PrepSection />
      </section>

      <section className="sbx-section" aria-labelledby="cat-band" data-testid="cat-band-section">
        <h2 id="cat-band">状態の帯（現場）</h2>
        <Band online stale={false} />
        <Band online stale />
        <Band online={false} stale={false} />
      </section>

      <section className="sbx-section" aria-labelledby="cat-art" data-testid="cat-art-section">
        <h2 id="cat-art">`/` の挿絵（線画。色は墨と白だけ）</h2>
        <div className="sb-hero" style={{ borderRadius: "var(--sb-r-l)" }}>
          <HeroIllustration />
        </div>
      </section>
    </div>
  );
}
