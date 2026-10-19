import { NextResponse } from "next/server";
import { resolveAddressSearch } from "@/server/address-data-dir";
import { geocode } from "@/server/geocode";

// 住所検索（Sprint 9）：①同梱索引（アドレス・ベース・レジストリ）→ ②国土地理院の住所検索。
// 処理本体は server/geocode.ts。
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length === 0) {
    return NextResponse.json({ error: "missing q" }, { status: 400 });
  }
  return NextResponse.json(await geocode(q, { searchBundled: await resolveAddressSearch() }));
}
