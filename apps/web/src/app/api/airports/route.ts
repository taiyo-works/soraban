import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

const AIRPORTS_FILE = path.resolve(
  process.env["REGULATION_DATA_DIR"] ??
    path.join(process.cwd(), "..", "..", "packages", "regulations", "data"),
  "airports",
  "airports.geojson",
);

export async function GET() {
  try {
    const content = await fs.readFile(AIRPORTS_FILE, "utf8");
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
