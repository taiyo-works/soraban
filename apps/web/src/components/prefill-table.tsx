"use client";

import { useCallback, useRef, useState } from "react";
import type { PrefillField } from "@soraban/regulations";

type Props = {
  readonly prefill: readonly PrefillField[];
};

// system → 表示トーン（DRS=墨抜き / DIPS 2.0=藍）。procedure-card・パネル末尾の
// 「2 系統の窓口」と同じ塗り分けで一貫させ、別導線であることを一目で示す。
const systemTone: Readonly<Record<PrefillField["system"], string>> = {
  "DIPS 2.0": "border-sb-ink text-sb-ink bg-sb-st-info-face",
  DRS: "border-sb-edge text-sb-ink bg-sb-surface",
};

// クリップボードへコピー。navigator.clipboard が使えない環境（http や古い WebView）の
// ための textarea + execCommand フォールバックを持つ。成功/失敗を boolean で返す。
const copyToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // フォールバックへ
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

export function PrefillTable({ prefill }: Props) {
  // どの行をコピーしたか（index → "ok" | "fail"）。一定時間で消す。
  const [copied, setCopied] = useState<Readonly<Record<number, "ok" | "fail">>>({});
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const handleCopy = useCallback(async (idx: number, value: string) => {
    const ok = await copyToClipboard(value);
    setCopied((prev) => ({ ...prev, [idx]: ok ? "ok" : "fail" }));
    if (timers.current[idx]) clearTimeout(timers.current[idx]);
    timers.current[idx] = setTimeout(() => {
      setCopied((prev) => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
    }, 1800);
  }, []);

  if (prefill.length === 0) {
    return (
      <section className="flex flex-col gap-3" aria-labelledby="prefill-heading">
        <p id="prefill-heading" className="sb-eyebrow">
          DIPS／DRS 入力プリフィル
        </p>
        <p className="flex items-start gap-3 border border-dashed border-sb-rule bg-sb-base px-4 py-5 text-sm leading-relaxed text-sb-ink-2 rounded-sb-m">
          <span aria-hidden className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rotate-45 bg-sb-ink-3" />
          <span>現在の入力ではプリフィルする項目がありません。地点・飛行方法・機体重量を入力してください。</span>
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="prefill-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-1">
          <p id="prefill-heading" className="sb-eyebrow">
            DIPS／DRS 入力プリフィル (
            <span className="tnum">{String(prefill.length).padStart(2, "0")}</span> 行)
          </p>
          <p className="max-w-prose text-sm leading-relaxed text-sb-ink-2">
            各行の値をコピーして、DIPS 2.0（許可・承認）／DRS（機体登録）のフォームに貼り付けてください。
            自動入力はしません（規約・法的リスク回避）。入力先システムは行ごとに区別しています。
          </p>
        </div>
        {/* 系統の凡例（行頭の系統列と同じ塗り分け）。DRS と DIPS 2.0 が別ポータルである
            ことを表頭で一目に示す。値・ラベルは変えず装飾の凡例のみ。 */}
        <div className="flex shrink-0 items-center gap-3 text-sm tracking-wide text-sb-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-2.5 w-2.5 border ${systemTone.DRS}`} />
            DRS
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-2.5 w-2.5 border ${systemTone["DIPS 2.0"]}`} />
            DIPS 2.0
          </span>
        </div>
      </div>

      {/* 台帳組版: 通し番号 / 系統 / 入力欄 / 値（主役） / 出所 / コピー。
          値列を主役として ・ink で最も強く、ラベルと出所は従属色に落とす。
          モバイルでも崩れないよう min-w + 横スクロール。 */}
      <div className="rounded-sb-m border border-sb-rule md:overflow-x-auto">
        <table className="block w-full border-collapse text-left text-sm md:table md:min-w-[680px]">
          <thead className="max-md:hidden">
            <tr className="border-b border-sb-edge bg-sb-surface text-sm tracking-wide text-sb-ink-3">
              <th scope="col" className="w-8 py-2.5 pl-3 text-center font-medium">
                <span aria-hidden>#</span>
              </th>
              <th scope="col" className="py-2.5 pl-3 pr-3 font-medium">
                系統
              </th>
              <th scope="col" className="py-2.5 pr-3 font-medium">
                DIPS／DRS 入力欄
              </th>
              <th scope="col" className="py-2.5 pr-3 font-medium text-sb-ink-2">
                値（コピペ用）
              </th>
              <th scope="col" className="py-2.5 pr-3 font-medium">
                出所
              </th>
              <th scope="col" className="py-2.5 pr-3 text-right font-medium">
                コピー
              </th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-sb-rule md:table-row-group">
            {prefill.map((f, idx) => {
              const state = copied[idx];
              return (
                <tr
                  key={`${f.system}-${f.dipsFieldLabel}-${idx}`}
                  className="flex flex-col gap-1 px-3 py-3 align-top transition-colors hover:bg-sb-surface md:table-row md:p-0"
                >
                  {/* 通し番号（register の一葉感。coverage 一覧・期限カレンダーと同じ mono tnum）。 */}
                  <td
                    aria-hidden
                    className="select-none py-3 pl-3 text-center align-middle sb-num text-sm tnum text-sb-ink-3 max-md:hidden"
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </td>
                  <td className="py-3 pl-3 pr-3 max-md:block max-md:p-0">
                    <span
                      className={`inline-flex items-center border px-1.5 py-px sb-num text-sm font-medium uppercase tracking-wider ${systemTone[f.system]}`}
                    >
                      {f.system}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-[0.875rem] leading-relaxed text-sb-ink-2 max-md:block max-md:p-0" data-label="入力欄">
                    {f.dipsFieldLabel}
                  </td>
                  {/* 値＝この表の主役。display 書体・ink で最大の可読性を確保。 */}
                  <td className="py-3 pr-3 max-md:block max-md:p-0" data-label="値">
                    <span className=" font-medium text-sb-ink">{f.value}</span>
                  </td>
                  <td className="py-3 pr-3 text-sm leading-relaxed text-sb-ink-3 max-md:block max-md:p-0" data-label="出所">
                    {f.source}
                  </td>
                  <td className="py-3 pr-3 text-right max-md:block max-md:p-0 max-md:text-left">
                    <button
                      type="button"
                      onClick={() => void handleCopy(idx, f.value)}
                      className={`inline-flex min-h-11 min-w-[6.5rem] items-center justify-center gap-1.5 rounded-sb-pill border px-3 py-1.5 sb-num text-sm font-bold transition-colors ${
                        state === "ok"
                          ? "border-sb-v-none-fg bg-sb-surface text-sb-v-none-fg"
                          : state === "fail"
                            ? "border-sb-v-no-fg bg-sb-surface text-sb-v-no-fg"
                            : "border-sb-edge bg-sb-control text-sb-ink hover:bg-sb-hover"
                      }`}
                      aria-label={`${f.dipsFieldLabel} の値「${f.value}」をコピー`}
                      title="この値をクリップボードにコピー"
                    >
                      {state === "ok" ? (
                        <span className="inline-flex items-center gap-1">
                          <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-current" />
                          コピー済
                        </span>
                      ) : state === "fail" ? (
                        <span className="inline-flex items-center gap-1">
                          <span aria-hidden className="inline-block h-2 w-2 bg-current" />
                          失敗
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden className="inline-block h-2 w-2 border border-current" />
                          コピー
                        </span>
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* コピー成功の live region（スクリーンリーダ向けフィードバック）。 */}
      <p className="sr-only" role="status" aria-live="polite">
        {Object.values(copied).some((s) => s === "ok") ? "値をクリップボードにコピーしました" : ""}
      </p>
    </section>
  );
}
