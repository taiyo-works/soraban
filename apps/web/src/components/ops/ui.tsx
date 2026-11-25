import Link from "next/link";
import type { ReactNode } from "react";

// 運航管理（Sprint 10）の画面で共通に使う見た目の部品（サーバー・クライアントのどちらからも使える）。
// Sprint 12h PR ③b：デザインシステム v2（暖色・ピル・角丸 16/8/4）。見た目は app/ops/ops-v2.css の .opx-*（と soraban-ui.css の .sb-*）で、値は --sb-* だけ。
// 色だけで意味を伝えないよう、状態は必ず文字で示し、形（実線・破線・反転）を併用する。

// "alert"（期限切れ・失効など。墨の面＋「！」）と "soon"（期限が近い。状態「注意」の面）は、期限の札用。判定の色（赤・琥珀・緑）は使わない（形と言葉で区別する）。
export type Tone = "neutral" | "brand" | "green" | "amber" | "red" | "mute";
export type BadgeTone = Tone | "alert" | "soon";

const toneClass: Record<BadgeTone, string> = {
  neutral: "",
  brand: "opx-badge-brand",
  green: "opx-badge-green",
  amber: "opx-badge-amber",
  red: "opx-badge-red",
  mute: "opx-badge-mute",
  alert: "opx-badge-alert",
  soon: "opx-badge-soon",
};

/** 状態・役割などの小さな札。中身は文字だけにする（data-testid 等の属性はそのまま渡せる）。mark は先頭の印（読み上げない。「！」など）。 */
export function Badge({
  tone = "neutral",
  mark,
  children,
  ...rest
}: { readonly tone?: BadgeTone; readonly mark?: string; readonly children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <span {...rest} className={`opx-badge ${toneClass[tone]}`.trim()}>
      {mark ? <span aria-hidden>{mark}</span> : null}
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
  meta,
  back,
  aside,
  children,
}: {
  readonly title: ReactNode;
  readonly eyebrow?: string;
  /** 見出しの右に添える短い説明（画面の副題）。 */
  readonly meta?: ReactNode;
  readonly back?: { readonly href: string; readonly label: string };
  readonly aside?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {back ? (
        <Link href={back.href} prefetch={false} className="opx-back">
          <span aria-hidden>← </span>
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow ? <p data-note="" className="opx-eyebrow">{eyebrow}</p> : null}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="opx-h1">{title}</h1>
            {meta ? <span className="text-sm text-sb-ink-3">{meta}</span> : null}
          </div>
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** 画面内の区切り（v2 の見出し：左 5px の墨の線）。 */
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
    <section {...rest} {...(id ? { id } : {})} className="flex scroll-mt-4 flex-col gap-4 lg:gap-3">
      <div className="sb-sec-head" {...(tone === "danger" ? { "data-tone": "danger" } : {})}>
        <h2>{title}</h2>
        {description ? <p className="sb-sec-note sb-sec-note-body">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** 短い説明（権限・取消の意味など）。くぼみの面に置く。 */
export function Note({ children, tone = "brand", body = false }: { readonly children: ReactNode; readonly tone?: "brand" | "red"; readonly body?: boolean }) {
  // 既定は補足（定型の免責・断り書き。印 data-note="" で 14px・1.5）。body は本文（説明文。16px・1.7。印なし）
  return (
    <p className={`opx-note ${body ? "opx-note-lg " : ""}${tone === "red" ? "opx-note-red" : ""}`.trim()} {...(body ? {} : { "data-note": "" })}>
      {children}
    </p>
  );
}

/** 常に見える固定の注意書き（折りたたまない）。くぼみの面。warn・danger は枠の形（破線・実線）でも区別する。 */
export function Notice({
  meaning = "neutral",
  title,
  children,
  ...rest
}: {
  readonly meaning?: "neutral" | "info" | "warn" | "danger" | "ok";
  readonly title?: string;
  readonly children: ReactNode;
} & Record<`data-${string}`, string>) {
  return (
    <div {...rest} role="note" data-meaning={meaning} className="opx-notice">
      {title ? <p className="font-bold text-sb-ink">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

/** 詳細画面の項目の並び（狭い画面では見出しの下に値、広い画面では 2 列）。白いカードの中に置く。 */
export function DetailList({
  rows,
  compact = false,
  ...rest
}: { readonly rows: readonly (readonly [string, ReactNode])[]; readonly compact?: boolean } & Record<`data-${string}`, string>) {
  return (
    <dl {...rest} className={`opx-card opx-detail${compact ? " opx-detail-compact" : ""}`}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 一覧の「取消していないもの／取消済みも含める」の切り替え（チップ。現在地は実線＋太字＋aria-current）。 */
export function VoidedToggle({ basePath, includeVoided }: { readonly basePath: string; readonly includeVoided: boolean }) {
  return (
    <nav aria-label="表示する範囲" className="opx-seg">
      <a href={basePath} aria-current={!includeVoided ? "page" : undefined}>
        取消していないもの
      </a>
      <a href={`${basePath}?includeVoided=1`} aria-current={includeVoided ? "page" : undefined}>
        取消済みも含める
      </a>
    </nav>
  );
}

/** 一覧の行（狭い画面では白いカード、広い画面では表の行）。見出しの行は ListHead で出す。 */
export const listRowClass = "opx-row";

export function ListHead({ columns, gridClass }: { readonly columns: readonly string[]; readonly gridClass: string }) {
  return (
    <div aria-hidden className={`opx-listhead ${gridClass}`}>
      {columns.map((c) => (
        <span key={c}>{c}</span>
      ))}
    </div>
  );
}

/** カードの中で、狭い画面だけ見せる項目名（広い画面では列見出しが代わりになる。読み上げでは常に読む）。 */
export function CellLabel({ children }: { readonly children: ReactNode }) {
  return <span className="opx-cell-label">{children}</span>;
}

export const buttonPrimaryClass = "opx-btn opx-btn-primary";
export const buttonGhostClass = "opx-btn";
/** 文字ボタン（背景なし・主色の文字・高さ 48）。 */
export const buttonTextClass = "opx-btn opx-btn-text";
export const buttonDangerClass = "opx-btn opx-btn-danger";

/** 屋外で手袋でも押せる大きさの主ボタン（高さ 56px 以上。現場は 64px）。 */
export const buttonFieldClass = "opx-btn opx-btn-primary opx-btn-field";
/** 縁の太いボタン（主ボタンの次に押してほしい操作）。 */
export const buttonOutlineBrandClass = "opx-btn";

/**
 * 技能証明書番号の表示。伏せた値（先頭が「*」）は、伏せた部分を薄く、見えている末尾を濃く示し、
 * 読み上げでは「末尾 4 桁は 2222（ほかは伏せています）」のように読む。伏せるかどうかはサーバー側が決める。
 */
export function LicenseNumber({ value, ...rest }: { readonly value: string } & Record<`data-${string}`, string>) {
  const m = /^(\*+)(.*)$/.exec(value);
  if (!m) {
    return (
      <span {...rest} className="break-all sb-num tnum">
        {value}
      </span>
    );
  }
  const [, hidden, tail] = m;
  return (
    <span {...rest} className="inline-flex flex-wrap items-baseline gap-x-2">
      <span aria-hidden className="break-all sb-num tracking-wider">
        <span className="text-sb-ink-3">{"•".repeat(hidden!.length)}</span>
        <span className="text-sb-ink">{tail}</span>
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
