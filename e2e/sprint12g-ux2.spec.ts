import { appendFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { collectTapTargets, expectContrast, expectNoHorizontalScroll, expectTapTargets } from "./field-checks";

// UX 段階 2 の E2E：メニューとホームの案（/ops/design?view=menu）。
// - 見本は DESIGN_CATALOG=1 のサーバー（フィクスチャ用の 2 台目）でだけ表示する静的なページ。認証・DB・外部通信を使わない。
// - 作業の台本ごとに、案ごとの操作数（押した回数）を数える。数え方は、台本ごとの「いちばん自然な最短の経路」を
//   1 つずつ押していき、押した回数を自分で数える。見本の中の数え方（data-taps）と一致することも確かめる。
//   スクロールは数えず、「押す部品がスクロールしないと見えなかった回数」を別に記録する。
// - UX_COUNTS_FILE を指定すると、数えた結果を 1 行 1 件の JSON で書き出す（docs/design/ux-compare.md の元の数字）。
const CATALOG = process.env["E2E_CATALOG_URL"] ?? `http://127.0.0.1:${process.env["E2E_FIXTURE_PORT"] ?? 3101}`;

const open = async (page: Page, query = ""): Promise<void> => {
  await page.goto(`${CATALOG}/ops/design?view=menu${query ? `&${query}` : ""}`);
  await expect(page.getByTestId("design-catalog")).toBeVisible();
  await expect(page.getByTestId("design-catalog")).toHaveAttribute("data-hydrated", "1");
  await expect(page.getByTestId("menu-trial")).toBeVisible();
};
const pcFrame = (page: Page): Locator => page.getByTestId("pc-frame");
const spFrame = (page: Page): Locator => page.getByTestId("sp-frame");

type Result = {
  readonly device: "pc" | "phone";
  readonly menu: string;
  readonly judge?: string;
  readonly script: string;
  readonly start: "home" | "other";
  readonly day: string;
  readonly path: readonly string[];
  readonly taps: number;
  readonly scrollsNeeded: number;
  readonly extra?: Record<string, boolean>;
};
const record = (r: Result): void => {
  const file = process.env["UX_COUNTS_FILE"];
  if (file) appendFileSync(file, `${JSON.stringify(r)}\n`);
};

/** 押す部品が、本文のスクロール領域の見えている範囲の外にあるか（スクロールが要るか）。 */
const needsScroll = (loc: Locator): Promise<boolean> =>
  loc.evaluate((el) => {
    const main = el.closest('[data-testid="pc-main"], [data-testid="sp-main"]');
    if (!main) return false;
    const r = el.getBoundingClientRect();
    const m = main.getBoundingClientRect();
    return r.top < m.top - 0.5 || r.bottom > m.bottom + 0.5;
  });

/** 経路を 1 つずつ押す。押した回数と、スクロールが要った回数を返す。 */
const walk = async (frame: Locator, path: readonly string[]): Promise<{ taps: number; scrolls: number }> => {
  let taps = 0;
  let scrolls = 0;
  for (const id of path) {
    const target = frame.getByTestId(id);
    await expect(target, `${id} が 1 つ見えること`).toBeVisible();
    if (await needsScroll(target)) scrolls += 1;
    await target.click();
    taps += 1;
  }
  return { taps, scrolls };
};

/** 台本を選び、開始位置まで進めてから数え直す（開始位置までの操作は数えない）。 */
const prepare = async (page: Page, device: "pc" | "phone", script: string, start: "home" | "other", other: string): Promise<void> => {
  const prefix = device === "pc" ? "pc" : "sp";
  const frame = device === "pc" ? pcFrame(page) : spFrame(page);
  await page.getByTestId(`${prefix}-script-select`).selectOption(script);
  if (start === "other") {
    await frame.getByTestId(other).click();
    await page.getByTestId(`${prefix}-recount`).click();
  }
  await expect(page.getByTestId(`${prefix}-taps`)).toHaveText("0");
};

const reachedOk = async (page: Page, device: "pc" | "phone", taps: number): Promise<void> => {
  const prefix = device === "pc" ? "pc" : "sp";
  await expect(page.getByTestId(`${prefix}-goal`)).toHaveAttribute("data-reached", "1");
  await expect(page.getByTestId(`${prefix}-taps`)).toHaveText(String(taps));
  await expect(device === "pc" ? pcFrame(page) : spFrame(page)).toHaveAttribute("data-taps", String(taps));
};

// ── 台本ごとの経路 ───────────────────────────────────────────────────────────

type PcMenu = "rail" | "tabs";
type JudgeForm = "workspace" | "stack";

const pcPath = (script: string, menu: PcMenu, judge: JudgeForm, start: "home" | "other"): readonly string[] => {
  switch (script) {
    case "p1":
      return start === "home" ? ["act-plan-new-head"] : ["nav-plans", "act-plan-new-list"];
    case "p2":
      return ["nav-judge", "map-pick", judge === "workspace" ? "layer-did" : "legend-did"];
    case "p3":
      return menu === "rail" ? ["nav-aircraft", "act-register-new"] : ["nav-register", "register-aircraft", "act-register-new"];
    case "p4":
      return menu === "rail" ? ["nav-pilots", "act-register-new"] : ["nav-register", "register-pilots", "act-register-new"];
    default:
      throw new Error(script);
  }
};

type SpMenu = "tabs5" | "tabs4band";
const spPath = (script: string, menu: SpMenu, start: "home" | "other"): readonly string[] => {
  switch (script) {
    case "s1":
      return start === "home" ? ["act-inspection"] : menu === "tabs5" ? ["nav-home", "act-inspection"] : ["next-flight-band", "field-inspection"];
    case "s2":
      return start === "home" ? ["act-journal"] : ["nav-journal", "act-journal-flight"];
    case "s3":
      return start === "home" ? [] : ["nav-home"];
    case "s4":
      return ["nav-judge", "act-geo"];
    case "s5":
      return ["nav-journal", "act-journal-incident"];
    default:
      throw new Error(script);
  }
};

const PC_GOAL_PAGE: Readonly<Record<string, string>> = { p1: "plan-new", p2: "judge", p3: "aircraft-new", p4: "pilot-new" };
const SP_GOAL_PAGE: Readonly<Record<string, string>> = { s1: "inspection-new", s2: "journal-new", s3: "home", s4: "judge", s5: "incident-new" };

/** 数えた結果。見本の作りを変えたら、ここと docs/design/ux-compare.md を一緒に直す。 */
const EXPECTED_PC: Readonly<Record<string, { home: number; other: number }>> = {
  "rail:p1": { home: 1, other: 2 },
  "tabs:p1": { home: 1, other: 2 },
  "rail:p2": { home: 3, other: 3 },
  "tabs:p2": { home: 3, other: 3 },
  "rail:p3": { home: 2, other: 2 },
  "tabs:p3": { home: 3, other: 3 },
  "rail:p4": { home: 2, other: 2 },
  "tabs:p4": { home: 3, other: 3 },
};
const EXPECTED_SP: Readonly<Record<string, { home: number; other: number }>> = {
  "tabs5:s1": { home: 1, other: 2 },
  "tabs4band:s1": { home: 1, other: 2 },
  "tabs5:s2": { home: 1, other: 2 },
  "tabs4band:s2": { home: 1, other: 2 },
  "tabs5:s3": { home: 0, other: 1 },
  "tabs4band:s3": { home: 0, other: 1 },
  "tabs5:s4": { home: 2, other: 2 },
  "tabs4band:s4": { home: 2, other: 2 },
  "tabs5:s5": { home: 2, other: 2 },
  "tabs4band:s5": { home: 2, other: 2 },
};

test.describe("A. 見本の表示と、実画面に触れないこと", () => {
  test("1. view=menu で案の見本が出る。外部通信・API 呼び出しがない。運航管理の枠が付かない。既定の表示は変わらない", async ({ page }) => {
    const origins = new Set<string>();
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      origins.add(u.origin);
      if (u.pathname.startsWith("/api/")) apiCalls.push(u.pathname);
    });
    await open(page);
    await expect(page.getByTestId("trial-notice")).toContainText("実際の画面（/ と /ops 以下）は変えていません");
    await expect(page.getByTestId("trial-notice")).toContainText("すべて見本データ");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(pcFrame(page)).toBeVisible();
    await expect(spFrame(page)).toBeVisible();
    await expect(page.getByTestId("ops-header")).toHaveCount(0);
    await expect(page.getByTestId("ops-bottom-nav")).toHaveCount(0);
    expect(apiCalls).toEqual([]);
    expect([...origins]).toEqual([new URL(CATALOG).origin]);
    // the default view keeps its sections and has no trial
    await page.goto(`${CATALOG}/ops/design`);
    await expect(page.getByTestId("design-catalog")).toHaveAttribute("data-hydrated", "1");
    await expect(page.getByTestId("menu-trial")).toHaveCount(0);
    await expect(page.locator("section#tokens")).toBeVisible();
  });

  test("2. 切り替えは URL で共有できる（pc・sp・day・pcname・judge）。既定の値は URL に出さない", async ({ page }) => {
    await open(page, "pc=tabs&sp=tabs4band&day=empty&pcname=map&judge=stack");
    await expect(page.getByTestId("ctl-pc").getByRole("radio", { name: "横タブ" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("ctl-sp").getByRole("radio", { name: "4 タブ＋帯" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("ctl-day").getByRole("radio", { name: "予定のない日" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("ctl-pcname").getByRole("radio", { name: "地図・判定" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("ctl-judge").getByRole("radio", { name: "現状の縦並び" })).toHaveAttribute("aria-checked", "true");
    await expect(pcFrame(page)).toHaveAttribute("data-menu", "tabs");
    await expect(spFrame(page)).toHaveAttribute("data-menu", "tabs4band");
    await expect(page.getByTestId("home-empty")).toHaveCount(2);
    await page.getByTestId("ctl-pc").getByRole("radio", { name: "左メニュー" }).click();
    await page.getByTestId("ctl-sp").getByRole("radio", { name: "5 タブ" }).click();
    await page.getByTestId("ctl-day").getByRole("radio", { name: "飛行がある日" }).click();
    await page.getByTestId("ctl-pcname").getByRole("radio", { name: "判定", exact: true }).click();
    await page.getByTestId("ctl-judge").getByRole("radio", { name: "地図中心" }).click();
    await expect.poll(() => new URL(page.url()).search).toBe("?view=menu");
    await page.getByTestId("ctl-pc").getByRole("radio", { name: "横タブ" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("pc")).toBe("tabs");
  });

  test("3. 名前：ホーム／判定／計画／日誌／登録。「今日」「その他」を使わない。ハンバーガーがない。事故・ヒヤリハットは日誌の中、ログアウトは利用者メニューの中", async ({ page }) => {
    await open(page);
    const trial = page.getByTestId("menu-trial");
    const text = await trial.innerText();
    expect(await spFrame(page).getByTestId("sp-nav").getByRole("button").allInnerTexts()).toEqual(["ホーム", "判定", "計画", "日誌", "登録"]);
    expect(await pcFrame(page).getByTestId("pc-nav").getByRole("button").allInnerTexts()).toEqual(["ホーム", "判定", "計画", "日誌", "登録", "機体", "操縦者", "許可・承認", "地点"]);
    for (const w of ["その他", "運航管理のトップ", "地点判定"]) expect(text, w).not.toContain(w);
    await expect(trial.getByRole("button", { name: /ハンバーガー|メニューを開く/ })).toHaveCount(0);
    // the incident is not a menu item; it is inside the journal
    await expect(pcFrame(page).getByTestId("pc-nav").getByText("事故")).toHaveCount(0);
    await spFrame(page).getByTestId("nav-journal").click();
    await expect(spFrame(page).getByTestId("act-journal-incident")).toBeVisible();
    // the sign-out is in the user menu at the top right
    await expect(spFrame(page).getByText("ログアウト")).toHaveCount(0);
    await spFrame(page).getByTestId("user-menu-button").click();
    await expect(spFrame(page).getByTestId("user-menu")).toContainText("ログアウト");
    await page.keyboard.press("Escape");
    await expect(spFrame(page).getByTestId("user-menu")).toHaveCount(0);
    // PC: the name of the judgement page can be 地図・判定
    await page.getByTestId("ctl-pcname").getByRole("radio", { name: "地図・判定" }).click();
    await expect(pcFrame(page).getByTestId("nav-judge")).toHaveText("地図・判定");
    await page.getByTestId("ctl-pc").getByRole("radio", { name: "横タブ" }).click();
    expect(await pcFrame(page).getByTestId("pc-nav").getByRole("button").allInnerTexts()).toEqual(["ホーム", "地図・判定", "計画", "日誌", "登録"]);
  });

  test("4. 5 タブは 5 つ・4 タブ＋帯は 4 つ。帯は飛行がある日の、ホーム以外の画面に出る。現場モードにはメニューも帯も出ない", async ({ page }) => {
    await open(page, "sp=tabs4band");
    const sp = spFrame(page);
    expect(await sp.getByTestId("sp-nav").getByRole("button").allInnerTexts()).toEqual(["ホーム", "判定", "日誌", "登録"]);
    await expect(sp.getByTestId("next-flight-band")).toHaveCount(0); // on the home page the flight is shown in full
    await sp.getByTestId("nav-journal").click();
    await expect(sp.getByTestId("next-flight-band")).toBeVisible();
    await expect(sp.getByTestId("next-flight-band")).toContainText("10:30");
    await sp.getByTestId("next-flight-band").click();
    await expect(sp).toHaveAttribute("data-page", "field");
    await expect(sp.getByTestId("sp-nav")).toHaveCount(0);
    await expect(sp.getByTestId("next-flight-band")).toHaveCount(0);
    // an empty day has no band
    await sp.getByTestId("back").click();
    await page.getByTestId("ctl-day").getByRole("radio", { name: "予定のない日" }).click();
    await sp.getByTestId("nav-journal").click();
    await expect(sp.getByTestId("next-flight-band")).toHaveCount(0);
  });
});

test.describe("B. ホームの中身（飛行がある日・予定のない日）と行程", () => {
  test("5. 飛行がある日：次の飛行を大きく。行程は 7 段の順に並ぶ。次にやること・近づく期限がある", async ({ page }) => {
    await open(page, "day=busy");
    for (const frame of [pcFrame(page), spFrame(page)]) {
      await expect(frame.getByTestId("home-flight")).toContainText("10:30");
      const stages = frame.getByTestId("home-flight").getByTestId("route").locator("li");
      await expect(stages).toHaveCount(7);
      expect((await stages.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim())).toEqual(["判定 済", "計画 済", "確認 済", "通報 済", "点検 次", "飛行 未", "日誌 未"]);
      await expect(frame.getByTestId("home-actions")).toContainText("日常点検をする");
      await expect(frame.getByTestId("home-deadlines")).toContainText("技能証明");
      await expect(frame.getByTestId("home-empty")).toHaveCount(0);
    }
    await expect(spFrame(page).getByTestId("act-field")).toHaveText("現場モードを開く");
  });

  test("6. 予定のない日：何もない旨と次の一手（計画を作る・地点を判定する）、直近の予定と期限が出る", async ({ page }) => {
    await open(page, "day=empty");
    for (const frame of [pcFrame(page), spFrame(page)]) {
      await expect(frame.getByTestId("home-empty")).toContainText("今日は飛行の予定がありません");
      await expect(frame.getByTestId("act-plan-new-card")).toHaveText("飛行計画を作る");
      await expect(frame.getByTestId("act-judge-card")).toHaveText("地点を判定する");
      await expect(frame.getByTestId("home-upcoming")).toContainText("11/02（月）");
      await expect(frame.getByTestId("home-deadlines")).toContainText("あと 21 日");
      await expect(frame.getByTestId("home-flight")).toHaveCount(0);
    }
    await spFrame(page).getByTestId("act-judge-card").click();
    await expect(spFrame(page)).toHaveAttribute("data-page", "judge");
  });

  test("7. 計画の画面にも行程が小さく出る（計画の入力では「計画」が「いま」）", async ({ page }) => {
    await open(page);
    await pcFrame(page).getByTestId("act-plan-new-head").click();
    const states = await pcFrame(page).getByTestId("stub-plan-new").getByTestId("route").locator("li").evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ").trim()));
    expect(states).toEqual(["判定 済", "計画 いま", "確認 未", "通報 未", "点検 未", "飛行 未", "日誌 未"]);
    await spFrame(page).getByTestId("nav-plans").click();
    await expect(spFrame(page).getByTestId("page-plans").getByTestId("route")).toHaveCount(3);
  });
});

test.describe("C. 判定の画面：地図中心の案と現状の並び。層は見本の絵", () => {
  for (const form of ["workspace", "stack"] as const) {
    test(`8. PC の判定（${form}）：地図で地点を指定すると結果が出る。層を切り替えると地図の絵が変わり、結果は変わらない`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, `judge=${form}`);
      const pc = pcFrame(page);
      await pc.getByTestId("nav-judge").click();
      await expect(pc.getByTestId("judge-empty")).toBeVisible();
      await pc.getByTestId("map-pick").click({ position: { x: 120, y: 90 } });
      await expect(pc.getByTestId("map-pin")).toBeVisible();
      await expect(pc.getByTestId("judge-result")).toContainText("人口集中地区（DID）");
      const before = await pc.getByTestId("judge-result").innerText();
      await expect(pc.locator('[data-layer="did"]')).toHaveCount(1);
      await pc.getByTestId(form === "workspace" ? "layer-did" : "legend-did").click();
      await expect(pc.locator('[data-layer="did"]')).toHaveCount(0);
      expect(await pc.getByTestId("judge-result").innerText()).toBe(before);
      // the five layers are listed, the legend and the map are on screen together (workspace) or the map needs a scroll (stack)
      await expect(pc.locator("[data-layer]")).toHaveCount(4);
      await expect(pc.getByTestId("map-pick")).toBeInViewport();
      await expect(pc.getByText("見本の絵・実際の区域ではありません")).toBeVisible();
    });
  }

  test("9. スマホの判定：現在地を押すと読み込み中を経て結果が出る。取得できない場合は理由とやり直しが出る", async ({ page }) => {
    await open(page);
    const sp = spFrame(page);
    await sp.getByTestId("nav-judge").click();
    await sp.getByTestId("act-geo").click();
    await expect(sp.getByTestId("judge-loading")).toContainText("現在地を確かめています");
    await expect(sp.getByTestId("judge-result")).toContainText("要手続き");
    await page.getByTestId("ctl-geo").getByRole("radio", { name: "取得できない" }).click();
    await page.getByTestId("sp-restart").click();
    await sp.getByTestId("nav-judge").click();
    await sp.getByTestId("act-geo").click();
    await expect(sp.getByTestId("judge-denied")).toContainText("現在地を取得できませんでした");
    await expect(sp.getByTestId("judge-retry")).toBeVisible();
  });
});

test.describe("D. 登録の画面：DIPS は「未接続」の静かな表示だけ", () => {
  test("10. 登録の一覧に未接続の表示。機体・操縦者に取り込みの無効ボタンと登録元の札。動作しない", async ({ page }) => {
    await open(page, "pc=tabs");
    const pc = pcFrame(page);
    await pc.getByTestId("nav-register").click();
    await expect(pc.getByTestId("dips-note")).toContainText("DIPS との接続：未接続");
    await expect(pc.getByTestId("dips-note")).toContainText("手動で記録");
    await pc.getByTestId("register-aircraft").click();
    await expect(pc.getByTestId("act-dips-import")).toBeDisabled();
    await expect(pc.getByTestId("act-dips-import")).toContainText("未接続");
    await expect(pc.getByText("登録元：アプリ").first()).toBeVisible();
    await pc.getByTestId("act-register-new").click();
    await expect(pc).toHaveAttribute("data-page", "aircraft-new");
    await expect(pc.getByTestId("stub-aircraft-new").getByRole("button", { name: /保存する/ })).toBeDisabled();
    await pc.getByTestId("back").click();
    await expect(pc).toHaveAttribute("data-page", "aircraft");
  });
});

test.describe("E. 台本ごとの操作数（PC）", () => {
  for (const menu of ["rail", "tabs"] as const) {
    for (const script of ["p1", "p2", "p3", "p4"]) {
      for (const start of ["home", "other"] as const) {
        test(`11. PC ${menu === "rail" ? "左メニュー" : "横タブ"}・台本 ${script}・開始 ${start === "home" ? "ホーム" : "日誌"}`, async ({ page }) => {
          await page.setViewportSize({ width: 1280, height: 900 });
          const judge: JudgeForm = "workspace";
          await open(page, `pc=${menu}&judge=${judge}`);
          await prepare(page, "pc", script, start, "nav-journal");
          const path = pcPath(script, menu, judge, start);
          const { taps, scrolls } = await walk(pcFrame(page), path);
          await expect(pcFrame(page)).toHaveAttribute("data-page", PC_GOAL_PAGE[script]!);
          await reachedOk(page, "pc", taps);
          expect(taps, `${menu}:${script} ${start}`).toBe(EXPECTED_PC[`${menu}:${script}`]![start]);
          record({ device: "pc", menu, judge, script, start, day: "busy", path, taps, scrollsNeeded: scrolls });
        });
      }
    }
  }

  for (const judge of ["workspace", "stack"] as const) {
    test(`12. PC 判定画面（${judge}）：地図・層の切り替え・結果が、スクロールなしで同時に見えるか（1280×900・台本 p2）`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, `pc=rail&judge=${judge}`);
      await prepare(page, "pc", "p2", "home", "nav-journal");
      const pc = pcFrame(page);
      const path = pcPath("p2", "rail", judge, "home");
      const { taps, scrolls } = await walk(pc, path);
      await reachedOk(page, "pc", taps);
      const inMain = (id: string): Promise<boolean> =>
        pc.getByTestId(id).first().evaluate((el) => {
          const m = el.closest('[data-testid="pc-main"]')!.getBoundingClientRect();
          const r = el.getBoundingClientRect();
          return r.top >= m.top - 0.5 && r.bottom <= m.bottom + 0.5;
        });
      const extra = {
        mapWhole: await inMain("judge-map"),
        resultWhole: await inMain("judge-result"),
        togglesWhole: await inMain(judge === "workspace" ? "layer-chips" : "legend-list"),
      };
      record({ device: "pc", menu: "rail", judge, script: "p2-visibility", start: "home", day: "busy", path, taps, scrollsNeeded: scrolls, extra });
      if (judge === "workspace") expect(extra).toEqual({ mapWhole: true, resultWhole: true, togglesWhole: true });
      else expect(extra.mapWhole && extra.resultWhole && extra.togglesWhole).toBe(false);
    });
  }
});

test.describe("F. 台本ごとの操作数（スマホ）", () => {
  for (const menu of ["tabs5", "tabs4band"] as const) {
    for (const script of ["s1", "s2", "s3", "s4", "s5"]) {
      for (const start of ["home", "other"] as const) {
        test(`13. スマホ ${menu === "tabs5" ? "5 タブ" : "4 タブ＋帯"}・台本 ${script}・開始 ${start === "home" ? "ホーム" : "登録"}`, async ({ page }) => {
          await page.setViewportSize({ width: 375, height: 812 });
          const day = script === "s3" ? "empty" : "busy";
          await open(page, `sp=${menu}&day=${day}`);
          await prepare(page, "phone", script, start, "nav-register");
          const path = spPath(script, menu, start);
          const sp = spFrame(page);
          const { taps, scrolls } = await walk(sp, path);
          await expect(sp).toHaveAttribute("data-page", SP_GOAL_PAGE[script]!);
          await reachedOk(page, "phone", taps);
          expect(taps, `${menu}:${script} ${start}`).toBe(EXPECTED_SP[`${menu}:${script}`]![start]);
          const extra: Record<string, boolean> = {};
          if (script === "s3") {
            // the deadlines are on the first screen without any scroll
            const row = sp.getByTestId("home-deadlines").locator("li").first();
            extra["firstDeadlineVisible"] = !(await needsScroll(row));
            expect(extra["firstDeadlineVisible"]).toBe(true);
          }
          if (script === "s4") {
            // the top of the result (the verdict) is on screen; the full list below may need a scroll
            extra["resultVisible"] = await sp.getByTestId("judge-result").evaluate((el) => {
              const m = el.closest('[data-testid="sp-main"]')!.getBoundingClientRect();
              return el.getBoundingClientRect().top + 44 <= m.bottom;
            });
            expect(extra["resultVisible"]).toBe(true);
          }
          record({ device: "phone", menu, script, start, day, path, taps, scrollsNeeded: scrolls, extra });
        });
      }
    }
  }

  for (const menu of ["tabs5", "tabs4band"] as const) {
    test(`14. 現場モードに入るまで（飛行がある日、日誌の画面から）：${menu === "tabs5" ? "5 タブ" : "4 タブ＋帯"}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await open(page, `sp=${menu}`);
      const sp = spFrame(page);
      await sp.getByTestId("nav-journal").click();
      await page.getByTestId("sp-recount").click();
      // five tabs: the home page has the button; four tabs: the band is on every page except the home page
      const path = menu === "tabs5" ? ["nav-home", "act-field"] : ["next-flight-band"];
      const { taps, scrolls } = await walk(sp, path);
      await expect(sp).toHaveAttribute("data-page", "field");
      expect(taps).toBe(menu === "tabs5" ? 2 : 1);
      record({ device: "phone", menu, script: "field-entry", start: "other", day: "busy", path, taps, scrollsNeeded: scrolls });
    });
  }
});

test.describe("F2. スクロールの観察（数えない操作の記録）", () => {
  for (const menu of ["tabs5", "tabs4band"] as const) {
    test(`14b. スマホ ${menu === "tabs5" ? "5 タブ" : "4 タブ＋帯"}：ホームの上から、計画を作るボタンと近づく期限は、スクロールなしで見えるか（飛行がある日）`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await open(page, `sp=${menu}&day=busy`);
      const sp = spFrame(page);
      const deadlines = sp.getByTestId("home-deadlines").locator("li").first();
      const extra: Record<string, boolean> = { firstDeadlineVisible: !(await needsScroll(deadlines)) };
      if (menu === "tabs4band") extra["planButtonVisible"] = !(await needsScroll(sp.getByTestId("act-plan-new-home")));
      else {
        // five tabs: the plan button is one tap away, in the plans tab
        await sp.getByTestId("nav-plans").click();
        extra["planButtonVisible"] = !(await needsScroll(sp.getByTestId("act-plan-new-list")));
      }
      record({ device: "phone", menu, script: "home-scroll", start: "home", day: "busy", path: [], taps: 0, scrollsNeeded: 0, extra });
      expect(extra["planButtonVisible"]).toBe(menu === "tabs5");
    });
  }
});

test.describe("G. 見た目の基準（横スクロールなし・押す大きさ・コントラスト）", () => {
  for (const width of [320, 375, 768, 1280]) {
    test(`15. 幅 ${width}px：明・暗・現場モード × 案の組み合わせで、ページ全体に横スクロールがない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const q of ["theme=light", "theme=dark", "theme=dark&field=1", "theme=light&pc=tabs&sp=tabs4band&day=empty&pcname=map&judge=stack"]) {
        await open(page, q);
        await expectNoHorizontalScroll(page, `${width}px ${q}`);
        // visit pages that change the layout
        await spFrame(page).getByTestId("nav-judge").click();
        await spFrame(page).getByTestId("act-geo").click();
        await expect(spFrame(page).getByTestId("judge-result")).toBeVisible();
        await expectNoHorizontalScroll(page, `${width}px ${q} 判定`);
        await spFrame(page).getByTestId("nav-register").click();
        await expectNoHorizontalScroll(page, `${width}px ${q} 登録`);
        await pcFrame(page).getByTestId("nav-judge").click();
        await expectNoHorizontalScroll(page, `${width}px ${q} PC 判定`);
      }
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`16. 押す部品は 44px 以上（${theme}）。現場モードの画面は 56px 以上・間 12px 以上・本文 7:1`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 375, height: 812 });
      await open(page, `theme=${theme}`);
      for (const [frameId, pages] of [
        ["sp-frame", ["nav-home", "nav-judge", "nav-plans", "nav-journal", "nav-register"]],
        ["pc-frame", ["nav-home", "nav-judge", "nav-plans", "nav-journal", "nav-register", "nav-aircraft"]],
      ] as const) {
        for (const nav of pages) {
          await page.getByTestId(frameId).getByTestId(nav).click();
          const targets = await collectTapTargets(page, `[data-testid="${frameId}"]`);
          const small = targets.filter((t) => t.height < 43.5 || t.width < 43.5).map((t) => `${frameId}/${nav}: ${t.testId ?? t.text} ${t.width.toFixed(0)}x${t.height.toFixed(0)}`);
          expect(small).toEqual([]);
        }
      }
      await spFrame(page).getByTestId("nav-home").click();
      await spFrame(page).getByTestId("act-field").click();
      await expectTapTargets(page, '[data-testid="page-field"]', `現場モード ${theme}`);
      await expectContrast(page, '[data-testid="page-field"]', 7, `現場モード ${theme}`);
    });

    test(`17. 文字と背景の比は 4.5:1 以上（${theme}。ホーム・判定・登録・日誌・計画の入力。両方の日・両方の案）`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: 1280, height: 900 });
      for (const q of [`theme=${theme}&day=busy`, `theme=${theme}&day=empty&pc=tabs&sp=tabs4band&judge=stack`]) {
        await open(page, q);
        await expectContrast(page, '[data-testid="menu-trial"]', 4.5, `ホーム ${theme} ${q}`);
        for (const nav of ["nav-judge", "nav-journal", "nav-register", "nav-plans"]) {
          await pcFrame(page).getByTestId(nav).click();
          // the four-tab layout has no plans tab
          if (await spFrame(page).getByTestId(nav).count()) await spFrame(page).getByTestId(nav).click();
          await expectContrast(page, '[data-testid="menu-trial"]', 4.5, `${nav} ${theme} ${q}`);
        }
        await pcFrame(page).getByTestId("nav-judge").click();
        await pcFrame(page).getByTestId("map-pick").click({ position: { x: 100, y: 100 } });
        await spFrame(page).getByTestId("nav-judge").click();
        await spFrame(page).getByTestId("act-geo").click();
        await expect(spFrame(page).getByTestId("judge-result")).toBeVisible();
        await expectContrast(page, '[data-testid="menu-trial"]', 4.5, `判定の結果 ${theme} ${q}`);
      }
    });
  }

  test("18. 文字が枠からはみ出さない（375px・320px のスマホの枠。日本語の折り返しで 1 文字だけの行が出ない）", async ({ page }) => {
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 812 });
      await open(page, "sp=tabs4band");
      for (const nav of ["nav-home", "nav-judge", "nav-journal", "nav-register"]) {
        await spFrame(page).getByTestId(nav).click();
        const over = await page.getByTestId("sp-frame").evaluate((frame) => {
          const out: string[] = [];
          const fr = frame.getBoundingClientRect();
          for (const el of Array.from(frame.querySelectorAll<HTMLElement>("*"))) {
            if (el.children.length > 0 || !el.textContent?.trim()) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0) continue;
            if (r.right > fr.right + 0.5 || r.left < fr.left - 0.5) out.push(`${el.textContent.trim().slice(0, 20)} ${r.left.toFixed(0)}-${r.right.toFixed(0)}`);
          }
          return out;
        });
        expect(over, `${width}px ${nav}`).toEqual([]);
      }
    }
  });
});
