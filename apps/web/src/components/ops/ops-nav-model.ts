// メニューの定義と経路の判断（純粋関数・定数）。クライアントの部品（ops-nav.tsx）と、サーバーの画面（戻りリンク）が共有する。
// Sprint 16-F（G-1 承認済み。docs/sprints/sprint-16.md §7）：下タブ（スマホ）は 4 つ：ホーム／計画／日誌／機体と書類。
// 左メニュー（PC）は ホーム／計画／日誌（子：飛行記録・点検・事故・ヒヤリハット）／機体と書類（子：機体・操縦者・許可・承認・地点）、区切りの下に「調べる：判定」。
// 点検は下タブから外れ、日誌の下に入った（現在地は「日誌」）。点検の入口は ホームのクイック操作・日誌のタブ・左メニューの日誌の子・計画の詳細と現場の導線。
// キー（today・plans・journal・more）・data-testid（nav-*）・URL は変えない（ホーム＝/ops、機体と書類＝/ops/more）。判定は下タブに置かない。
import type { IconName } from "@/components/ui/icons";
import { can, type OpsAction } from "@/server/ops/authz";
import type { MemberRoleDb } from "@soraban/db";

/** 本文の枠の id（スキップリンクの移動先）。 */
export const OPS_MAIN_ID = "ops-main";

export type NavKey = "today" | "verdict" | "plans" | "journal" | "more";
/** 子項目のキー。nav-<key> が data-testid（nav-inspections は日誌の子として残る）。 */
export type NavChildKey = "flights" | "inspections" | "incidents" | "aircraft" | "pilots" | "permits" | "places";
/** 子項目を持つ親（左メニューだけ）。 */
export type NavParentKey = "journal" | "more";

export type NavItem = { readonly key: NavKey; readonly label: string; readonly href: string; readonly icon: IconName };

/** 5 項目すべての定義（キーで引く表）。 */
export const NAV_ITEM: Readonly<Record<NavKey, NavItem>> = {
  today: { key: "today", label: "ホーム", href: "/ops", icon: "home" },
  verdict: { key: "verdict", label: "判定", href: "/", icon: "verdict" },
  plans: { key: "plans", label: "計画", href: "/ops/plans", icon: "plan" },
  journal: { key: "journal", label: "日誌", href: "/ops/journal", icon: "journal" },
  more: { key: "more", label: "機体と書類", href: "/ops/more", icon: "list" },
};

const pick = (keys: readonly NavKey[]): readonly NavItem[] => keys.map((k) => NAV_ITEM[k]);

/** 下タブ（<1024px）の 4 項目。判定は置かない（ホームと計画の作成画面のピルから入る）。点検は日誌の下（ホームのクイック操作・日誌のタブからも入る）。 */
export const BOTTOM_TABS: readonly NavItem[] = pick(["today", "plans", "journal", "more"]);

/** 左メニュー（PC）の 5 項目。判定は区切りの下に置く。 */
export const SIDE_ITEMS: readonly NavItem[] = pick(["today", "plans", "journal", "more", "verdict"]);

/** 左メニューの区切り。上の 4 項目に見出しはなく、罫のあとに「調べる」（判定）を置く。 */
export const NAV_GROUPS: readonly { readonly heading: string | null; readonly keys: readonly NavKey[] }[] = [
  { heading: null, keys: ["today", "plans", "journal", "more"] },
  { heading: "調べる", keys: ["verdict"] },
];

export type NavChild = {
  readonly key: NavChildKey;
  readonly parent: NavParentKey;
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
  readonly read: OpsAction;
};

/**
 * 左メニューの子項目（日誌の下に 3 つ、機体と書類の下に 4 つ。左メニューだけ）。
 * 出し分けは authz.ts の閲覧の規則に従う（新しい規則は作らない。現行は全役割が見られる）。
 */
export const NAV_CHILDREN: readonly NavChild[] = [
  { key: "flights", parent: "journal", label: "飛行記録", href: "/ops/flights", icon: "flight", read: "flight.read" },
  { key: "inspections", parent: "journal", label: "点検", href: "/ops/inspections", icon: "inspection", read: "inspection.read" },
  { key: "incidents", parent: "journal", label: "事故・ヒヤリハット", href: "/ops/incidents", icon: "incident", read: "incident.read" },
  { key: "aircraft", parent: "more", label: "機体", href: "/ops/aircraft", icon: "aircraft", read: "aircraft.read" },
  { key: "pilots", parent: "more", label: "操縦者", href: "/ops/pilots", icon: "pilot", read: "pilot.read" },
  { key: "permits", parent: "more", label: "許可・承認", href: "/ops/permits", icon: "permit", read: "permit.read" },
  { key: "places", parent: "more", label: "地点", href: "/ops/places", icon: "place", read: "place.read" },
];

