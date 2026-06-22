import {
  subtractBusinessDays,
  isBusinessDay,
  isJapaneseHoliday,
  daysBetween,
  classifyDeadlineUrgency,
  toJstIsoDate,
  HOLIDAY_COVERAGE,
  ALL_HOLIDAYS,
} from "./business-days";

describe("祝日データ（jp-holidays.json）", () => {
  it("2024〜2027 をカバーしている", () => {
    expect(HOLIDAY_COVERAGE.from).toBeLessThanOrEqual(2024);
    expect(HOLIDAY_COVERAGE.to).toBeGreaterThanOrEqual(2027);
  });
  it("2026-07-20（海の日）を含む（契約の祝日除外検証に効く）", () => {
    expect(isJapaneseHoliday("2026-07-20")).toBe(true);
  });
  it("祝日でない平日は祝日扱いしない", () => {
    expect(isJapaneseHoliday("2026-07-17")).toBe(false);
  });
  it("内閣府 CSV 由来の祝日が一定数読み込まれている", () => {
    expect(ALL_HOLIDAYS.length).toBeGreaterThanOrEqual(70);
  });
});

describe("isBusinessDay — 土日・祝日の判定", () => {
  it("平日（祝日でない）は開庁日", () => {
    // 2026-07-31 は金曜
    expect(isBusinessDay("2026-07-31")).toBe(true);
  });
  it("土曜は開庁日でない", () => {
    // 2026-07-25 は土曜
    expect(isBusinessDay("2026-07-25")).toBe(false);
  });
  it("日曜は開庁日でない", () => {
    // 2026-07-26 は日曜
    expect(isBusinessDay("2026-07-26")).toBe(false);
  });
  it("国民の祝日は開庁日でない（2026-07-20 海の日）", () => {
    expect(isBusinessDay("2026-07-20")).toBe(false);
  });
  it("不正な日付形式は false", () => {
    expect(isBusinessDay("2026/07/31")).toBe(false);
    expect(isBusinessDay("not-a-date")).toBe(false);
    expect(isBusinessDay("2026-02-30")).toBe(false); // 実在しない日
  });
});

describe("subtractBusinessDays — 提出期限の逆算（飛行日 − 10 開庁日）", () => {
  // ★ 契約の中核ケース ★
  // 飛行予定日 2026-07-31（金）から 10 開庁日前を逆算する。
  // 途中に海の日 2026-07-20（月）を含むため、単純な暦日・単純な土日除外より
  // さらに 1 日前にずれる。手計算:
  //   基準日 07-31(金) は数えない。過去方向へ開庁日を数える:
  //   07-30(木)=1, 07-29(水)=2, 07-28(火)=3, 07-27(月)=4,
  //   [07-26日/07-25土 skip] 07-24(金)=5, 07-23(木)=6, 07-22(水)=7, 07-21(火)=8,
  //   [07-20 海の日 skip] [07-19日/07-18土 skip] 07-17(金)=9, 07-16(木)=10
  //   → 2026-07-16
  it("2026-07-31 から 10 開庁日前は 2026-07-16（海の日を跨ぐ手計算と一致）", () => {
    expect(subtractBusinessDays("2026-07-31", 10)).toBe("2026-07-16");
  });

  it("海の日を除外しなければ 2026-07-17 になるはず（除外が効いている証明）", () => {
    // 祝日を考慮しない素朴な「土日のみ除外で 10 営業日前」は 07-17。
    // 実装は海の日を除くので 07-16 になる。両者が異なることで祝日除外を検証。
    const withHoliday = subtractBusinessDays("2026-07-31", 10);
    expect(withHoliday).toBe("2026-07-16");
    expect(withHoliday).not.toBe("2026-07-17"); // 単純土日除外との差分
  });

  it("単純な 10 暦日前（2026-07-21）にはならない（土日祝で押し戻される）", () => {
    expect(subtractBusinessDays("2026-07-31", 10)).not.toBe("2026-07-21");
  });

  it("祝日を跨がない期間: 2026-07-31 から 1 開庁日前は 2026-07-30（木）", () => {
    expect(subtractBusinessDays("2026-07-31", 1)).toBe("2026-07-30");
  });

  it("週末を跨ぐ: 2026-07-27（月）から 1 開庁日前は 2026-07-24（金）", () => {
    expect(subtractBusinessDays("2026-07-27", 1)).toBe("2026-07-24");
  });

  it("祝日の直後: 2026-07-21（火）から 1 開庁日前は海の日を飛ばして 2026-07-17（金）", () => {
    // 07-21 の 1 営業日前は 07-20(海の日) を飛ばし、さらに 07-19/18(土日) を飛ばして 07-17。
    expect(subtractBusinessDays("2026-07-21", 1)).toBe("2026-07-17");
  });

  it("ゴールデンウィーク（連休 + 祝日）を跨ぐ逆算: 2026-05-11(月) から 5 開庁日前", () => {
    // 2026-05: 03(日,憲法)→振替なし扱いだが 05-06 が「休日」。祝日: 05-03日,05-04月みどり,
    // 05-05火こども,05-06水休日。05-11(月) から過去へ開庁日:
    //   05-08(金)=1, 05-07(木)=2, [05-06休/05-05/05-04 祝, 05-03日/05-02土 skip]
    //   05-01(金)=3, 04-30(木)=4, [04-29(水)昭和の日 skip] 04-28(火)=5 → 2026-04-28
    expect(subtractBusinessDays("2026-05-11", 5)).toBe("2026-04-28");
  });

  it("businessDays=0 は基準日をそのまま返す", () => {
    expect(subtractBusinessDays("2026-07-31", 0)).toBe("2026-07-31");
  });

  it("不正な基準日・負の日数は null", () => {
    expect(subtractBusinessDays("bad-date", 10)).toBeNull();
    expect(subtractBusinessDays("2026-07-31", -1)).toBeNull();
    expect(subtractBusinessDays("2026-07-31", 1.5)).toBeNull();
  });
});

