"use client";

import {
  buildFlightManualDraft,
  formatManualDraftText,
  type ManualChoice,
  type SpecificFlightFlag,
} from "@soraban/regulations";
import { useState } from "react";
import { shortUrl, splitInlineSource } from "@/lib/inline-source";

type Props = {
  /** 診断に使った最終フラグ集合（空域＋方法）。骨子の追記観点の選定に使う。 */
  readonly flags: readonly SpecificFlightFlag[];
  /** 選択（標準／独自）。親（パネル）が PDF にも渡せるよう lift up する。 */
  readonly choice: ManualChoice;
  readonly onChoiceChange: (choice: ManualChoice) => void;
  /** 機体重量（g）。100g 未満は模型航空機の観点・根拠に置き換える（Sprint 11e）。 */
  readonly droneWeightG?: number;
};

// 飛行マニュアルの骨子ドラフト表示 ＋ 標準／独自の選択 UI。
// - choice="standard": 標準マニュアルを使う旨と参照先のみ（本文は出さない＝著作権配慮）。
// - choice="custom":   独自マニュアルの基本章 + 該当飛行方法の追記観点（骨子）を表示。
export function ManualDraft({ flags, choice, onChoiceChange, droneWeightG }: Props) {
  const draft = buildFlightManualDraft({
    choice,
    flags,
    ...(droneWeightG !== undefined ? { droneWeightG } : {}),
  });
  const [copied, setCopied] = useState<boolean>(false);

  // 整形テキストをコピー（独自骨子・標準通知のどちらでも）。
  const handleCopyText = async (): Promise<void> => {
    const text = formatManualDraftText(draft);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  // 選択トグル: ラジオではなくセグメント風のボタン 2 つ（タップしやすく状態が明確）。
  // 選択中は藍塗り＋左の状態記（製図記号）で「いま選ばれている方針」を二重に明示。
  const segBtn = (active: boolean): string =>
    `flex-1 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-sb-pill border-2 px-4 py-2.5 text-sm font-bold transition-colors ${
      active
        ? "border-sb-ink bg-sb-control text-sb-ink"
        : "border-dashed border-sb-edge bg-transparent text-sb-ink-2 hover:bg-sb-hover"
    }`;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="manual-draft-heading">
      <div className="flex flex-col gap-1">
        <p id="manual-draft-heading" className="sb-eyebrow">
          書類ドラフト — 飛行マニュアル
        </p>
        <p className="text-xs leading-relaxed text-sb-ink-2">
          「標準マニュアル（01／02）を使う」か「独自マニュアルを作る」かを選べます。
          標準を選んだ場合は本ツールでは本文を表示しません（著作権配慮）。独自を選ぶと、
          選択中の飛行方法に対応した骨子（記載すべき項目と観点）を生成します。
        </p>
      </div>

      {/* 標準／独自の選択 */}
      <div
        role="radiogroup"
        aria-label="飛行マニュアルの方針"
        className="flex flex-col gap-2 sm:flex-row"
      >
        <button
          type="button"
          role="radio"
          aria-checked={choice === "standard"}
          onClick={() => onChoiceChange("standard")}
          className={segBtn(choice === "standard")}
        >
          <span
            aria-hidden
            className={`inline-block h-2 w-2 shrink-0 rotate-45 ${
              choice === "standard" ? "bg-sb-orange" : "border border-sb-edge"
            }`}
          />
          標準マニュアル（01／02）を使う
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={choice === "custom"}
          onClick={() => onChoiceChange("custom")}
          className={segBtn(choice === "custom")}
        >
          <span
            aria-hidden
            className={`inline-block h-2 w-2 shrink-0 rotate-45 ${
              choice === "custom" ? "bg-sb-orange" : "border border-sb-edge"
            }`}
          />
          独自マニュアルを作る（骨子を生成）
        </button>
      </div>

      {/* 出力（選択に応じて変わる） */}
      {choice === "standard" ? (
        <div className="flex flex-col gap-2 border-l-2 border-sb-ink bg-sb-base px-4 py-3.5">
          <p className="sb-eyebrow">{draft.standardReference.label} を使用</p>
          <p className="text-xs leading-relaxed text-sb-ink-2">{draft.standardNotice}</p>
          <p className="border-t border-sb-rule pt-2 text-xs tracking-wide text-sb-ink-3">
            参照{" "}
            <a
              href={draft.standardReference.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sb-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sb-focus"
            >
              航空局 標準マニュアル（出典）↗
            </a>
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 border border-sb-rule bg-sb-base px-4 py-4 rounded-sb-m">
          <p className="text-xs leading-relaxed text-sb-ink-3">
            ※ 以下は記載すべき項目の見出しと観点（骨子）です。航空局 標準マニュアル01／02
            の本文は含みません（著作権配慮）。実際のマニュアルは自社の運用に合わせて作成してください。
          </p>

          {/* 基本構成 */}
          <div className="flex flex-col gap-2.5">
            <p className="flex items-center gap-2 text-xs tracking-wide text-sb-ink-3">
              <span aria-hidden className="inline-block h-1.5 w-1.5 rotate-45 border border-sb-edge" />
              基本構成
              <span aria-hidden className="h-px flex-1 bg-sb-rule" />
            </p>
            <ol className="flex flex-col gap-3">
              {draft.baseSections.map((s) => (
                <li key={s.id} className="border-l border-sb-rule pl-3.5">
                  <p className=" text-sm font-medium leading-snug text-sb-ink">{s.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-sb-ink-2">{s.outline}</p>
                </li>
              ))}
            </ol>
          </div>

          {/* 飛行方法に応じた追記観点 */}
          {draft.methodSections.length > 0 ? (
            <div className="flex flex-col gap-2.5 border-t border-sb-rule pt-3.5">
              <p className="flex items-center gap-2 text-xs tracking-wide text-sb-ink">
                <span aria-hidden className="inline-block h-1.5 w-1.5 bg-sb-ink" />
                選択した飛行方法に応じて追記する観点
                <span aria-hidden className="h-px flex-1 bg-sb-ink" />
              </p>
              <ol className="flex flex-col gap-3">
                {draft.methodSections.map((m) => (
                  <li key={m.flag} className="border-l-2 border-sb-ink pl-3">
                    <p className=" text-sm font-medium text-sb-ink">{m.title}</p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {m.points.map((p, i) => {
                        // 観点の文中の URL は本文から切り分け、観点の下に短い表記の控えめなリンクとして添える。
                        const point = splitInlineSource(p);
                        return (
                          <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-sb-ink-2">
                            <span aria-hidden className="mt-1.5 inline-block h-1 w-1 shrink-0 rotate-45 bg-sb-ink" />
                            <span className="min-w-0">
                              {point.text}
                              {point.urls.map((url) => (
                                <span key={url} className="mt-0.5 block text-xs text-sb-ink-3">
                                  出典{" "}
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="break-all sb-num text-[10.5px] underline decoration-sb-rule underline-offset-2 hover:text-sb-ink hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sb-focus focus-visible:ring-offset-1 focus-visible:ring-offset-sb-base"
                                  >
                                    {shortUrl(url)}
                                  </a>
                                </span>
                              ))}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-1.5 text-xs tracking-wide text-sb-ink-3">
                      根拠 {m.legalBasis}{" "}
                      <a
                        href={m.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sb-ink underline-offset-2 hover:underline"
                      >
                        出典 ↗
                      </a>
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="border-t border-sb-rule pt-3 text-xs leading-relaxed text-sb-ink-3">
              飛行方法が選択されていないため、追記観点はありません。基本構成のみを骨子とします。
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-sb-rule pt-3">
        <button
          type="button"
          onClick={() => void handleCopyText()}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-sb-pill border px-4 py-2 sb-num text-xs font-bold transition-colors ${
            copied
              ? "border-sb-v-none-fg bg-sb-surface text-sb-v-none-fg"
              : "border-sb-edge bg-sb-control text-sb-ink hover:bg-sb-hover"
          }`}
          title="ドラフトのテキストをコピー"
        >
          {copied ? (
            <>
              <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-current" />
              コピー済
            </>
          ) : (
            <>
              <span aria-hidden className="inline-block h-2 w-2 border border-current" />
              ドラフトをコピー
            </>
          )}
        </button>
      </div>
    </section>
  );
}
