// 導出の絞り込み（SQL にできないもの：計画の状態・許可の有効性など）を、一覧の上限（LIMIT）の前の行にも届かせる。
// 上限の後で絞ると、新しい上限件数に一致しない古い行が漏れる。ページを順に読み、一致する行が上限に達するか、行が尽きるまで集める。
// クエリの数は、読んだページの数に比例する（一致する行の件数や、ページの中の行数には比例しない）。

/**
 * fetchPage(offset) で pageSize 件ずつ順に読み、select で一致する行（変換後）を集める。max 件に達するか、最後のページ（pageSize 未満）で止まる。
 * 並びは fetchPage が決める（offset で安定した順であること）。
 */
export const collectMatching = async <T, U>(
  fetchPage: (offset: number) => Promise<readonly T[]>,
  select: (rows: readonly T[]) => Promise<readonly U[]>,
  pageSize: number,
  max: number = pageSize,
): Promise<U[]> => {
  const out: U[] = [];
  for (let offset = 0; out.length < max; offset += pageSize) {
    const rows = await fetchPage(offset);
    out.push(...(await select(rows)));
    if (rows.length < pageSize) break;
  }
  return out.slice(0, max);
};