describe("daysBetween — 残り日数", () => {
  it("同日は 0", () => {
    expect(daysBetween("2026-07-16", "2026-07-16")).toBe(0);
  });
  it("未来は正、過去は負", () => {
    expect(daysBetween("2026-07-16", "2026-07-31")).toBe(15);
    expect(daysBetween("2026-07-31", "2026-07-16")).toBe(-15);
  });
  it("月またぎ", () => {
    expect(daysBetween("2026-07-31", "2026-08-01")).toBe(1);
  });
  it("不正形式は null", () => {
    expect(daysBetween("x", "2026-07-31")).toBeNull();
  });
});

describe("classifyDeadlineUrgency — アラート色の判定", () => {
  it("提出期限が未確定（submitBy undefined）→ none", () => {
    expect(classifyDeadlineUrgency(undefined, "2026-07-01", 10)).toBe("none");
  });
  it("leadTime 0（登録・通報・日誌）→ none", () => {
    expect(classifyDeadlineUrgency("2026-07-16", "2026-07-01", 0)).toBe("none");
  });
  it("期限を過ぎている → overdue（red）", () => {
    expect(classifyDeadlineUrgency("2026-07-16", "2026-07-20", 10)).toBe("overdue");
  });
  it("残り日数が少ない → urgent（amber）", () => {
    // leadTime 10 → urgent 閾値 = ceil(10*0.7)=7 暦日。残り 5 日は urgent。
    expect(classifyDeadlineUrgency("2026-07-16", "2026-07-11", 10)).toBe("urgent");
  });
  it("まだ余裕がある → ok", () => {
    // 残り 15 日は閾値 7 を超える。
    expect(classifyDeadlineUrgency("2026-07-16", "2026-07-01", 10)).toBe("ok");
  });
  it("当日（残り 0 日）は urgent", () => {
    expect(classifyDeadlineUrgency("2026-07-16", "2026-07-16", 10)).toBe("urgent");
  });
});

describe("toJstIsoDate — JST の今日", () => {
  it("固定時刻を JST 日付に変換（UTC 23:00 は翌日 JST）", () => {
    // 2026-07-15T23:00:00Z は JST で 2026-07-16 08:00
    expect(toJstIsoDate(new Date("2026-07-15T23:00:00Z"))).toBe("2026-07-16");
  });
  it("UTC 朝は同日 JST", () => {
    expect(toJstIsoDate(new Date("2026-07-16T00:00:00Z"))).toBe("2026-07-16");
  });
});
