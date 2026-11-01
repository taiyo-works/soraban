import type { Metadata } from "next";
import { ENGINE_VERSION } from "@soraban/regulations";
import { ProviderInfo } from "@/components/provider-info";
import { DraftOwnerGuard } from "@/components/ops/ops-client";
import { BACK_TO } from "@/components/ops/ops-nav-model";
import { PageHeader, Section } from "@/components/ops/ui";
import { BOUNDARY_FULL } from "@/lib/boundary";
import { DISCLAIMER_INSPECTION, DISCLAIMER_JUDGEMENT, DISCLAIMER_RECORD } from "@/lib/disclaimers";
import { requireOpsMember } from "@/server/ops/page";

// このアプリについて（Sprint 18-3 §5.4）。提供元の表記・境界・免責を 1 か所にまとめる。ログインした全役割が読める（運航管理者・操縦者・閲覧者）。
// 入口：右上の利用者メニュー（user-menu-about）と、登録のタブの末尾（more-link-about）。どちらも 2 回の操作（Sprint 18 §12 の Q6）。
// 文言は専門家確認の前の暫定版（lib/boundary.ts・lib/disclaimers.ts）。提供元の値は lib/provider-info.ts の確認済みの 6 項目だけ。
export const metadata: Metadata = { title: "このアプリについて" };

export default async function OpsAboutPage() {
  const { me } = await requireOpsMember();
  return (
    <main className="flex flex-col gap-8" data-testid="ops-about">
      <DraftOwnerGuard memberId={me.member.id} />
      <PageHeader title="このアプリについて" back={BACK_TO.register} />
      <Section title="提供元">
        <div className="sb-block">
          <ProviderInfo testId="about-provider" />
        </div>
      </Section>
      <Section title="このアプリの範囲">
        <div className="sb-block">
          <p data-testid="about-boundary" className="text-[15px] leading-relaxed text-sb-ink">
            {BOUNDARY_FULL}
          </p>
        </div>
      </Section>
      <Section title="免責">
        <div className="sb-block flex flex-col gap-3" data-testid="about-disclaimer">
          <p data-testid="about-disclaimer-judgement" className="text-[15px] leading-relaxed text-sb-ink">
            {DISCLAIMER_JUDGEMENT}
          </p>
          <p data-testid="about-disclaimer-inspection" className="text-[15px] leading-relaxed text-sb-ink">
            {DISCLAIMER_INSPECTION}
          </p>
          <p data-testid="about-disclaimer-record" className="text-[15px] leading-relaxed text-sb-ink">
            {DISCLAIMER_RECORD}
          </p>
        </div>
      </Section>
      <p data-testid="about-version" className="text-[13px] text-sb-ink-3">
        判定の版：<span className="sb-num">{ENGINE_VERSION}</span>
      </p>
    </main>
  );
}
