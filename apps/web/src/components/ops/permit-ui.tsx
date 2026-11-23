import Link from "next/link";
import type { PermitBasisPlanDto, PermitDto, PermitVersionDto } from "@/server/ops/permits";
import type { PermitBasisDto } from "@/server/ops/plans";
import { PERMIT_KIND_LABEL, type PermitMatchStatus, type PermitValidity, type PlanPermitSummary } from "@/server/ops/permit-logic";
import type { PlanPermitCandidateDto } from "@/server/ops/permits";
import { Badge, Section, type BadgeTone } from "./ui";

// 許可・承認の登録・照合の表示部品（Sprint 12d 設計 G）。サーバー・クライアントのどちらからも使える（状態を持たない）。
// 状態は文字＋記号で示し、色は補助にとどめる（文言は server/ops/permit-logic.ts の定数 1 か所）。
// 登録は利用者の申告で、そらばんは許可書そのものを確認できない。DIPS には接続しない。

// 有効性の札は判定の色（赤・琥珀・緑）を使わない（ホームの「近づく期限」の札と同じ規則）：
// 期限切れ・失効・取消＝墨の面に「！」（alert）、期限が近い＝状態「注意」の面（soon）。形と文言で見分ける。
export const VALIDITY_TONE: Readonly<Record<PermitValidity, BadgeTone>> = {
  upcoming: "brand",
  valid: "green",
  expiring: "soon",
  expired: "alert",
  revoked: "alert",
  voided: "alert",
};

export const MATCH_TONE: Readonly<Record<PermitMatchStatus, BadgeTone>> = {
  applied: "green",
  reference: "brand",
  not_relevant: "neutral",
  not_applied: "amber",
  unregistered: "amber",
};

/** 照合の状態の枠（確認が要るものだけ破線の枠。状態は札の文字と記号で示す。色の線は使わない）。 */
const MATCH_EDGE: Readonly<Record<PermitMatchStatus, string>> = {
  applied: "",
  reference: "",
  not_relevant: "",
  not_applied: "opx-edge-attn",
  unregistered: "opx-edge-attn",
};

/** 登録の固定の文言（登録は利用者の申告。DIPS に接続しない）。 */
export function PermitDeclaration({ declaration, noDipsNote }: { readonly declaration: string; readonly noDipsNote: string }) {
  return (
    <div className="opx-notice flex flex-col gap-1.5" data-testid="permit-declaration">
      <p data-note="" className="text-sm font-bold leading-relaxed text-sb-ink">
        <span aria-hidden className="mr-1.5 sb-num">!</span>
        <span data-testid="permit-declaration-text">{declaration}</span>
      </p>
      <p data-note="" className="text-sm leading-relaxed text-sb-ink-2">
        <span data-testid="permit-no-dips-note">{noDipsNote}</span>
      </p>
    </div>
  );
}

export function PermitValidityBadge({ p }: { readonly p: Pick<PermitDto, "validity" | "validityLabel"> }) {
  // 文言（「× 期限切れ」など）はサーバーの定数。先頭の印だけを別の要素にして、期限切れ・失効・取消（墨の面）では見た目を「！」に替える
  // （.opx-mark-x を隠し、札の ::before に「！」を描く。文字は変えない：テキストと読み上げは「× 期限切れ」のまま）
  const m = /^(\S)\s+(.+)$/.exec(p.validityLabel);
  return (
    <Badge tone={VALIDITY_TONE[p.validity]} data-testid="permit-validity" data-validity={p.validity}>
      {m ? (
        <>
          <span aria-hidden className="opx-mark-x">
            {m[1]}
          </span>{" "}
          {m[2]}
        </>
      ) : (
        p.validityLabel
      )}
    </Badge>
  );
}

/** 範囲の要約（場所・機体・操縦者）。 */
export function permitScopeSummary(p: PermitDto): string {
  const aircraft = p.aircraftScope.type === "any" ? "機体：限定なし" : `機体：${p.aircraftScope.ids.length} 件`;
  const pilot = p.pilotScope.type === "any" ? "操縦者：限定なし" : `操縦者：${p.pilotScope.ids.length} 件`;
  return `場所：${p.placeSummary}／${aircraft}／${pilot}`;
}

