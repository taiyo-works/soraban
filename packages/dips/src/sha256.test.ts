import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

describe("sha256Hex", () => {
  const samples = [
    "",
    "abc",
    "soraban",
    "あいうえお通報の指紋",
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(63),
    "a".repeat(64),
    "a".repeat(65),
    "a".repeat(119),
    "a".repeat(120),
    "x".repeat(1000),
    "😀絵文字を含む",
  ];
  for (const s of samples) {
    it(`node:crypto と一致する（${s.length} 文字）`, () => {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    });
  }
  it("既知の値", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
