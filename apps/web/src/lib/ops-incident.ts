// 事故・ヒヤリハット（Sprint 12e 設計 A・C）の固定の文言・版つきの事象の類型のデータ・目安の計算。画面・API・テストが同じ定数を使う。
// 純粋（DB・時計・ネットワークに触れない）。クライアントのコンポーネントからも import できる（node の組み込みを使わない）。
//
// 守ること：
//   - 記録は事実の記録であり、法的な報告の完了も、責任の判断も意味しない（N1）。そらばんは国へ報告を送信しない（N2）。
//   - 目安は 2 段（possible／none_selected）だけ。報告の要否を断定する語・法令上の区分（事故・重大インシデントのどちらに当たるか）
//     を目安の出力に含めない。分からないときは可能性の側（possible）に倒す。
//   - 事象の類型は版つきのデータ（INCIDENT_GUIDANCE_REVISIONS）。類型・名称・説明・状態の変更は版を上げるだけで済み、型・画面・DB の
//     CHECK は変えない。古い版は消さない（過去の記録は保存した版の名称で読める）。
//   - 条番号・URL・電話番号・金額をここに書かない（出典は資料の名称だけ）。

// ---- 固定の文言（設計 A。designer は文言を変えない） ---------------------------------------

/** G1（最初の案内）の段落。事故・ヒヤリハットの入力画面（事務所・現場）の最上部。入力欄より前（DOM の順でも）。 */
export const INCIDENT_SAFETY_FIRST_LINES = [
  "まず、飛行を中止し（速やかに着陸させ）、けがをした人の救護と危険の防止を最優先にしてください。必要に応じて 119 番（救急・消防）・110 番（警察）へ連絡してください。",
  "機体やバッテリーから煙や熱が出ているときは、近づかず、無理に触れないでください。周囲の人が近づかないようにしてください。",
  "記録は、安全を確保したあとで構いません。",
] as const;
/** G1（最初の案内）の全文（段落をつないだもの）。 */
export const INCIDENT_SAFETY_FIRST = INCIDENT_SAFETY_FIRST_LINES.join("");

/** N1（事実の記録の注意）。事故・ヒヤリハットのすべての画面に常に表示。「責任」の語はこの定数の中だけで使う。 */
export const INCIDENT_FACT_NOTICE =
  "この記録は、起きたことの事実を残すためのものです。国への報告が済んだこと、報告の義務があるかどうか、責任の所在を示すものではありません。";

/** N2（公式の手続き）。一覧・詳細・報告の記録・現場の簡易記録の完了後。 */
export const INCIDENT_OFFICIAL_PROCEDURE_NOTICE =
  "そらばんは国への報告を送信しません。報告が必要かどうかと報告の方法は、国土交通省の報告要領と DIPS 2.0 で確認してください。";

/** N3（報告の記録）。報告の記録のフォーム・記録の表示。 */
export const INCIDENT_REPORT_RECORD_NOTICE = "報告の記録は、利用者の申告です。そらばんが報告の完了を確認したものではありません。";

/** N4（目安）の共通部分。目安の表示のすぐ下。出典・状態はデータの版から足す（incidentGuidanceNote）。 */
export const INCIDENT_GUIDANCE_NOTICE_BASE =
  "この目安は、選んだ事象の類型から機械的に示すものです。報告が必要かどうかを判断するものでも、保証するものでもありません。";

/** N5（個人情報）。自由記述の欄の近く。 */
export const INCIDENT_PERSONAL_INFO_NOTICE = "氏名・連絡先・病状の詳細など、個人が特定される情報は書かないでください。";

/** N6（区分の注意）。区分の選択の近く。 */
export const INCIDENT_KIND_NOTICE =
  "この区分は記録を整理するためのもので、法令上の区分ではありません。迷うときは『まだ分からない』を選んでください。";

/** N7（類型の選び方）。事象の類型の選択の近く。 */
export const INCIDENT_EVENT_TYPE_NOTICE =
  "当てはまるものをすべて選んでください。各類型の説明は、国土交通省の報告要領に基づきます。けがの重さ（重傷か軽傷か）の境目は報告要領に定めがなく、そらばんは判定しません。迷うときは重い方か『まだ分からない』を選んでください。";