/** 計画の「許可・承認の照合」（番号ごとの状態・理由・登録の版へのリンク）。 */
export function PlanPermitList({ summary }: { readonly summary: PlanPermitSummary }) {
  if (summary.numbers.length === 0) {
    return (
      <p className="sb-block-soft text-sb-ink-2" data-testid="plan-permit-empty">
        許可・承認の番号が入っていません。DIPS の許可・承認は、登録した許可の番号を計画の許可番号の欄に入れたときだけ判定に使われます。
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="plan-permit-list">
      {summary.numbers.map((n) => (
        <li key={n.numberText} className={`opx-edge-row ${MATCH_EDGE[n.status]}`.trim()} data-testid="plan-permit-row" data-status={n.status}>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="break-all sb-num text-[1rem] text-sb-ink" data-testid="plan-permit-number">{n.numberText}</span>
            <Badge tone={MATCH_TONE[n.status]} data-testid="plan-permit-status">{n.statusLabel}</Badge>
          </p>
          {n.reasons.length > 0 ? (
            <ul className="list-disc pl-5 text-sm leading-relaxed text-sb-ink" data-testid="plan-permit-reasons">
              {n.reasons.map((r) => (
                <li key={r.code} data-reason={r.code}>{r.label}</li>
              ))}
            </ul>
          ) : null}
          {n.registrationId ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-sb-ink-2">
              <span className="sb-num tnum" data-testid="plan-permit-version">版 {n.versionNo}</span>
              {n.validFrom && n.validTo ? (
                <span className="sb-num tnum">{n.validFrom} 〜 {n.validTo}</span>
              ) : null}
              {n.kinds.length > 0 ? <span data-testid="plan-permit-kinds">関係した種類：{n.kinds.map((k) => k.label).join("、")}</span> : null}
              <Link prefetch={false} href={`/ops/permits/${n.registrationId}${n.versionNo ? `?version=${n.versionNo}#v${n.versionNo}` : ""}`} className="inline-flex min-h-12 items-center font-bold text-sb-ink underline decoration-sb-primary decoration-2 underline-offset-4" data-testid="plan-permit-link">
                登録を見る
              </Link>
            </p>
          ) : null}
          {n.conditionsText ? (
            <p className="break-all text-sm leading-relaxed text-sb-ink-2" data-testid="plan-permit-conditions">
              <span className="font-medium text-sb-ink">許可書の条件（照合していません）：</span>
              {n.conditionsText}
            </p>
          ) : null}
          {n.scopeNotes.map((s) => (
            <p key={s} className="text-sm leading-relaxed text-sb-ink-2">{s}</p>
          ))}
        </li>
      ))}
    </ul>
  );
}

/** 範囲に収まる登録済みの許可の候補（提案だけで、判定には使わない）。ボタンは画面の入力欄に足す（クライアント側の部品が受け持つ）。 */
export function CandidateSummary({ c }: { readonly c: PlanPermitCandidateDto }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="break-all sb-num text-sm text-sb-ink">{c.permitNumber}</span>
      <span className="text-sm text-sb-ink-2">
        {c.coverageLabel}／{c.kinds.map((k) => k.label).join("、")}／版 {c.versionNo}／{c.validFrom} 〜 {c.validTo}
      </span>
    </span>
  );
}

