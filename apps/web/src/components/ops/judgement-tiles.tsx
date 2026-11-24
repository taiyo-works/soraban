"use client";

// 計画の判定の画面の第 2 層（項目のタイル）と第 3 層（タイルを押すと開くボトムシートの詳細）。Sprint 16-H2 H2-2。
// - タイルは、今の判定エンジンが返す項目の区分（FlightVerdict.items）だけ。気象・標高・ハザードなど、持っていない項目は出さない（契約 §10）。
// - シートの詳細は、保存した判定の理由・元の判定・適用した許可と、判定に使ったデータ（台帳 sources.json の値だけ：名称・提供元・版・基準年・確認日・出典）。
//   項目ごとのデータの対応は保存していないので、データは「この判定全体で使ったもの」として出す。
// - 端末のストレージには書かない。開いているタイルの印は画面の状態だけ。
import { useCallback, useState } from "react";
import type { ItemVerdict } from "@soraban/regulations";
import { Sheet } from "@/components/ui/sheet";
import { VerdictSign, VerdictTag, VERDICT_KEY } from "@/components/ui/sb-parts";

const LINK_ARROW = "\u2060\u00a0↗";

export type TileDataset = {
  readonly id: string;
  readonly name: string;
  /** 台帳（sources.json）にあるものだけ。台帳に無いときは出さない（空欄・仮の値を出さない）。 */
  readonly provider?: string;
  readonly version?: string;
  readonly baseYear: number | null;
  readonly verifiedAt: string;
  readonly url?: string;
  readonly stale: boolean;
};

export type TileRef = { readonly title: string; readonly url: string };

export type TileItem = {
  readonly id: string;
  readonly title: string;
  readonly verdict: ItemVerdict;
  readonly verdictLabel: string;
  readonly baseLabel: string;
  readonly tierLabel: string;
  /** 判定の理由（模型航空機の参照先の行は除き、参照先は refs に分ける）。 */
  readonly reason: string;
  readonly refs: readonly TileRef[];
  readonly appliedPermits: readonly string[];
  /** 許可・承認の登録に基づく表示だけの補足。 */
  readonly permitNote?: string;
  /** 手続き済み（条件付き）の項目の守る条件。 */
  readonly conditions: readonly string[];
};

export function JudgementTiles({
  items,
  datasets,
  fetchedAt,
  fetchedAtIso,
}: {
  readonly items: readonly TileItem[];
  readonly datasets: readonly TileDataset[];
  readonly fetchedAt: string;
  readonly fetchedAtIso: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const open = items.find((i) => i.id === openId) ?? null;
  return (
    <>
      <ul className="opx-tiles" data-testid="judgement-tiles">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              className="opx-tile"
              data-testid="judgement-tile"
              data-item-id={it.id}
              data-verdict={it.verdict}
              data-verdict-key={VERDICT_KEY[it.verdict]}
              aria-haspopup="dialog"
              aria-expanded={openId === it.id}
              onClick={() => setOpenId(it.id)}
            >
              <span className="opx-tile-title">{it.title}</span>
              <VerdictTag level={it.verdict}>{it.verdictLabel}</VerdictTag>
              <span className="opx-tile-more" aria-hidden="true">
                詳細 <span aria-hidden>›</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={open !== null} onClose={close} title={open?.title ?? ""} testId="judgement-sheet" defaultStage="half">
        {open ? (
          <div className="opx-tile-detail" data-wording-scope="judgement" data-testid="judgement-sheet-detail" data-item-id={open.id}>
            <p className="opx-tile-state">
              <VerdictSign level={open.verdict} className="sb-vm" />
              <span data-testid="judgement-sheet-verdict">{open.verdictLabel}</span>
            </p>
            <dl className="opx-tile-dl">
              <div>
                <dt>判定の理由</dt>
                <dd data-testid="judgement-sheet-reason">{open.reason}</dd>
              </div>
              <div>
                <dt>元の判定</dt>
                <dd>{open.baseLabel}</dd>
              </div>
              <div>
                <dt>適用した許可</dt>
                <dd>{open.appliedPermits.length > 0 ? open.appliedPermits.join(" / ") : "—"}</dd>
              </div>
              <div>
                <dt>法的な重さ</dt>
                <dd>{open.tierLabel}</dd>
              </div>
              {open.permitNote ? (
                <div>
                  <dt>許可・承認の登録</dt>
                  <dd>{open.permitNote}</dd>
                </div>
              ) : null}
              {open.conditions.length > 0 ? (
                <div>
                  <dt>守る条件</dt>
                  <dd>
                    <ul className="opx-tile-list">
                      {open.conditions.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
              {open.refs.length > 0 ? (
                <div>
                  <dt>参照先</dt>
                  <dd>
                    <ul className="opx-tile-list" data-testid="judgement-sheet-refs">
                      {open.refs.map((r) => (
                        <li key={r.url}>
                          <a href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`参照先：${r.title}（新しいタブで開く）`} className="opx-tile-link">
                            {r.title}
                            <span aria-hidden>{LINK_ARROW}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>判定の取得時刻（日本時間）</dt>
                <dd>
                  <time dateTime={fetchedAtIso} className="sb-num tnum" data-testid="judgement-sheet-fetched-at">{fetchedAt}</time>
                </dd>
              </div>
            </dl>
            <section aria-label="根拠（この判定に使ったデータ）" data-testid="judgement-sheet-datasets">
              <h3 className="opx-tile-h3">根拠（この判定に使ったデータ）</h3>
              <p data-note="" className="opx-tile-aside">項目ごとのデータの対応は保存していないため、判定全体で使ったデータを示します。</p>
              {datasets.length === 0 ? (
                <p>記録されたデータはありません。</p>
              ) : (
                <ul className="opx-tile-ds">
                  {datasets.map((d) => (
                    <li key={d.id} data-testid="judgement-sheet-dataset">
                      <span className="opx-tile-ds-name">{d.name}</span>
                      {d.provider ? <span className="opx-tile-ds-meta">提供元：{d.provider}</span> : null}
                      <span className="opx-tile-ds-meta sb-num tnum">
                        {d.baseYear !== null ? `基準年 ${d.baseYear}／` : ""}確認日 {d.verifiedAt}
                        {d.version ? `／版 ${d.version}` : ""}
                        {d.stale ? "（確認日が古い：90 日超）" : ""}
                      </span>
                      {d.url ? (
                        <a href={d.url} target="_blank" rel="noopener noreferrer" aria-label={`出典：${d.name}（新しいタブで開く）`} className="opx-tile-link">
                          出典を開く<span aria-hidden>{LINK_ARROW}</span>
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