/** 現場の簡易記録：類型はあとで入力できる旨（簡易記録では類型を「まだ分からない」で保存する）。 */
export const INCIDENT_QUICK_LATER_NOTICE = "事象の類型などは、あとで入力できます";
/** 現場の簡易記録：保存の直後。 */
export const INCIDENT_QUICK_SAVED_MESSAGE = "記録しました。詳細はあとで記入できます";
/** 考えられる要因の欄の見出し（推測でよい旨）。 */
export const INCIDENT_FACTORS_LABEL = "考えられる要因（推測でかまいません）";
/** 報告の記録のあとで事実（類型・区分・けがの有無・人数）が変わったとき。 */
export const INCIDENT_CHANGED_SINCE_REPORT = "内容が変わりました。追加の報告の要否を確認してください";
/** 「※要確認」の印（版の状態が unconfirmed のときだけ付く）。 */
export const UNCONFIRMED_MARK = "※要確認";

// ---- 区分・選択肢 ---------------------------------------------------------------------------

export const INCIDENT_KINDS = ["accident", "near_miss", "undetermined"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
/** 利用者が選ぶ区分の名称（法令上の区分ではない。N6）。 */
export const INCIDENT_KIND_LABEL: Readonly<Record<IncidentKind, string>> = {
  accident: "事故",
  near_miss: "ヒヤリハット",
  undetermined: "まだ分からない",
};

export const INCIDENT_PHASES = ["preparation", "takeoff", "in_flight", "landing", "after_flight", "other"] as const;
export type IncidentPhase = (typeof INCIDENT_PHASES)[number];
export const INCIDENT_PHASE_LABEL: Readonly<Record<IncidentPhase, string>> = {
  preparation: "飛行の準備中",
  takeoff: "離陸のとき",
  in_flight: "飛行中",
  landing: "着陸のとき",
  after_flight: "飛行のあと",
  other: "その他",
};

export const YES_NO_UNKNOWN = ["yes", "no", "unknown"] as const;
export type YesNoUnknown = (typeof YES_NO_UNKNOWN)[number];
export const YES_NO_UNKNOWN_LABEL: Readonly<Record<YesNoUnknown, string>> = { yes: "ある", no: "ない", unknown: "わからない" };
/** けがの有無・機体の損傷の項目名。 */
export const PEOPLE_INJURY_LABEL = "けがをした人";
export const AIRCRAFT_DAMAGE_LABEL = "自社の機体の損傷";

export const INCIDENT_CONTACTS = ["emergency_119", "police_110", "site_manager", "client", "internal_manager"] as const;
export type IncidentContact = (typeof INCIDENT_CONTACTS)[number];
export const INCIDENT_CONTACT_LABEL: Readonly<Record<IncidentContact, string>> = {
  emergency_119: "119 番（救急・消防）",
  police_110: "110 番（警察）",
  site_manager: "施設管理者・土地の所有者",
  client: "発注者・お客様",
  internal_manager: "社内の運航管理者",
};

export const INCIDENT_SOURCES = ["office", "field_quick"] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];
export const INCIDENT_SOURCE_LABEL: Readonly<Record<IncidentSource, string>> = { office: "事務所で記録", field_quick: "現場の簡易記録" };

export const INCIDENT_FOLLOW_UPS = ["open", "done"] as const;
export type IncidentFollowUp = (typeof INCIDENT_FOLLOW_UPS)[number];
export const INCIDENT_FOLLOW_UP_LABEL: Readonly<Record<IncidentFollowUp, string>> = { open: "対応中", done: "対応済み" };

/** 簡易記録の印（文字と記号。色だけで区別しない）。 */
export const INCIDENT_DETAIL_PENDING_LABEL = "詳細は未記入（現場の簡易記録）";
export const INCIDENT_DETAIL_PENDING_MARK = "✎";
export const INCIDENT_VOIDED_LABEL = "取消済み";

// ---- 長さの上限 ---------------------------------------------------------------------------

