import { defineConfig } from "vitest/config";

// monorepo 内の package ごとに test を分ける。
// 追加 package で vitest を使いたい場合はこの projects 配列に1行足すだけ。
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "geo",
          include: ["packages/geo/src/**/*.test.ts"],
          globals: true,
        },
      },
      {
        test: {
          name: "regulations",
          include: ["packages/regulations/src/**/*.test.ts"],
          globals: true,
        },
      },
    ],
  },
});
