"use client";

import { useState } from "react";
import {
  buildFlightManualDraft,
  getCategoryDefinition,
  formatDidDetermination,
  verificationNoteLabel,
  toJstIsoDate,
  PROCEDURES_VERIFIED_AT,
  type DiagnosisCategory,
  type ManualChoice,
} from "@soraban/regulations";
import { MODEL_AIRCRAFT_CATEGORY_HEADLINE, MODEL_AIRCRAFT_CATEGORY_NOTE } from "@soraban/regulations";
import type { DiagnoseResponse } from "@/lib/diagnose";
import { shortUrl, splitInlineSource } from "@/lib/inline-source";
import { ProcedureCard } from "./procedure-card";
import { doneByProcedureId, isModelAircraftDiagnosis } from "@/lib/verdict-display";
import { DeadlineCalendar } from "./deadline-calendar";
import { PrefillTable } from "./prefill-table";
import { ManualDraft } from "./manual-draft";

type Props = {
  readonly diagnosis: DiagnoseResponse;
  /** 入力中の飛行予定日（ISO 日付。未入力なら空文字）。期限カレンダーで使う。 */
  readonly plannedDate: string;
  /** 手続き完了チェック状態（親で履歴と同期する場合に指定、未指定時は内部 state で動作） */
  readonly doneMap?: Readonly<Record<string, boolean>>;
  readonly onToggleDone?: (id: string, done: boolean) => void;
  /** 飛行マニュアル方針（親で履歴と同期する場合に指定、未指定時は内部 state で動作） */
  readonly manualChoice?: ManualChoice;
  readonly onManualChoiceChange?: (choice: ManualChoice) => void;
};

// カテゴリー切り分けの severity 表現。信号機と同じ「色＋符号＋ラベル」の
// 三重符号化で段階を示す。意味の担い手はテキストラベル（severity）であり、
// glyph は装飾（aria-hidden）。色だけに依存しない（WCAG / 色覚多様性対応）。
//
//   I            … 特定飛行に非該当 → 緑（clear）。最も弱い。
//   IIA / IIB    … 申請が必要 → ブランド藍。装飾色ではなく「要対応」の系統色。
//   III(level4)  … 第三者上空 → 赤。パレット中で最も強い severity。最も目立たせる。
//   緊急用務空域 … 原則飛行禁止 → 赤。III と同じ赤でも、符号（円に横棒＝進入禁止の形）・
//                  ラベル（原則飛行禁止）・太い左罫で III（警告の三角・最重要）と区別する。
//
// glyph: bearing-mark と同じ製図記号の語彙。CSS の border だけで描き、新規
// トークンや画像・絵文字は増やさない。
type CategorySeverity = {
  /** バナー左罫の色 */
  readonly rule: string;
  /** 見出し・符号の前景色 */
  readonly accent: string;
  /** バナー面の地色（III のみ severity-soft で面を起こして最も目立たせる） */
  readonly surface: string;
  /** 三重符号化の「ラベル」要素。色・符号と並ぶ三つ目の手がかり。 */
  readonly severity: string;
  /** glyph の形状（製図記号）。prohibit=飛行不可 / triangle=警告 / square=要対応 / diamond=clear */
  readonly mark: "diamond" | "square" | "triangle" | "prohibit";
  /** III を最重要として面取りを強める */
  readonly emphatic: boolean;
};