export const INCIDENT_LIMITS = {
  summary: 200,
  details: 1000,
  factorsNote: 500,
  actionsTaken: 500,
  preventionNote: 500,
  placeName: 100,
  injuredCountMax: 999,
  reportNote: 500,
  channelNote: 100,
  reference: 50,
  reason: 500,
} as const;

/** 詳細の記入を促す期間（起きた日から何日目まで。社内の目安）。 */
export const INCIDENT_DETAIL_DUE_DAYS = 14;

// ---- 事象の類型（版つきのデータ） ------------------------------------------------------------

/** 特別な値：どれにも当たらない（目安は none_selected の側）。他の値と一緒に選べない。 */
export const EVENT_TYPE_NONE = "none";
/** 特別な値：まだ分からない（目安は possible の側）。他の値と一緒に選べない。 */
export const EVENT_TYPE_UNKNOWN = "unknown";
export const EXCLUSIVE_EVENT_TYPES = [EVENT_TYPE_NONE, EVENT_TYPE_UNKNOWN] as const;

/** 類型ごとの目安への効き方。possible：1 つでも選べば possible／fact_only：単独では possible に倒さない事実の類型。 */
export type IncidentEventGuidance = "possible" | "fact_only";

export type IncidentEventTypeDef = {
  readonly key: string;
  /** 画面の名称。 */
  readonly label: string;
  /** 選択肢の下に出す短い説明（無ければ null）。 */
  readonly description: string | null;
  readonly guidance: IncidentEventGuidance;
  /** この類型だけ原本と照合できていない（版の状態が confirmed でも「※要確認」を付ける）。 */
  readonly unconfirmed?: boolean;
  /** 出典の記録と照合のためだけの参考（画面・目安の出力に出さない）。 */
  readonly reference?: string;
};

export type IncidentGuidanceRevisionStatus = "unconfirmed" | "confirmed";

export type IncidentGuidanceRevisionData = {
  readonly revision: number;
  readonly status: IncidentGuidanceRevisionStatus;
  /** 出典（資料の名称と照合の状態。URL・条番号は書かない）。 */
  readonly source: string;
  /** N4 の「類型は〜に基づきます」の資料の名称。 */
  readonly basis: string;
  /** 原本と照合した日（YYYY-MM-DD）と確認者。未照合は null。 */
  readonly confirmedOn: string | null;
  readonly confirmedBy: string | null;
  /** 類型（表示の順）。特別な値 none・unknown は含めない（共通）。 */
  readonly eventTypes: readonly IncidentEventTypeDef[];
  /** 目安の案内の文（2 段）。 */
  readonly guidanceText: { readonly possible: string; readonly none_selected: string };
  /** 特別な値の名称と説明。 */
  readonly noneLabel: string;
  readonly noneDescription: string;
  readonly unknownLabel: string;
  readonly unknownDescription: string;
};

/**
 * 版 1（出荷時）。一次資料（国土交通省航空局の報告要領の原本）と照合済み（docs/references/accident-report-primary-sources.md A〜C）。
 * 重傷と軽傷の境目は要領に定義がないため、アプリは判定しない（N7）。参考の区分（reference）は出典の記録のためだけで、画面・目安の出力に出さない。
 */
