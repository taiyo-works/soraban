// The screens and parts shown by the style trial. Server components, no state: every state (hover, focus, pressed) is
// drawn by a class (`is-hover`, `is-focus`, `is-active`) so it can be seen without touching the page.
import type { ItemVerdict } from "@soraban/regulations";
import { VerdictGlyph } from "@/components/verdict-mark";
import { VERDICT_LABEL } from "@/lib/verdict-display";
import { Icon, type IconName } from "../icons";
import { ContourBand, EMPTY_SPEC, HOME_SPEC, MapPicture } from "./style-art";
import { DEADLINES, NEXT_ACTIONS, STAGES, TODAY_FLIGHT, TODAY_LABEL } from "./trial-data";

const SHORT: Readonly<Record<ItemVerdict, { readonly label: string; readonly v: string; readonly help: string }>> = {
  no_fly: { label: "飛行不可", v: "nofly", help: "この場所・条件では飛ばせません。" },
  needs_procedure: { label: "要手続き", v: "needs", help: "許可・承認や通報を済ませてから飛ばします。" },
  procedure_done: { label: "手続き済み", v: "done", help: "必要な手続きは済んでいます。条件を守って飛ばします。" },
  no_procedure: { label: "手続き不要", v: "clear", help: "この項目では、手続きは要りません。" },
  unknown: { label: "判定不能", v: "unknown", help: "データがなく、判定できません。管理者に確かめます。" },
};
const LEVELS: readonly ItemVerdict[] = ["no_fly", "needs_procedure", "procedure_done", "no_procedure"];

export function Mark({ level, size = 22 }: { readonly level: ItemVerdict; readonly size?: number }) {
  return (
    <svg className="sty-mark" data-v={SHORT[level].v} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <VerdictGlyph level={level} strokeWidth={size > 28 ? 1.6 : 2} />
    </svg>
  );
}

/** A verdict as a seal: a ruled frame and a second thin rule inside it; the mark and the words carry the meaning. */
export function Stamp({ level, size = "md" }: { readonly level: ItemVerdict; readonly size?: "sm" | "md" | "lg" }) {
  const s = SHORT[level];
  return (
    <span className={`sty-stamp sty-stamp-${size}`} data-v={s.v}>
      <Mark level={level} size={size === "lg" ? 34 : size === "md" ? 24 : 18} />
      <span className="sty-stamp-word">{s.label}</span>
    </span>
  );
}

type TabKey = "home" | "judge" | "plans" | "journal" | "register";
const TABS: readonly { readonly key: TabKey; readonly label: string; readonly icon: IconName }[] = [
  { key: "home", label: "ホーム", icon: "home" },
  { key: "judge", label: "判定", icon: "place" },
  { key: "plans", label: "計画", icon: "plan" },
  { key: "journal", label: "日誌", icon: "journal" },
  { key: "register", label: "登録", icon: "list" },
];

