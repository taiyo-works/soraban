import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// monorepo 内の package ごとに test を分ける。
// 追加 package で vitest を使いたい場合はこの projects 配列に1行足すだけ。
//
// resolve.alias: ホスト FS が exFAT 等で symlink 不可な環境でも
// `@soraban/*` を packages/*/src の絶対パスへ直接解決する。
// node_modules への workspace リンクに依存しないため pnpm install 失敗時にも動く。
const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

const sorabanAlias = {
  // サブパスは本体より先に書く（先に一致したものが使われる）
  "@soraban/regulations/address": fileURLToPath(
    new URL("./packages/regulations/src/address/index.ts", import.meta.url),
  ),
  "@soraban/db": pkg("db"),
  "@soraban/dips": pkg("dips"),
  "@soraban/geo": pkg("geo"),
  "@soraban/regulations": pkg("regulations"),
};

export default defineConfig({
  resolve: {
    alias: sorabanAlias,
  },
  test: {
    projects: [
      {
        resolve: { alias: sorabanAlias },
        test: {
          name: "db",
          include: ["packages/db/src/**/*.test.ts"],
          // DB を使うテストは vitest.db.config.ts（pnpm test:db）で実行する。
          exclude: ["**/*.db.test.ts", "**/node_modules/**"],
          globals: true,
        },
      },
      {
        resolve: { alias: sorabanAlias },
        test: {
          name: "geo",
          include: ["packages/geo/src/**/*.test.ts"],
          globals: true,
        },
      },
      {
        resolve: { alias: sorabanAlias },
        test: {
          name: "dips",
          include: ["packages/dips/src/**/*.test.ts"],
          globals: true,
        },
      },
      {
        resolve: { alias: sorabanAlias },
        test: {
          name: "regulations",
          include: ["packages/regulations/src/**/*.test.ts"],
          globals: true,
        },
      },
      {
        resolve: {
          alias: {
            ...sorabanAlias,
            "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
          },
        },
        test: {
          name: "web",
          include: ["apps/web/src/**/*.test.ts"],
          exclude: ["**/*.db.test.ts", "**/node_modules/**"],
          globals: true,
        },
      },
    ],
  },
});
