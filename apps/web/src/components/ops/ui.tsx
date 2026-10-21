import Link from "next/link";
import type { ReactNode } from "react";

// 運航管理（Sprint 10）の画面で共通に使う見た目の部品（サーバー・クライアントのどちらからも使える）。
// 判定画面の意匠（紙面調・藍 1 色・1px の罫線・角 2px・影なし）に合わせる。
// 色だけで意味を伝えないよう、状態は必ず文字で示し、色は補助にとどめる。

export type Tone = "neutral" | "brand" | "green" | "amber" | "red" | "mute";

const toneClass: Record<Tone, string> = {
  neutral: "border-rule text-ink-soft",
  brand: "border-brand-500 text-brand-700",
  green: "border-signal-green/60 bg-signal-green-soft text-signal-green",
  amber: "border-signal-amber/60 bg-signal-amber-soft text-signal-amber",
  red: "border-signal-red/60 bg-signal-red-soft text-signal-red",
  mute: "border-rule bg-paper-soft text-ink-mute",
};

/** 状態・役割などの小さな札。中身は文字だけにする（data-testid 等の属性はそのまま渡せる）。 */
export function Badge({
  tone = "neutral",
  children,
  ...rest
}: { readonly tone?: Tone; readonly children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <span
      {...rest}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-sharp border px-1.5 py-px text-[11px] font-medium leading-5 ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}

export const AIRCRAFT_STATUS_TONE = { active: "green", suspended: "amber", deregistered: "mute" } as const;
export const MEMBER_STATUS_TONE = { invited: "amber", active: "green", disabled: "mute" } as const;
export const ROLE_TONE = { manager: "brand", pilot: "neutral", viewer: "neutral" } as const;
export const OP_TONE = { create: "brand", update: "neutral", void: "red" } as const;

/** 役割ごとにできること（運航管理者が招待するときと、本人がトップで見るときの説明）。 */
export const ROLE_DESCRIPTIONS = {
  manager: "飛行記録・日常点検の入力・訂正・取消、機体・操縦者の登録・訂正・取消と、利用者の招待・役割の変更・停止ができます。",
  pilot: "自分の飛行記録・日常点検を入力・訂正できます。機体と操縦者を閲覧でき、自分に結び付いた操縦者の情報は訂正できます。",
  viewer: "飛行記録・日常点検・機体・操縦者を閲覧できます。入力・訂正はできません。",
} as const;

/**
 * 各画面の見出し。back を渡すと、見出しの上に一覧などへ戻るリンクを出す。
 * 戻るリンクは先読み（prefetch）しない：詳細画面で訂正した直後の router.refresh() と、
 * 動的な一覧の先読みが重なると、版の一覧が更新されないことがあった（CI の E2E-DB 17 で再現）。
 */
export function PageHeader({
  title,
  eyebrow,
  back,
  aside,
  children,
}: {
  readonly title: ReactNode;
  readonly eyebrow?: string;
  readonly back?: { readonly href: string; readonly label: string };
  readonly aside?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {back ? (
        <Link href={back.href} prefetch={false} className="-my-3 inline-flex min-h-11 items-center self-start text-xs text-brand-700 underline-offset-2 hover:underline">
          <span aria-hidden>← </span>
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 className="font-display text-2xl font-light leading-tight text-ink sm:text-3xl">{title}</h1>
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** 画面内の区切り（判定画面の節見出しと同じ、罫線＋方位記の見出し）。 */
export function Section({
  title,
  description,
  children,
  tone = "default",
  id,
  ...rest
}: {
  readonly id?: string;
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly tone?: "default" | "danger";
} & Record<`aria-${string}`, string>) {
  return (
    <section {...rest} {...(id ? { id } : {})} className="flex scroll-mt-4 flex-col gap-4">
      <div className={`flex flex-col gap-1 border-b pb-2 ${tone === "danger" ? "border-signal-red/50" : "border-rule"}`}>
        <h2 className="font-display text-lg font-light text-ink sm:text-xl">
          <span aria-hidden className="bearing-mark" />
          {title}
        </h2>
        {description ? <p className="text-xs leading-relaxed text-ink-mute">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** 罫線の左に藍の線を引いた短い説明（権限・取消の意味など）。 */
export function Note({ children, tone = "brand" }: { readonly children: ReactNode; readonly tone?: "brand" | "red" }) {
  return (
    <p
      className={`border-l-2 py-0.5 pl-3 text-xs leading-relaxed ${
        tone === "red" ? "border-signal-red text-ink-soft" : "border-brand-700 text-ink-soft"
      }`}
    >
      {children}
    </p>
  );
}

/** 詳細画面の項目の並び（狭い画面では見出しの下に値、広い画面では 2 列）。 */
export function DetailList({
  rows,
  ...rest
}: { readonly rows: readonly (readonly [string, ReactNode])[] } & Record<`data-${string}`, string>) {
  return (
    <dl {...rest} className="flex flex-col border-t border-rule text-sm">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="grid grid-cols-1 gap-0.5 border-b border-rule-soft py-2.5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4"
        >
          <dt className="text-xs text-ink-mute sm:text-sm">{k}</dt>
          <dd className="min-w-0 break-all text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 一覧の「取消していないもの／取消済みも含める」の切り替え。 */
export function VoidedToggle({ basePath, includeVoided }: { readonly basePath: string; readonly includeVoided: boolean }) {
  const item = (active: boolean) =>
    `inline-flex min-h-11 items-center px-3 text-xs ${
      active ? "bg-brand-700 text-paper" : "bg-paper text-ink-soft hover:bg-paper-soft"
    }`;
  return (
    <nav aria-label="表示する範囲" className="inline-flex self-start overflow-hidden rounded-sharp border border-rule">
      <Link href={basePath} className={item(!includeVoided)} aria-current={!includeVoided ? "page" : undefined}>
        取消していないもの
      </Link>
      <Link
        href={`${basePath}?includeVoided=1`}
        className={`${item(includeVoided)} border-l border-rule`}
        aria-current={includeVoided ? "page" : undefined}
      >
        取消済みも含める
      </Link>
    </nav>
  );
}

/** 一覧の行（狭い画面ではカード、広い画面では表の行）。見出しの行は ListHead で出す。 */
export const listRowClass =
  "grid grid-cols-1 gap-1.5 rounded-sharp border border-rule bg-paper px-3 py-3 text-sm transition-colors hover:bg-paper-soft focus-visible:bg-paper-soft sm:items-center sm:gap-4 sm:rounded-none sm:border-x-0 sm:border-t-0 sm:bg-transparent sm:px-2";

export function ListHead({ columns, gridClass }: { readonly columns: readonly string[]; readonly gridClass: string }) {
  return (
    <div
      aria-hidden
      className={`hidden gap-4 border-b border-rule px-2 pb-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute sm:grid ${gridClass}`}
    >
      {columns.map((c) => (
        <span key={c}>{c}</span>
      ))}
    </div>
  );
}

/** カードの中で、狭い画面だけ見せる項目名（広い画面では列見出しが代わりになる。読み上げでは常に読む）。 */
export function CellLabel({ children }: { readonly children: ReactNode }) {
  return <span className="mr-2 text-xs text-ink-mute sm:sr-only">{children}</span>;
}

export const buttonPrimaryClass =
  "inline-flex min-h-11 items-center justify-center rounded-sharp bg-brand-700 px-5 text-sm font-medium text-paper transition-colors hover:bg-brand-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-40";
export const buttonGhostClass =
  "inline-flex min-h-11 items-center justify-center rounded-sharp border border-rule bg-paper px-4 text-sm text-ink-soft transition-colors hover:border-ink-soft hover:bg-paper-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-40";
export const buttonDangerClass =
  "inline-flex min-h-11 items-center justify-center rounded-sharp border border-signal-red bg-paper px-4 text-sm font-medium text-signal-red transition-colors hover:bg-signal-red-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-40";

/** 屋外で手袋でも押せる大きさの主ボタン（高さ 56px）。クラスの重ね書きで高さが競合しないよう、置き換えで作る。 */
export const buttonFieldClass = buttonPrimaryClass.replace("min-h-11", "min-h-14").replace("px-5", "px-8").replace("text-sm", "text-base");
/** 藍の枠のボタン（主ボタンの次に押してほしい操作）。 */
export const buttonOutlineBrandClass = buttonGhostClass
  .replace("border-rule ", "border-brand-700 ")
  .replace("text-ink-soft ", "font-medium text-brand-700 ")
  .replace("hover:border-ink-soft hover:bg-paper-soft", "hover:bg-brand-50");

/**
 * 技能証明書番号の表示。伏せた値（先頭が「*」）は、伏せた部分を薄く、見えている末尾を濃く示し、
 * 読み上げでは「末尾 4 桁は 2222（ほかは伏せています）」のように読む。伏せるかどうかはサーバー側が決める。
 */
export function LicenseNumber({ value, ...rest }: { readonly value: string } & Record<`data-${string}`, string>) {
  const m = /^(\*+)(.*)$/.exec(value);
  if (!m) {
    return (
      <span {...rest} className="break-all font-mono">
        {value}
      </span>
    );
  }
  const [, hidden, tail] = m;
  return (
    <span {...rest} className="inline-flex flex-wrap items-baseline gap-x-2">
      <span aria-hidden className="break-all font-mono tracking-wider">
        <span className="text-ink-mute/70">{"•".repeat(hidden!.length)}</span>
        <span className="text-ink">{tail}</span>
      </span>
      <span className="sr-only">
        末尾 {tail!.length} 桁は {tail}（ほかは伏せています）
      </span>
    </span>
  );
}

/** 読み直し後の結果表示（change-notice.tsx）の target。サーバー・クライアントの両方から使うため、ここに置く。 */
export const VERSION_NOTICE_TARGET = "versions";
/** 利用者の画面の結果表示の target（行ごと・招待）。利用者の内部 ID だけを使う。 */
export const memberNoticeTarget = (memberId: string): string => `member:${memberId}`;
export const MEMBER_INVITE_NOTICE_TARGET = "member-invite";