export const INCIDENT_GUIDANCE_REVISION_1: IncidentGuidanceRevisionData = {
  revision: 1,
  status: "confirmed",
  source: "国土交通省航空局『無人航空機の事故及び重大インシデントの報告要領』（令和4年11月4日制定）。2026-10-22 原本照合",
  basis: "国土交通省の報告要領（令和4年11月4日制定）",
  confirmedOn: "2026-10-22",
  confirmedBy: "ユーザー（原本の取得と照合）",
  eventTypes: [
    {
      key: "death_or_serious_injury",
      label: "人の死傷（重傷以上）",
      description:
        "操縦者や関係者のけがも含みます。悪天候などの外的な要因によるけがも含みます。けがの重さが分からないときは、この類型か『人の負傷（軽傷）』のうち重い方を選んでください。",
      guidance: "possible",
      reference: "accident_3_1_a",
    },
    {
      key: "minor_injury",
      label: "人の負傷（軽傷）",
      description: "重傷以上を除くけがです。地上で待機・移動しているときのけが（回転中のプロペラに触れたなど）も含みます。",
      guidance: "possible",
      reference: "serious_incident_3_2_b",
    },
    {
      key: "property_damage",
      label: "第三者の物件の損壊（軽微なものも含む）",
      description:
        "他人が所有する物（建物・車・設備など）を傷つけた場合です。瓦のひび割れや壁の傷などの軽微なものも含みます。他人が所有する無人航空機とぶつかった場合も含みます。",
      guidance: "possible",
      reference: "accident_3_1_a_6_1",
    },
    {
      key: "aircraft_collision",
      label: "航空機との衝突・接触（機体に損傷）",
      description: "航空機と衝突・接触し、どちらかまたは両方の機体に損傷が確認できる場合です。",
      guidance: "possible",
      reference: "accident_3_1_b",
    },
    {
      key: "near_collision",
      label: "航空機との衝突・接触のおそれ（回避の措置をとったもの）",
      description: "航空機との衝突・接触のおそれがあり、無人航空機を地上に降ろすなどの回避の措置をとった場合です。",
      guidance: "possible",
      reference: "serious_incident_3_2_a",
    },
    {
      key: "loss_of_control_malfunction",
      label: "機体の不具合による制御不能（これによる紛失を含む）",
      description:
        "通信の障害（通信できる範囲から出た場合を除く）、想定しないバッテリー切れ、機体や装備品の機能の不良などで、飛行中に制御できなくなった場合です。これにより機体を紛失した場合も含みます。",
      guidance: "possible",
      reference: "serious_incident_3_2_c",
    },
    {
      key: "fire_in_flight",
      label: "飛行中の発火（推進装置が動いている間）",
      description: "飛行のために推進装置が動いている間に発火した場合です。保管中のバッテリーの発火は含みません。",
      guidance: "possible",
      reference: "serious_incident_3_2_d",
    },
    {
      key: "loss_by_operation",
      label: "操縦ミスなどによる操縦不能・機体の紛失（機体の不具合によらないもの）",
      description:
        "国土交通省の報告要領では、操縦ミス（通信できる範囲から出た、バッテリー残量の確認不足、急な旋回による失速、気象の確認不足で風にあおられた など）による操縦不能は、制御不能には当たらないとされています。機体の不具合かどうか分からないときは『機体の不具合による制御不能』か『まだ分からない』を選んでください。けがや物の損壊、発火があったときは、その類型も選んでください。",
      guidance: "fact_only",
      reference: "fact_only_3_2_c_proviso",
    },
  ],
  guidanceText: {
    possible:
      "報告の対象になる可能性があります。報告は、DIPS 2.0 の『事故等の報告』から、操縦者が速やかに行います（そらばんは送信しません）。DIPS 2.0 で報告できないやむを得ない場合は、国土交通省の報告要領に定める方法（様式による電話・電子メール）で報告できます。",
    none_selected:
      "入力の範囲では、報告の対象になりうる事象は選ばれていません。報告が必要かどうかは、念のため国土交通省の報告要領で確認してください。",
  },
  noneLabel: "どれにも当たらない（ヒヤリハットなど）",
  noneDescription: "けが・物の損壊・航空機との接近・制御不能・発火のどれもなかったときに選んでください。",
  unknownLabel: "まだ分からない",
  unknownDescription: "起きたことがまだはっきりしないときに選んでください。分かったら訂正で類型を選び直せます。",
};

/** 版の一覧（古い版も消さない。過去の記録は保存した版で読む）。 */
export const INCIDENT_GUIDANCE_REVISIONS: readonly IncidentGuidanceRevisionData[] = [INCIDENT_GUIDANCE_REVISION_1];
/** いま使う版。 */
export const INCIDENT_GUIDANCE_REVISION = 1;

export type GuidanceTable = readonly IncidentGuidanceRevisionData[];

