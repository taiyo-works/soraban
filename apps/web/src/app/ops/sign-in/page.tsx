import { GoogleSignInButton } from "@/components/ops/ops-client";
import { requireOpsEnabled } from "@/server/ops/page";

// サインイン：neon は Google ログインのボタンだけ（メールとパスワードの画面は作らない）。test ではこの画面を使わない。
export default async function OpsSignIn() {
  const provider = await requireOpsEnabled();
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-lg text-ink">ログイン</h1>
      {provider === "neon" ? (
        <>
          <p className="text-sm text-ink-soft">
            運航管理者から招待されたメールアドレスの Google アカウントでログインしてください。
          </p>
          <GoogleSignInButton />
        </>
      ) : (
        <p className="text-sm text-ink-soft">
          テスト用の本人確認を使っています（AUTH_PROVIDER=test）。POST /api/test-auth/sign-in でログインしてください。
        </p>
      )}
    </main>
  );
}
