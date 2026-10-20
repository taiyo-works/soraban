"use client";

import type { RequiredProcedure, VerdictDoneItem } from "@soraban/regulations";
import { VERDICT_LABEL } from "@/lib/verdict-display";
import { VerdictMark } from "./verdict-mark";
import {
  isNoFlyConfirmation,
  PROCEDURE_BADGE_LABEL,
  procedureBadge,
  procedureKindDisplayLabel,
} from "@/lib/procedure-display";

// 検証日メタ（ISO 8601）を YYYY-MM-DD に短縮表示する。改正レビュー用の
// 「いつ時点の制度確認に基づくレコードか」を監査可能に示す（spec §8 / sprint-4）。
const shortVerifiedAt = (iso: string | undefined): string | null => {
  if (typeof iso !== "string" || iso.length === 0) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1]! : iso;
};

type Props = {
  readonly procedure: RequiredProcedure;
  /** 飛行予定日からの提出期限の根拠説明（あれば表示） */
  readonly deadlineBasis?: string;
  /** 完了チェックの状態と更新ハンドラ（完了管理） */
  readonly done: boolean;
  readonly onToggleDone: (id: string, done: boolean) => void;
  /** 診断のカテゴリー（緊急用務空域のとき札の文言を変えるため。表示の対応付けだけ） */
  readonly category?: string;
  /** 入力した許可・同意で満たしている（手続き済み（条件付き））とき、その項目（Sprint 11d B2）。手続きは消さない。 */
  readonly satisfied?: VerdictDoneItem;
};

// システム系統バッジ: ブランド藍 1 系統で塗り/抜き/罫線の 3 段階に分け、
// DRS（登録）と DIPS 2.0（許可承認）と 条例 を視覚的に別物として扱う。
// パネル末尾の「2 系統の窓口」案内と同じ塗り分けで一貫させる。
const systemTone: Readonly<Record<RequiredProcedure["system"], string>> = {
  "DIPS 2.0": "border-brand-700 text-brand-700 bg-brand-50",
  DRS: "border-ink text-ink bg-paper-soft",
  "条例（各管理者）": "border-rule text-ink-soft bg-paper-soft",
  // 航空法とは別系統の窓口。信号色（赤）は判定結果専用なので使わず、墨の抜きで区別する。
  都道府県公安委員会: "border-ink-soft text-ink-soft bg-paper",
};