/** 版のデータを引く（無ければ例外。保存された版が一覧から消えることはない前提）。 */
export const guidanceRevisionOf = (revision: number = INCIDENT_GUIDANCE_REVISION, table: GuidanceTable = INCIDENT_GUIDANCE_REVISIONS): IncidentGuidanceRevisionData => {
  const r = table.find((x) => x.revision === revision);
  if (!r) throw new Error(`事象の類型のデータの版 ${revision} がありません`);
  return r;
};

/** 表示に「※要確認」を付けるか（版が未照合か、類型が個別に未照合）。 */
const needsMark = (rev: IncidentGuidanceRevisionData, t?: IncidentEventTypeDef): boolean => rev.status === "unconfirmed" || t?.unconfirmed === true;

function withMark(text: string, mark: boolean): string;
function withMark(text: string | null, mark: boolean): string | null;
function withMark(text: string | null, mark: boolean): string | null {
  return text === null ? null : mark ? `${text}${UNCONFIRMED_MARK}` : text;
}

export type EventTypeOption = {
  readonly key: string;
  readonly label: string;
  /** 選択肢の下に出す説明（未照合の版・類型は末尾に「※要確認」）。 */
  readonly description: string | null;
  /** 他と一緒に選べない（none・unknown）。 */
  readonly exclusive: boolean;
  readonly unconfirmed: boolean;
};

/** 画面の選択肢（版の類型の順、最後に「どれにも当たらない」「まだ分からない」）。初期値は置かない（選択の状態は持たない）。 */
export const eventTypeOptions = (revision: number = INCIDENT_GUIDANCE_REVISION, table: GuidanceTable = INCIDENT_GUIDANCE_REVISIONS): EventTypeOption[] => {
  const rev = guidanceRevisionOf(revision, table);
  const mark = needsMark(rev);
  return [
    ...rev.eventTypes.map((t) => ({
      key: t.key,
      label: t.label,
      description: withMark(t.description, needsMark(rev, t)),
      exclusive: false,
      unconfirmed: needsMark(rev, t),
    })),
    { key: EVENT_TYPE_NONE, label: rev.noneLabel, description: withMark(rev.noneDescription, mark), exclusive: true, unconfirmed: mark },
    { key: EVENT_TYPE_UNKNOWN, label: rev.unknownLabel, description: withMark(rev.unknownDescription, mark), exclusive: true, unconfirmed: mark },
  ];
};

/** 類型のキーの、その版での表示名（版にないキーはキーのまま）。 */
export const eventTypeLabel = (key: string, revision: number = INCIDENT_GUIDANCE_REVISION, table: GuidanceTable = INCIDENT_GUIDANCE_REVISIONS): string => {
  const rev = guidanceRevisionOf(revision, table);
  if (key === EVENT_TYPE_NONE) return rev.noneLabel;
  if (key === EVENT_TYPE_UNKNOWN) return rev.unknownLabel;
  return rev.eventTypes.find((x) => x.key === key)?.label ?? key;
};

/** 類型のキーの、その版での説明（未照合の版・類型は末尾に「※要確認」。版にないキーは null）。 */
export const eventTypeDescription = (key: string, revision: number = INCIDENT_GUIDANCE_REVISION, table: GuidanceTable = INCIDENT_GUIDANCE_REVISIONS): string | null =>
  eventTypeOptions(revision, table).find((o) => o.key === key)?.description ?? null;

/** その版で選べる値（類型のキーと none・unknown）。 */
export const eventTypeKeysOf = (revision: number = INCIDENT_GUIDANCE_REVISION, table: GuidanceTable = INCIDENT_GUIDANCE_REVISIONS): string[] => [
  ...guidanceRevisionOf(revision, table).eventTypes.map((t) => t.key),
  EVENT_TYPE_NONE,
  EVENT_TYPE_UNKNOWN,
];

/** けがの重さの類型（けががある＝けがの類型か「まだ分からない」が要る）。 */
export const INJURY_EVENT_TYPES = ["death_or_serious_injury", "minor_injury"] as const;

// ---- 目安（2 段） ---------------------------------------------------------------------------

export type IncidentGuidanceLevel = "possible" | "none_selected";

