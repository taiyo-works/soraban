import type { ReactNode } from "react";
import type { ItemVerdict } from "@soraban/regulations";
import { BrandDrone } from "@/components/hero-illustration";
import { Icon, type IconName } from "@/components/ui/icons";
import { PillButton, VerdictSign } from "@/components/ui/sb-parts";

// 見本の静的な節（Sprint 16-E）：文字の段・主色・状態 5 種＋未確認・並べ見本（G-1 で決める候補）・下部ナビ・準備カードの文言案。
// 認証・DB・外部通信なし。値は持たず、soraban-tokens.css の --sb-* だけを使う。候補は見本の中だけに置き、実画面は変えない。

const cx = (...parts: ReadonlyArray<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

/** 比べる案の札。現行の案には「現行」、そうでない案には「案」を付ける（どれが現行かを必ず明記する）。 */
export function Cand({ current, name, testId, children }: { readonly current: boolean; readonly name: string; readonly testId: string; readonly children: ReactNode }) {
  return (
    <div className="sbx-cand" data-current={current ? "true" : "false"} data-testid={testId}>
      <span className="sbx-cand-tag" data-testid={`${testId}-tag`}>
        {current ? "現行" : "案"}
      </span>
      <span className="sbx-cand-name">{name}</span>
      <div className="sbx-cand-body">{children}</div>
    </div>
  );
}

// ── 地と面の補足（罫・縁・無効）────────────────────────────────────────

export function LineChips() {
  return (
    <div className="sbx-row" data-testid="cat-lines">
      <span className="sbx-chip">
        <i className="sbx-chip-box" style={{ background: "var(--sb-surface)", borderColor: "var(--sb-rule)" }} aria-hidden="true" />
        <span>罫 --sb-rule（区切りの線だけ）</span>
      </span>
      <span className="sbx-chip">
        <i className="sbx-chip-box" style={{ background: "var(--sb-surface)", borderColor: "var(--sb-edge)" }} aria-hidden="true" />
        <span>縁 --sb-edge（押せる部品の縁）</span>
      </span>
    </div>
  );
}

// ── 文字の段 ──────────────────────────────────────────────────────────

export function TypeScale() {
  return (
    <div className="sbx-type" data-testid="cat-type-list">
      <div className="sbx-type-row">
        <span className="sbx-type-k">画面の題（1.5rem・行 1.35・700）</span>
        <div className="sbx-t-title" data-testid="cat-type-title">今日の飛行の準備</div>
      </div>
      <div className="sbx-type-row">
        <span className="sbx-type-k">節の見出し（1.125rem・行 1.4・700）</span>
        <div className="sbx-t-section" data-testid="cat-type-section">計画の内容</div>
      </div>
      <div className="sbx-type-row">
        <span className="sbx-type-k">カードの見出し（1rem・行 1.45・600）</span>
        <div className="sbx-t-card" data-testid="cat-type-card">13:00〜14:00　試験空域</div>
      </div>
      <div className="sbx-type-row">
        <span className="sbx-type-k">本文（1rem・行 1.7。現場は 1.125rem）</span>
        <p className="sbx-t-body" data-testid="cat-type-body">ひらがなと漢字の混ざった文を、この大きさで読む。数字は 12:30 や 3/8 のように並べる。</p>
      </div>
      <div className="sbx-type-row">
        <span className="sbx-type-k">補足（0.875rem・行 1.5・500）</span>
        <p className="sbx-t-note" data-note="" data-testid="cat-type-note">日付・場所・ラベルなどの短い補足に使う。</p>
      </div>
      <div className="sbx-type-row">
        <span className="sbx-type-k">数値の強調（1.75rem・700・桁をそろえる）</span>
        <div className="sbx-t-num" data-testid="cat-type-number">
          12:30　3/8　0.5 kg
        </div>
      </div>
      <div className="sbx-row" data-testid="cat-type-colors">
        <span className="sbx-chip">
          <i className="sbx-chip-box" style={{ background: "var(--sb-ink)" }} aria-hidden="true" />
          <span>墨 --sb-ink</span>
        </span>
        <span className="sbx-chip">
          <i className="sbx-chip-box" style={{ background: "var(--sb-ink-2)" }} aria-hidden="true" />
          <span>強い補足 --sb-ink-2</span>
        </span>
        <span className="sbx-chip">
          <i className="sbx-chip-box" style={{ background: "var(--sb-ink-3)" }} aria-hidden="true" />
          <span>補足・ラベル --sb-ink-3</span>
        </span>
        <span className="sbx-chip">
          <i className="sbx-chip-box" style={{ background: "var(--sb-ink-disabled)" }} aria-hidden="true" />
          <span>無効の部品の文字だけ --sb-ink-disabled</span>
        </span>
      </div>
    </div>
  );
}

// ── 主色 ──────────────────────────────────────────────────────────────

export function PrimaryChips() {
  return (
    <div className="sbx-grid" data-testid="cat-primary-chips">
      <div className="sbx-prim" data-testid="cat-prim-face" style={{ background: "var(--sb-primary)", color: "var(--sb-on-primary)" }}>
        <strong>主色の面</strong>
        <span>--sb-primary ＋ 白の文字</span>
      </div>
      <div className="sbx-prim" data-testid="cat-prim-press" style={{ background: "var(--sb-primary-press)", color: "var(--sb-on-primary)" }}>
        <strong>押している間</strong>
        <span>--sb-primary-press</span>
      </div>
      <div className="sbx-prim sbx-prim-soft" data-testid="cat-prim-soft">
        <strong>選択・現在地の面</strong>
        <span>--sb-primary-soft ＋ 墨の文字</span>
      </div>
      <div className="sbx-prim sbx-prim-ring" data-testid="cat-prim-focus">
        <strong>フォーカスの輪</strong>
        <span>--sb-focus（3px・2px 離す）</span>
      </div>
    </div>
  );
}

// ── 状態 5 種＋未確認 ─────────────────────────────────────────────────

function InfoSign() {
  return (
    <svg viewBox="0 0 24 24" className="sb-vm" aria-hidden="true">
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 11 V16.2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <circle cx="12" cy="7.9" r="1.3" fill="currentColor" />
    </svg>
  );
}

function FlyingSign() {
  return (
    <svg viewBox="0 0 24 24" className="sb-vm" aria-hidden="true">
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M9.6 8.2 L16 12 L9.6 15.8 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

type StateKey = "safe" | "warn" | "danger" | "info" | "flying" | "unknown";

const STATES: ReadonlyArray<{ key: StateKey; name: string; word: string; use: string; sign: ReactNode; tokens: string }> = [
  { key: "safe", name: "安全", word: "点検済み", use: "点検済み・飛行済み・通報の受付番号の記録済み・判定「手続き不要」", sign: <VerdictSign level="procedure_done" />, tokens: "--sb-st-safe-*" },
  { key: "warn", name: "注意", word: "期限が近い", use: "要手続き・期限が近い・未記録", sign: <VerdictSign level="needs_procedure" />, tokens: "--sb-st-warn-*" },
  { key: "danger", name: "危険", word: "中止", use: "飛行不可・中止・取り消し済み・エラー", sign: <VerdictSign level="no_fly" />, tokens: "--sb-st-danger-*" },
  { key: "info", name: "情報", word: "待機中", use: "待機中・判定「手続き済み」", sign: <InfoSign />, tokens: "--sb-st-info-*" },
  { key: "flying", name: "飛行中", word: "飛行中", use: "飛行中だけ", sign: <FlyingSign />, tokens: "--sb-st-flying-*" },
  { key: "unknown", name: "未確認", word: "未確認", use: "判定不能・取得失敗・まだ確かめていない項目。確かめていないことを良い状態と読ませない", sign: <VerdictSign level="unknown" />, tokens: "白の面＋点線の縁＋「？」" },
];

export function StateKinds() {
  return (
    <div className="sbx-grid" data-testid="cat-status-list">
      {STATES.map((s) => (
        <div
          key={s.key}
          className={cx("sb-card sbx-status", s.key !== "unknown" && "sb-card-state")}
          {...(s.key !== "unknown" ? { "data-state": s.key } : {})}
          data-tone={s.key}
          data-testid={`cat-status-${s.key}`}
        >
          <div className="sbx-status-head">
            <span className="sbx-status-sign">{s.sign}</span>
            <strong className="sbx-status-word">{s.word}</strong>
            <span className="sbx-status-name">（{s.name}）</span>
          </div>
          <p className="sbx-note">{s.use}</p>
          <span data-note="" className="sbx-note">{s.tokens}</span>
        </div>
      ))}
    </div>
  );
}

// ── 並べ見本 1：ロゴの丸 ─────────────────────────────────────────────

export function LogoCandidates() {
  return (
    <div className="sbx-grid" data-testid="cat-logo-list">
      <Cand current name="主色の面（--sb-primary）" testId="cat-logo-primary">
        <span className="sb-brand">
          <span className="sb-brand-mark" aria-hidden="true">
            <BrandDrone />
          </span>
          そらばん
        </span>
      </Cand>
      <Cand current={false} name="墨の面（--sb-ink）" testId="cat-logo-ink">
        <span className="sb-brand">
          <span className="sb-brand-mark sbx-mark-ink" aria-hidden="true">
            <BrandDrone />
          </span>
          そらばん
        </span>
      </Cand>
    </div>
  );
}

// ── 並べ見本 2：状態ラベルの点の形 ───────────────────────────────────

function ShapeDot({ shape }: { readonly shape: "ring" | "play" | "check" | "triangle" | "cross" }) {
  return (
    <svg viewBox="0 0 12 12" width={12} height={12} className="sbx-shape" aria-hidden="true" focusable="false">
      {shape === "ring" ? <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="2" /> : null}
      {shape === "play" ? <path d="M3.5 2 L10 6 L3.5 10 Z" fill="currentColor" /> : null}
      {shape === "check" ? <path d="M2 6.4 L5 9.2 L10 3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {shape === "triangle" ? <path d="M6 1.8 L11 10.2 H1 Z" fill="currentColor" /> : null}
      {shape === "cross" ? <path d="M2.4 2.4 L9.6 9.6 M9.6 2.4 L2.4 9.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /> : null}
    </svg>
  );
}

const SHAPE_LABELS = [
  { tone: "info", word: "待機中", shape: "ring" },
  { tone: "flying", word: "飛行中", shape: "play" },
  { tone: "safe", word: "飛行済", shape: "check" },
  { tone: "warn", word: "期限が近い", shape: "triangle" },
  { tone: "danger", word: "中止", shape: "cross" },
] as const;

export function DotShapeCandidates() {
  return (
    <div className="sbx-grid" data-testid="cat-dot-list">
      <Cand current name="4 状態とも同じ丸（8px）" testId="cat-dot-same">
        <div className="sbx-row">
          {SHAPE_LABELS.map((l) => (
            <span key={l.tone} className={cx("sb-state", l.tone === "warn" ? "sbx-state-warn" : `sb-state-${l.tone}`)} data-testid={`cat-dot-same-${l.tone}`}>
              <span className="sb-state-dot" aria-hidden="true" />
              <span>{l.word}</span>
            </span>
          ))}
        </div>
      </Cand>
      <Cand current={false} name="状態ごとに形を変える（12px）" testId="cat-dot-shapes">
        <div className="sbx-row">
          {SHAPE_LABELS.map((l) => (
            <span key={l.tone} className={cx("sb-state", l.tone === "warn" ? "sbx-state-warn" : `sb-state-${l.tone}`)} data-testid={`cat-dot-shapes-${l.tone}`}>
              <ShapeDot shape={l.shape} />
              <span>{l.word}</span>
            </span>
          ))}
        </div>
      </Cand>
    </div>
  );
}

// ── 並べ見本 3：一覧のカードの矢印 ───────────────────────────────────

export function CardArrowCandidates() {
  return (
    <div className="sbx-grid" data-testid="cat-arrow-list">
      <Cand current name="矢印なし（全体が押せる）" testId="cat-arrow-none">
        <a className="sb-card sb-card-list" href="#cat-card-arrow" data-testid="cat-arrow-none-card">
          <strong>13:00〜14:00　試験空域</strong>
          <span data-note="" className="sbx-note">機体 JU0000（試験機）</span>
        </a>
      </Cand>
      <Cand current={false} name="右端に矢印（chevron-right）" testId="cat-arrow-with">
        <a className="sb-card sb-card-list sbx-card-arrow" href="#cat-card-arrow" data-testid="cat-arrow-with-card">
          <span className="sbx-card-arrow-text">
            <strong>13:00〜14:00　試験空域</strong>
            <span data-note="" className="sbx-note">機体 JU0000（試験機）</span>
          </span>
          <Icon name="chevron-right" size={24} className="sbx-card-arrow-icon" />
        </a>
      </Cand>
    </div>
  );
}

// ── 並べ見本 4：計画作成の段の順（§9.1）──────────────────────────────

const ORDER_ADOPTED = [
  ["場所", "地点を決める"],
  ["日時", "日付・開始・飛行時間"],
  ["飛行の方法と目的", "夜間・目視外などの方法。判定の結果が変わる"],
  ["操縦者・機体・許可", "機体の重さで判定が変わる"],
  ["内容の確認（保存）", "読み取りのカードで確認し「計画を保存」。保存のときに判定が記録される"],
  ["判定と通報の準備", "保存のあとの画面。主ボタンは「DIPS に出す内容を確認」"],
] as const;

const ORDER_DIRECTION = [
  ["場所", ""],
  ["日時", ""],
  ["自動調査の結果の確認", "保存の前に判定を見せる。記録された結果と食い違いうる"],
  ["目的と運航条件", ""],
  ["操縦者・機体・許可", ""],
  ["内容の確認（DIPS に出す内容の確認）", ""],
] as const;

function OrderList({ items, testId }: { readonly items: ReadonlyArray<readonly [string, string]>; readonly testId: string }) {
  return (
    <ol className="sbx-order" data-testid={testId}>
      {items.map(([name, note], i) => (
        <li key={name} className="sbx-order-item">
          <span className="sbx-order-n" aria-hidden="true">
            {i + 1}
          </span>
          <span className="sbx-order-text">
            <strong>{name}</strong>
            {note ? <span data-note="" className="sbx-note">{note}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function WizardOrder() {
  return (
    <div className="sbx-grid" data-testid="cat-order-list">
      <Cand current={false} name="この計画の順（G-1 の確認の対象。§9.1）" testId="cat-order-adopted">
        <OrderList items={ORDER_ADOPTED} testId="cat-order-adopted-list" />
      </Cand>
      <Cand current={false} name="方針書の順（比べる用。採らない案）" testId="cat-order-direction">
        <OrderList items={ORDER_DIRECTION} testId="cat-order-direction-list" />
      </Cand>
      <div className="flex flex-col gap-2" data-testid="cat-progress-sample">
        <span className="sbx-cand-name">進捗の帯の見本（高さ 4・主色・「2/6 日時」の文字）</span>
        <div className="sbx-progress" role="progressbar" aria-label="計画作成の進み具合（見本）" aria-valuemin={1} aria-valuemax={6} aria-valuenow={2} aria-valuetext="2/6 日時" data-testid="cat-progress">
          <div className="sbx-progress-fill" style={{ width: `${(2 / 6) * 100}%` }} />
        </div>
        <span data-note="" className="sbx-note">2/6 日時</span>
      </div>
    </div>
  );
}

// ── 下部ナビ（4 項目の見本。F-1）─────────────────────────────────────

const NAV_SAMPLE: ReadonlyArray<{ key: string; label: string; icon: IconName; current?: boolean }> = [
  { key: "today", label: "ホーム", icon: "home", current: true },
  { key: "plans", label: "計画", icon: "plan" },
  { key: "journal", label: "日誌", icon: "journal" },
  { key: "more", label: "機体と書類", icon: "list" },
];

export function BottomNavSample() {
  return (
    <nav className="sbx-bnav" aria-label="下部ナビの見本（4 項目）" data-float="" data-testid="cat-bottomnav">
      {NAV_SAMPLE.map((it) => (
        <a key={it.key} href="#cat-bottomnav-sec" className="sbx-bnav-item" {...(it.current ? { "aria-current": "page" as const } : {})} data-testid={`cat-bnav-${it.key}`}>
          <Icon name={it.icon} size={24} />
          <span>{it.label}</span>
        </a>
      ))}
    </nav>
  );
}

// ── 準備カードの文言案（§8）────────────────────────────────────────────

type Tone = "safe" | "warn" | "danger" | "info" | "unknown";
type PrepRow = { readonly k: string; readonly tone: Tone; readonly level: ItemVerdict; readonly text: string; readonly note?: string };

const RANK: Readonly<Record<Tone, number>> = { danger: 4, warn: 3, unknown: 2, info: 1, safe: 0 };
const heaviest = (rows: readonly PrepRow[]): Tone => rows.reduce<Tone>((a, r) => (RANK[r.tone] > RANK[a] ? r.tone : a), "safe");

export const PREP_REPORT = {
  recorded: { k: "通報", tone: "safe", level: "procedure_done", text: "受付番号を記録済み" },
  confirm: { k: "通報", tone: "warn", level: "needs_procedure", text: "DIPS に出す内容を確認する" },
  cancelled: { k: "通報", tone: "danger", level: "no_fly", text: "取り消し済み" },
} as const satisfies Record<string, PrepRow>;

export const PREP_INSPECTION = {
  recorded: { k: "飛行前点検", tone: "safe", level: "procedure_done", text: "記録済み" },
  missing: { k: "飛行前点検", tone: "warn", level: "needs_procedure", text: "未記録" },
  abnormal: { k: "飛行前点検", tone: "danger", level: "no_fly", text: "異常あり" },
} as const satisfies Record<string, PrepRow>;

const J = "判定（参考）";
const NOTE = "判定は参考情報です";

function PrepCard({ id, rows, readout, label }: { readonly id: string; readonly rows: readonly PrepRow[]; readonly readout: string; readonly label: string }) {
  const tone = heaviest(rows);
  return (
    <section
      className={cx("sb-card sbx-prep", tone !== "unknown" && "sb-card-state")}
      {...(tone !== "unknown" ? { "data-state": tone } : {})}
      data-tone={tone}
      aria-label={readout}
      data-testid={`cat-prep-card-${id}`}
    >
      <div className="sbx-prep-head">
        <h3 className="sbx-prep-title">次の飛行の準備</h3>
        <span data-note="" className="sbx-note">11/25 10:00〜10:30　試験空域（見本）</span>
      </div>
      <ul className="sbx-prep-rows">
        {rows.map((r) => (
          <li key={r.k} className="sbx-prep-row" data-tone={r.tone}>
            <span className="sbx-prep-sign">
              <VerdictSign level={r.level} />
            </span>
            <span className="sbx-prep-k">{r.k}</span>
            <span className="sbx-prep-v">{r.text}</span>
          </li>
        ))}
      </ul>
      <span data-note="" className="sbx-note">{NOTE}</span>
      <span className="sbx-cand-name">{label}（帯の色＝3 行のうち重い状態）</span>
    </section>
  );
}

const CARDS: ReadonlyArray<{ id: string; label: string; readout: string; rows: readonly PrepRow[] }> = [
  {
    id: "danger",
    label: "危険の帯",
    readout: "次の飛行の準備。通報、取り消し済み。飛行前点検、異常あり。判定、飛行不可の項目が 2 件あります。",
    rows: [PREP_REPORT.cancelled, PREP_INSPECTION.abnormal, { k: J, tone: "danger", level: "no_fly", text: "飛行不可の項目があります（2 件）" }],
  },
  {
    id: "warn",
    label: "注意の帯",
    readout: "次の飛行の準備。通報、受付番号を記録済み。飛行前点検、未記録。判定、未確認の項目が 2 件あります。",
    rows: [PREP_REPORT.recorded, PREP_INSPECTION.missing, { k: J, tone: "unknown", level: "unknown", text: "未確認の項目があります（2 件）" }],
  },
  {
    id: "unknown",
    label: "未確認の帯",
    readout: "次の飛行の準備。通報、受付番号を記録済み。飛行前点検、記録済み。判定、未確認の項目が 2 件あります。",
    rows: [PREP_REPORT.recorded, PREP_INSPECTION.recorded, { k: J, tone: "unknown", level: "unknown", text: "未確認の項目があります（2 件）" }],
  },
  {
    id: "info",
    label: "情報の帯",
    readout: "次の飛行の準備。通報、受付番号を記録済み。飛行前点検、記録済み。判定、調べた項目は手続き済みです。条件を確認してください。",
    rows: [PREP_REPORT.recorded, PREP_INSPECTION.recorded, { k: J, tone: "info", level: "procedure_done", text: "調べた項目は手続き済みです。条件を確認してください" }],
  },
  {
    id: "safe",
    label: "安全の帯",
    readout: "次の飛行の準備。通報、受付番号を記録済み。飛行前点検、記録済み。判定、調べた項目では、手続きが要るものは見つかりませんでした。調べていない項目があります。",
    rows: [PREP_REPORT.recorded, PREP_INSPECTION.recorded, { k: J, tone: "safe", level: "no_procedure", text: "調べた項目では、手続きが要るものは見つかりませんでした", note: "調べていない項目があります" }],
  },
];

function RowChip({ r }: { readonly r: PrepRow }) {
  return (
    <span className="sbx-prep-chip" data-tone={r.tone}>
      <span className="sbx-prep-sign">
        <VerdictSign level={r.level} />
      </span>
      <span>{r.text}</span>
    </span>
  );
}

const JUDGEMENT_STATES: ReadonlyArray<{ id: string; tone: Tone; level: ItemVerdict; text: string; note?: string; action?: "rejudge" | "reload" }> = [
  { id: "no-fly", tone: "danger", level: "no_fly", text: "飛行不可の項目があります（2 件）" },
  { id: "needs", tone: "warn", level: "needs_procedure", text: "手続きが要る項目があります（1 件）" },
  { id: "unknown", tone: "unknown", level: "unknown", text: "未確認の項目があります（3 件）" },
  { id: "done", tone: "info", level: "procedure_done", text: "調べた項目は手続き済みです。条件を確認してください" },
  { id: "none", tone: "safe", level: "no_procedure", text: "調べた項目では、手続きが要るものは見つかりませんでした", note: "調べていない項目があります" },
  { id: "norecord", tone: "unknown", level: "unknown", text: "未確認（判定の記録がありません）", action: "rejudge" },
  { id: "loadfail", tone: "unknown", level: "unknown", text: "未確認（読み込めませんでした）", action: "reload" },
  { id: "stale", tone: "warn", level: "needs_procedure", text: "古い判定：手続きが要る項目があります（1 件）" },
];

export function PrepSection() {
  return (
    <div className="flex flex-col gap-4" data-testid="cat-prep-body">
      <p className="sbx-note">
        文言は案のまま（専門家の確認が出るまで社内の試験運用だけ）。判定は補助で、記号と文字が状態を伝える。帯の色は補助。確かめていない項目を、良い状態と読ませる語は、どの状態にも使わない。
      </p>

      <h3 className="sbx-h3">行の状態（通報・飛行前点検）</h3>
      <div className="sbx-prep-table" data-testid="cat-prep-rows">
        <div className="sbx-prep-table-row" data-testid="cat-prep-rows-report">
          <span className="sbx-prep-k">通報</span>
          <RowChip r={PREP_REPORT.recorded} />
          <RowChip r={PREP_REPORT.confirm} />
          <RowChip r={PREP_REPORT.cancelled} />
        </div>
        <div className="sbx-prep-table-row" data-testid="cat-prep-rows-inspection">
          <span className="sbx-prep-k">飛行前点検</span>
          <RowChip r={PREP_INSPECTION.recorded} />
          <RowChip r={PREP_INSPECTION.missing} />
          <RowChip r={PREP_INSPECTION.abnormal} />
        </div>
      </div>

      <h3 className="sbx-h3">準備カード（帯の色は 3 行のうちいちばん重い状態：危険＞注意＞未確認＞情報＞安全）</h3>
      <div className="sbx-grid" data-testid="cat-prep-cards">
        {CARDS.map((c) => (
          <PrepCard key={c.id} id={c.id} rows={c.rows} readout={c.readout} label={c.label} />
        ))}
      </div>

      <h3 className="sbx-h3">判定の総合の語（ホーム・計画の段 6・公開の / の結論。全 8 状態）</h3>
      <ul className="sbx-vstates" data-testid="cat-prep-verdicts">
        {JUDGEMENT_STATES.map((s) => (
          <li key={s.id} className="sbx-vstate" data-tone={s.tone} data-testid={`cat-prep-v-${s.id}`}>
            <span className="sbx-prep-sign">
              <VerdictSign level={s.level} />
            </span>
            <span className="sbx-vstate-text">
              <strong>{s.text}</strong>
              {s.note ? <span data-note="" className="sbx-note">{s.note}</span> : null}
            </span>
            {s.action === "rejudge" ? <PillButton data-testid="cat-prep-rejudge">再判定</PillButton> : null}
            {s.action === "reload" ? <PillButton data-testid="cat-prep-reload">再読み込み</PillButton> : null}
          </li>
        ))}
      </ul>
      <p className="sbx-note" data-testid="cat-prep-rule">
        規則：未確認の項目が 1 つでもあれば、総合を「手続き済み」「手続き不要」の語にしない。記号は、判定の 5 段の形（×・△・丸にチェック・塗った丸・点線の四角）を使う。
      </p>
    </div>
  );
}