export function ProcedureCard({ procedure, deadlineBasis, done, onToggleDone, category, satisfied }: Props) {
  const kindLabel = procedureKindDisplayLabel(procedure);
  const noFly = isNoFlyConfirmation(procedure);
  const badge = procedureBadge(procedure, category);
  const verifiedAt = shortVerifiedAt(procedure.verifiedAt);
  return (
    <article
      data-testid="procedure-card"
      data-procedure-id={procedure.id}
      data-verdict={satisfied ? "procedure_done" : ""}
      className={`flex flex-col gap-3 border p-5 transition-colors ${
        done ? "border-signal-green bg-signal-green-soft" : "border-rule bg-paper hover:border-ink/40"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span
          className={`inline-flex items-center whitespace-nowrap border px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-wider ${systemTone[procedure.system]}`}
        >
          {procedure.system}
        </span>
        <span className="whitespace-nowrap text-[11px] text-ink-mute">{kindLabel}</span>
        {noFly ? (
          <span className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap border border-signal-red bg-signal-red-soft px-2 py-0.5 text-[10px] font-medium text-signal-red">
            <span aria-hidden className="relative inline-block h-2 w-2 rounded-full border border-current">
              <span className="absolute inset-x-px top-1/2 h-px -translate-y-1/2 bg-current" />
            </span>
            指定中は飛行不可
          </span>
        ) : badge === "after_release" ? (
          <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap border border-rule bg-paper-soft px-2 py-0.5 text-[10px] font-medium text-ink-mute">
            {PROCEDURE_BADGE_LABEL.after_release}
          </span>
        ) : procedure.kind === "facility_consent_notice" ? (
          <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap border border-rule bg-paper-soft px-2 py-0.5 text-[10px] font-medium text-ink-mute">
            航空法とは別系統（飛行禁止法）
          </span>
        ) : procedure.waivableByIIB ? (
          <span className="ml-auto inline-flex items-center gap-1 border border-rule bg-paper-soft px-2 py-0.5 text-[10px] font-medium text-ink-mute">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rotate-45 bg-current" />
            IIB 相当で不要化可
          </span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1 border border-signal-amber bg-signal-amber-soft px-2 py-0.5 text-[10px] font-medium text-signal-amber">
            <span aria-hidden className="inline-block h-1.5 w-1.5 bg-current" />
            IIA 相当・不要化不可
          </span>
        )}
      </div>

      <label className="group/check flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={done}
          onChange={(e) => onToggleDone(procedure.id, e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          aria-label={`${procedure.title} を完了にする`}
        />
        <h4
          className={`font-display text-base font-medium leading-snug transition-colors ${
            done ? "text-signal-green line-through" : "text-ink group-hover/check:text-brand-700"
          }`}
        >
          {procedure.title}
        </h4>
      </label>

      {satisfied ? (
        <div
          data-testid="procedure-verdict-done"
          className="flex flex-col gap-1 border-l-2 border-brand-700 bg-brand-50 px-3 py-2 text-[11px] leading-relaxed text-ink-soft"
        >
          <p className="flex items-center gap-1.5 font-semibold text-ink">
            <VerdictMark level="procedure_done" size="sm" decorative />
            {VERDICT_LABEL.procedure_done}：{satisfied.appliedPermits.map((p) => p.label).join(" / ")}
          </p>
          <ul className="flex flex-col gap-0.5">
            {satisfied.conditions.map((c) => (
              <li key={c}>・{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {procedure.note ? (
        <p className="text-xs leading-relaxed text-ink-soft">{procedure.note}</p>
      ) : null}

      <p className="border-l border-rule pl-3 text-xs leading-relaxed text-ink-mute">
        <span className="eyebrow !text-[11px]">法的根拠</span>{" "}
        <span className="text-ink-soft">{procedure.legalBasis}</span>
      </p>

      {deadlineBasis ? (
        <p className="border-l border-rule pl-3 text-xs leading-relaxed text-ink-mute">
          <span className="eyebrow !text-[11px]">提出期限</span>{" "}
          <span className="text-ink-soft">{deadlineBasis}</span>
        </p>
      ) : null}

      {/* システム系統 URL（手続きをする場所）と 出典 URL（条文・手引き）を別導線で。
          手続き窓口を主導線（藍・矢印つき）、出典を従（控えめ）として段差をつける。 */}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule pt-2.5 text-[11px]">
        <a
          href={procedure.systemUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-1 focus-visible:ring-offset-paper"
          title={
            procedure.kind === "facility_consent_notice"
              ? "事前通報の方法（警察庁の案内）を開く"
              : noFly
                ? `${procedure.system} のポータルを開く`
                : `${procedure.system} の手続き画面を開く`
          }
        >
          {procedure.kind === "facility_consent_notice"
            ? `${procedure.system}への通報方法 ↗`
            : noFly
              ? `${procedure.system} を開く ↗`
              : `${procedure.system} で手続き ↗`}
        </a>
        <span aria-hidden className="h-3 w-px bg-rule" />
        <a
          href={procedure.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ink-mute underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-1 focus-visible:ring-offset-paper"
          title="根拠条文・手引きの出典を開く"
        >
          出典 ↗
        </a>
        {/* 検証日メタ（改正レビュー用）。確定事実の出典と並べて「いつ確認したか」を示す。 */}
        {verifiedAt ? (
          <span
            className="ml-auto text-ink-mute/80 normal-case tracking-normal"
            title="この手続き定義を一次情報で確認した日付（改正レビュー用）"
          >
            確認日 {verifiedAt}
          </span>
        ) : null}
      </div>
    </article>
  );
}
