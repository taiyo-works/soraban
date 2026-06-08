import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DID_DIR } from "@/server/regulation-data-dir";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pref: string }> },
) {
  const { pref } = await ctx.params;
  if (!/^\d{2}$/.test(pref)) {
    return NextResponse.json({ error: "invalid pref code" }, { status: 400 });
  }
  const file = path.join(DID_DIR, `pref-${pref}.geojson`);
  try {
    const content = await fs.readFile(file, "utf8");
    return new NextResponse(content, {
      status: 200,
      headers: {
        "content-type": "application/geo+json",
        "cache-control": "public, max-age=86400",
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }
}
