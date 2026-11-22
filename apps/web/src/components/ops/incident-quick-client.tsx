"use client";

// 現場の簡易記録（事故・ヒヤリハット。Sprint 12e 設計 F）。片手・屋外・手袋を前提に、区分とけがの有無を選んで「記録する」だけで残す。
//   - 並び：①最初の案内（G1）→ ②事実の記録の注意（N1）→ ③区分 → ④けがの有無 → ⑤類型はあとで入力できる旨 → ⑥「記録する」。
//   - 確認ダイアログは出さない。押した記録は端末の送信待ちに 1 行保存してから自分のサーバーへ送る（lib/incident-outbox.ts）。
//     押した結果は送信の前に画面へ反映する。未送信は「未送信 N 件」で常に示し、4xx は黙って捨てず「あとから入力」へ案内する。
//   - 端末に残すのは、計画の ID（キー）・区分・けがの有無・時刻・識別子だけ（氏名・技能証明書番号・座標・自由記述は入れない）。
//   - 押す部品は高さ 56px 以上・間 12px 以上、文字は 18px 以上、状態の語は 20px 以上。色だけで区別しない。見た目は v2 の部品。
import { useCallback, useEffect, useState } from "react";
import { discardRejectedIncident, enqueueIncident, incidentUnsentCount, rejectedIncidentEntries, type IncidentOutboxState } from "@/lib/incident-outbox";
import {
  INCIDENT_KIND_LABEL,
  INCIDENT_KINDS,
  INCIDENT_QUICK_LATER_NOTICE,
  INCIDENT_QUICK_SAVED_MESSAGE,
  INCIDENTS_HREF,
  PEOPLE_INJURY_LABEL,
  YES_NO_UNKNOWN,
  YES_NO_UNKNOWN_LABEL,
  incidentHref,
  incidentNewHref,
  type IncidentKind,
  type YesNoUnknown,
} from "@/lib/ops-incident";
import { OUTBOX_RETRY_INTERVAL_MS, fieldHref } from "@/lib/ops-field";
import { nowJstInput } from "@/lib/ops-time";
import { newRequestId } from "./drafts";
import { flushIncidentOutbox, loadPlanIncidentOutbox, planIncidentOutboxUnsaved, updatePlanIncidentOutbox } from "./incident-outbox";
import { IncidentFactNotice, IncidentOfficialNotice, IncidentSafetyFirst } from "./incident-ui";

// 見た目は ops-v2.css の .opx-btn／ops-v2-screens.css の .opx-box-*。現場の値（56／64px・7:1・影なし・動きなし）は FieldModeMark（<html data-mode="field">）が効かせる。
const BTN = "opx-btn w-full";
const BTN_PRIMARY = "opx-btn opx-btn-primary opx-btn-field w-full";
const BTN_OUTLINE = BTN;
// 選択中の面（主色。右端の丸と矢印は付けない：押すと進む意味になるため）
const BTN_SEL = "opx-btn opx-btn-primary opx-btn-flat opx-btn-field w-full";
const BTN_WARN = "opx-btn opx-btn-danger w-full";
// 「記録する」は画面でいちばん押してほしい操作：ほかの選択肢より一段高く・大きく
const BTN_RECORD = `${BTN_PRIMARY} min-h-16 text-xl`;
const BOX_NOTE = "opx-box opx-box-note";
const BOX_WARN = "opx-box opx-box-warn";
const BOX_OK = "opx-box opx-box-ok";

type Saved = { readonly clientRequestId: string; readonly hm: string; readonly recordId: string | null };

