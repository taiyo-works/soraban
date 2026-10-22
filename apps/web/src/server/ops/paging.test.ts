// 導出の絞り込みを、上限（ページ）の前の行にも届かせる読み方（collectMatching）。
import { describe, expect, it } from "vitest";
import { collectMatching } from "./paging";

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("collectMatching", () => {
  const run = async (total: number, pageSize: number, keep: (n: number) => boolean, max = pageSize) => {
    const all = rowsOf(total);
    let pages = 0;
    const out = await collectMatching(
      async (offset) => {
        pages++;
        return all.slice(offset, offset + pageSize);
      },
      async (rows) => rows.filter(keep),
      pageSize,
      max,
    );
    return { out, pages };
  };

  it("最初のページの外にある一致する行にも届く（最後の 1 件だけが一致）", async () => {
    const r = await run(23, 5, (n) => n === 23);
    expect(r.out).toEqual([23]);
    expect(r.pages).toBe(5);
  });

  it("一致が上限件数に達したら止まる。一致が少なければ最後のページまで読む", async () => {
    const r = await run(100, 5, (n) => n % 2 === 0, 5);
    expect(r.out).toEqual([2, 4, 6, 8, 10]);
    expect(r.pages).toBe(1 + 1);
    expect((await run(12, 5, () => false)).pages).toBe(3);
  });

  it("ちょうどページの倍数の件数でも、次の空のページで止まる。空でも 1 回は読む", async () => {
    expect((await run(10, 5, (n) => n === 10)).out).toEqual([10]);
    expect((await run(10, 5, (n) => n === 10)).pages).toBe(3);
    expect(await run(0, 5, () => true)).toEqual({ out: [], pages: 1 });
  });
});