export type IncidentGuidance = {
  readonly level: IncidentGuidanceLevel;
  readonly revision: number;
  /** possible に倒した類型のキー（unknown を含む）。 */
  readonly reasons: readonly string[];
  readonly source: string;
  readonly status: IncidentGuidanceRevisionStatus;
  /** 目安の案内の文（データの版から。未照合の版は「※要確認」付き）。 */
  readonly text: string;
};

/**
 * 目安を計算する。possible に倒す類型を 1 つでも選ぶか、unknown なら possible。それ以外（fact_only だけ・none だけ）は none_selected。
 * 区分（事故・ヒヤリハット等）は使わない（類型だけで決める）。版にないキーは分からないものとして possible の側に倒す。
 * 空の配列（未選択）も possible の側に倒す（保存は検査が止める）。
 */
export const incidentGuidance = (
  eventTypes: readonly string[],
  revision: number = INCIDENT_GUIDANCE_REVISION,
  table: GuidanceTable = INCIDENT_GUIDANCE_REVISIONS,
): IncidentGuidance => {
  const rev = guidanceRevisionOf(revision, table);
  const reasons: string[] = [];
  for (const k of eventTypes) {
    if (k === EVENT_TYPE_NONE) continue;
    if (k === EVENT_TYPE_UNKNOWN) {
      reasons.push(k);
      continue;
    }
    const t = rev.eventTypes.find((x) => x.key === k);
    if (!t || t.guidance === "possible") reasons.push(k);
  }
  const level: IncidentGuidanceLevel = reasons.length > 0 || eventTypes.length === 0 ? "possible" : "none_selected";
  return {
    level,
    revision: rev.revision,
    reasons,
    source: rev.source,
    status: rev.status,
    text: guidanceTextOf(level, rev.revision, table),
  };
};

/** 目安の案内の文（版のデータから。未照合の版は「※要確認」付き）。 */
export const guidanceTextOf = (level: IncidentGuidanceLevel, revision: number = INCIDENT_GUIDANCE_REVISION, table: GuidanceTable = INCIDENT_GUIDANCE_REVISIONS): string => {
  const rev = guidanceRevisionOf(revision, table);
  return needsMark(rev) ? `${rev.guidanceText[level]}${UNCONFIRMED_MARK}` : rev.guidanceText[level];
};

/** N4（目安の注意）：共通部分＋出典と照合の状態（データの版から）。 */
export const incidentGuidanceNote = (revision: number = INCIDENT_GUIDANCE_REVISION, table: GuidanceTable = INCIDENT_GUIDANCE_REVISIONS): string => {
  const rev = guidanceRevisionOf(revision, table);
  const text = `${INCIDENT_GUIDANCE_NOTICE_BASE}類型は${rev.basis}に基づきます。`;
  return needsMark(rev) ? `${text}${UNCONFIRMED_MARK}` : text;
};

/** 目安の短い表示（文字と記号。色だけで区別しない）。 */
export const INCIDENT_GUIDANCE_LABEL: Readonly<Record<IncidentGuidanceLevel, { readonly label: string; readonly mark: string }>> = {
  possible: { label: "報告の対象になる可能性があります", mark: "！" },
  none_selected: { label: "選ばれた事象はありません", mark: "－" },
};

export const GUIDANCE_STATUS_LABEL: Readonly<Record<IncidentGuidanceRevisionStatus, string>> = {
  confirmed: "原本照合済み",
  unconfirmed: `原本照合前（${UNCONFIRMED_MARK}）`,
};

// ---- 国への報告の記録 ------------------------------------------------------------------------

export const INCIDENT_REPORT_ACTIONS = ["reported", "consulted", "retract"] as const;
export type IncidentReportAction = (typeof INCIDENT_REPORT_ACTIONS)[number];
export const INCIDENT_REPORT_ACTION_LABEL: Readonly<Record<IncidentReportAction, string>> = {
  reported: "報告した（利用者の申告）",
  consulted: "報告の要否を確かめた（利用者の申告）",
  retract: "取り下げ",
};

