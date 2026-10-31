import { headers } from "next/headers";
import { DESIGN_CATALOG_HEADER } from "@/lib/design-catalog";
import { getOpsAvailability } from "@/server/ops/availability";
import { getSignedInMember } from "@/server/ops/member-gate";
import { ROLE_LABELS } from "@/server/ops/page";
import { DraftOwnerGuard } from "./ops-client";
import { OpsBottomNav, OpsSidebar, OpsTopBar } from "./ops-nav";
import { ROLE_DESCRIPTIONS } from "./ui";

// メニュー（PC の左メニューとスマホの下タブ）と上のバー（利用者メニュー）を出してよいか（運航管理が有効でログイン済みの利用者）を
// サーバーで決めてから描く。無効・未ログインでは何も描かず、追加の通信もしない。Suspense の内側で使う（静的なシェルを変えない）。
// Sprint 12g：デザイン見本は認証・DB を使わない。proxy.ts が付けた印があれば、利用者の確認（認証・DB）をしない。
const skip = async (): Promise<boolean> =>
  (await headers()).get(DESIGN_CATALOG_HEADER) === "1";

export async function OpsNavGate() {
  if (await skip()) return null;
  const ctx = await getSignedInMember();
  if (!ctx) return null;
  return <OpsSidebar role={ctx.member.role} />;
}

// スマホの下の 5 タブは、Tab の順で本文のあとになるよう、枠の最後に置く（見た目は画面下に固定）。
export async function OpsBottomNavGate() {
  if (await skip()) return null;
  const ctx = await getSignedInMember();
  if (!ctx) return null;
  return <OpsBottomNav />;
}

export async function OpsTopBarGate() {
  if (await skip()) return null;
  const ctx = await getSignedInMember();
  if (!ctx) return null;
  const availability = getOpsAvailability(process.env);
  if (availability.state !== "enabled") return null;
  const role = ctx.member.role;
  // Sprint 15（F-1）：ログイン中のすべての /ops の画面で、前の利用者の下書き・送信待ち・先読みの束を消し、「いまの利用者」を書き換える
  // （ログアウトせずに別の利用者がログインしても、どの画面を通っても前の利用者の分が残らない）
  return (
    <>
      <DraftOwnerGuard memberId={ctx.member.id} />
      <OpsTopBar
        user={{
          memberId: ctx.member.id,
          name: ctx.member.display_name,
          email: ctx.member.email,
          role,
          roleLabel: ROLE_LABELS[role],
          roleDescription: ROLE_DESCRIPTIONS[role],
          provider: availability.provider,
        }}
      />
    </>
  );
}
