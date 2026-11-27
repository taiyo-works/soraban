import { createRequire } from "node:module";
const require = createRequire("/home/user/soraban/package.json");
export const { chromium, request } = require("@playwright/test");
export const BASE = "http://127.0.0.1:3400";
export const SHOT = "/home/user/soraban/docs/evaluations/screenshots/sprint-16I-reeval";
export async function launch() {
  return chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
}
export async function signedCtx(browser, key, opts = {}) {
  const ctx = await browser.newContext({ baseURL: BASE, ...opts });
  const r = await ctx.request.post("/api/test-auth/sign-in", { data: { authUserId: key, email: `${key}@example.test`, emailVerified: true, name: key } });
  if (r.status() !== 200) throw new Error("signin " + r.status());
  return ctx;
}
export async function api(key) {
  const c = await request.newContext({ baseURL: BASE });
  const r = await c.post("/api/test-auth/sign-in", { data: { authUserId: key, email: `${key}@example.test`, emailVerified: true, name: key } });
  if (r.status() !== 200) throw new Error("signin");
  return c;
}
