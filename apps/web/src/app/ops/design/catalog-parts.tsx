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
