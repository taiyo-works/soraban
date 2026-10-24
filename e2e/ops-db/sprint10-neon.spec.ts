import { expect, test } from "@playwright/test";
import { openUserMenu } from "../ops-menu";

// Sprint 10 差し戻し A：AUTH_PROVIDER=neon で Google ログインが完了すること（Neon Auth の上流は模擬サーバー）。
//   (a) Google から戻ったとき（?neon_auth_session_verifier=… と challenge Cookie）に session_token が設定され、/ops が表示される
//   (b) セッションの Cookie の更新（session_data の発行・作り直し）があっても、ログイン画面に戻されない
// 模擬サーバー：e2e/mock-neon-auth-server.mjs。利用者は packages/db/src/ops-seed.ts の a-neon・a-neon2（招待中）。

const NEON = `http://localhost:${process.env.E2E_OPS_NEON_PORT ?? 3301}`;
const PREFIX = "__Secure-neon-auth";
const cookie = (name: string, value: string) => ({
  name: `${PREFIX}.${name}`,
  value,
  domain: "localhost",
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
});

test.describe.configure({ mode: "serial" });

test.describe("Sprint 10 E2E-DB：Neon Auth（模擬の上流）", () => {
  test("未ログインで /ops を開くとサインイン画面（Google のボタン）に移る", async ({ page }) => {
    await page.goto(`${NEON}/ops/aircraft`);
    await expect(page).toHaveURL(/\/ops\/sign-in/);
    await expect(page.getByRole("button", { name: /Google でログイン/ })).toBeVisible();
  });

  test("(a) Google から戻ると verifier がセッションに交換され、session_token が設定されて /ops が表示される", async ({ page, context }) => {
    await context.addCookies([cookie("session_challenge", "c-neon")]);
    await page.goto(`${NEON}/ops?neon_auth_session_verifier=v-neon`);
    // verifier を取り除いた /ops に移り、サインイン画面に戻されない
    await expect(page).toHaveURL(`${NEON}/ops`);
    await openUserMenu(page);
    await expect(page.getByTestId("ops-me-name")).toHaveText("ネオン 太郎");
    await expect(page.getByTestId("ops-me-role")).toContainText("操縦者");
    const jar = await context.cookies(NEON);
    expect(jar.find((c) => c.name === `${PREFIX}.session_token`)?.value).toBe("tok-neon");
    expect(jar.find((c) => c.name === `${PREFIX}.session_challenge`)).toBeUndefined();
    // 続けて別の画面も開ける（API も同じセッションで通る）
    await page.goto(`${NEON}/ops/aircraft`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("機体");
    expect((await page.request.get(`${NEON}/api/ops/me`)).status()).toBe(200);
  });

  test("(b) session_token だけ（session_data なし・壊れた session_data）でも、Cookie を更新して /ops が表示される", async ({ page, context }) => {
    await context.addCookies([cookie("session_token", "tok-neon2")]);
    await page.goto(`${NEON}/ops`);
    await expect(page).toHaveURL(`${NEON}/ops`);
    await openUserMenu(page);
    await expect(page.getByTestId("ops-me-name")).toHaveText("ネオン 花子");
    let jar = await context.cookies(NEON);
    const data1 = jar.find((c) => c.name === `${PREFIX}.local.session_data`)?.value;
    expect(data1, "session_data が発行されていない").toBeTruthy();

    // 壊れた session_data に差し替えても、作り直してログイン画面に戻されない
    await context.addCookies([cookie("local.session_data", "broken.jwt.value")]);
    await page.goto(`${NEON}/ops/pilots`);
    await expect(page).toHaveURL(`${NEON}/ops/pilots`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("操縦者");
    jar = await context.cookies(NEON);
    const data2 = jar.find((c) => c.name === `${PREFIX}.local.session_data`)?.value;
    expect(data2).toBeTruthy();
    expect(data2).not.toBe("broken.jwt.value");
  });

  test("サインイン画面・権限なしの画面は保護しないが、Google から戻ったときの交換は行う", async ({ page, context }) => {
    await page.goto(`${NEON}/ops/no-access`);
    await expect(page).toHaveURL(`${NEON}/ops/no-access`);
    await context.addCookies([cookie("session_challenge", "c-neon")]);
    await page.goto(`${NEON}/ops/sign-in?neon_auth_session_verifier=v-neon`);
    await expect(page).toHaveURL(`${NEON}/ops/sign-in`);
    const jar = await context.cookies(NEON);
    expect(jar.find((c) => c.name === `${PREFIX}.session_token`)?.value).toBe("tok-neon");
  });
});