export function IncidentQuickClient({
  planId,
  planTitle,
  memberId,
  canCreate,
}: {
  readonly planId: string;
  readonly planTitle: string;
  readonly memberId: string;
  readonly canCreate: boolean;
}) {
  const [kind, setKind] = useState<IncidentKind | null>(null);
  const [injury, setInjury] = useState<YesNoUnknown | null>(null);
  const [outbox, setOutbox] = useState<IncidentOutboxState>({ v: 1, entries: [] });
  const [saved, setSaved] = useState<Saved | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const reloadOutbox = useCallback(() => setOutbox(loadPlanIncidentOutbox(planId, memberId)), [planId, memberId]);

  const flush = useCallback(async () => {
    await flushIncidentOutbox(planId, memberId, (info) => {
      const rid = typeof info.data["id"] === "string" ? info.data["id"] : null;
      setSaved((s) => (s && s.clientRequestId === info.entry.clientRequestId ? { ...s, recordId: rid } : s));
    });
    reloadOutbox();
  }, [planId, memberId, reloadOutbox]);

  // 画面を開いたとき・接続が戻ったとき・開いている間 15 秒ごとに、送信待ちを送る
  useEffect(() => {
    const t = window.setTimeout(() => {
      reloadOutbox();
      setHydrated(true);
      void flush();
    }, 0);
    const iv = window.setInterval(() => {
      if (incidentUnsentCount(loadPlanIncidentOutbox(planId, memberId)) > 0) void flush();
    }, OUTBOX_RETRY_INTERVAL_MS);
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(iv);
      window.removeEventListener("online", onOnline);
    };
  }, [flush, reloadOutbox, planId, memberId]);

  const ready = kind !== null && injury !== null;
  const onRecord = () => {
    if (!ready || saved) return;
    const clientRequestId = newRequestId();
    const occurredAt = nowJstInput(new Date());
    updatePlanIncidentOutbox(planId, memberId, (s) => enqueueIncident(s, { clientRequestId, kind, peopleInjury: injury, occurredAt }));
    // 押した結果は送信の前に画面へ反映する
    setSaved({ clientRequestId, hm: occurredAt.slice(11, 16), recordId: null });
    reloadOutbox();
    void flush();
  };

  const unsent = incidentUnsentCount(outbox);
  const rejected = rejectedIncidentEntries(outbox);
  const pendingIds = new Set(outbox.entries.map((e) => e.clientRequestId));
  const savedRejected = saved !== null && rejected.some((e) => e.clientRequestId === saved.clientRequestId);
  const savedSent = saved !== null && !pendingIds.has(saved.clientRequestId);

  const choice = <T extends string>(
    name: string,
    values: readonly T[],
    label: (v: T) => string,
    value: T | null,
    set: (v: T) => void,
    testPrefix: string,
  ) => (
    <div role="radiogroup" aria-label={name} className="flex flex-col gap-3">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={value === v ? BTN_SEL : BTN_OUTLINE}
          onClick={() => set(v)}
          disabled={saved !== null}
          data-testid={`${testPrefix}-${v}`}
        >
          <span aria-hidden>{value === v ? "◉" : "○"}</span>
          {label(v)}
        </button>
      ))}
    </div>
  );

  return (
    <main
      className="flex flex-col gap-6 pb-[env(safe-area-inset-bottom)] text-lg leading-relaxed text-sb-ink touch-manipulation"
      data-testid="incident-quick-root"
      data-hydrated={hydrated ? "true" : "false"}
      aria-label="事故・ヒヤリハットの簡易記録"
    >
      {/* ① 最初の案内（入力欄より前） */}
      <IncidentSafetyFirst large />
      {/* ② 事実の記録の注意 */}
      <IncidentFactNotice large />

      <header className="flex flex-col gap-1 border-l-[length:8px] border-sb-ink pl-3">
        <h1 className="text-2xl font-bold leading-snug">事故・ヒヤリハットの簡易記録</h1>
        <p data-testid="incident-quick-plan">{planTitle}</p>
      </header>

      {!canCreate ? (
        <p className={BOX_NOTE} data-testid="incident-quick-readonly">
          閲覧者は記録できません。運航管理者または操縦者に記録を依頼してください。
        </p>
      ) : saved ? (
        <section className="flex flex-col gap-4" aria-label="記録の結果" data-testid="incident-quick-saved">
          <div className={savedRejected ? BOX_WARN : BOX_OK} role="status" aria-live="polite">
            <p className="text-xl font-bold" data-testid="incident-quick-saved-message" data-rejected={savedRejected ? "true" : "false"}>
              {savedRejected ? (
                <>
                  <span aria-hidden>！ </span>この記録は送れませんでした。下の理由を確かめてください。
                </>
              ) : (
                <>
                  <span aria-hidden>✓ </span>
                  {INCIDENT_QUICK_SAVED_MESSAGE}
                </>
              )}
            </p>
            <p data-testid="incident-quick-saved-time">
              {INCIDENT_KIND_LABEL[kind!]}／{PEOPLE_INJURY_LABEL}：{YES_NO_UNKNOWN_LABEL[injury!]}／{saved.hm}
            </p>
          </div>
          {!savedRejected ? (
            <a href={saved.recordId ? incidentHref(saved.recordId, "correct") : `${INCIDENTS_HREF}?detailPending=1`} className={BTN_PRIMARY} data-testid="incident-quick-detail">
              詳細を記入する
            </a>
          ) : null}
          {!savedSent && !savedRejected ? <p data-testid="incident-quick-detail-note">送信が済むと、この記録の詳細の入力を開けます。</p> : null}
          <a href={fieldHref(planId)} className={BTN_OUTLINE} data-testid="incident-quick-back-field">
            現場モードへ戻る
          </a>
          <IncidentOfficialNotice large />
        </section>
      ) : (
        <>
          {/* ③ 区分 */}
          <section className="flex flex-col gap-3" aria-labelledby="incident-quick-h-kind">
            <h2 id="incident-quick-h-kind" className="text-xl font-bold">
              区分
            </h2>
            {choice("区分", INCIDENT_KINDS, (k) => INCIDENT_KIND_LABEL[k], kind, setKind, "incident-quick-kind")}
          </section>
          {/* ④ けがの有無 */}
          <section className="flex flex-col gap-3" aria-labelledby="incident-quick-h-injury">
            <h2 id="incident-quick-h-injury" className="text-xl font-bold">
              {PEOPLE_INJURY_LABEL}
            </h2>
            {choice(PEOPLE_INJURY_LABEL, YES_NO_UNKNOWN, (v) => YES_NO_UNKNOWN_LABEL[v], injury, setInjury, "incident-quick-injury")}
          </section>
          {/* ⑤ 類型はあとで入力できる旨 */}
          <p className="opx-note !text-lg !leading-relaxed !text-sb-ink" data-testid="incident-quick-later">
            {INCIDENT_QUICK_LATER_NOTICE}
          </p>
          <p className="pl-4 text-sb-ink-2" data-testid="incident-quick-time">
            時刻：いま（押した時刻で記録します）
          </p>
          {/* ⑥ 記録する */}
          <button type="button" className={`${BTN_RECORD} tracking-[0.2em]`} disabled={!ready} onClick={onRecord} data-testid="incident-quick-submit">
            記録する
          </button>
          {!ready ? (
            <p className="-mt-3 text-center text-sb-ink-2" data-testid="incident-quick-hint">
              区分とけがの有無を選ぶと記録できます。
            </p>
          ) : null}
        </>
      )}

      {/* 送信の状況（常に出す） */}
      <section aria-label="送信の状況" className="flex flex-col gap-3">
        <p className={unsent > 0 ? `${BOX_NOTE} text-xl` : "flex items-center gap-2 px-1 text-xl"} role="status" data-testid="incident-quick-unsent" data-count={unsent}>
          <span className={unsent > 0 ? "text-2xl font-bold" : "font-bold"}>{unsent > 0 ? `！ 未送信 ${unsent} 件` : "✓ 送信済み"}</span>
          {unsent > 0 ? <span>電波が戻ると自動で送ります。</span> : null}
        </p>
        {planIncidentOutboxUnsaved(planId, memberId) ? (
          <p className={BOX_WARN} role="alert" data-testid="incident-quick-unsaved">
            端末に保存できませんでした。送信が済むまで、この画面を閉じないでください。
          </p>
        ) : null}
      </section>

      {/* 送れなかった記録（黙って捨てない） */}
      {rejected.length > 0 ? (
        <section aria-label="送れなかった記録" className="flex flex-col gap-3" data-testid="incident-quick-rejected">
          <h2 className="text-2xl font-bold">！ 送れなかった記録</h2>
          {rejected.map((e) => (
            <div key={e.clientRequestId} className={BOX_WARN} role="alert" data-testid="incident-quick-rejected-row" data-code={e.rejection?.code}>
              <p className="font-bold">
                {INCIDENT_KIND_LABEL[e.kind]}／{PEOPLE_INJURY_LABEL}：{YES_NO_UNKNOWN_LABEL[e.peopleInjury]}／{e.occurredAt.slice(11, 16)}
              </p>
              <p data-testid="incident-quick-rejected-reason">送れませんでした。{e.rejection?.message}</p>
              <a href={incidentNewHref({ planId })} className={BTN_OUTLINE} data-testid="incident-quick-rejected-after-entry">
                あとから入力
              </a>
              <button
                type="button"
                className={BTN_WARN}
                data-testid="incident-quick-rejected-discard"
                onClick={() => {
                  updatePlanIncidentOutbox(planId, memberId, (s) => discardRejectedIncident(s, e.clientRequestId));
                  reloadOutbox();
                }}
              >
                この記録を破棄する
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {!saved ? (
        <a href={fieldHref(planId)} className={BTN_OUTLINE} data-testid="incident-quick-back">
          <span aria-hidden>←</span> 現場モードへ戻る
        </a>
      ) : null}
    </main>
  );
}
