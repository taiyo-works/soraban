// Sample data for the menu and home trial (UX stage 2). Everything here is made up for layout review; the trial says so
// on screen. Dates are fixed strings (today is the sample date), never read from a clock or from a record.

import type { IconName } from "../icons";

/** The seven stages of one flight, in the order the work goes (docs/design/ux-audit.md section 5.2). */
export const STAGES = ["判定", "計画", "確認", "通報", "点検", "飛行", "日誌"] as const;

export const TODAY_LABEL = "10/24（土）";

export type PageId =
  | "home"
  | "judge"
  | "plans"
  | "plan-new"
  | "journal"
  | "journal-new"
  | "inspection-new"
  | "incident-new"
  | "register"
  | "aircraft"
  | "aircraft-new"
  | "pilots"
  | "pilot-new"
  | "permits"
  | "places"
  | "field";

export type NavKey = "home" | "judge" | "plans" | "journal" | "register" | "aircraft" | "pilots" | "permits" | "places";

/** Which menu item a page belongs to (the sub pages light up their parent). */
export const NAV_OF_PAGE: Readonly<Record<PageId, NavKey>> = {
  home: "home",
  judge: "judge",
  plans: "plans",
  "plan-new": "plans",
  journal: "journal",
  "journal-new": "journal",
  "inspection-new": "journal",
  "incident-new": "journal",
  register: "register",
  aircraft: "aircraft",
  "aircraft-new": "aircraft",
  pilots: "pilots",
  "pilot-new": "pilots",
  permits: "permits",
  places: "places",
  field: "home",
};

export const NAV_ICON: Readonly<Record<NavKey, IconName>> = {
  home: "home",
  judge: "place",
  plans: "plan",
  journal: "journal",
  register: "list",
  aircraft: "aircraft",
  pilots: "pilot",
  permits: "permit",
  places: "place",
};

export const PAGE_TITLE: Readonly<Record<PageId, string>> = {
  home: "ホーム",
  judge: "判定",
  plans: "計画",
  "plan-new": "飛行計画を作る",
  journal: "日誌",
  "journal-new": "飛行記録を入力",
  "inspection-new": "日常点検",
  "incident-new": "事故・ヒヤリハットの記録",
  register: "登録",
  aircraft: "機体",
  "aircraft-new": "機体を登録",
  pilots: "操縦者",
  "pilot-new": "操縦者を登録",
  permits: "許可・承認",
  places: "地点",
  field: "現場モード",
};

/** Where the back link of a sub page goes. */
export const PARENT_PAGE: Readonly<Partial<Record<PageId, PageId>>> = {
  "plan-new": "plans",
  "journal-new": "journal",
  "inspection-new": "journal",
  "incident-new": "journal",
  aircraft: "register",
  pilots: "register",
  permits: "register",
  places: "register",
  "aircraft-new": "aircraft",
  "pilot-new": "pilots",
};

export type Flight = {
  readonly id: string;
  readonly when: string;
  readonly time: string;
  readonly place: string;
  readonly aircraft: string;
  readonly pilot: string;
  /** How many of the seven stages are done (the next one is the first not done). */
  readonly done: number;
  readonly daysLeft?: number;
};

export const TODAY_FLIGHT: Flight = { id: "f-today", when: "今日", time: "10:30", place: "見本公園の撮影", aircraft: "見本機 01", pilot: "見本 一郎", done: 4 };
export const UPCOMING: readonly Flight[] = [
  { id: "f-1102", when: "11/02（月）", time: "09:00", place: "見本橋梁の点検", aircraft: "見本機 02", pilot: "見本 二郎", done: 2, daysLeft: 9 },
  { id: "f-1109", when: "11/09（月）", time: "13:30", place: "見本河川敷の測量", aircraft: "見本機 01", pilot: "見本 三郎", done: 1, daysLeft: 16 },
];

export type NextAction = { readonly id: string; readonly label: string; readonly meta: string; readonly urgency: string; readonly meaning: "warn" | "info" | "neutral"; readonly go: PageId };
export const NEXT_ACTIONS: readonly NextAction[] = [
  { id: "inspection", label: "日常点検をする", meta: "今日 10:30 見本公園の撮影", urgency: "今日", meaning: "warn", go: "inspection-new" },
  { id: "plans", label: "通報の内容を確かめる", meta: "11/02（月）見本橋梁の点検", urgency: "9 日後", meaning: "info", go: "plans" },
  { id: "journal", label: "日誌を記入する", meta: "昨日 10/23 見本川の撮影", urgency: "昨日", meaning: "neutral", go: "journal-new" },
];

export type Deadline = { readonly id: string; readonly what: string; readonly who: string; readonly date: string; readonly left: string; readonly meaning: "warn" | "neutral" };
export const DEADLINES: readonly Deadline[] = [
  { id: "d1", what: "技能証明", who: "見本 一郎", date: "11/14", left: "あと 21 日", meaning: "warn" },
  { id: "d2", what: "技能証明", who: "見本 二郎", date: "11/26", left: "あと 33 日", meaning: "neutral" },
  { id: "d3", what: "許可・承認（包括）", who: "事務所", date: "12/03", left: "あと 40 日", meaning: "neutral" },
];

