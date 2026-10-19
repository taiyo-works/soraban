import { SignOutButton } from "@/components/ops/ops-client";
import { requireOpsEnabled } from "@/server/ops/page";

// 本人確認はできたが、そらばんの利用者として扱えない場合の画面（招待されていない・確認されていないメールアドレス・停止）。
export default async function OpsNoAccess() {
  const provider = await requireOpsEnabled();
  return (
    <main className="flex max-w-xl flex-col gap-6">
      <h1 className="font-display text-2xl font-light leading-tight text-ink sm:text-3xl" data-testid="ops-no-access">
        権限がありません
      </h1>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-ink-soft">
        <p>運航管理者に招待を依頼してください。</p>
        <p className="text-xs text-ink-mute">次のいずれかに当たる場合、この画面が表示されます。</p>
        <ul className="flex flex-col gap-1 border-l-2 border-rule pl-3 text-xs text-ink-mute">
          <li>ログインしたメールアドレスが招待されていない</li>
          <li>メールアドレスの確認が済んでいない</li>
          <li>利用が停止されている</li>
        </ul>
        <p className="text-xs text-ink-mute">別の Google アカウントで入り直す場合は、いったんログアウトしてください。</p>
      </div>
      <div>
        <SignOutButton provider={provider} />
      </div>
    </main>
  );
}
