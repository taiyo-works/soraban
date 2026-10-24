"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "../cx";
import { DataTable } from "../data";
import { Checkbox, ErrorSummary, FormField, Radio, Select, SearchInput, TextInput, Textarea, Toggle, describedBy } from "../forms";
import { ICON_NAMES, Icon } from "../icons";
import { APP_ICON_PROPOSALS, DroneLineArt } from "../brand-marks";
import { ContextMenu, Dialog, InfoPopover, ReasonDialog, useToast } from "../overlays";
import { Button, Card, Disclosure, EmptyState, Kbd, NoticeBar, Skeleton, Spinner, StatTile, StatusPill, type Meaning } from "../primitives";
import { Segmented, TabPanel, Tabs } from "../tabs";

// Catalog sections other than the six sample screens: tokens, icons and app icon proposals, and the parts in each state.

// ── helpers ──────────────────────────────────────────────────────────────────

export function Sub({ title, note, children }: { readonly title: string; readonly note?: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-h3 font-semibold text-fg">{title}</h3>
        {note ? <p className="text-aux text-fg-mute">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** A labelled cell for one state of a part. */
function State({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <span className="text-aux text-fg-mute">{label}</span>
      {children}
    </div>
  );
}

// ── contrast read-out (computed from the live CSS variables) ─────────────────

const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
/** Relative luminance of "#rrggbb", "#rgb" (the CSS minifier shortens colours) or "rgb(r, g, b)". */
function lum(css: string): number | null {
  const v = css.trim();
  let r: number;
  let g: number;
  let b: number;
  const long = /^#([0-9a-f]{6})$/i.exec(v);
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (long) {
    const n = parseInt(long[1]!, 16);
    [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else if (short) {
    [r, g, b] = [short[1]!, short[2]!, short[3]!].map((c) => parseInt(c + c, 16)) as [number, number, number];
  } else if (fn) {
    [r, g, b] = [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  } else return null;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(a: string, b: string): number | null {
  const x = lum(a);
  const y = lum(b);
  if (x === null || y === null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const SWATCHES: readonly string[] = ["bg-app", "bg-surface", "bg-sunken", "fg", "fg-soft", "fg-mute", "line", "line-strong", "accent", "accent-solid", "accent-soft"];
const PAIRS: readonly { readonly label: string; readonly fg: string; readonly bg: string; readonly min: number }[] = [
  { label: "本文 × surface", fg: "fg", bg: "bg-surface", min: 4.5 },
  { label: "補助 × sunken", fg: "fg-mute", bg: "bg-sunken", min: 4.5 },
  { label: "アクセント × surface", fg: "accent", bg: "bg-surface", min: 4.5 },
  { label: "ボタンの文字 × 主ボタンの地", fg: "accent-fg", bg: "accent-solid", min: 4.5 },
  { label: "主ボタンの地 × surface（境界）", fg: "accent-solid", bg: "bg-surface", min: 3 },
  { label: "入力欄の境界 × surface", fg: "line-strong", bg: "bg-surface", min: 3 },
  { label: "成功 文字 × 地", fg: "ok-fg", bg: "ok-bg", min: 4.5 },
  { label: "注意 文字 × 地", fg: "warn-fg", bg: "warn-bg", min: 4.5 },
  { label: "危険 文字 × 地", fg: "danger-fg", bg: "danger-bg", min: 4.5 },
  { label: "情報 文字 × 地", fg: "info-fg", bg: "info-bg", min: 4.5 },
];

export function TokensSection({ context }: { readonly context: string }) {
  const [rows, setRows] = useState<{ label: string; r: number | null; min: number }[]>([]);
  // Read the live values after the theme / mode attributes have been applied (re-run when `context` changes).
  // The read happens in an animation frame, once the new styles are in effect.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector(".ds-page");
      if (!el) return;
      const cs = getComputedStyle(el);
      const v = (n: string): string => cs.getPropertyValue(`--${n}`).trim();
      setRows(PAIRS.map((p) => ({ label: p.label, min: p.min, r: ratio(v(p.fg), v(p.bg)) })));
    });
    return () => cancelAnimationFrame(frame);
  }, [context]);

  return (
    <div className="flex flex-col gap-8">
      <Sub title="色" note="現在のテーマ・現場モードの値です。紙色の地、墨色の文字、アクセントは藍 1 色です。">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6" aria-label="色の見本">
          {SWATCHES.map((n) => (
            <li key={n} className="flex flex-col gap-1.5 rounded-ctl border border-line bg-surface p-2">
              <span className="h-10 rounded-ctl border border-line" style={{ background: `var(--${n})` }} />
              <code className="font-mono text-aux text-fg-soft">{n}</code>
            </li>
          ))}
        </ul>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="意味の色">
          {(["ok", "warn", "danger", "info", "neutral"] as Meaning[]).map((m) => (
            <li key={m} className="flex flex-col gap-1.5">
              <StatusPill meaning={m}>{{ ok: "成功", warn: "注意", danger: "危険", info: "情報", neutral: "中立" }[m]}</StatusPill>
            </li>
          ))}
        </ul>
      </Sub>
      <Sub title="コントラスト" note="現在の値から計算した実測です（基準：文字 4.5、境界 3。現場モードは本文 7）。">
        <ul className="grid gap-1.5 sm:grid-cols-2" data-testid="contrast-readout">
          {rows.map((r) => {
            const ok = r.r !== null && r.r >= r.min;
            return (
              <li key={r.label} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-ctl bg-sunken px-3 py-1.5">
                <span className="min-w-0 text-table text-fg">{r.label}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-table tabular-nums text-fg-soft">
                  {r.r === null ? "—" : `${r.r.toFixed(2)}:1`}
                  <StatusPill meaning={ok ? "ok" : "danger"}>{ok ? `${r.min} 以上` : "不足"}</StatusPill>
                </span>
              </li>
            );
          })}
        </ul>
      </Sub>
      <Sub title="文字の大きさ" note="見出し 22／24px、本文 15／14px（行間 1.7）、補助 12px 以上。数値は等幅。">
        <div className="flex flex-col gap-2 rounded-ctl border border-line bg-surface p-4">
          <p className="text-h1 font-semibold">ページ見出し（h1）</p>
          <p className="text-h2 font-semibold">節の見出し（h2）</p>
          <p className="text-h3 font-semibold">小見出し（h3）</p>
          <p className="text-body">本文です。書体は日本語の 1 種類にそろえ、太さと大きさで階層を作ります。</p>
          <p className="text-table">表・一覧の文字です。</p>
          <p className="text-aux text-fg-mute">補助の文字（凡例・注記）です。</p>
          <p className="text-stat font-semibold tabular-nums">1,234.5 <span className="text-aux font-normal text-fg-mute">統計の数値（等幅）</span></p>
        </div>
      </Sub>
    </div>
  );
}

// ── icons and app icon proposals ─────────────────────────────────────────────

export function IconsSection() {
  return (
    <div className="flex flex-col gap-8">
      <Sub title={`アイコン（${ICON_NAMES.length} 個）`} note="24px の方眼・線 1.75px・currentColor。意味は隣の文字が担い、アイコンは装飾です。">
        <ul className="grid grid-cols-3 gap-px border border-line bg-line sm:grid-cols-6 lg:grid-cols-8" aria-label="アイコンの一覧" data-testid="icon-grid">
          {ICON_NAMES.map((n) => (
            <li key={n} className="flex flex-col items-center gap-1.5 bg-surface px-1 py-3">
              <Icon name={n} size={24} className="text-fg" />
              <code className="max-w-full truncate font-mono text-aux text-fg-mute">{n}</code>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-4 text-fg">
          {[16, 20, 24, 32].map((s) => (
            <span key={s} className="inline-flex items-center gap-2 text-aux text-fg-mute">
              <Icon name="flight" size={s} className="text-fg" />
              {s}px
            </span>
          ))}
        </div>
      </Sub>

      <Sub title="アプリのアイコン案（3 案）" note="正方形・四隅まで塗りつぶし・角丸なし・文字なし。色は仮の青で、配色案に追従します。明・暗の背景の見本には、OS が付ける丸みを仮に付けて並べています。">
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-6 border-y border-line lg:grid-cols-3 lg:gap-0 lg:divide-x lg:divide-line" aria-label="アプリのアイコン案">
          {APP_ICON_PROPOSALS.map(({ id, label, note, Icon: Mark }) => (
            <li key={id} className="flex flex-col gap-3 py-4 lg:px-4 lg:first:pl-0 lg:last:pr-0" data-testid={`appicon-${id}`}>
              <div>
                <p className="text-h3 font-semibold text-fg">{label}</p>
                <p className="text-aux text-fg-mute">{note}</p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-aux text-fg-mute">原画（角丸なし・四隅まで塗り）</span>
                <div className="w-fit" data-testid={`appicon-${id}-raw`}>
                  <Mark size={180} label={`${label}の原画`} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {([
                  ["明の背景", "light", "bg-[#f2f2f7]", "text-[#4a4a4f]"],
                  ["暗の背景", "dark", "bg-[#1c1c1e]", "text-[#c7c7cc]"],
                ] as const).map(([name, key, bg, fg]) => (
                  <div key={key} className={cx("flex flex-col gap-2 rounded-ctl p-3", bg)}>
                    <span className={cx("text-aux", fg)}>{name}（角丸は OS が付ける想定）</span>
                    <div className="flex flex-wrap items-end gap-4">
                      {[180, 60, 29].map((s) => (
                        <div key={s} className="flex flex-col items-center gap-1" data-testid={`appicon-${id}-${key}-${s}`}>
                          <span className="block overflow-hidden" style={{ width: s, height: s, borderRadius: "22.5%" }}>
                            <Mark size={s} />
                          </span>
                          <span className={cx("text-[11px]", fg)}>{s}px</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Sub>

      <Sub title="ドローンの線画（空の状態に小さく置く）" note="線 1.75px・currentColor。拡大しても線の太さは変わりません。">
        <div className="flex flex-wrap items-center gap-6 rounded-ctl border border-line bg-surface p-4 text-fg-mute">
          <DroneLineArt width={200} />
          <DroneLineArt width={120} />
          <DroneLineArt width={64} />
        </div>
      </Sub>
    </div>
  );
}

// ── parts in each state ──────────────────────────────────────────────────────

export function PartsSection({ density }: { readonly density: "standard" | "compact" }) {
  const toast = useToast();
  const [tab, setTab] = useState("a");
  const [seg, setSeg] = useState("one");
  const [tog, setTog] = useState(true);
  const [dialog, setDialog] = useState<null | "dialog" | "sheet" | "drawer" | "reason">(null);
  const [lastReason, setLastReason] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-10">
      <ControlsSection />

      <Sub title="チェック・ラジオ・トグル" note="トグルは角を丸めた四角の軌道で、つまみの位置と右のオン・オフの文字で状態を示します。">
        <div className="grid gap-4 rounded-ctl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
          <State label="チェック"><div className="flex flex-col"><Checkbox label="既定" /><Checkbox label="選択済み" defaultChecked /><Checkbox label="無効" disabled /></div></State>
          <State label="ラジオ"><div className="flex flex-col"><Radio name="r-demo" label="一つ目" defaultChecked /><Radio name="r-demo" label="二つ目" /><Radio name="r-demo" label="無効" disabled /></div></State>
          <State label="トグル（スイッチ）">
            <div className="flex items-center gap-2">
              <Toggle label="トグルの見本" checked={tog} onChange={setTog} data-testid="demo-toggle" />
              <span className="text-table text-fg-soft">{tog ? "オン" : "オフ"}</span>
              <Toggle label="無効のトグル" checked={false} disabled />
            </div>
          </State>
        </div>
      </Sub>

      <Sub title="状態の印・注意バー" note="5 つの意味は、アイコン（形）＋文言＋色で示します。丸いピルは件数のバッジだけに使います。">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill meaning="ok">確認済み</StatusPill>
          <StatusPill meaning="warn">確認待ち</StatusPill>
          <StatusPill meaning="danger">期限切れ</StatusPill>
          <StatusPill meaning="info">案内</StatusPill>
          <StatusPill meaning="neutral">下書き</StatusPill>
          <span className="inline-flex items-center gap-2 text-table text-fg-soft">
            未確認の計画
            <span className="rounded-pill bg-sunken px-2 text-aux font-medium tabular-nums text-fg">12</span>
          </span>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          <NoticeBar meaning="info" title="情報">固定の注意書きは、見出しの直下に常に表示します。</NoticeBar>
          <NoticeBar meaning="warn" title="注意">操作の前に確かめることがある場合に使います。</NoticeBar>
          <NoticeBar meaning="danger" title="危険">先に進めない理由があるときに使います。</NoticeBar>
          <NoticeBar meaning="ok" title="成功">保存できたことを、画面の中にも残します。</NoticeBar>
        </div>
      </Sub>

      <Sub title="カード（3 種）と統計タイル" note="主（1 画面に 1 つ）・標準・インセット。影はなく、罫線と地色の差で分けます。同じ幅を並べません。">
        <div className="flex flex-col gap-3">
          <Card variant="primary"><p className="text-h3 font-semibold">主カード</p><p className="text-table text-fg-soft">1 画面に 1 つ。太い罫で囲み、いちばん大きく取ります。</p></Card>
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <Card variant="standard"><p className="text-h3 font-semibold">標準カード</p><p className="text-table text-fg-soft">一覧や要約を入れる、細い罫の面です。</p></Card>
            <Card variant="inset"><p className="text-h3 font-semibold">インセット</p><p className="text-table text-fg-soft">地色の差だけで、枠はありません。</p></Card>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile size="lead" label="次にやること" value={3} unit="件" status="期限が近い" meaning="warn" href="#" />
          <div className="flex flex-col divide-y divide-line border-y border-line">
            <StatTile label="今日の飛行" value={2} unit="件" href="#" />
            <StatTile label="飛行中" value={0} unit="件" status="なし" meaning="ok" />
          </div>
        </div>
      </Sub>

      <Sub title="タブ・セグメント・ⓘ・折りたたみ・コンテキストメニュー">
        <div className="flex flex-col gap-4 rounded-ctl border border-line bg-surface p-4">
          <Tabs
            idPrefix="demo-tabs"
            label="タブの見本"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "a", label: "概要", icon: "today" },
              { id: "b", label: "履歴", icon: "history", count: 4 },
              { id: "c", label: "設定", icon: "sliders" },
            ]}
          />
          <TabPanel idPrefix="demo-tabs" id="a" active={tab === "a"}>概要のパネルです。矢印キーでタブを移動できます。</TabPanel>
          <TabPanel idPrefix="demo-tabs" id="b" active={tab === "b"}>履歴のパネルです。</TabPanel>
          <TabPanel idPrefix="demo-tabs" id="c" active={tab === "c"}>設定のパネルです。</TabPanel>
          <div className="flex flex-wrap items-center gap-4">
            <Segmented label="表示の切り替え" value={seg} onChange={setSeg} options={[{ id: "one", label: "一覧" }, { id: "two", label: "地図" }, { id: "three", label: "表" }]} />
            <span className="inline-flex items-center text-table text-fg-soft">
              用語の説明
              <InfoPopover label="用語の説明" data-testid="demo-info">ボタンを押すか、フォーカスすると開きます。Esc で閉じます。タッチでも開けます。</InfoPopover>
            </span>
          </div>
          <Disclosure summary="説明（折りたたみ）">3 文以上の説明や、選択肢ごとの長い説明はここに置きます。固定の注意書きは置きません。</Disclosure>
          <ContextMenu
            label="行の操作"
            data-testid="demo-context"
            items={[
              { id: "open", label: "開く", icon: "external-link", onSelect: () => toast.show("開きました（見本）", "info") },
              { id: "copy", label: "リンクをコピー", icon: "copy", onSelect: () => toast.show("リンクをコピーしました（見本）") },
              { id: "tab", label: "新しいタブで開く", icon: "external-link", onSelect: () => toast.show("新しいタブで開きます（見本）", "info") },
            ]}
          >
            <span className="inline-flex min-h-11 items-center text-body text-fg">この行で右クリック、長押し、Shift+F10、右の「…」で開きます</span>
          </ContextMenu>
        </div>
      </Sub>

      <Sub title="表・空・読み込み中・エラー">
        <div className="grid gap-4 lg:grid-cols-2">
          <DataTable
            caption="読み込み中の表の見本"
            loading
            density={density}
            columns={[{ key: "a", header: "名称", cell: () => null, primary: true }, { key: "b", header: "状態", cell: () => null }]}
            rows={[]}
            rowKey={() => ""}
          />
          <EmptyState art={<DroneLineArt width={120} />} title="飛行の記録はまだありません" action={<Button variant="primary" icon="plus">飛行を記録する</Button>}>
            最初の飛行を記録すると、ここに一覧が出ます。
          </EmptyState>
        </div>
        <NoticeBar meaning="danger" title="送信できませんでした" data-testid="demo-error">
          通信が切れたため、記録は端末に保存されています。電波の届く場所で、もう一度「送信する」を押してください。
        </NoticeBar>
        <div className="flex flex-wrap items-center gap-4 text-fg-mute">
          <span className="inline-flex items-center gap-2 text-table"><Spinner label="読み込み中" />読み込み中</span>
          <div className="w-48"><Skeleton className="h-4 w-full" /></div>
        </div>
      </Sub>

      <Sub title="ダイアログ・ボトムシート・ドロワー・トースト・コマンド">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog("dialog")} data-testid="open-dialog">ダイアログ</Button>
          <Button onClick={() => setDialog("sheet")} data-testid="open-sheet">ボトムシート</Button>
          <Button onClick={() => setDialog("drawer")} data-testid="open-drawer">ドロワー</Button>
          <Button onClick={() => setDialog("reason")} data-testid="open-reason" variant="danger">理由つきの確認</Button>
          <Button onClick={() => toast.show("保存しました（見本）")} data-testid="open-toast">トースト</Button>
          <Button onClick={() => toast.show("通信が戻りました（見本）", "info")}>トースト（情報）</Button>
        </div>
        {lastReason ? <p className="text-table text-fg-soft" data-testid="reason-result">入力された理由：{lastReason}</p> : null}
        <p className="flex flex-wrap items-center gap-2 text-aux text-fg-mute">
          コマンドは <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd>（Mac は <Kbd>⌘</Kbd>+<Kbd>K</Kbd>）、ショートカット一覧は <Kbd>?</Kbd> で開きます。
        </p>
        <Dialog open={dialog === "dialog"} onClose={() => setDialog(null)} title="ダイアログ" footer={<><Button onClick={() => setDialog(null)}>閉じる</Button><Button variant="primary" onClick={() => setDialog(null)}>決定</Button></>}>
          <p className="text-body">768px 以上は中央、未満は下から出るシートになります。Esc、閉じるボタン、外側の押下で閉じ、フォーカスは開いたボタンへ戻ります。</p>
          <div className="mt-3"><TextInput aria-label="ダイアログ内の入力" placeholder="フォーカスは中に閉じ込められます" /></div>
        </Dialog>
        <Dialog open={dialog === "sheet"} onClose={() => setDialog(null)} title="ボトムシート" kind="sheet" footer={<Button onClick={() => setDialog(null)}>閉じる</Button>}>
          <p className="text-body">つかみを下へ引くか、閉じるボタンで閉じます。</p>
        </Dialog>
        <Dialog open={dialog === "drawer"} onClose={() => setDialog(null)} title="ドロワー" kind="drawer" footer={<Button onClick={() => setDialog(null)}>閉じる</Button>}>
          <p className="text-body">768px 以上は右から、未満はボトムシートです。一覧の行のプレビュー（インスペクタ）に使います。</p>
        </Dialog>
        <ReasonDialog open={dialog === "reason"} onClose={() => setDialog(null)} title="記録を取り消す（見本）" confirmLabel="取り消す" onConfirm={(r) => { setLastReason(r); setDialog(null); toast.show("取り消しました（見本）", "warn"); }} />
      </Sub>
    </div>
  );
}

// ── ボタンと入力欄 ───────────────────────────────────────────────────────────

const BUTTON_ROWS = [
  { variant: "primary", name: "主", label: "飛行計画を保存", busy: "保存中" },
  { variant: "secondary", name: "副", label: "下書きに戻す", busy: "戻し中" },
  { variant: "quiet", name: "控えめ", label: "あとで確認する", busy: "確認中" },
  { variant: "danger", name: "取り消し", label: "記録を取り消す", busy: "取消中" },
] as const;

/** Buttons and entry fields in every state, with real wording. Hover, focus and pressed are forced on (data-force). */
function ControlsSection() {
  return (
    <div id="controls" className="flex scroll-mt-16 flex-col gap-10" data-testid="controls-section">
      <Sub title="ボタン" note="通常・ホバー・フォーカス・押下・無効・読み込み中。ホバー・フォーカス・押下は固定表示です。文字は枠からはみ出さず、長い文言は枠の中で折り返します。">
        <div className="flex flex-col gap-6 border-y border-line py-5" data-testid="buttons">
          {BUTTON_ROWS.map((b) => (
            <div key={b.variant} className="grid grid-cols-2 gap-x-4 gap-y-4 field:max-sm:grid-cols-1 sm:grid-cols-3 lg:grid-cols-6" data-testid={`buttons-${b.variant}`}>
              <State label={`${b.name}：通常`}><Button variant={b.variant}>{b.label}</Button></State>
              <State label="ホバー"><Button variant={b.variant} data-force="hover">{b.label}</Button></State>
              <State label="フォーカス"><Button variant={b.variant} data-force="focus">{b.label}</Button></State>
              <State label="押下"><Button variant={b.variant} data-force="active">{b.label}</Button></State>
              <State label="無効"><Button variant={b.variant} disabled>{b.label}</Button></State>
              <State label="読み込み中"><Button variant={b.variant} loading>{b.busy}</Button></State>
            </div>
          ))}
          <div className="flex flex-col gap-3">
            <p className="text-aux text-fg-mute">長い文言：幅に合わせて伸び、収まらなければ枠の中で折り返します。</p>
            <div className="flex flex-wrap items-start gap-3" data-testid="buttons-long">
              <Button variant="primary" icon="check-circle">日常点検の記録を確認して、運航管理者へ提出する</Button>
              <div className="w-48"><Button variant="secondary" className="w-full">飛行前の確認項目をすべて見直してから、もう一度送信する</Button></div>
              <Button variant="danger" icon="ban">確定した記録を取り消す</Button>
            </div>
          </div>
        </div>
      </Sub>

      <Sub title="入力欄" note="ラベルは常に欄の上に出します。時刻・座標・飛行時間は等幅の数字です。エラーは「何が起きたか」と「どうすればよいか」を欄のすぐ下に書きます。">
        <div className="flex flex-col gap-6 border-y border-line py-5" data-testid="fields">
          <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            <State label="通常">
              <div className="w-full">
                <FormField id="ctl-reg" label="機体の登録記号" hint="機体に貼ってあるラベルの記号を入力します。">
                  <TextInput id="ctl-reg" aria-describedby={describedBy("ctl-reg", { hint: true })} placeholder="JU から始まる 12 文字" />
                </FormField>
              </div>
            </State>
            <State label="ホバー">
              <div className="w-full">
                <FormField id="ctl-pilot" label="操縦者の氏名">
                  <TextInput id="ctl-pilot" data-force="hover" placeholder="例：米子 太郎" />
                </FormField>
              </div>
            </State>
            <State label="フォーカス">
              <div className="w-full">
                <FormField id="ctl-place" label="離陸地点の名称">
                  <TextInput id="ctl-place" data-force="focus" defaultValue="弓ヶ浜公園 河川敷" />
                </FormField>
              </div>
            </State>
            <State label="無効">
              <div className="w-full">
                <FormField id="ctl-no" label="確定した記録の番号" hint="確定した記録は書き換えられません。訂正は新しい版として追記します。">
                  <TextInput id="ctl-no" disabled defaultValue="R-2026-0412" className="tabular-nums" aria-describedby={describedBy("ctl-no", { hint: true })} />
                </FormField>
              </div>
            </State>
            <State label="読み込み中">
              <div className="w-full">
                <FormField id="ctl-addr" label="離陸地点の住所" hint="座標から住所を調べています。">
                  <TextInput id="ctl-addr" loading defaultValue="35.4821, 133.3190" className="tabular-nums" aria-describedby={describedBy("ctl-addr", { hint: true })} />
                </FormField>
              </div>
            </State>
            <State label="エラー">
              <div className="w-full">
                <FormField id="demo-err" label="機体の登録記号" required error="登録記号の形式が違います。機体のラベルを見て、英数字 12 文字で入力してください。">
                  <TextInput id="demo-err" invalid defaultValue="JU12-34" aria-describedby={describedBy("demo-err", { error: true })} />
                </FormField>
              </div>
            </State>
            <State label="数字（等幅・右寄せ）">
              <div className="w-full">
                <FormField id="ctl-min" label="飛行時間" hint="離陸から着陸までの時間です。">
                  <div className="flex items-center gap-2">
                    <div className="w-28"><TextInput id="ctl-min" inputMode="numeric" defaultValue="25" className="text-right tabular-nums" aria-describedby={describedBy("ctl-min", { hint: true })} /></div>
                    <span className="text-body text-fg-soft">分</span>
                  </div>
                </FormField>
              </div>
            </State>
            <State label="数字（座標）">
              <div className="w-full">
                <FormField id="ctl-lat" label="離陸地点の緯度" optional>
                  <TextInput id="ctl-lat" inputMode="decimal" defaultValue="35.482100" className="tabular-nums" />
                </FormField>
              </div>
            </State>
            <State label="選択">
              <div className="w-full">
                <FormField id="ctl-kind" label="飛行の区分">
                  <Select id="ctl-kind"><option>訓練</option><option>業務</option><option>点検</option></Select>
                </FormField>
              </div>
            </State>
            <State label="検索">
              <div className="w-full">
                <FormField id="ctl-find" label="計画を探す">
                  <SearchInput id="ctl-find" placeholder="地点名・機体名" />
                </FormField>
              </div>
            </State>
            <State label="複数行">
              <div className="w-full sm:col-span-2 lg:col-span-1">
                <FormField id="ctl-memo" label="気づいたこと" optional>
                  <Textarea id="ctl-memo" placeholder="風の強さや、周りの様子を書き留めます。" />
                </FormField>
              </div>
            </State>
          </div>
          <ErrorSummary errors={[{ id: "demo-err", message: "登録記号の形式が違います" }]} />
        </div>
      </Sub>
    </div>
  );
}