export const visibleNavChildren = (role: MemberRoleDb): readonly NavChild[] => NAV_CHILDREN.filter((c) => can(role, c.read));

/** ある親の子項目のうち、この役割に見えるもの。 */
export const visibleChildrenOf = (parent: NavParentKey, role: MemberRoleDb): readonly NavChild[] => visibleNavChildren(role).filter((c) => c.parent === parent);

/** 現場モードと、その中の現場の簡易記録（Sprint 12e）。メニューも利用者メニューも出さない。 */
export const FIELD_PATH = /^\/ops\/plans\/[^/]+\/field(\/incident)?\/?$/;

/**
 * メニューを出さない画面：現場モード（現場の簡易記録を含む）・サインイン・アクセス権なし。
 * Sprint 15：圏外用の現場の枠（/ops/offline/field）も現場モード。Service Worker はこの枠を現場の URL（/ops/plans/<id>/field）で返すため、
 * サーバーで描いた枠とブラウザの最初の描画で、メニュー・本文へ移動のリンクの有無を揃える（揃わないと水和の誤り #418 になる）。
 */
export const navHiddenOn = (pathname: string): boolean =>
  FIELD_PATH.test(pathname) || pathname === "/ops/offline/field" || pathname === "/ops/sign-in" || pathname === "/ops/no-access";

/**
 * どの項目が現在地か。
 *   日誌：飛行記録・点検（/ops/inspections*。16-F から）・日誌・事故・ヒヤリハット／計画：/ops/plans*（現場モードを除く）／機体と書類：/ops/more・機体・操縦者・許可・承認・地点・利用者・このアプリについて。
 *   `/` は判定（左メニューの現在地）。下タブには判定がないので、`/` では下タブのどれも現在地にならない。
 */
export const currentNavKey = (pathname: string): NavKey | null => {
  if (pathname === "/") return "verdict";
  if (pathname === "/ops") return "today";
  if (pathname.startsWith("/ops/plans")) return "plans";
  if (/^\/ops\/(flights|journal|inspections|incidents)/.test(pathname)) return "journal";
  if (pathname.startsWith("/ops/more") || /^\/ops\/(aircraft|pilots|places|permits|members|about)/.test(pathname)) return "more";
  return null;
};

const CHILD_KEYS: ReadonlySet<string> = new Set(NAV_CHILDREN.map((c) => c.key));

/** 子項目のうち、現在地のもの（左メニューで子項目を現在地にする）。日誌・機体と書類の画面そのものでは null。 */
export const currentChildKey = (pathname: string): NavChildKey | null => {
  const m = /^\/ops\/(flights|inspections|incidents|aircraft|pilots|permits|places)(\/|$)/.exec(pathname);
  return m && CHILD_KEYS.has(m[1] ?? "") ? (m[1] as NavChildKey) : null;
};

/** 現在地の子項目の親（左メニューで、親を「子がある」印にする）。 */
export const currentChildParent = (pathname: string): NavParentKey | null => {
  const k = currentChildKey(pathname);
  return k === null ? null : (NAV_CHILDREN.find((c) => c.key === k)?.parent ?? null);
};

/**
 * 左メニューで親を「祖先」（現在地の子がある）にしてよいか。現在地の子の親がこの親で、かつその子がこの役割に見えるとき（`visible`）だけ。
 * 見えない子が現在地でも、親を祖先にしない（親そのものが現在地として残る）。`visible` は `visibleChildrenOf(parent, role)`。
 */
export const hasVisibleCurrentChild = (pathname: string, parent: NavParentKey, visible: readonly NavChild[]): boolean => {
  const child = currentChildKey(pathname);
  return child !== null && currentChildParent(pathname) === parent && visible.some((c) => c.key === child);
};

// ---- 戻りリンク ----------------------------------------------------------------------------------------
// 戻り先は「メニューで親になっている画面」。1 段目の画面（ホーム・計画・日誌・機体と書類）には戻りリンクを置かない（メニューが退路）。
// 点検の一覧は 16-F から日誌の下の画面（戻りリンク「日誌」。ホームのクイック操作・日誌のタブからも入る）。

export type BackLink = { readonly href: string; readonly label: string };

