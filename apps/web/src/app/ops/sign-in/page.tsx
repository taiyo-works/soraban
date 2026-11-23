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
        <div className="sb-block flex flex-col gap-5">
          <p className="text-sm leading-relaxed text-sb-ink-2">
            運航管理者から招待されたメールアドレスの Google アカウントでログインしてください。
          </p>
          <GoogleSignInButton />
          <Note body>
            招待されていないメールアドレスでは利用できません。利用したい場合は、社内の運航管理者に招待を依頼してください。
          </Note>
        </div>
      ) : (
        <p className="sb-block-soft text-sm leading-relaxed text-sb-ink-2">
          テスト用の本人確認を使っています（AUTH_PROVIDER=test）。POST /api/test-auth/sign-in でログインしてください。
        </p>
      )}
    </main>
  );
}
