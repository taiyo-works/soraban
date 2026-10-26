"use client";

import dynamic from "next/dynamic";

// 下メニューは利用者メニュー・サインアウトなど大きな client の木。静的に import すると、未ログインの `/` も約 28KB（gzip）多く読む。
// ログイン済みのときだけ描かれるここで読み込む（描かれたときは、これまでどおり HTML に含めて返す）。
export const OpsBottomNavLazy = dynamic(() => import("./ops/ops-nav").then((m) => m.OpsBottomNavSb));
