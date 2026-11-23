import type { ComponentPropsWithRef, ReactNode } from "react";
import type { ItemVerdict } from "@soraban/regulations";

// 公開の判定画面 `/` の部品（デザインシステム v2。見本：docs/design/warm-final/）。
// 見た目は soraban-ui.css の .sb-*（値は soraban-tokens.css の --sb-*）。ここは構造だけで、色・寸法を持たない。

const cx = (...parts: ReadonlyArray<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

// ── ボタン（主・副・文字・危険。16-C：右端の丸と矢印は外した。クラス名 .sb-pill* は残す）──

export type PillIcon = "arrow" | "locate" | "external" | "download";

const ICON_PATH: Record<Exclude<PillIcon, "arrow">, ReactNode> = {
  external: <path d="M7 4 H16 V13 M16 4 L5 15" />,
  download: <path d="M10 3.5 V13 M5.5 9 L10 13.5 L14.5 9 M4 16.5 H16" />,
  locate: (
    <>
      <circle cx="10" cy="10" r="3.2" />
      <circle cx="10" cy="10" r="7" />
      <path d="M10 1.5 V4 M10 16 V18.5 M1.5 10 H4 M16 10 H18.5" />
    </>
  ),
};

// "arrow"（既定）は何も描かない。探す・外部・保存だけ、文字の脇に線画のアイコン（円なし・装飾）を置く。
function PillInner({ icon, children }: { readonly icon: PillIcon; readonly children: ReactNode }) {
  return (
    <>
      {icon === "arrow" ? null : (
        <svg className="sb-pill-icon" viewBox="0 0 20 20" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {ICON_PATH[icon]}
        </svg>
      )}
      <span className="sb-pill-label">{children}</span>
    </>
  );
}

type PillVariant = "primary" | "secondary" | "text" | "danger";
type PillCommon = {
  readonly variant?: PillVariant;
  readonly small?: boolean;
  readonly block?: boolean;
  readonly icon?: PillIcon;
};

const pillClass = (p: PillCommon, extra?: string): string =>
  cx("sb-pill", `sb-pill-${p.variant ?? "secondary"}`, p.small && "sb-pill-sm", p.block && "sb-pill-block", extra);

// K-8：主ボタンには data-variant="primary"（1 画面に 1 つ）
const variantAttr = (p: PillCommon): { "data-variant"?: "primary" } => ((p.variant ?? "secondary") === "primary" ? { "data-variant": "primary" } : {});

export function PillButton({
  variant,
  small,
  block,
  icon = "arrow",
  className,
  children,
  ...rest
}: PillCommon & Omit<ComponentPropsWithRef<"button">, "children"> & { readonly children: ReactNode }) {
  return (
    <button type="button" {...rest} {...variantAttr({ variant })} className={pillClass({ variant, small, block }, className)}>
      <PillInner icon={icon}>{children}</PillInner>
    </button>
  );
}

export function PillLink({
  variant,
  small,
  block,
  icon = "arrow",
  className,
  children,
  ...rest
}: PillCommon & Omit<ComponentPropsWithRef<"a">, "children"> & { readonly children: ReactNode }) {
  return (
    <a {...rest} {...variantAttr({ variant })} className={pillClass({ variant, small, block }, className)}>
      <PillInner icon={icon}>{children}</PillInner>
    </a>
  );
}

// ── 状態ラベル（16-C。待機中＝情報、飛行中＝飛行中、飛行済＝安全、中止＝危険。丸は装飾で、状態は文字が担う）──

export type StatusTone = "info" | "flying" | "safe" | "danger";

export function StatusLabel({ tone, children, testId }: { readonly tone: StatusTone; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <span className={cx("sb-state", `sb-state-${tone}`)} data-tone={tone} {...(testId ? { "data-testid": testId } : {})}>
      <span className="sb-state-dot" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

// ── 判定の印（5 段。形と言葉を必ず併用する。主色・状態色以外の色は使わない）──

export type VerdictKey = "no" | "needs" | "done" | "none" | "unknown";

export const VERDICT_KEY: Readonly<Record<ItemVerdict, VerdictKey>> = {
  no_fly: "no",
  needs_procedure: "needs",
  procedure_done: "done",
  no_procedure: "none",
  unknown: "unknown",
};

const MARK_PATHS: Record<VerdictKey, ReactNode> = {
  no: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M8.6 8.6 L15.4 15.4 M15.4 8.6 L8.6 15.4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </>
  ),
  needs: (
    <>
      <path d="M12 3.6 L21.2 19.6 H2.8 Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M12 9.6 V14.2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.3" fill="currentColor" />
    </>
  ),
  done: (
    <>
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M7.8 12.4 L10.9 15.4 L16.4 9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  none: <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="3.4" />,
  unknown: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeDasharray="3 2.6" />
      <path d="M9.7 9.6 a2.4 2.4 0 1 1 3.5 2.1 c-.8.5-1.2 1-1.2 1.9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="16.9" r="1.2" fill="currentColor" />
    </>
  ),
};

/** 判定の印の形だけ（色は currentColor。装飾。隣に言葉を置く）。 */
export function VerdictSign({ level, className = "sb-vm" }: { readonly level: ItemVerdict; readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {MARK_PATHS[VERDICT_KEY[level]]}
    </svg>
  );
}

/** 判定の札（形＋言葉）。段階の言葉は呼び出し側が渡す（定数 VERDICT_LABEL）。 */
export function VerdictTag({ level, children, testId }: { readonly level: ItemVerdict; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <span className={cx("sb-vtag", `sb-v-${VERDICT_KEY[level]}`)} {...(testId ? { "data-testid": testId } : {})} data-verdict-key={VERDICT_KEY[level]}>
      <VerdictSign level={level} />
      <span>{children}</span>
    </span>
  );
}

/** 結論の大きな印（装飾）。 */
export function VerdictBig({ level }: { readonly level: ItemVerdict }) {
  return (
    <div className={cx("sb-v-big", `sb-vb-${VERDICT_KEY[level]}`)} data-verdict-key={VERDICT_KEY[level]}>
      <VerdictSign level={level} className="" />
    </div>
  );
}

// ── 見出し（左 5px の墨の線だけ。Sprint 16 H-5：背後の大きな薄い数字をやめた）──

export function SectionHead({
  id,
  title,
  note,
  as: Tag = "h2",
}: {
  readonly id: string;
  readonly title: string;
  readonly note?: string;
  readonly as?: "h2" | "h3";
}) {
  return (
    <div className="sb-sec-head">
      <Tag id={id}>{title}</Tag>
      {note ? <p data-note="" className="sb-sec-note">{note}</p> : null}
    </div>
  );
}

// ── 折りたたみ（見出しだけ見せ、開くと中身が出る。キーボードで開閉でき、開閉は形（矢印の向き）と文字（開く／閉じる）で分かる）──
// 標準の <details>／<summary> をそのまま使う（Enter／Space で開閉。開閉の状態は支援技術にも伝わる）。
// 「開く／閉じる」の文字は CSS の ::before で出す（soraban-ui.css の .sb-disc-hint）ので、ここは構造だけ。動きは付けない。
export function Disclosure({
  title,
  note,
  children,
  testId,
  className,
  defaultOpen = false,
  variant = "block",
  summaryTestId,
}: {
  readonly title: ReactNode;
  /** 見出しの右に添える短い説明（件数など）。 */
  readonly note?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
  readonly className?: string;
  readonly defaultOpen?: boolean;
  /** block＝カード（枠つき）／plain＝枠なし（カードの中の一部）。 */
  readonly variant?: "block" | "plain";
  readonly summaryTestId?: string;
}) {
  return (
    <details
      className={cx("sb-disc", variant === "block" ? "sb-block" : "sb-disc-plain", className)}
      {...(testId ? { "data-testid": testId } : {})}
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary {...(summaryTestId ? { "data-testid": summaryTestId } : {})}>
        <span className="sb-disc-text">
          <span className="sb-disc-title">{title}</span>
          {note ? <span className="sb-disc-note">{note}</span> : null}
        </span>
        <span className="sb-disc-hint">
          <svg className="sb-disc-chev" viewBox="0 0 20 20" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 8 L10 13 L15 8" />
          </svg>
        </span>
      </summary>
      <div className="sb-disc-body">{children}</div>
    </details>
  );
}
