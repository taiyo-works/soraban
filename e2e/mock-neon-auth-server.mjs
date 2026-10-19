// E2E 用の Neon Auth（Managed Better Auth）上流の模擬サーバー（Sprint 10 差し戻し A）。実在のサービスには接続しない。
//   node e2e/mock-neon-auth-server.mjs <port>     → http://127.0.0.1:<port>/neondb/auth が NEON_AUTH_BASE_URL
// get-session だけを模擬する：
//   - ?neon_auth_session_verifier=<v> と session_challenge Cookie の組が一致 → セッションを返し、session_token を
//     Set-Cookie し、challenge Cookie を消す（Google から戻ったときの交換）
//   - session_token Cookie が既知 → セッションを返す
//   - それ以外 → null（未ログイン）
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 3299);
const PREFIX = "__Secure-neon-auth";

// 利用者（メールアドレスは packages/db/src/ops-seed.ts の招待中の利用者と一致させる）
const USERS = [
  { verifier: "v-neon", challenge: "c-neon", token: "tok-neon", id: "neon-user-1", email: "a-neon@example.test", name: "ネオン 太郎" },
  { verifier: "v-neon2", challenge: "c-neon2", token: "tok-neon2", id: "neon-user-2", email: "a-neon2@example.test", name: "ネオン 花子" },
];
const stats = { getSession: 0, exchanges: 0 };

const parseCookies = (h) =>
  new Map(
    (h ?? "")
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]),
  );

const sessionOf = (u) => {
  const now = new Date();
  const iso = now.toISOString();
  return {
    session: {
      id: `s-${u.id}`,
      token: u.token,
      userId: u.id,
      expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
      createdAt: iso,
      updatedAt: iso,
      ipAddress: null,
      userAgent: null,
    },
    user: { id: u.id, email: u.email, name: u.name, emailVerified: true, image: null, createdAt: iso, updatedAt: iso },
  };
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") return res.end("ok");
  if (url.pathname === "/__stats") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify(stats));
  }
  if (url.pathname !== "/neondb/auth/get-session") {
    res.statusCode = 404;
    return res.end("{}");
  }
  stats.getSession++;
  const cookies = parseCookies(req.headers.cookie);
  res.setHeader("content-type", "application/json");
  const verifier = url.searchParams.get("neon_auth_session_verifier");
  if (verifier) {
    const u = USERS.find((x) => x.verifier === verifier && cookies.get(`${PREFIX}.session_challenge`) === x.challenge);
    if (u) {
      stats.exchanges++;
      res.setHeader("set-cookie", [
        `${PREFIX}.session_token=${u.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`,
        `${PREFIX}.session_challenge=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      ]);
      return res.end(JSON.stringify(sessionOf(u)));
    }
  }
  const u = USERS.find((x) => cookies.get(`${PREFIX}.session_token`) === x.token);
  return res.end(JSON.stringify(u ? sessionOf(u) : null));
}).listen(port, "127.0.0.1", () => console.log(`[mock-neon-auth] listening on ${port}`));
