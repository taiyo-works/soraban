import { describe, expect, it } from "vitest";
import type { OutboxEntry } from "@/lib/ops-outbox";
import { requestBodyFor } from "./field-outbox";

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  clientEventId: "11111111-1111-4111-8111-111111111111",
  kind: "takeoff",
  occurredAt: "2027-01-05T12:00",
  status: "pending",
  attempts: 0,
  ...over,
});
const at = (hm: string) => new Date(`2027-01-05T${hm}:00+09:00`).getTime();

describe("requestBodyFor：その場の送信か、送信待ちを経由したものか", () => {
  it("押してすぐの最初の送信は queued: false（端末の時計のずれをサーバーが検査する）", () => {
    expect(requestBodyFor(entry(), at("12:00"))["queued"]).toBe(false);
    expect(requestBodyFor(entry(), at("12:01"))["queued"]).toBe(false);
    expect(requestBodyFor(entry(), at("12:02"))["queued"]).toBe(false);
  });
  it("再試行の行・押してから 2 分を超えた行は queued: true（72 時間まで受ける）", () => {
    expect(requestBodyFor(entry({ attempts: 1 }), at("12:00"))["queued"]).toBe(true);
    expect(requestBodyFor(entry(), at("12:03"))["queued"]).toBe(true);
    expect(requestBodyFor(entry(), at("20:00"))["queued"]).toBe(true);
  });
  it("本文は種別・識別子・時刻・対象だけ（氏名・座標・自由記述を含まない）", () => {
    const body = requestBodyFor(
      entry({ kind: "landing", targetClientEventId: "22222222-2222-4222-8222-222222222222" }),
      at("12:00"),
    );
    expect(Object.keys(body).sort()).toEqual(["clientEventId", "kind", "occurredAt", "queued", "targetClientEventId"]);
  });
});
