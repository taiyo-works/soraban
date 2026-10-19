import { SignOutButton } from "@/components/ops/ops-client";
import { requireOpsEnabled } from "@/server/ops/page";

// 本人確認はできたが、そらばんの利用者として扱えない場合の画面（招待されていない・確認されていないメールアドレス・停止）。
export default async function OpsNoAccess() {
  const provider = await requireOpsEnabled();
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-lg text-ink" data-testid="ops-no-access">
        権限がありません
      </h1>
      <p className="text-sm text-ink-soft">運航管理者に招待を依頼してください。</p>
      <div>
        <SignOutButton provider={provider} />
      </div>
    </main>
  );
}