export type JournalKind = "flight" | "inspection" | "incident";
export const JOURNAL_KIND_LABEL: Readonly<Record<JournalKind, string>> = { flight: "飛行記録", inspection: "日常点検", incident: "事故・ヒヤリハット" };
export const JOURNAL_ENTRIES: readonly { readonly id: string; readonly date: string; readonly kind: JournalKind; readonly title: string; readonly note: string }[] = [
  { id: "j1", date: "10/23", kind: "flight", title: "見本川の撮影", note: "見本機 01 ・ 見本 一郎" },
  { id: "j2", date: "10/23", kind: "inspection", title: "見本機 01 の日常点検", note: "すべて正常" },
  { id: "j3", date: "10/20", kind: "incident", title: "見本橋梁の点検", note: "風で機体が流され、ヒヤリとした" },
  { id: "j4", date: "10/18", kind: "flight", title: "見本公園の撮影", note: "見本機 02 ・ 見本 二郎" },
];

export type RegisterKind = "aircraft" | "pilots" | "permits" | "places";
export const REGISTER_KIND_LABEL: Readonly<Record<RegisterKind, string>> = { aircraft: "機体", pilots: "操縦者", permits: "許可・承認", places: "地点" };
export const REGISTER_ROWS: Readonly<Record<RegisterKind, readonly { readonly id: string; readonly name: string; readonly detail: string }[]>> = {
  aircraft: [
    { id: "a1", name: "見本機 01", detail: "見本型 A ・ 登録記号 見本-0001" },
    { id: "a2", name: "見本機 02", detail: "見本型 B ・ 登録記号 見本-0002" },
    { id: "a3", name: "見本機 03", detail: "見本型 A ・ 登録記号 見本-0003" },
  ],
  pilots: [
    { id: "p1", name: "見本 一郎", detail: "技能証明の期限 11/14" },
    { id: "p2", name: "見本 二郎", detail: "技能証明の期限 11/26" },
    { id: "p3", name: "見本 三郎", detail: "技能証明の期限 来年 03/08" },
  ],
  permits: [
    { id: "m1", name: "包括 許可・承認（見本）", detail: "有効期間 12/03 まで" },
    { id: "m2", name: "個別 承認（見本橋梁）", detail: "有効期間 11/30 まで" },
  ],
  places: [
    { id: "s1", name: "見本公園", detail: "よく使う地点" },
    { id: "s2", name: "見本橋梁", detail: "よく使う地点" },
    { id: "s3", name: "見本河川敷", detail: "よく使う地点" },
  ],
};

/** Map layers drawn as sample pictures. The pattern, not the colour alone, tells them apart. */
export const LAYERS = [
  { id: "did", label: "人口集中地区（DID）", short: "DID" },
  { id: "urgent", label: "緊急用務空域", short: "緊急用務空域" },
  { id: "industrial", label: "工業専用地域", short: "工業専用地域" },
  { id: "airport", label: "空港等の周辺", short: "空港等" },
  { id: "park", label: "都市公園", short: "都市公園" },
] as const;
export type LayerId = (typeof LAYERS)[number]["id"];

/** Rows of the sample result. Switching a layer only changes what the map draws, never this list. */
export const SAMPLE_RESULT_ROWS: readonly { readonly label: string; readonly state: string; readonly meaning: "ok" | "warn" | "danger" }[] = [
  { label: "人口集中地区（DID）", state: "対象", meaning: "warn" },
  { label: "緊急用務空域", state: "対象外", meaning: "ok" },
  { label: "工業専用地域", state: "対象外", meaning: "ok" },
  { label: "空港等の周辺", state: "対象外", meaning: "ok" },
];

export type ScriptDef = {
  readonly id: string;
  readonly device: "pc" | "phone";
  readonly label: string;
  readonly goal: string;
  /** The sample day the script needs (the trial switches to it when the script is chosen). */
  readonly day?: "busy" | "empty";
};

export const PC_SCRIPTS: readonly ScriptDef[] = [
  { id: "p1", device: "pc", label: "来週の飛行計画を作り始める", goal: "計画の入力画面が出るまで" },
  { id: "p2", device: "pc", label: "地点の規制を地図で確認する（層を 1 つ切り替える）", goal: "地図で地点を指定し、層を 1 つ切り替えるまで" },
  { id: "p3", device: "pc", label: "機体の登録画面へ行く", goal: "機体の登録画面が出るまで" },
  { id: "p4", device: "pc", label: "操縦者の登録画面へ行く", goal: "操縦者の登録画面が出るまで" },
];

export const PHONE_SCRIPTS: readonly ScriptDef[] = [
  { id: "s1", device: "phone", label: "これから飛ぶ計画の日常点検を始める", goal: "日常点検の画面が出るまで", day: "busy" },
  { id: "s2", device: "phone", label: "飛行後の日誌を書き始める", goal: "飛行記録の入力画面が出るまで", day: "busy" },
  { id: "s3", device: "phone", label: "予定がない日に次の期限を見る", goal: "近づく期限の一覧が見えるまで", day: "empty" },
  { id: "s4", device: "phone", label: "現在地の規制を確認する", goal: "現在地の判定結果が出るまで" },
  { id: "s5", device: "phone", label: "事故・ヒヤリハットの記録を始める", goal: "記録の入力画面が出るまで" },
];
