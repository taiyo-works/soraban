import { GoogleSignInButton } from "@/components/ops/ops-client";
import { Note, PageHeader } from "@/components/ops/ui";
import { requireOpsEnabled } from "@/server/ops/page";

// サインイン：neon は Google ログインのボタンだけ（メールとパスワードの画面は作らない）。test ではこの画面を使わない。
export default async function OpsSignIn() {
  const provider = await requireOpsEnabled();
  return (
    <main className="flex max-w-xl flex-col gap-6">
      <PageHeader title="ログイン" />
      {provider === "neon" ? (
        <div className="flex flex-col gap-5 rounded-sharp border border-rule bg-paper px-4 py-5 sm:px-6">
          <p className="text-sm leading-relaxed text-ink-soft">
            運航管理者から招待されたメールアドレスの Google アカウントでログインしてください。
          </p>
          <GoogleSignInButton />
          <Note>
            招待されていないメールアドレスでは利用できません。利用したい場合は、社内の運航管理者に招待を依頼してください。
          </Note>
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-ink-soft">
          テスト用の本人確認を使っています（AUTH_PROVIDER=test）。POST /api/test-auth/sign-in でログインしてください。
        </p>
      )}
    </main>
  );
}