export const INCIDENT_REPORT_CHANNELS = ["dips", "other"] as const;
export type IncidentReportChannel = (typeof INCIDENT_REPORT_CHANNELS)[number];
export const INCIDENT_REPORT_CHANNEL_LABEL: Readonly<Record<IncidentReportChannel, string>> = { dips: "DIPS 2.0", other: "その他" };

/** 確認のチェック（すべて真でないと保存できない）。 */
export const INCIDENT_REPORT_CHECK_LABEL = {
  reportCompleted: "DIPS 2.0 などで事故等の報告を完了した",
  consultationDone: "報告の要否を国土交通省などに確かめた",
} as const;
export const INCIDENT_REPORT_REFERENCE_ABSENT_LABEL = "番号が表示されなかった";
/** consulted の note の近く（氏名を書かない旨）。 */
export const INCIDENT_CONSULT_NOTE_HINT = "確かめた相手（部署など）と結果の要点を書いてください。相手の氏名は書かないでください。";

/** 報告の状態（行から毎回導出する）。 */
export type IncidentReportStateCode = "none" | "reported" | "consulted";
export const INCIDENT_REPORT_STATE_LABEL: Readonly<Record<IncidentReportStateCode, { readonly label: string; readonly mark: string }>> = {
  none: { label: "報告の記録なし", mark: "○" },
  reported: { label: "報告の記録あり（利用者の申告）", mark: "✓" },
  consulted: { label: "要否を確かめた記録あり（利用者の申告）", mark: "✓" },
};

// ---- 経路・端末の保存 ---------------------------------------------------------------------------

export const incidentHref = (id: string, anchor?: "report" | "correct"): string => `/ops/incidents/${id}${anchor ? `#${anchor}` : ""}`;
export const INCIDENTS_HREF = "/ops/incidents";
/** 入力画面（?planId・?flightRecordId・?summary は画面側で初期値に入れるだけ）。 */
export const incidentNewHref = (q: { readonly planId?: string | null; readonly flightRecordId?: string | null; readonly summary?: string | null } = {}): string => {
  const p = new URLSearchParams();
  if (q.planId) p.set("planId", q.planId);
  if (q.flightRecordId) p.set("flightRecordId", q.flightRecordId);
  if (q.summary) p.set("summary", q.summary);
  const s = p.toString();
  return `/ops/incidents/new${s ? `?${s}` : ""}`;
};
export const incidentQuickHref = (planId: string): string => `/ops/plans/${planId}/field/incident`;

/** 現場の簡易記録の送信待ちのキーの接頭辞（drafts.ts の soraban:ops-draft: の配下。clearOtherUsersDrafts が他の利用者の分を消す）。 */
export const INCIDENT_OUTBOX_KEY_PREFIX = "soraban:ops-draft:incident-";
/** 計画ごと・利用者ごとの送信待ちのキー。例：soraban:ops-draft:incident-<計画の ID>:<利用者の ID> */
export const incidentOutboxKey = (planId: string, memberId: string): string => `${INCIDENT_OUTBOX_KEY_PREFIX}${planId}:${memberId}`;

/** 事故・ヒヤリハットの API の誤り（error コード）→ 利用者に見せる理由。 */
export const INCIDENT_ERROR_MESSAGE: Readonly<Record<string, string>> = {
  clock_skew: "端末の時刻がずれています。時刻の設定（自動）を確かめてください。",
  future_time: "時刻が現在より先になっています。時刻を確かめてください。",
  too_old: "記録してから時間が経ちすぎたため送れません。「あとから入力」で詳しい入力画面から記録してください。",
  request_conflict: "同じ識別子で内容の違う記録があります。",
  version_conflict: "ほかの人が先に更新しました。読み直してから、もう一度入力してください。",
  voided: "この記録は取り消されています。",
  already_retracted: "この報告の記録はすでに取り下げられています。",
  invalid_target: "取り下げる記録が正しくありません。",
  not_found: "記録が見つかりません。",
  forbidden: "この操作を行う権限がありません。",
  invalid_input: "入力が正しくありません。",
};

export const incidentErrorMessage = (code: string): string => INCIDENT_ERROR_MESSAGE[code] ?? "送れませんでした。";
