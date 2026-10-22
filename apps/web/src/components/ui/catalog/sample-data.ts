// Sample data for the design catalog. Everything here is made up for layout review (names, dates, counts);
// the catalog says so on screen. It is never read from, or written to, a real record.

export type SamplePlan = {
  readonly id: string;
  readonly name: string;
  readonly date: string;
  readonly status: "draft" | "checking" | "confirmed" | "done";
  readonly aircraft: string;
  readonly pilot: string;
};

export const PLAN_STATUS_LABEL = { draft: "下書き", checking: "確認待ち", confirmed: "確認済み", done: "完了" } as const;
export const PLAN_STATUS_MEANING = { draft: "neutral", checking: "warn", confirmed: "info", done: "ok" } as const;

export const SAMPLE_PLANS: readonly SamplePlan[] = [
  { id: "p1", name: "見本の地点 A の撮影", date: "2026-11-04", status: "checking", aircraft: "見本機 01", pilot: "見本 一郎" },
  { id: "p2", name: "見本の地点 B の点検", date: "2026-11-05", status: "confirmed", aircraft: "見本機 02", pilot: "見本 二郎" },
  { id: "p3", name: "見本の地点 C の測量", date: "2026-11-09", status: "draft", aircraft: "見本機 01", pilot: "見本 三郎" },
  { id: "p4", name: "見本の地点 D の撮影", date: "2026-10-28", status: "done", aircraft: "見本機 03", pilot: "見本 一郎" },
  { id: "p5", name: "見本の地点 E の巡回", date: "2026-11-12", status: "checking", aircraft: "見本機 02", pilot: "見本 二郎" },
  { id: "p6", name: "見本の地点 F の撮影", date: "2026-10-30", status: "done", aircraft: "見本機 03", pilot: "見本 三郎" },
  { id: "p7", name: "見本の地点 G の点検", date: "2026-11-15", status: "draft", aircraft: "見本機 01", pilot: "見本 一郎" },
  { id: "p8", name: "見本の地点 H の測量", date: "2026-11-02", status: "confirmed", aircraft: "見本機 02", pilot: "見本 三郎" },
];

export const SAMPLE_FLIGHTS_14D: readonly number[] = [1, 0, 2, 1, 3, 0, 0, 2, 2, 1, 4, 1, 0, 2];
