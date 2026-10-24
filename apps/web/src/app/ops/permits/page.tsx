import Link from "next/link";
import { PermitDeclaration, PermitValidityBadge, permitScopeSummary } from "@/components/ops/permit-ui";
import { Badge, buttonGhostClass, buttonPrimaryClass, ListHead, listRowClass, Note, PageHeader, VoidedToggle } from "@/components/ops/ui";
import { can } from "@/server/ops/authz";
import { requireOpsMember } from "@/server/ops/page";
import { PERMIT_DECLARATION_NOTE, PERMIT_FORMAT_UNVERIFIED_NOTE, PERMIT_NO_DIPS_NOTE, PERMIT_VALIDITY_LABEL, type PermitValidity } from "@/server/ops/permit-logic";
import { listPermits } from "@/server/ops/permits";
import { BACK_TO } from "@/components/ops/ops-nav-model";

const GRID = "sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,11rem)_minmax(0,9rem)]";
const VALIDITIES = Object.keys(PERMIT_VALIDITY_LABEL) as PermitValidity[];

// 許可・承認の登録の一覧（Sprint 12d 設計 G）。全役割が見られる。登録・訂正・失効・取消は運航管理者だけ。
// 登録は利用者の申告で、そらばんは許可書そのものを確認できない。DIPS には接続しない。取消は既定で出さない（?includeVoided=1）。
export default async function PermitListPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ includeVoided?: string; validity?: string; q?: string }>;
}) {
  const { ctx, me } = await requireOpsMember();
  const sp = await searchParams;
  const includeVoided = sp.includeVoided === "1";
  const validity = VALIDITIES.find((v) => v === sp.validity);
  const q = sp.q?.trim() || undefined;
  const rows = await listPermits(ctx, { includeVoided, ...(validity ? { validity } : {}), ...(q ? { q } : {}) });
  const manager = can(me.member.role, "permit.create");
  return (
    <main className="flex flex-col gap-6">
      <PageHeader
        title="許可・承認"
        eyebrow="登録（利用者の申告）"
        back={BACK_TO.register}
        aside={
          manager ? (
            <Link prefetch={false} href="/ops/permits/new" className={buttonPrimaryClass} data-testid="permit-new-link">
              許可・承認を登録
            </Link>
          ) : null
        }
      >
        <PermitDeclaration declaration={PERMIT_DECLARATION_NOTE} noDipsNote={PERMIT_NO_DIPS_NOTE} />
        <Note>登録した許可の番号を計画の許可番号の欄に入れると、計画の日時・場所・機体・操縦者が範囲に収まるときだけ判定に使われます。範囲外・期限切れ・失効・確認できないものは、要手続きのままです。</Note>
        <p className="border-l-2 border-signal-amber pl-3 text-xs leading-relaxed text-ink-soft" data-testid="permit-format-note">{PERMIT_FORMAT_UNVERIFIED_NOTE}</p>
        {manager ? null : <Note>許可・承認の登録・訂正・失効・取消は運航管理者だけが行えます。</Note>}
      </PageHeader>

      <form method="get" className="flex flex-wrap items-end gap-3" data-testid="permit-filter" aria-label="許可・承認の絞り込み">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-mute">
          番号・空港名
          <input name="q" defaultValue={q ?? ""} className="min-h-11 w-56 max-w-full rounded-sharp border border-rule bg-paper px-3 text-base text-ink sm:text-sm" data-testid="permit-filter-q" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-mute">
          有効性
          <select name="validity" defaultValue={validity ?? ""} className="min-h-11 rounded-sharp border border-rule bg-paper px-3 text-base text-ink sm:text-sm" data-testid="permit-filter-validity">
            <option value="">すべて</option>
            {VALIDITIES.map((v) => (
              <option key={v} value={v}>
                {PERMIT_VALIDITY_LABEL[v]}
              </option>
            ))}
          </select>
        </label>
        {includeVoided ? <input type="hidden" name="includeVoided" value="1" /> : null}
        <button type="submit" className={buttonGhostClass} data-testid="permit-filter-submit">
          絞り込む
        </button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <VoidedToggle basePath="/ops/permits" includeVoided={includeVoided} />
        <p className="font-mono text-[11px] tnum text-ink-mute" data-testid="permit-count">{rows.length} 件</p>
      </div>

      {rows.length === 0 ? (
        <p className="border-y border-rule py-6 text-center text-sm text-ink-mute" data-testid="permit-empty">登録された許可・承認はありません。</p>
      ) : (
        <div className="flex flex-col">
          <ListHead columns={["番号", "種類", "有効期間", "有効性"]} gridClass={GRID} />
          <ul className="flex flex-col gap-2 sm:gap-0" data-testid="permit-list">
            {rows.map((p) => (
              <li key={p.id}>
                <Link prefetch={false} href={`/ops/permits/${p.id}`} className={`${listRowClass} ${GRID} ${p.voided ? "text-ink-mute" : ""}`} data-testid="permit-row" data-validity={p.validity}>
                  <span className="min-w-0 break-all font-mono text-[15px] text-ink" data-testid="permit-row-number">{p.permitNumber}</span>
                  <span className="flex min-w-0 flex-col gap-0.5 text-ink-soft">
                    <span data-testid="permit-row-kinds">
                      {p.coverageLabel}：{p.kinds.map((k) => k.label).join("、")}
                    </span>
                    <span className="text-xs text-ink-soft" data-testid="permit-row-scope">{permitScopeSummary(p)}</span>
                  </span>
                  <span className="font-mono text-xs tnum text-ink-soft" data-testid="permit-row-period">
                    {p.validFrom} 〜 {p.validTo}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <PermitValidityBadge p={p} />
                    {p.revokedOn ? <Badge tone="red">失効日 {p.revokedOn}</Badge> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