/** Bottom tabs. The current tab has a square marker on top and a heavier label; the count is the only round part. */
export function TabBar({ current, badge = false, label = "メニュー（見本）" }: { readonly current: TabKey; readonly badge?: boolean; readonly label?: string }) {
  return (
    <nav className="sty-tabbar" aria-label={label}>
      {TABS.map((t) => (
        <a key={t.key} href="#" className="sty-tab" aria-current={t.key === current ? "page" : undefined}>
          <span className="sty-tab-icon">
            <Icon name={t.icon} size={22} />
            {badge && t.key === "plans" ? <span className="sty-count">3</span> : null}
          </span>
          <span className="sty-tab-label">{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

// ---- the judgement screen (phone, map first) ----
export function JudgeScreen({ uid }: { readonly uid: string }) {
  return (
    <div className="sty-phone sty-judge" role="group" aria-label="判定の画面（見本）">
      <div className="sty-map">
        <MapPicture uid={uid} />
        <div className="sty-map-top">
          <div className="sty-search">
            <Icon name="search" size={18} />
            <span>鳥取県米子市 見本町</span>
            <span className="sty-note sty-num">35.43, 133.33</span>
          </div>
        </div>
        <div className="sty-chips" role="group" aria-label="地図に重ねるもの">
          <button type="button" className="sty-chip" aria-pressed="true"><Icon name="check" size={14} />DID</button>
          <button type="button" className="sty-chip" aria-pressed="true"><Icon name="check" size={14} />空港</button>
          <button type="button" className="sty-chip" aria-pressed="false">緊急用務空域</button>
        </div>
        <div className="sty-zoom" role="group" aria-label="拡大と縮小">
          <button type="button" aria-label="拡大"><Icon name="plus" size={20} /></button>
          <button type="button" aria-label="縮小"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.75" /></svg></button>
        </div>
        <button type="button" className="sty-locate" aria-label="現在地へ移動">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v5M12 17v5M2 12h5M17 12h5" fill="none" stroke="currentColor" strokeWidth="1.75" /><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>
        </button>
        <p className="sty-map-caption">見本の絵です。実際の地図ではありません。</p>
      </div>
      <div className="sty-sheet">
        <div className="sty-grip" aria-hidden="true" />
        <div className="sty-sheet-head">
          <Stamp level="needs_procedure" size="lg" />
          <p className="sty-note sty-num">10/24 14:02 の判定</p>
        </div>
        <h3 className="sty-h">人口集中地区（DID）の上空です</h3>
        <ul className="sty-reasons">
          <li>
            <Mark level="needs_procedure" />
            <span>人口集中地区（DID）</span>
            <span className="sty-note">対象。許可・承認が要る</span>
          </li>
          <li>
            <Mark level="no_procedure" />
            <span>空港等の周辺</span>
            <span className="sty-note">対象外</span>
          </li>
          <li>
            <Mark level="no_procedure" />
            <span>緊急用務空域</span>
            <span className="sty-note">対象外</span>
          </li>
        </ul>
        <div className="sty-actions">
          <button type="button" className="sty-btn sty-btn-primary">申請の準備へ</button>
          <button type="button" className="sty-btn sty-btn-secondary">根拠を見る</button>
        </div>
      </div>
      <TabBar current="judge" />
    </div>
  );
}

// ---- the home screen, on a day with a flight ----
export function HomeScreen() {
  return (
    <div className="sty-phone sty-home" role="group" aria-label="ホームの画面（見本）">
      <header className="sty-home-head">
        <ContourBand id="home-head" spec={HOME_SPEC} className="sty-home-art" />
        <p className="sty-note">今日</p>
        <h3 className="sty-h sty-num">{TODAY_LABEL}</h3>
        <p className="sty-note">見本 一郎 さん ・ 予定は 1 件</p>
      </header>
      <div className="sty-home-body">
        <section className="sty-card" aria-label="次の飛行">
          <p className="sty-note">次の飛行</p>
          <p className="sty-em sty-num">{TODAY_FLIGHT.time}　{TODAY_FLIGHT.place}</p>
          <p className="sty-note">{TODAY_FLIGHT.aircraft} ・ {TODAY_FLIGHT.pilot}</p>
          <ol className="sty-stages" aria-label="七つの段階。4 つ済み、次は点検">
            {STAGES.map((s, i) => (
              <li key={s} data-state={i < TODAY_FLIGHT.done ? "done" : i === TODAY_FLIGHT.done ? "next" : "todo"}>
                <span className="sty-stage-dot" aria-hidden="true" />
                <span className="sty-stage-name">{s}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="sty-btn sty-btn-primary sty-btn-wide">日常点検をする</button>
        </section>
        <section aria-labelledby="home-todo">
          <h3 className="sty-h" id="home-todo">次にやること</h3>
          <ul className="sty-ledger">
            {NEXT_ACTIONS.map((a) => (
              <li key={a.id}>
                <a href="#" className="sty-row">
                  <span className="sty-row-main">
                    <span>{a.label}</span>
                    <span className="sty-note">{a.meta}</span>
                  </span>
                  <span className="sty-tag" data-hot={a.meaning === "warn" ? "1" : "0"}>{a.urgency}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="home-due">
          <h3 className="sty-h" id="home-due">近づく期限</h3>
          <ul className="sty-ledger">
            {DEADLINES.slice(0, 2).map((d) => (
              <li key={d.id} className="sty-row sty-row-static">
                <span className="sty-row-main">
                  <span>{d.what}　{d.who}</span>
                  <span className="sty-note sty-num">{d.date} ・ {d.left}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <TabBar current="home" badge />
    </div>
  );
}

// ---- parts and states ----
type ButtonState = "normal" | "hover" | "focus" | "active" | "disabled";
const STATE_LABEL: Readonly<Record<ButtonState, string>> = { normal: "通常", hover: "ホバー", focus: "フォーカス", active: "押下", disabled: "無効" };
const STATE_CLASS: Readonly<Record<ButtonState, string>> = { normal: "", hover: "is-hover", focus: "is-focus", active: "is-active", disabled: "" };
const BUTTON_STATES: readonly ButtonState[] = ["normal", "hover", "focus", "active", "disabled"];

function ButtonRow({ title, variant, label }: { readonly title: string; readonly variant: string; readonly label: string }) {
  return (
    <div className="sty-state-row">
      <h4 className="sty-sub">{title}</h4>
      <div className="sty-state-cells">
        {BUTTON_STATES.map((s) => (
          <div key={s} className="sty-state-cell">
            <span className="sty-note">{STATE_LABEL[s]}</span>
            <button type="button" className={`sty-btn sty-btn-${variant} ${STATE_CLASS[s]}`} disabled={s === "disabled"}>{label}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

type FieldState = "normal" | "hover" | "focus" | "filled" | "error" | "disabled";
const FIELD_STATES: readonly { readonly s: FieldState; readonly label: string }[] = [
  { s: "normal", label: "通常" },
  { s: "hover", label: "ホバー" },
  { s: "focus", label: "フォーカス" },
  { s: "filled", label: "入力済み" },
  { s: "error", label: "エラー" },
  { s: "disabled", label: "無効" },
];

function TextField({ u, s }: { readonly u: string; readonly s: FieldState }) {
  const id = `${u}-f-${s}`;
  const err = s === "error";
  return (
    <div className="sty-field">
      <label htmlFor={id} className="sty-label">飛行高度（m）</label>
      <input
        id={id}
        className={`sty-input ${s === "hover" ? "is-hover" : s === "focus" ? "is-focus" : ""}`}
        inputMode="numeric"
        defaultValue={s === "filled" ? "45" : s === "error" ? "450" : ""}
        placeholder={s === "normal" || s === "hover" || s === "focus" || s === "disabled" ? "例：45" : undefined}
        disabled={s === "disabled"}
        aria-invalid={err ? "true" : undefined}
        aria-describedby={`${id}-help`}
      />
      <p id={`${id}-help`} className={err ? "sty-error" : "sty-note"}>
        {err ? (
          <>
            <Mark level="no_fly" size={16} />
            150 m を超えています。150 m 以下の数字を入れてください。
          </>
        ) : (
          "地表からの高さ。半角の数字で入れます。"
        )}
      </p>
    </div>
  );
}

export function PartsPanel({ u }: { readonly u: string }) {
  return (
    <div className="sty-parts">
      <section aria-labelledby={`${u}-pb`}>
        <h3 className="sty-h" id={`${u}-pb`}>ボタンの状態</h3>
        <ButtonRow title="主（その画面で一番の操作。1 つだけ）" variant="primary" label="申請の準備へ" />
        <ButtonRow title="副" variant="secondary" label="根拠を見る" />
        <ButtonRow title="文字だけ" variant="text" label="あとで" />
        <ButtonRow title="取り消せない操作" variant="danger" label="記録を削除" />
      </section>
      <section aria-labelledby={`${u}-pi`}>
        <h3 className="sty-h" id={`${u}-pi`}>入力欄の状態</h3>
        <div className="sty-field-grid">
          {FIELD_STATES.map(({ s, label }) => (
            <div key={s} className="sty-state-cell">
              <span className="sty-note">{label}</span>
              <TextField u={u} s={s} />
            </div>
          ))}
        </div>
      </section>
      <section aria-labelledby={`${u}-pc`}>
        <h3 className="sty-h" id={`${u}-pc`}>選ぶ部品</h3>
        <div className="sty-choice-grid">
          <fieldset className="sty-choice">
            <legend className="sty-label">飛行の目的</legend>
            <label className="sty-check"><input type="radio" name={`${u}-r`} defaultChecked />撮影</label>
            <label className="sty-check"><input type="radio" name={`${u}-r`} />点検</label>
            <label className="sty-check"><input type="radio" name={`${u}-r`} />測量</label>
          </fieldset>
          <fieldset className="sty-choice">
            <legend className="sty-label">確認したこと</legend>
            <label className="sty-check"><input type="checkbox" defaultChecked />機体の外観</label>
            <label className="sty-check"><input type="checkbox" defaultChecked />バッテリー残量</label>
            <label className="sty-check"><input type="checkbox" />プロペラの固定</label>
          </fieldset>
          <div className="sty-choice">
            <span className="sty-label" id={`${u}-sw`}>通知</span>
            <div className="sty-switch-row"><button type="button" role="switch" aria-checked="true" aria-labelledby={`${u}-sw`} className="sty-switch" /><span>期限の 7 日前に知らせる（オン）</span></div>
            <div className="sty-switch-row"><button type="button" role="switch" aria-checked="false" aria-labelledby={`${u}-sw`} className="sty-switch" /><span>前日に知らせる（オフ）</span></div>
            <div className="sty-switch-row"><button type="button" role="switch" aria-checked="false" aria-labelledby={`${u}-sw`} className="sty-switch" disabled /><span className="sty-disabled-text">メールで知らせる（無効）</span></div>
          </div>
          <div className="sty-choice">
            <span className="sty-label">表示する期間</span>
            <div className="sty-seg" role="group" aria-label="表示する期間">
              <button type="button" aria-pressed="false">今日</button>
              <button type="button" aria-pressed="true">1 週間</button>
              <button type="button" aria-pressed="false">1 か月</button>
            </div>
          </div>
        </div>
      </section>
      <section aria-labelledby={`${u}-ps`}>
        <h3 className="sty-h" id={`${u}-ps`}>空の状態と、失敗したとき</h3>
        <div className="sty-empty-grid">
          <div className="sty-card sty-empty">
            <ContourBand id="empty" spec={EMPTY_SPEC} className="sty-empty-art" />
            <p className="sty-body-strong">予定のない日です</p>
            <p className="sty-note">次の飛行は 11/02（月）の見本橋梁の点検です。</p>
            <button type="button" className="sty-btn sty-btn-secondary">飛行を計画する</button>
          </div>
          <div className="sty-card sty-failed" role="alert">
            <p className="sty-body-strong"><Mark level="no_fly" size={20} />保存できませんでした</p>
            <p className="sty-note">通信がつながっていません。入力した内容はこの端末に残っています。つながったあとに、もう一度押してください。</p>
            <button type="button" className="sty-btn sty-btn-primary">もう一度保存する</button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---- the four steps of the verdict ----
export function VerdictPanel() {
  return (
    <div className="sty-verdicts">
      <ul className="sty-vlist">
        {[...LEVELS, "unknown" as const].map((l) => (
          <li key={l} className="sty-vitem">
            <Stamp level={l} size="lg" />
            <p className="sty-note">{SHORT[l].help}</p>
            <p className="sty-note sty-vfull">{VERDICT_LABEL[l]}</p>
          </li>
        ))}
      </ul>
      <div className="sty-vmono" aria-label="色を抜いた表示">
        <p className="sty-note">色を抜いても、形と言葉で見分けられます。</p>
        <div className="sty-vmono-row">
          {[...LEVELS, "unknown" as const].map((l) => (
            <Stamp key={l} level={l} size="md" />
          ))}
        </div>
      </div>
      <div className="sty-vsmall">
        <p className="sty-note">小さく使うとき（一覧の行）</p>
        <ul className="sty-vsmall-list">
          {[...LEVELS, "unknown" as const].map((l) => (
            <li key={l}>
              <Stamp level={l} size="sm" />
              <span>見本公園の撮影</span>
              <span className="sty-note sty-num">11/04</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MenuPanel() {
  return (
    <div className="sty-menus-wide">
      <div className="sty-menus">
        {([
          ["ホームを開いている", "home", false],
          ["判定を開いている", "judge", false],
          ["計画に、未確認が 3 件ある", "plans", true],
        ] as const).map(([cap, cur, badge]) => (
          <div key={cur} className="sty-menu-demo">
            <p className="sty-note">{cap}</p>
            <TabBar current={cur} badge={badge} label={`メニュー（見本：${cap}）`} />
          </div>
        ))}
      </div>
      <div className="sty-menu-demo">
        <p className="sty-note">事務所の PC の縦メニュー。現在地は短い線で示す</p>
        <nav className="sty-sidemenu" aria-label="縦メニュー（見本）">
          {TABS.map((t) => (
            <a key={t.key} href="#" aria-current={t.key === "judge" ? "page" : undefined}>{t.label}</a>
          ))}
        </nav>
      </div>
    </div>
  );
}
