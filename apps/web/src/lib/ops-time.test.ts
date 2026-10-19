// Sprint 11 契約 1・2（単体）：時刻の解釈と飛行時間。
import { afterEach, describe, expect, it } from "vitest";
import {
  checkCoordinate,
  flightMinutes,
  flightMinutesFromInput,
  formatHm,
  formatJst,
  formatLanding,
  jstDate,
  nowJstInput,
  parseJstMinute,
  roundCoordinate,
  toJstInput,
} from "./ops-time";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const at = (s: string): Date => {
  const d = parseJstMinute(s);
  if (!d) throw new Error(`parse failed: ${s}`);
  return d;
};

describe("1. 時刻の解釈（JST・1 分単位）", () => {
  for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
    it(`TZ=${tz} でも 2027-01-05T09:30 は JST 09:30（UTC 00:30）`, () => {
      process.env.TZ = tz;
      const d = parseJstMinute("2027-01-05T09:30");
      expect(d?.toISOString()).toBe("2027-01-05T00:30:00.000Z");
      expect(toJstInput(d!)).toBe("2027-01-05T09:30");
      expect(formatJst(d!)).toBe("2027-01-05 09:30");
      expect(jstDate(at("2027-01-05T00:10"))).toBe("2027-01-05");
    });
  }

  it.each([
    ["秒付き", "2027-01-05T09:30:15"],
    ["Z 付き", "2027-01-05T09:30Z"],
    ["+09:00 付き", "2027-01-05T09:30+09:00"],
    ["空白区切り", "2027-01-05 09:30"],
    ["存在しない日付（2 月 30 日）", "2027-02-30T09:30"],
    ["存在しない日付（13 月）", "2027-13-01T09:30"],
    ["24 時", "2027-01-05T24:00"],
    ["60 分", "2027-01-05T09:60"],
    ["時が 1 桁", "2027-01-05T9:30"],
    ["空", ""],
  ])("%s は time_format で拒否（丸めない）", (_label, s) => {
    expect(parseJstMinute(s)).toBeNull();
    expect(flightMinutesFromInput(s, "2027-01-05T10:00")).toEqual({ ok: false, code: "time_format" });
  });

  it("文字列以外は拒否", () => {
    expect(parseJstMinute(new Date())).toBeNull();
    expect(parseJstMinute(1736037000000)).toBeNull();
  });

  it("「今」は JST の分（秒は切り捨て）", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(nowJstInput(new Date("2027-01-05T00:30:59.999Z"))).toBe("2027-01-05T09:30");
  });
});

describe("2. 飛行時間", () => {
  const now = new Date("2027-01-05T03:00:40Z"); // JST 12:00:40

  it("同じ分 → 1（切り上げ）", () => {
    expect(flightMinutes(at("2027-01-05T09:30"), at("2027-01-05T09:30"), now)).toEqual({ ok: true, minutes: 1, roundedUp: true });
  });

  it("23:50 → 翌日 00:10 は 20 分", () => {
    expect(flightMinutes(at("2027-01-03T23:50"), at("2027-01-04T00:10"), now)).toEqual({ ok: true, minutes: 20, roundedUp: false });
    expect(formatLanding(at("2027-01-03T23:50"), at("2027-01-04T00:10"))).toBe("翌日 00:10");
    expect(formatLanding(at("2027-01-03T09:00"), at("2027-01-03T09:45"))).toBe("09:45");
  });

  it("着陸が離陸より前 → landing_before_takeoff", () => {
    expect(flightMinutes(at("2027-01-05T09:30"), at("2027-01-05T09:29"), now)).toEqual({ ok: false, code: "landing_before_takeoff" });
  });

  it("24 時間以上 → flight_too_long（23:59 までは可）", () => {
    expect(flightMinutes(at("2027-01-03T09:00"), at("2027-01-04T09:00"), now)).toEqual({ ok: false, code: "flight_too_long" });
    expect(flightMinutes(at("2027-01-03T09:00"), at("2027-01-04T08:59"), now)).toEqual({ ok: true, minutes: 1439, roundedUp: false });
  });

  it("離陸が現在の分より後 → takeoff_in_future（現在の分ちょうどは可。過去は制限しない）", () => {
    expect(flightMinutes(at("2027-01-05T12:01"), at("2027-01-05T12:05"), now)).toEqual({ ok: false, code: "takeoff_in_future" });
    expect(flightMinutes(at("2027-01-05T12:00"), at("2027-01-05T12:00"), now)).toMatchObject({ ok: true, minutes: 1 });
    expect(flightMinutes(at("2020-01-01T09:00"), at("2020-01-01T09:10"), now)).toMatchObject({ ok: true, minutes: 10 });
  });

  it("表示は H:MM（24 時間を超える累計も）", () => {
    expect(formatHm(1)).toBe("0:01");
    expect(formatHm(20)).toBe("0:20");
    expect(formatHm(123 * 60 + 45)).toBe("123:45");
    expect(formatHm(0)).toBe("0:00");
  });
});

describe("位置（WGS84 の 10 進度、小数 6 桁まで）", () => {
  it("範囲・桁数", () => {
    expect(checkCoordinate(35.123456, "lat")).toEqual({ ok: true, value: 35.123456 });
    expect(checkCoordinate("133.5", "lng")).toEqual({ ok: true, value: 133.5 });
    expect(checkCoordinate(90.000001, "lat")).toEqual({ ok: false, code: "coordinate_range" });
    expect(checkCoordinate(-180.5, "lng")).toEqual({ ok: false, code: "coordinate_range" });
    expect(checkCoordinate(35.1234567, "lat")).toEqual({ ok: false, code: "coordinate_precision" });
    expect(checkCoordinate("35.1234567", "lat")).toEqual({ ok: false, code: "coordinate_precision" });
    expect(checkCoordinate("abc", "lat")).toEqual({ ok: false, code: "coordinate_format" });
    expect(roundCoordinate(35.12345678)).toBe(35.123457);
  });
});
