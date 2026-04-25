import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as cheerio from "cheerio";

import { KEYWORD_PATTERN, SOURCES, type ScrapeSource } from "./sources.js";

type ScrapedLink = {
  readonly text: string;
  readonly href: string;
};

type ScrapedPage = {
  readonly source: ScrapeSource;
  readonly fetchedAt: string;
  readonly httpStatus: number;
  readonly title: string;
  readonly headings: readonly string[];
  readonly relevantLinks: readonly ScrapedLink[];
  readonly error?: string;
};

const USER_AGENT = "soraban-scraper/0.0.0 (+contact: nor.gleam@gmail.com)";

const log = (msg: string): void => {
  process.stderr.write(`[scraper] ${msg}\n`);
};

const absolutize = (href: string, baseUrl: string): string => {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
};

const fetchAndParse = async (source: ScrapeSource): Promise<ScrapedPage> => {
  const baseResult = {
    source,
    fetchedAt: new Date().toISOString(),
  };
  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return {
        ...baseResult,
        httpStatus: res.status,
        title: "",
        headings: [],
        relevantLinks: [],
        error: `HTTP ${res.status}`,
      };
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const title = $("title").first().text().trim();
    const headings = $("h1, h2, h3")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0)
      .filter((t) => KEYWORD_PATTERN.test(t));
    const seen = new Set<string>();
    const relevantLinks: ScrapedLink[] = [];
    $("a").each((_, el) => {
      const text = $(el).text().trim().replace(/\s+/g, " ");
      const href = $(el).attr("href")?.trim() ?? "";
      if (text.length === 0 || href.length === 0) return;
      if (!KEYWORD_PATTERN.test(text) && !KEYWORD_PATTERN.test(href)) return;
      const absolute = absolutize(href, source.url);
      if (seen.has(absolute)) return;
      seen.add(absolute);
      relevantLinks.push({ text, href: absolute });
    });
    return {
      ...baseResult,
      httpStatus: res.status,
      title,
      headings,
      relevantLinks: relevantLinks.slice(0, 20),
    };
  } catch (err) {
    return {
      ...baseResult,
      httpStatus: 0,
      title: "",
      headings: [],
      relevantLinks: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

const main = async (): Promise<void> => {
  const results: ScrapedPage[] = [];
  for (const source of SOURCES) {
    log(`fetching: ${source.label} (${source.url})`);
    const page = await fetchAndParse(source);
    results.push(page);
    if (page.error) {
      log(`  ! error: ${page.error}`);
    } else {
      log(`  → ${page.relevantLinks.length} relevant link(s), ${page.headings.length} matched heading(s)`);
    }
  }
  const outPath = resolve(process.cwd(), "data/scraped/latest.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
  log(`wrote ${results.length} pages → ${outPath}`);
  const errored = results.filter((r) => r.error).length;
  if (errored > 0) {
    log(`completed with ${errored} error(s)`);
  }
};

await main();
