import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isDesignCatalogEnabled } from "@/lib/design-catalog";
import { DesignCatalogV2, parseCatalogConfig } from "./catalog";

// デザイン見本（Sprint 12g で作り、Sprint 16-1 で白基調の v2 の見本に作り直した）。認証・DB・外部通信なし。
// 環境の確認は要求ごと（connection()）なので、ビルドの出力にフラグが焼き込まれない。
// proxy.ts がフラグ無効のとき先に 404 を返す。ここの notFound() は二重の防御。
export const metadata: Metadata = {
  title: { absolute: "デザイン見本 — そらばん" },
  robots: { index: false, follow: false },
};

export default async function DesignCatalogPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  if (!isDesignCatalogEnabled(process.env)) notFound();
  const config = parseCatalogConfig(await searchParams);
  // 現場の値・強制の暗は <html> の属性で効く。最初の描画から効かせるため、固定の語だけを文書の解析中に付ける（生のクエリは入れない）。
  const attrs = [config.mode ? `r.dataset.mode="field"` : "", config.theme ? `r.dataset.theme="dark"` : ""].filter(Boolean).join(";");
  return (
    <>
      {attrs ? <script dangerouslySetInnerHTML={{ __html: `(function(){var r=document.documentElement;${attrs}})()` }} /> : null}
      <DesignCatalogV2 config={config} />
    </>
  );
}
