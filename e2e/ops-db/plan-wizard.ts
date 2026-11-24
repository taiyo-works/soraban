import { expect, type Page } from "@playwright/test";

/**
 * 計画の新規作成（/ops/plans/new）は、6 段（①場所 ②日時 ③飛行の方法と目的 ④操縦者・機体・許可 ⑤内容の確認（保存）⑥保存後の計画の画面。Sprint 16-H1）。
 * 1 画面の前提で書かれた検査が、段を進めて同じ値を入れられるようにする helper。入れる値・保存される値・判定の結果は、1 画面のときと同じ。
 *
 * Next のクライアントのルーターで最初の押下が反応しないことがある（sprint-16.md §17 申し送り 9）ので、「次へ」「戻る」は
 * 段の表示（`plan-form` の `data-step`）が変わるまで再試行する。`goto` で逃げない。
 */

export type WizardValues = {
  /** ① よく使う地点（表示名で選ぶ）。 */
  readonly savedPlace?: string;
  readonly placeName?: string;
  readonly lat?: string;
  readonly lng?: string;
  readonly radius?: string;
  /** ② */
  readonly date?: string;
  readonly time?: string;
  readonly duration?: string;
  /** ③ */
  readonly title?: string;
  readonly purpose?: string;
  readonly altitude?: string;
  readonly flags?: readonly string[];
  readonly judgementPurpose?: string;
  readonly access?: string;
  readonly observer?: string;
  /** ④ */
  readonly aircraftId?: string;
  readonly pilotId?: string;
  readonly permits?: readonly string[];
  readonly permitNumbers?: string;
  readonly notes?: string;
};

const tid = (page: Page, id: string) => page.getByTestId(id);

/** 今の段（1〜5）。 */
export const currentStep = async (page: Page): Promise<number> => Number(await tid(page, "plan-form").getAttribute("data-step"));

export const expectStep = async (page: Page, n: number): Promise<void> => {
  await expect(tid(page, "plan-form")).toHaveAttribute("data-step", String(n));
  await expect(tid(page, "plan-wizard-progress")).toHaveAttribute("aria-valuenow", String(n));
};

/** ボタンを押して、段が `to` になるまで（最初の押下が効かないことがあるので）押し直す。 */
const tapUntilStep = async (page: Page, testId: string, to: number): Promise<void> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    await tid(page, testId).click();
    try {
      await expect(tid(page, "plan-form")).toHaveAttribute("data-step", String(to), { timeout: 3_000 });
      return;
    } catch {
      // 反応しなかった。もう一度押す
    }
  }
  await expectStep(page, to);
};

/** 「次へ」を押して、次の段へ進む（入力に漏れがなく、段が進む前提）。 */
export const tapNext = async (page: Page): Promise<void> => tapUntilStep(page, "plan-wizard-next", (await currentStep(page)) + 1);
export const tapBack = async (page: Page): Promise<void> => tapUntilStep(page, "plan-wizard-back", (await currentStep(page)) - 1);

/** 段の入力欄に値を入れる（渡した値だけ。省略したものは触らない）。 */
export const fillStep = async (page: Page, step: number, v: WizardValues): Promise<void> => {
  await expectStep(page, step);
  if (step === 1) {
    if (v.savedPlace !== undefined) await tid(page, "plan-saved-place").selectOption({ label: v.savedPlace });
    if (v.placeName !== undefined) await tid(page, "plan-place-name").fill(v.placeName);
    if (v.lat !== undefined) await tid(page, "plan-lat").fill(v.lat);
    if (v.lng !== undefined) await tid(page, "plan-lng").fill(v.lng);
    if (v.radius !== undefined) await tid(page, "plan-radius").fill(v.radius);
  } else if (step === 2) {
    if (v.date !== undefined) await tid(page, "plan-start-date").fill(v.date);
    if (v.time !== undefined) await tid(page, "plan-start-time").fill(v.time);
    if (v.duration !== undefined) await tid(page, "plan-duration").fill(v.duration);
  } else if (step === 3) {
    if (v.title !== undefined) await tid(page, "plan-title").fill(v.title);
    if (v.purpose !== undefined) await tid(page, "plan-purpose").fill(v.purpose);
    if (v.altitude !== undefined) await tid(page, "plan-altitude").fill(v.altitude);
    for (const f of v.flags ?? []) await tid(page, `plan-flag-${f}`).check();
    if (v.judgementPurpose !== undefined) await tid(page, "plan-judgement-purpose").selectOption(v.judgementPurpose);
    if (v.access !== undefined) await tid(page, "plan-access").selectOption(v.access);
    if (v.observer !== undefined) await tid(page, "plan-observer").selectOption(v.observer);
  } else if (step === 4) {
    if (v.aircraftId !== undefined) await tid(page, "plan-aircraft").selectOption(v.aircraftId);
    if (v.pilotId !== undefined) await tid(page, "plan-pilot").selectOption(v.pilotId);
    for (const p of v.permits ?? []) await tid(page, `plan-permit-${p}`).check();
    if (v.permitNumbers !== undefined) await tid(page, "plan-permit-numbers").fill(v.permitNumbers);
    if (v.notes !== undefined) await tid(page, "plan-notes").fill(v.notes);
  }
};

/**
 * ①から順に値を入れて「次へ」で進み、`upTo`（既定は ⑤ 内容の確認）の段で止まる。今の段が ① でなければ、今の段から続ける。
 * 渡さなかった値は触らない（引き継ぎ・先に入れた値を残す）。
 */
export const walkWizard = async (page: Page, v: WizardValues, upTo = 5): Promise<void> => {
  let step = await currentStep(page);
  while (step <= Math.min(upTo, 4)) {
    await fillStep(page, step, v);
    if (step === upTo) return;
    await tapNext(page);
    step += 1;
  }
};

/** ⑤ で「計画を保存」を押す（押した後の遷移は呼び出し側が待つ）。 */
export const clickSave = async (page: Page): Promise<void> => {
  await expectStep(page, 5);
  await tid(page, "plan-submit").click();
};

/** ①〜④に値を入れて ⑤ で保存し、保存後の計画の画面（/ops/plans/<id>）へ移るまで待つ。計画の id を返す。 */
export const createPlanThroughWizard = async (page: Page, v: WizardValues): Promise<string> => {
  await walkWizard(page, v, 5);
  await clickSave(page);
  await page.waitForURL(/\/ops\/plans\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
};
