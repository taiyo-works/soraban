// メニューの定義と経路の判断（純粋関数・定数）。クライアントの部品（ops-nav.tsx）と、サーバーの画面（戻りリンク）が共有する。
// 下タブ（スマホ）は 5 つ：ホーム／計画／点検／日誌／登録。左メニュー（PC）は 6 項目：ホーム／判定／計画／点検／日誌／登録（docs/sprints/sprint-12h-pr3.md §4）。
// 判定は下タブに置かない（ホームと計画の作成画面のピルから入る）。URL は変えない（ホーム＝/ops、登録＝/ops/more）。
import type { IconName } from "@/components/ui/icons";
import { can, type OpsAction } from "@/server/ops/authz";
import type { MemberRoleDb } from "@soraban/db";

/** 本文の枠の id（スキップリンクの移動先）。 */
export const OPS_MAIN_ID = "ops-main";

export type NavKey = "today" | "verdict" | "plans" | "inspections" | "journal" | "more";
export type NavChildKey = "aircraft" | "pilots" | "permits" | "places";

export type NavItem = { readonly key: NavKey; readonly label: string; readonly href: string; readonly icon: IconName };

/** 6 項目すべての定義（キーで引く表）。 */
export const NAV_ITEM: Readonly<Record<NavKey, NavItem>> = {
  today: { key: "today", label: "ホーム", href: "/ops", icon: "home" },
  verdict: { key: "verdict", label: "判定", href: "/", icon: "verdict" },
  plans: { key: "plans", label: "計画", href: "/ops/plans", icon: "plan" },
  inspections: { key: "inspections", label: "点検", href: "/ops/inspections", icon: "inspection" },
  journal: { key: "journal", label: "日誌", href: "/ops/journal", icon: "journal" },
  more: { key: "more", label: "登録", href: "/ops/more", icon: "list" },
};

const pick = (keys: readonly NavKey[]): readonly NavItem[] => keys.map((k) => NAV_ITEM[k]);

/** 下タブ（<1024px）の 5 項目。順序は仕事の流れ（計画→点検→日誌）。判定は置かない。 */
export const BOTTOM_TABS: readonly NavItem[] = pick(["today", "plans", "inspections", "journal", "more"]);

/** 左メニュー（PC）の 6 項目。 */
export const SIDE_ITEMS: readonly NavItem[] = pick(["today", "verdict", "plans", "inspections", "journal", "more"]);

/** 左メニューの区切り（見出しは「調べる」「飛ばす」。ホームと登録は見出しなし）。 */
export const NAV_GROUPS: readonly { readonly heading: string | null; readonly keys: readonly NavKey[] }[] = [
  { heading: null, keys: ["today"] },
  { heading: "調べる", keys: ["verdict"] },
  { heading: "飛ばす", keys: ["plans", "inspections", "journal"] },
  { heading: null, keys: ["more"] },
];

export type NavChild = { readonly key: NavChildKey; readonly label: string; readonly href: string; readonly icon: IconName; readonly read: OpsAction };

/** 登録の子項目（左メニューだけ）。出し分けは authz.ts の閲覧の規則に従う（新しい規則は作らない）。 */
export const NAV_CHILDREN: readonly NavChild[] = [
  { key: "aircraft", label: "機体", href: "/ops/aircraft", icon: "aircraft", read: "aircraft.read" },
  { key: "pilots", label: "操縦者", href: "/ops/pilots", icon: "pilot", read: "pilot.read" },
  { key: "permits", label: "許可・承認", href: "/ops/permits", icon: "permit", read: "permit.read" },
  { key: "places", label: "地点", href: "/ops/places", icon: "place", read: "place.read" },
];

export const visibleNavChildren = (role: MemberRoleDb): readonly NavChild[] => NAV_CHILDREN.filter((c) => can(role, c.read));

/** 現場モードと、その中の現場の簡易記録（Sprint 12e）。メニューも利用者メニューも出さない。 */
export const FIELD_PATH = /^\/ops\/plans\/[^/]+\/field(\/incident)?\/?$/;

/** メニューを出さない画面：現場モード（現場の簡易記録を含む）・サインイン・アクセス権なし。 */
export const navHiddenOn = (pathname: string): boolean =>
  FIELD_PATH.test(pathname) || pathname === "/ops/sign-in" || pathname === "/ops/no-access";

/**
 * どの項目が現在地か。
 *   点検：/ops/inspections*／日誌：飛行記録・日誌・事故・ヒヤリハット／計画：/ops/plans*（現場モードを除く）／登録：登録・機体・操縦者・許可・承認・地点・利用者。
 *   `/` は判定（左メニューの現在地）。下タブには判定がないので、`/` では下タブのどれも現在地にならない。
 */
export const currentNavKey = (pathname: string): NavKey | null => {
  if (pathname === "/") return "verdict";
  if (pathname === "/ops") return "today";
  if (pathname.startsWith("/ops/plans")) return "plans";
  if (pathname.startsWith("/ops/inspections")) return "inspections";
  if (/^\/ops\/(flights|journal|incidents)/.test(pathname)) return "journal";
  if (pathname.startsWith("/ops/more") || /^\/ops\/(aircraft|pilots|places|permits|members)/.test(pathname)) return "more";
  return null;
};

/** 登録の子項目のうち、現在地のもの（左メニューで子項目を現在地にする）。 */
export const currentChildKey = (pathname: string): NavChildKey | null => {
  const m = /^\/ops\/(aircraft|pilots|permits|places)(\/|$)/.exec(pathname);
  return m ? (m[1] as NavChildKey) : null;
};

// ---- 戻りリンク ----------------------------------------------------------------------------------------
// 戻り先は「メニューで親になっている画面」。1 段目の画面（ホーム・計画・点検・日誌・登録）には戻りリンクを置かない（メニューが退路）。

export type BackLink = { readonly href: string; readonly label: string };

export const BACK_TO = {
  /** 機体・操縦者・許可・承認・よく使う地点・利用者の一覧 → 登録 */
  register: { href: "/ops/more", label: "登録" },
  /** 飛行記録・事故・ヒヤリハットの一覧 → 日誌 */
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
  { screen: "/ops/inspections", back: null },
  { screen: "/ops/journal", back: null },
  { screen: "/ops/more", back: null },
  { screen: "/ops/aircraft", back: BACK_TO.register },
  { screen: "/ops/pilots", back: BACK_TO.register },
  { screen: "/ops/permits", back: BACK_TO.register },
  { screen: "/ops/places", back: BACK_TO.register },
  { screen: "/ops/members", back: BACK_TO.register },
  { screen: "/ops/flights", back: BACK_TO.journal },
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
  { screen: `/ops/plans/${ID}/snapshots`, back: { href: `/ops/plans/${ID}`, label: "飛行計画の詳細" } },
  { screen: `/ops/plans/${ID}/snapshots/${ID}`, back: { href: `/ops/plans/${ID}/snapshots`, label: "判定の履歴" } },
  { screen: `/ops/plans/${ID}/report`, back: { href: `/ops/plans/${ID}`, label: "飛行計画の詳細" } },
];