export const BACK_TO = {
  /** 機体・操縦者・許可・承認・よく使う地点・利用者の一覧 → 機体と書類 */
  register: { href: "/ops/more", label: "機体と書類" },
  /** 飛行記録・点検・事故・ヒヤリハットの一覧 → 日誌 */
  journal: { href: "/ops/journal", label: "日誌" },
} as const satisfies Record<string, BackLink>;

/** 現場モードの退路（ホームへ戻る）。 */
export const FIELD_BACK = { href: "/ops", label: "ホームへ戻る" } as const satisfies BackLink;

/**
 * 画面ごとの戻り先の表。screen は代表の経路（動的な部分は例の値）、back は戻りリンクの行き先（1 段目の画面は null）。
 * 単体テストが、すべての行で currentNavKey(back.href) === currentNavKey(screen) を確かめる。
 */
const ID = "00000000-0000-4000-8000-000000000001";
export const BACK_TABLE: readonly { readonly screen: string; readonly back: BackLink | null }[] = [
  { screen: "/ops", back: null },
  { screen: "/ops/plans", back: null },
  { screen: "/ops/journal", back: null },
  { screen: "/ops/more", back: null },
  { screen: "/ops/aircraft", back: BACK_TO.register },
  { screen: "/ops/pilots", back: BACK_TO.register },
  { screen: "/ops/permits", back: BACK_TO.register },
  { screen: "/ops/places", back: BACK_TO.register },
  { screen: "/ops/members", back: BACK_TO.register },
  { screen: "/ops/about", back: BACK_TO.register },
  { screen: "/ops/flights", back: BACK_TO.journal },
  { screen: "/ops/inspections", back: BACK_TO.journal },
  { screen: "/ops/incidents", back: BACK_TO.journal },
  // 各詳細・入力・訂正・通報・判定の記録は、自分の一覧／計画の詳細へ（変更なし）
  { screen: "/ops/aircraft/new", back: { href: "/ops/aircraft", label: "機体の一覧" } },
  { screen: `/ops/aircraft/${ID}`, back: { href: "/ops/aircraft", label: "機体の一覧" } },
  { screen: "/ops/pilots/new", back: { href: "/ops/pilots", label: "操縦者の一覧" } },
  { screen: `/ops/pilots/${ID}`, back: { href: "/ops/pilots", label: "操縦者の一覧" } },
  { screen: "/ops/permits/new", back: { href: "/ops/permits", label: "許可・承認の一覧" } },
  { screen: `/ops/permits/${ID}`, back: { href: "/ops/permits", label: "許可・承認の一覧" } },
  { screen: "/ops/places/new", back: { href: "/ops/places", label: "よく使う地点" } },
  { screen: `/ops/places/${ID}`, back: { href: "/ops/places", label: "よく使う地点" } },
  { screen: "/ops/flights/new", back: { href: "/ops/flights", label: "飛行記録の一覧" } },
  { screen: `/ops/flights/${ID}`, back: { href: "/ops/flights", label: "飛行記録の一覧" } },
  { screen: "/ops/inspections/new", back: { href: "/ops/inspections", label: "点検の一覧" } },
  { screen: `/ops/inspections/${ID}`, back: { href: "/ops/inspections", label: "点検の一覧" } },
  { screen: "/ops/incidents/new", back: { href: "/ops/incidents", label: "事故・ヒヤリハットの一覧" } },
  { screen: `/ops/incidents/${ID}`, back: { href: "/ops/incidents", label: "事故・ヒヤリハットの一覧" } },
  { screen: "/ops/plans/new", back: { href: "/ops/plans", label: "飛行計画の一覧" } },
  { screen: `/ops/plans/${ID}`, back: { href: "/ops/plans", label: "飛行計画の一覧" } },
  { screen: `/ops/plans/${ID}/edit`, back: { href: `/ops/plans/${ID}`, label: "飛行計画の詳細" } },
  { screen: `/ops/plans/${ID}/snapshots`, back: { href: `/ops/plans/${ID}/judgement`, label: "判定" } },
  { screen: `/ops/plans/${ID}/snapshots/${ID}`, back: { href: `/ops/plans/${ID}/snapshots`, label: "判定の履歴" } },
  { screen: `/ops/plans/${ID}/overview`, back: { href: "/ops/plans", label: "飛行計画の一覧" } },
  { screen: `/ops/plans/${ID}/journal`, back: { href: "/ops/plans", label: "飛行計画の一覧" } },
  { screen: `/ops/plans/${ID}/judgement`, back: { href: `/ops/plans/${ID}`, label: "通報の状況" } },
  { screen: `/ops/plans/${ID}/report`, back: { href: `/ops/plans/${ID}`, label: "飛行計画の詳細" } },
];