/** 判定の根拠のうち、根拠にした登録の版（スナップショット詳細）。ハッシュが合わなければ文字と記号で示す。 */
export function PermitBasisSection({ basis }: { readonly basis: readonly PermitBasisDto[] }) {
  return (
    <Section
      title="根拠にした許可・承認の登録"
      aria-label="根拠にした許可・承認の登録"
      description="判定に使った許可・承認の登録の版です。登録は利用者の入力です。許可書で確認してください。登録をあとで訂正しても、当時の版は履歴に残ります。"
    >
      {basis.length === 0 ? (
        <p className="text-sm text-sb-ink-3" data-testid="basis-permits-empty">この判定が根拠にした許可・承認の登録はありません。</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="basis-permits">
          {basis.map((b) => (
            <li key={`${b.registrationId}-${b.versionNo}`} className={`opx-edge-row ${b.versionExists && b.hashMatches ? "" : "opx-edge-attn"}`.trim()} data-testid="basis-permit" data-applied={String(b.applied)}>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="break-all sb-num text-[1rem] text-sb-ink" data-testid="basis-permit-number">{b.permitNumber}</span>
                <Badge tone={b.applied ? "green" : "brand"} data-testid="basis-permit-applied">
                  {b.applied ? "● 適用" : "◇ 参考（空港等周辺。判定の段は変えていません）"}
                </Badge>
                <span className="sb-num text-sm tnum text-sb-ink-2" data-testid="basis-permit-version">版 {b.versionNo}</span>
                {b.versionExists && b.hashMatches ? (
                  <Badge tone="green" data-testid="basis-permit-hash">✓ 版のハッシュが一致します</Badge>
                ) : (
                  <Badge tone="amber" data-testid="basis-permit-hash">! 版が一致しません</Badge>
                )}
              </p>
              <p className="break-all sb-num text-sm text-sb-ink-2" data-testid="basis-permit-hash-value">{b.versionHash}</p>
              <p className="text-sm leading-relaxed text-sb-ink-2">
                <span data-testid="basis-permit-period">有効期間：{b.validFrom} 〜 {b.validTo}</span>
                <span className="ml-3">照合した飛行の日付：{b.window.from === b.window.to ? b.window.from : `${b.window.from} 〜 ${b.window.to}`}</span>
                <span className="ml-3">関係した種類：{b.kinds.map((k) => PERMIT_KIND_LABEL[k] ?? k).join("、")}</span>
              </p>
              <Link
                prefetch={false}
                href={`/ops/permits/${b.registrationId}?version=${b.versionNo}#v${b.versionNo}`}
                className="inline-flex min-h-12 items-center self-start text-sm font-bold text-sb-ink underline decoration-sb-primary decoration-2 underline-offset-4"
                data-testid="basis-permit-link"
              >
                当時の版（版 {b.versionNo}）を見る
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** 登録の版の履歴（ハッシュの連鎖つき）。?version=N の版を強調し、各版に #vN のアンカーを持つ。 */
export function PermitVersionList({ versions, highlight }: { readonly versions: readonly PermitVersionDto[]; readonly highlight: number | null }) {
  return (
    <Section
      title="版の履歴"
      aria-label="版の履歴"
      description="登録・訂正・失効・取消のたびに版が 1 つ増えます。前の版は書き換えられず、判定の根拠から当時の内容に辿れます。"
    >
      <ol className="flex flex-col gap-2" data-testid="permit-version-list">
        {versions.map((v) => {
          const content = v.content;
          return (
            <li
              key={v.versionNo}
              id={`v${v.versionNo}`}
              className={`opx-edge-row scroll-mt-24 ${highlight === v.versionNo ? "opx-edge-hl" : ""}`.trim()}
              data-testid="permit-version-row"
              data-version={String(v.versionNo)}
              data-highlight={String(highlight === v.versionNo)}
            >
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="sb-num text-sm tnum text-sb-ink-3">版 {v.versionNo}</span>
                <Badge tone={v.op === "void" ? "red" : v.op === "create" ? "brand" : "neutral"} data-testid="permit-version-op">
                  {v.op === "create" ? "登録" : v.op === "void" ? "取消" : content.status === "revoked" && v.changedFields.includes("状態") ? "失効" : "訂正"}
                </Badge>
                {highlight === v.versionNo ? <Badge tone="brand" data-testid="permit-version-highlight">◆ 判定の根拠にした版</Badge> : null}
                <time dateTime={v.createdAt} className="sb-num text-sm tnum">{v.createdAtJst}</time>
                <span className="break-all">{v.actorName}</span>
              </p>
              {v.reason ? <p className="break-all text-sb-ink-2"><span className="text-sm text-sb-ink-3">理由：</span>{v.reason}</p> : null}
              {v.changedFields.length > 0 ? (
                <p className="text-sb-ink-2" data-testid="permit-version-changed">
                  <span className="text-sm text-sb-ink-3">変わった項目：</span>
                  {v.changedFields.join("、")}
                </p>
              ) : null}
              <p className="break-all sb-num text-sm text-sb-ink-2" data-testid="permit-version-hash">{v.contentHash}</p>
              <p className="break-all text-sm text-sb-ink-2" data-testid="permit-version-content">
                <span className="text-sb-ink-3">この版の内容：</span>
                番号 {content.permitNumber}／{content.coverage === "blanket" ? "包括許可" : "個別許可"}／{content.validFrom} 〜 {content.validTo}
                {content.status === "revoked" ? `／失効日 ${content.revokedOn}` : ""}
              </p>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/** この登録を根拠にしている計画（現在のスナップショットの根拠から。中止した計画は除く）。 */
export function BasisPlanList({ plans, count }: { readonly plans: readonly PermitBasisPlanDto[]; readonly count: number }) {
  return (
    <Section title="この登録を根拠にしている計画" aria-label="この登録を根拠にしている計画" description="計画の現在の判定が根拠にしている登録の版です。">
      <p className="text-sm text-sb-ink" data-testid="permit-basis-count">{count} 件</p>
      {plans.length === 0 ? null : (
        <ul className="flex flex-col gap-2" data-testid="permit-basis-plans">
          {plans.map((p) => (
            <li key={p.planId} className="rounded-sb-m bg-sb-surface" data-testid="permit-basis-plan">
              <Link prefetch={false} href={`/ops/plans/${p.planId}/judgement`} className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 rounded-sb-m px-3 py-2.5 text-sm hover:bg-sb-hover">
                <span className="break-words text-sb-ink">{p.title}</span>
                <span className="sb-num text-sm tnum text-sb-ink-2">{p.plannedDate}</span>
                <span className="sb-num text-sm tnum text-sb-ink-3">根拠の版 {p.versionNo ?? "—"}</span>
                {!p.isCurrentVersion ? <Badge tone="amber">! 登録は版が進んでいます（判定が古い）</Badge> : null}
                {!p.applied ? <Badge tone="brand">◇ 参考</Badge> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
