"use client";

import { useState } from "react";
import { CheckGroup, CheckRow, EmptyState, ErrorCard, PillButton, TextField } from "@/components/ui/sb-parts";
import { Sheet } from "@/components/ui/sheet";
import type { SheetStage } from "@/components/ui/sheet";

// 見本の操作のある部品（Sprint 16-D：入力欄・チェック行・ボトムシート・空の状態・通信エラー）。状態は画面の中だけ（端末のストレージには書かない）。

export function CatalogInputs() {
  const [name, setName] = useState("");
  const [checked, setChecked] = useState(false);
  const error = checked && name.trim() === "" ? "機体の名前を入力してください。" : undefined;
  return (
    <div className="sbx-grid" data-testid="cat-inputs">
      <TextField id="cat-input" label="機体の名前" hint="例：試験機 1" placeholder="入力してください" data-testid="cat-input" />
      <div className="flex flex-col gap-2">
        <TextField
          id="cat-f-check"
          label="機体の名前（確認の見本）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          requiredMark
          data-testid="cat-f-check"
        />
        <PillButton data-testid="cat-f-check-submit" onClick={() => setChecked(true)}>
          確認する
        </PillButton>
      </div>
      <TextField id="cat-f-error" label="機体の登録番号（エラーの見本）" defaultValue="" error="登録番号は 12 桁で入力してください。" data-testid="cat-f-error" />
      <TextField id="cat-f-focus" label="フォーカス中の見本（実際は Tab で出る）" hint="主色の輪 3px・離して 1 本だけ" className="sbx-focused" data-testid="cat-f-focus" />
      <TextField id="cat-f-disabled" label="機体の名前（無効の見本）" disabled defaultValue="" data-testid="cat-f-disabled" />
    </div>
  );
}

const ITEMS = ["機体にひび・欠けがない", "プロペラが固定されている", "バッテリーの残量が十分", "送信機の電池が十分"] as const;

export function CatalogChecks() {
  const [on, setOn] = useState<readonly boolean[]>([true, false, false, false]);
  const done = on.filter(Boolean).length;
  return (
    <CheckGroup title="飛行前の点検（見本）" done={done} total={ITEMS.length} testId="cat-chk-group">
      {ITEMS.map((label, i) => (
        <CheckRow
          key={label}
          label={label}
          checked={on[i] === true}
          onChange={(e) => setOn((s) => s.map((v, j) => (j === i ? e.target.checked : v)))}
          rowTestId={`cat-chk-row-${i}`}
          data-testid={`cat-chk-${i}`}
        />
      ))}
    </CheckGroup>
  );
}

export function CatalogSheet() {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<SheetStage>("half");
  const launch = (s: SheetStage) => () => {
    setStage(s);
    setOpen(true);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="sbx-row">
        <PillButton data-testid="cat-sheet-open" onClick={launch("half")}>
          シートを開く（中間）
        </PillButton>
        <PillButton data-testid="cat-sheet-open-peek" onClick={launch("peek")}>
          シートを開く（ピーク）
        </PillButton>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="点検のメモ（見本）" defaultStage={stage}>
        <p>ボトムシートの見本です。中間と全面では、フォーカスがシートの中に閉じ込められます。</p>
        <TextField id="cat-sheet-field" label="メモ" />
      </Sheet>
    </div>
  );
}

export function CatalogStates() {
  const [msg, setMsg] = useState("");
  return (
    <div className="sbx-grid">
      <EmptyState testId="cat-empty" message="まだ記録がありません。最初の記録を追加しましょう。" actionLabel="記録を追加する" onAction={() => setMsg("追加の画面を開きます（見本）")} />
      <div className="flex flex-col gap-2">
        <ErrorCard testId="cat-error" message="読み込めませんでした。通信の状態を確かめて、もう一度お試しください。" onRetry={() => setMsg("再読み込みしました（見本）")} />
        <p data-note="" className="sbx-note" data-testid="cat-states-result">
          {msg}
        </p>
      </div>
    </div>
  );
}

/** チェック（複数選択・32px の丸）とラジオ（単一選択・24px の輪）を並べる（16-D の後回し）。行全体が <label>。素の input の状態は端末の標準で動く。 */
export function CatalogChoices() {
  return (
    <div className="sbx-pair sbx-pair-choice" data-testid="cat-choices">
      <fieldset className="sbx-choice-set" data-testid="cat-check-set">
        <legend className="sbx-choice-legend">チェック（複数選択・sb-check・32px）</legend>
        <label className="sb-check-row sbx-choice">
          <input type="checkbox" className="sb-check" data-testid="cat-check-off" />
          <span>未チェック</span>
        </label>
        <label className="sb-check-row sbx-choice">
          <input type="checkbox" className="sb-check" defaultChecked data-testid="cat-check-on" />
          <span>チェック済み（記号つき）</span>
        </label>
        <label className="sb-check-row sbx-choice">
          <input type="checkbox" className="sb-check" disabled data-testid="cat-check-disabled" />
          <span>無効</span>
        </label>
        <label className="sb-check-row sbx-choice sbx-row-focused" data-testid="cat-check-focus">
          <input type="checkbox" className="sb-check" tabIndex={-1} />
          <span>フォーカス中（行の輪 1 本）</span>
        </label>
      </fieldset>
      <fieldset className="sbx-choice-set" data-testid="cat-radio-set">
        <legend className="sbx-choice-legend">ラジオ（単一選択・sb-radio・24px）</legend>
        <label className="sb-check-row sbx-choice">
          <input type="radio" name="cat-radio-demo" className="sb-radio" data-testid="cat-radio-off" />
          <span>未選択</span>
        </label>
        <label className="sb-check-row sbx-choice">
          <input type="radio" name="cat-radio-demo" className="sb-radio" defaultChecked data-testid="cat-radio-on" />
          <span>選択（内側に点）</span>
        </label>
        <label className="sb-check-row sbx-choice">
          <input type="radio" name="cat-radio-demo" className="sb-radio sb-radio-no" data-testid="cat-radio-no" />
          <span>異常あり（選ぶと危険の印の色）</span>
        </label>
        <label className="sb-check-row sbx-choice">
          <input type="radio" name="cat-radio-off-group" className="sb-radio" disabled data-testid="cat-radio-disabled" />
          <span>無効</span>
        </label>
        <label className="sb-check-row sbx-choice sbx-row-focused" data-testid="cat-radio-focus">
          <input type="radio" name="cat-radio-focus-group" className="sb-radio" tabIndex={-1} />
          <span>フォーカス中（行の輪 1 本）</span>
        </label>
      </fieldset>
    </div>
  );
}