const categorySeverity: Readonly<Record<DiagnosisCategory, CategorySeverity>> = {
  I: {
    rule: "border-signal-green",
    accent: "text-signal-green",
    surface: "bg-paper",
    severity: "非該当",
    mark: "diamond",
    emphatic: false,
  },
  needs_verification: {
    rule: "border-signal-amber",
    accent: "text-signal-amber",
    surface: "bg-signal-amber-soft",
    severity: "要確認",
    mark: "triangle",
    emphatic: false,
  },
  II_A: {
    rule: "border-brand-700",
    accent: "text-brand-700",
    surface: "bg-paper",
    severity: "要申請",
    mark: "square",
    emphatic: false,
  },
  II_B_eligible: {
    rule: "border-brand-700",
    accent: "text-brand-700",
    surface: "bg-paper",
    severity: "要申請（不要にできる場合あり）",
    mark: "square",
    emphatic: false,
  },
  III_level4: {
    rule: "border-signal-red",
    accent: "text-signal-red",
    surface: "bg-signal-red-soft",
    severity: "最重要",
    mark: "triangle",
    emphatic: true,
  },
  emergency_no_fly: {
    rule: "border-signal-red",
    accent: "text-signal-red",
    surface: "bg-signal-red-soft",
    severity: "原則飛行禁止",
    mark: "prohibit",
    emphatic: true,
  },
};

const categoryHeadline: Readonly<Record<DiagnosisCategory, string>> = {
  I: "カテゴリー I（特定飛行に非該当）",
  needs_verification: "要確認（DID 等の空域該当が未確認）",
  II_A: "カテゴリー II（IIA 相当・申請が必要）",
  II_B_eligible: "カテゴリー II（IIB 相当・申請を不要化できる可能性）",
  III_level4: "カテゴリー III（レベル4・第三者上空）",
  emergency_no_fly: "飛行できません（緊急用務空域・原則飛行禁止）",
};

// 注記の文中の出典 URL は本文から切り分け、本文の下に短い表記の控えめなリンクとして添える
// （注記の文字列はそのまま持ち、PDF では「出典:」行の URL 文字列として出す）。
function NoteWithSource({ text }: { text: string }) {
  const { text: body, urls } = splitInlineSource(text);
  return (
    <>
      <span>{body}</span>
      {urls.map((url) => (
        <span key={url} className="mt-0.5 block text-[11px] font-normal text-ink-mute">
          出典{" "}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-mono text-[10.5px] underline decoration-rule underline-offset-2 hover:text-ink hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-1 focus-visible:ring-offset-paper"
          >
            {shortUrl(url)}
          </a>
        </span>
      ))}
    </>
  );
}

// severity glyph: CSS の border だけで描く製図記号。aria-hidden 前提（装飾）。
function SeverityMark({ shape, className }: { shape: CategorySeverity["mark"]; className: string }) {
  if (shape === "prohibit") {
    // 飛行不可：円に横棒（進入禁止の形）。currentColor の罫線で描く。
    return (
      <span
        aria-hidden
        className={`relative inline-block h-[11px] w-[11px] shrink-0 rounded-full border-[1.5px] border-current ${className}`}
      >
        <span className="absolute left-[1.5px] right-[1.5px] top-1/2 h-[1.5px] -translate-y-1/2 bg-current" />
      </span>
    );
  }
  if (shape === "triangle") {
    // 警告の三角。currentColor で塗る。
    return (
      <span
        aria-hidden
        className={`inline-block h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent ${className}`}
        style={{ borderBottomColor: "currentColor" }}
      />
    );
  }
  if (shape === "square") {
    return <span aria-hidden className={`inline-block h-2 w-2 bg-current ${className}`} />;
  }
  // diamond: 45deg 回転の小四角（clear）
  return <span aria-hidden className={`inline-block h-2 w-2 rotate-45 bg-current ${className}`} />;
}

export function DiagnosisPanel({
  diagnosis,
  plannedDate,
  doneMap: controlledDoneMap,
  onToggleDone,
  manualChoice: controlledManualChoice,
  onManualChoiceChange,
}: Props) {
  // 完了チェックの状態（手続き id → done）。親から制御されない場合のローカルフォールバック。
  const [internalDoneMap, setInternalDoneMap] = useState<Readonly<Record<string, boolean>>>({});
  const doneMap = controlledDoneMap ?? internalDoneMap;
  const toggleDone = (id: string, done: boolean): void => {
    setInternalDoneMap((prev) => ({ ...prev, [id]: done }));
    onToggleDone?.(id, done);
  };

  // 飛行マニュアルの方針（標準／独自）。既定は独自（骨子が見える方）。
  // 束ね PDF にも同じ選択を反映するためパネルで状態を保持する。
  const [internalManualChoice, setInternalManualChoice] = useState<ManualChoice>("custom");
  const manualChoice = controlledManualChoice ?? internalManualChoice;
  const handleManualChoiceChange = (choice: ManualChoice): void => {
    setInternalManualChoice(choice);
    onManualChoiceChange?.(choice);
  };

  // 束ね PDF 生成中フラグ。
  const [bundleBusy, setBundleBusy] = useState<boolean>(false);
  const [bundleError, setBundleError] = useState<string | null>(null);

  // 手続き済み（条件付き）の印（Sprint 11d B2）。手続きそのものは消さない。
  const satisfiedMap = doneByProcedureId(diagnosis.verdict);

  const deadlineFor = (id: string): string | undefined =>
    diagnosis.deadlines.find((d) => d.procedureId === id)?.basis;

  const doneCount = diagnosis.procedures.filter((p) => doneMap[p.id]).length;

  // 束ね PDF 出力。既存単発 PDF と同じ作法（@react-pdf/renderer・self-host フォント・
  // 動的 import）。ファイル名に evidenceId を含め、いつのロジックの診断か同定可能にする。
  const handleBundlePdfExport = async (): Promise<void> => {
    setBundleBusy(true);
    setBundleError(null);
    try {
      const [{ pdf }, { ApplicationPdfDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./application-pdf"),
      ]);
      // PDF に焼く飛行マニュアルは、画面で選択中の方針（標準／独自）と一致させる。
      const manualDraft = buildFlightManualDraft({
        choice: manualChoice,
        flags: diagnosis.flags,
      });
      const blob = await pdf(
        <ApplicationPdfDocument
          diagnosis={diagnosis}
          manualDraft={manualDraft}
          plannedDate={plannedDate}
          todayIso={toJstIsoDate()}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      // ファイル名に evidenceId を含める（束ね PDF と単発 PDF を名前で区別）。
      anchor.download = `soraban-application-${diagnosis.evidenceId}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (err) {
      setBundleError(`束ね PDF の生成に失敗しました: ${(err as Error).message}`);
    } finally {
      setBundleBusy(false);
    }
  };

  return (
    <section
      className="flex flex-col gap-6 border-y border-double border-rule bg-paper-soft/40 p-4 sm:gap-7 sm:p-6"
      aria-live="polite"
      aria-labelledby="diagnosis-heading"
    >
      <div className="flex flex-col gap-1">
        <p id="diagnosis-heading" className="eyebrow">
          <span aria-hidden className="bearing-mark" />
          申請支援 — 必要手続き診断
        </p>
        <p className="text-sm leading-relaxed text-ink-soft">
          信号機判定の理由（DID・空港等）と選択した飛行方法から、必要な申請・登録・手続きを機械的に導出しています。
        </p>
      </div>

      {/* カテゴリー切り分けバナー（結果先頭）。色＋符号＋ラベルの三重符号化で
          severity を示し、III＝レベル4 は赤の面取りで最も強く警告する。 */}
      {(() => {
        const modelAircraft = isModelAircraftDiagnosis(diagnosis);
        const sev = modelAircraft
          ? { ...categorySeverity[diagnosis.category], severity: "模型航空機" }
          : categorySeverity[diagnosis.category];
        // カテゴリー定義（出典 URL を含む）。出典は制度データ（categories.json）由来で
        // コード直書きしない。バナーに出典を併記する契約を満たす。
        const def = getCategoryDefinition(diagnosis.category);
        return (
          <div
            className={`${diagnosis.category === "emergency_no_fly" ? "border-l-4" : "border-l-2"} ${sev.rule} ${sev.surface} px-4 py-3.5 ${sev.emphatic ? "border-y border-r" : ""}`}
          >
            <div className={`flex items-center gap-2 ${sev.accent}`}>
              <SeverityMark shape={sev.mark} className={sev.accent} />
              <p className={`eyebrow !text-[11px] ${sev.accent}`}>カテゴリー切り分け</p>
              <span
                className={`ml-auto inline-flex items-center border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                  sev.emphatic
                    ? "border-signal-red bg-signal-red text-paper"
                    : `${sev.rule} ${sev.accent} bg-paper`
                }`}
              >
                {sev.severity}
              </span>
            </div>
            <p className={`mt-1.5 font-display text-lg font-medium leading-snug ${sev.accent}`}>
              <span data-testid="diagnosis-category-headline">
                {modelAircraft ? MODEL_AIRCRAFT_CATEGORY_HEADLINE : categoryHeadline[diagnosis.category]}
              </span>
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
              {modelAircraft ? MODEL_AIRCRAFT_CATEGORY_NOTE : diagnosis.categoryNote}
            </p>
            <p className="mt-1.5 text-[11px] tracking-wide text-ink-mute" data-testid="diagnosis-did-status">
              DID（人口集中地区）: {formatDidDetermination(diagnosis.didStatus ?? "unverified", diagnosis.didDetail)}
            </p>
            {(diagnosis.verificationNotes ?? []).length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1 border-t border-signal-amber/40 pt-2 text-xs leading-relaxed text-signal-amber">
                {(diagnosis.verificationNotes ?? []).map((n) => (
                  <li key={n}>
                    {verificationNoteLabel(n)}<NoteWithSource text={n} />
                  </li>
                ))}
              </ul>
            ) : null}
            {diagnosis.category === "III_level4" ? (
              <p className="mt-2.5 flex gap-2 border-t border-signal-red/30 pt-2.5 text-xs font-medium leading-relaxed text-signal-red">
                <SeverityMark shape="triangle" className="mt-0.5 shrink-0" />
                <span>
                  ※ 単純な飛行許可・承認の申請では実施できません。一等無人航空機操縦士 ＋ 第一種機体認証が必須です。
                </span>
              </p>
            ) : null}
            {/* IIA／IIB は正式名称が未確認（spec §11-D）。「相当」表記であることの断りと
                出典を併記する。確定的に正式名称と断定しない。 */}
            {diagnosis.category === "II_A" || diagnosis.category === "II_B_eligible" ? (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-mute">
                ※「IIA／IIB」の呼称が国土交通省の正式名称か運用通称かは要確認のため「相当」表記としています（制度実体＝申請が必要な区分と不要化できる区分の別は確実）。
              </p>
            ) : null}
            {/* 出典の併記（契約：カテゴリー切り分けバナーに出典を併記）。 */}
            <p className="mt-2 border-t border-rule/60 pt-2 text-[11px] tracking-wide text-ink-mute">
              出典{" "}
              <a
                href={def.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-1 focus-visible:ring-offset-paper"
                title={
                  diagnosis.category === "emergency_no_fly"
                    ? "緊急用務空域の出典（国土交通省）"
                    : "カテゴリー制度・レベル4 の出典（国土交通省）"
                }
              >
                {diagnosis.category === "emergency_no_fly"
                  ? "国土交通省 無人航空機の飛行禁止空域と飛行の方法 ↗"
                  : "国土交通省 無人航空機のレベル4飛行 ↗"}
              </a>
            </p>
          </div>
        );
      })()}

      {/* 免責（全画面表示の契約）。最終確認は DIPS／航空局で。 */}
      <div className="border-l-2 border-brand-700 bg-paper px-4 py-3 text-xs leading-relaxed text-ink-soft">
        <span className="eyebrow !text-[11px]">免責</span> {diagnosis.disclaimer}
      </div>

      {/* 必要手続きチェックリスト */}
      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <p className="eyebrow">
            <span aria-hidden className="bearing-mark" />
            必要手続きチェックリスト (
            <span className="tnum">{String(diagnosis.procedures.length).padStart(2, "0")}</span>
            {" "}件)
          </p>
          {diagnosis.procedures.length > 0 ? (
            <div className="flex items-center gap-2.5">
              {/* 完了進捗の細トラック。全完了で緑、進行中は藍。装飾（aria-hidden）で、
                  数値カウンタが意味の担い手。 */}
              <span
                aria-hidden
                className="hidden h-1 w-24 overflow-hidden bg-rule/60 sm:block"
              >
                <span
                  className={`block h-full transition-[width] duration-[240ms] ease-out ${
                    doneCount === diagnosis.procedures.length ? "bg-signal-green" : "bg-brand-700"
                  }`}
                  style={{
                    width: `${Math.round((doneCount / diagnosis.procedures.length) * 100)}%`,
                  }}
                />
              </span>
              <p className="font-mono text-[10px] tnum text-ink-mute">
                完了{" "}
                <span
                  className={
                    doneCount === diagnosis.procedures.length ? "text-signal-green" : "text-ink"
                  }
                >
                  {doneCount}
                </span>{" "}
                / {diagnosis.procedures.length}
              </p>
            </div>
          ) : null}
        </div>

        {diagnosis.procedures.length === 0 ? (
          <p className="border border-dashed border-rule bg-paper px-4 py-5 text-sm leading-relaxed text-ink-soft">
            現在の入力では、航空法に基づく飛行許可・承認・登録の手続きは導出されませんでした。
            機体重量・飛行方法・地点を確認してください（条例等の他法令は信号機判定の各カードをご確認ください）。
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {diagnosis.procedures.map((p) => (
              <ProcedureCard
                key={p.id}
                procedure={p}
                deadlineBasis={deadlineFor(p.id)}
                done={doneMap[p.id] ?? false}
                onToggleDone={toggleDone}
                category={diagnosis.category}
                satisfied={satisfiedMap.get(p.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 提出期限カレンダー（飛行予定日 − 10 開庁日・土日祝除く）。
          飛行予定日が未入力なら「飛行予定日を入力してください」と促し、
          入力済みなら各手続きの具体的な期限日と残り日数のアラート色を出す。 */}
      <DeadlineCalendar diagnosis={diagnosis} plannedDate={plannedDate} />

      {/* 申請内容プリフィル表（DIPS／DRS の入力欄に対応する値・各行コピペ）。 */}
      <PrefillTable prefill={diagnosis.prefill} />

      {/* 書類ドラフト（独自飛行マニュアル骨子 ／ 標準を使う選択）。
          選択（manualChoice）は束ね PDF にも反映する。 */}
      <ManualDraft
        flags={diagnosis.flags}
        choice={manualChoice}
        onChoiceChange={handleManualChoiceChange}
      />

      {/* 束ね PDF 出力（カテゴリー・チェックリスト・期限・プリフィル・書類ドラフトを 1 PDF に）。
          既存の単発判定 PDF（総合判定セクションの「PDF 出力」）とは別の導線。
          このパネルの締めくくりの主要アクションとして、藍の二重罫で面を起こし
          「ここまでの申請支援を 1 枚に束ねる」終端であることを構図で示す。 */}
      <div className="flex flex-col gap-3 border border-double border-brand-700/40 bg-paper px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1">
            <p className="eyebrow !text-[11px] flex items-center gap-1.5 text-brand-700">
              <span aria-hidden className="inline-block h-1.5 w-1.5 bg-brand-700" />
              束ね PDF 出力
            </p>
            <p className="max-w-prose text-xs leading-relaxed text-ink-soft">
              カテゴリー切り分け・必要手続き・提出期限・プリフィル表・書類ドラフトを 1 つの PDF にまとめます。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleBundlePdfExport()}
            disabled={bundleBusy}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-sharp bg-brand-700 px-5 text-xs font-medium uppercase tracking-wider text-paper transition-colors hover:bg-brand-900 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2 focus:ring-offset-paper disabled:opacity-40"
            title="申請支援サマリを 1 枚の PDF として書き出し（evidenceId 入り）"
          >
            <span aria-hidden className="font-mono text-[10px] tracking-[0.2em] opacity-70">
              ▾
            </span>
            {bundleBusy ? "束ね PDF 生成中…" : "束ね PDF を出力"}
          </button>
        </div>
        {bundleError ? (
          <p className="text-xs text-signal-red" role="alert">
            {bundleError}
          </p>
        ) : null}
      </div>

      {/* DRS と DIPS 2.0 の別導線を明示（混同防止の固定注意）。
          手続きカードと同じ系統バッジ（DRS=墨抜き / DIPS 2.0=藍塗り）で
          「2 つの別ポータル」であることを一目で示す。 */}
      <div className="flex flex-col gap-2 border-t border-rule pt-4">
        <p className="eyebrow !text-[11px]">2 系統の手続き窓口（混同しないこと）</p>
        <div className="grid grid-cols-1 gap-2 text-xs leading-relaxed text-ink-soft sm:grid-cols-2">
          <p className="border border-rule bg-paper px-3 py-2.5">
            <span className="mb-1 flex items-center gap-2">
              <span className="inline-flex items-center border border-ink bg-paper-soft px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-wider text-ink">
                DRS
              </span>
              <span className="text-[10px] text-ink-mute">機体登録（別系統）</span>
            </span>
            <a
              href="https://www.dips-reg.mlit.go.jp/drs/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-700 underline-offset-2 hover:underline"
            >
              DRS（DIPS-REG）↗
            </a>{" "}
            — 100g 以上の機体登録・リモートID。
          </p>
          <p className="border border-rule bg-paper px-3 py-2.5">
            <span className="mb-1 flex items-center gap-2">
              <span className="inline-flex items-center border border-brand-700 bg-brand-50 px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-wider text-brand-700">
                DIPS 2.0
              </span>
              <span className="text-[10px] text-ink-mute">飛行許可・承認</span>
            </span>
            <a
              href="https://www.ossportal.dips.mlit.go.jp/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-700 underline-offset-2 hover:underline"
            >
              DIPS 2.0 ↗
            </a>{" "}
            — 許可・承認／飛行計画通報／飛行日誌。
          </p>
        </div>
      </div>

      {/* 証跡メタ */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-rule pt-4 text-[11px] tracking-wide text-ink-mute sm:grid-cols-3">
        <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-1">
          <dt className="eyebrow !text-[11px]">証跡 ID（申請支援の診断）</dt>
          <dd className="tnum normal-case tracking-normal text-ink">{diagnosis.evidenceId}</dd>
        </div>
        {diagnosis.checkEvidenceId ? (
          <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-1">
            <dt className="eyebrow !text-[11px]">証跡 ID（地点判定）</dt>
            <dd className="tnum normal-case tracking-normal text-ink">
              {diagnosis.checkEvidenceId}
            </dd>
          </div>
        ) : null}
        <div className="flex flex-col gap-0.5">
          <dt className="eyebrow !text-[11px]">判定の版</dt>
          <dd className="tnum normal-case tracking-normal text-ink">{diagnosis.engineVersion}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="eyebrow !text-[11px]">判定日時</dt>
          <dd className="normal-case tracking-normal text-ink">
            {new Date(diagnosis.checkedAt).toLocaleString("ja-JP")}
          </dd>
        </div>
        {/* 制度データ検証日（改正レビュー用）。確定事実が「いつ時点の制度確認に
            基づくか」を画面でも明示する（spec §8 / sprint-4 検証日メタ）。 */}
        {PROCEDURES_VERIFIED_AT ? (
          <div className="flex flex-col gap-0.5">
            <dt className="eyebrow !text-[11px]">制度データ検証日</dt>
            <dd className="tnum normal-case tracking-normal text-ink">
              {PROCEDURES_VERIFIED_AT.slice(0, 10)}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
