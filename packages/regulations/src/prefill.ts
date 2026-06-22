// DIPS 入力プリフィル ＋ 独自飛行マニュアル骨子ドラフト（Sprint 3）。
//
// docs/spec.md §1.2 ゴール④⑤・§6 データモデル（PrefillField）・§10-5（標準マニュアル
// 本文は転載しない）を実装する。
//
// 設計の核:
//   - buildPrefillFields / buildFlightManualDraft は副作用のない純関数。
//     診断入力（座標・住所・飛行方法・機体重量 等）から、DIPS／DRS の入力欄に対応する
//     値の表（PrefillField[]）と、独自飛行マニュアルの骨子（構造化テキスト）を生成する。
//   - 値は実データを反映する（空ダミー禁止）。座標は度分秒でなく十進度の文字列。
//   - DRS（機体登録）と DIPS2.0（許可承認）で入力先が違う項目は system で区別し、
//     UI／PDF が「どちらのシステム向けか」を行で示せるようにする（別導線方針の維持）。
//   - マニュアル骨子テンプレは data/manual-templates/manual-templates.json（出典付き）で
//     保持し、コード直書きを避ける。標準マニュアル 01/02 の本文は転載しない。

import manualTemplatesData from "../data/manual-templates/manual-templates.json";
import {
  SPECIFIC_FLIGHT_FLAG_LABEL,
  type SpecificFlightFlag,
} from "./diagnosis";

// ── プリフィルの入力先システム（DRS と DIPS2.0 を別導線として区別）──
export type PrefillSystem = "DIPS2.0" | "DRS";

// PrefillField: DIPS／DRS のどの入力欄に、何を、どこ由来で入れるか（spec §6）。
//   - dipsFieldLabel … DIPS／DRS のどの入力欄か（ラベル）
//   - value          … コピペ用の値（実データ。空ダミー禁止）
//   - source         … どこから来た値か（判定 / 入力 / 既定）
//   - system         … 入力先システム（DRS か DIPS2.0 か）。別導線で案内するため必須。
export type PrefillField = {
  readonly dipsFieldLabel: string;
  readonly value: string;
  readonly source: string;
  readonly system: PrefillSystem;
};

export type BuildPrefillInput = {
  /** 判定地点の緯度（十進度） */
  readonly lat: number;
  /** 判定地点の経度（十進度） */
  readonly lng: number;
  /** 逆ジオコーディング等で解決した住所（あれば） */
  readonly resolvedAddress?: string;
  /** ユーザーが選んだ飛行方法 + 判定由来の空域フラグ */
  readonly flags: readonly SpecificFlightFlag[];
  /** 機体重量 (g)。100g 以上で登録対象。 */
  readonly droneWeightG?: number;
  /** 飛行予定日（ISO 日付 YYYY-MM-DD） */
  readonly plannedDate?: string;
  /** 立入管理措置の有無（カテゴリー切り分け） */
  readonly accessControl?: boolean;
  /** 第三者上空か（III＝レベル4） */
  readonly thirdPartyOverflight?: boolean;
  /** 目視外: 補助者の有無 */
  readonly bvlosWithObserver?: boolean;
};

// 十進度の座標を、入力欄に貼りやすい固定桁の文字列にする（過剰桁を避ける）。
const formatCoord = (n: number): string => {
  if (!Number.isFinite(n)) return "";
  return n.toFixed(6);
};

// 飛行方法フラグ群を、申請区分（夜間・目視外…）の日本語ラベル列に変換する。
// 空域フラグも飛行の前提条件として含める（DIPS の「飛行の種類」欄に対応）。
const flagsToMethodLabels = (
  flags: readonly SpecificFlightFlag[],
): readonly string[] => {
  // SPECIFIC_FLIGHT_FLAG_LABEL のキー順（UI と同じ並び）で安定化する。
  const order = Object.keys(SPECIFIC_FLIGHT_FLAG_LABEL) as SpecificFlightFlag[];
  const set = new Set(flags);
  return order.filter((f) => set.has(f)).map((f) => SPECIFIC_FLIGHT_FLAG_LABEL[f]);
};

// 航空法上の無人航空機（100g 以上）か。未指定はフェイルセーフで対象扱い（厳しい側）。
const isRegisteredDroneWeight = (g: number | undefined): boolean => {
  if (typeof g !== "number" || !Number.isFinite(g)) return true;
  return g >= 100;
};

/**
 * 診断入力から DIPS／DRS 入力プリフィル表（PrefillField[]）を生成する純関数。
 *
 * 生成方針:
 *   - 値は実データを反映（空ダミー禁止）。該当しない項目は「未選択」等の意味のある
 *     既定値を入れ、行自体は出す（コピペ運用で「ここは空でよい」と分かるように）。
 *   - DRS（機体登録）行と DIPS2.0（許可承認）行を system で区別する。
 */
export const buildPrefillFields = (
  input: BuildPrefillInput,
): readonly PrefillField[] => {
  const fields: PrefillField[] = [];
  const methodLabels = flagsToMethodLabels(input.flags);
  const registered = isRegisteredDroneWeight(input.droneWeightG);

  // ── DRS（機体登録）系の入力欄 ──
  // 機体重量は DRS の登録要否判定そのものなので、まず登録系に置く。
  fields.push({
    dipsFieldLabel: "機体の重量区分（DRS 登録要否）",
    value: registered
      ? input.droneWeightG !== undefined
        ? `${input.droneWeightG} g（100g 以上 → 登録対象）`
        : "未指定（100g 以上として扱い登録対象）"
      : `${input.droneWeightG} g（100g 未満 → 航空法上の無人航空機に非該当）`,
    source: input.droneWeightG !== undefined ? "入力（機体重量）" : "既定（フェイルセーフ＝厳しい側）",
    system: "DRS",
  });
  fields.push({
    dipsFieldLabel: "リモートID 搭載（DRS）",
    value: registered
      ? "原則搭載義務（特定区分の例外を除く）"
      : "対象外（100g 未満）",
    source: "既定（制度上の原則）",
    system: "DRS",
  });

  // ── DIPS2.0（飛行許可・承認）系の入力欄 ──
  // 飛行範囲（地点）。十進度の緯度・経度を別行で出し、住所があれば併記行も出す。
  fields.push({
    dipsFieldLabel: "飛行範囲の緯度（十進度）",
    value: formatCoord(input.lat),
    source: "入力（判定地点）",
    system: "DIPS2.0",
  });
  fields.push({
    dipsFieldLabel: "飛行範囲の経度（十進度）",
    value: formatCoord(input.lng),
    source: "入力（判定地点）",
    system: "DIPS2.0",
  });
  fields.push({
    dipsFieldLabel: "飛行範囲（住所・地名）",
    value:
      input.resolvedAddress && input.resolvedAddress.trim().length > 0
        ? input.resolvedAddress
        : `緯度 ${formatCoord(input.lat)} / 経度 ${formatCoord(input.lng)} 付近（住所未解決）`,
    source: input.resolvedAddress ? "判定（住所解決）" : "入力（座標から補完）",
    system: "DIPS2.0",
  });

  // 飛行の種類（飛行方法・空域）。承認・許可の対象になる飛行を列挙する。
  fields.push({
    dipsFieldLabel: "飛行の種類（特定飛行の区分）",
    value:
      methodLabels.length > 0
        ? methodLabels.join("、")
        : "特定飛行に非該当（許可・承認の対象なし）",
    source: "入力／判定（飛行方法・空域フラグ）",
    system: "DIPS2.0",
  });

  // 目視外を選んでいる場合、補助者の有無は運航条件に効くので明示行を出す。
  if (input.flags.includes("method_bvlos")) {
    fields.push({
      dipsFieldLabel: "目視外飛行の補助者配置",
      value:
        input.bvlosWithObserver === undefined
          ? "未選択（補助者の有無を確認してください）"
          : input.bvlosWithObserver
            ? "補助者あり"
            : "補助者なし（より上位の運航要件）",
      source: "入力（運航条件）",
      system: "DIPS2.0",
    });
  }

  // 立入管理措置の有無（カテゴリー II / III 切り分けに対応）。
  fields.push({
    dipsFieldLabel: "立入管理措置（第三者上空の別）",
    value:
      input.thirdPartyOverflight === true
        ? "立入管理措置なし＝第三者上空（カテゴリー III／レベル4）"
        : input.accessControl === true
          ? "立入管理措置あり（第三者の上空で飛行させない）"
          : "未選択（カテゴリー切り分けのため選択してください）",
    source: "入力（立入管理措置）",
    system: "DIPS2.0",
  });

  // 飛行予定日（飛行期間の開始日に対応）。
  fields.push({
    dipsFieldLabel: "飛行予定日（飛行期間の開始日）",
    value:
      input.plannedDate && input.plannedDate.trim().length > 0
        ? input.plannedDate
        : "未入力（飛行予定日を入力してください）",
    source: input.plannedDate ? "入力（飛行予定日）" : "既定（未入力）",
    system: "DIPS2.0",
  });

  return fields;
};

// ============================================================
// 独自飛行マニュアル骨子ドラフト（標準マニュアル本文は転載しない）
// ============================================================

// data/manual-templates のスキーマ（型検証つき）。
type RawBaseSection = {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly outline?: unknown;
};
type RawMethodSection = {
  readonly flag?: unknown;
  readonly title?: unknown;
  readonly outline?: unknown;
  readonly points?: unknown;
  readonly legalBasis?: unknown;
  readonly sourceUrl?: unknown;
};

export type ManualBaseSection = {
  readonly id: string;
  readonly title: string;
  readonly outline: string;
};
export type ManualMethodSection = {
  readonly flag: SpecificFlightFlag;
  readonly title: string;
  readonly outline: string;
  readonly points: readonly string[];
  readonly legalBasis: string;
  readonly sourceUrl: string;
};

const VALID_FLAGS: ReadonlySet<SpecificFlightFlag> = new Set(
  Object.keys(SPECIFIC_FLIGHT_FLAG_LABEL) as SpecificFlightFlag[],
);

const MANUAL_BASE_SECTIONS: readonly ManualBaseSection[] = (() => {
  const raw =
    (manualTemplatesData as { baseSections?: readonly RawBaseSection[] }).baseSections ?? [];
  const out: ManualBaseSection[] = [];
  for (const s of raw) {
    if (typeof s.id !== "string" || s.id.length === 0) continue;
    if (typeof s.title !== "string" || s.title.length === 0) continue;
    if (typeof s.outline !== "string" || s.outline.length === 0) continue;
    out.push({ id: s.id, title: s.title, outline: s.outline });
  }
  return out;
})();

const MANUAL_METHOD_SECTIONS: ReadonlyMap<SpecificFlightFlag, ManualMethodSection> = (() => {
  const raw =
    (manualTemplatesData as { methodSections?: readonly RawMethodSection[] }).methodSections ?? [];
  const map = new Map<SpecificFlightFlag, ManualMethodSection>();
  for (const s of raw) {
    if (typeof s.flag !== "string" || !VALID_FLAGS.has(s.flag as SpecificFlightFlag)) continue;
    if (typeof s.title !== "string" || s.title.length === 0) continue;
    if (typeof s.outline !== "string" || s.outline.length === 0) continue;
    if (typeof s.legalBasis !== "string" || s.legalBasis.length === 0) continue;
    if (typeof s.sourceUrl !== "string" || s.sourceUrl.length === 0) continue;
    const points =
      Array.isArray(s.points) && s.points.every((p) => typeof p === "string")
        ? (s.points as readonly string[])
        : [];
    map.set(s.flag as SpecificFlightFlag, {
      flag: s.flag as SpecificFlightFlag,
      title: s.title,
      outline: s.outline,
      points,
      legalBasis: s.legalBasis,
      sourceUrl: s.sourceUrl,
    });
  }
  return map;
})();

// 標準マニュアルの参照情報（本文は持たない。参照先 URL と「使用する旨」のラベルだけ）。
type RawStandardRef = {
  readonly label?: unknown;
  readonly note?: unknown;
  readonly sourceUrl?: unknown;
};
export type StandardManualReference = {
  readonly label: string;
  readonly note: string;
  readonly sourceUrl: string;
};
export const STANDARD_MANUAL_REFERENCE: StandardManualReference = (() => {
  const raw = (manualTemplatesData as { standardManualReference?: RawStandardRef })
    .standardManualReference;
  const label = typeof raw?.label === "string" ? raw.label : "航空局 標準マニュアル（01／02）";
  const note = typeof raw?.note === "string" ? raw.note : "";
  const sourceUrl =
    typeof raw?.sourceUrl === "string" && raw.sourceUrl.length > 0
      ? raw.sourceUrl
      : "https://www.mlit.go.jp/koku/koku_tk10_000003.html";
  return { label, note, sourceUrl };
})();

export const ALL_MANUAL_BASE_SECTIONS = MANUAL_BASE_SECTIONS;
export const ALL_MANUAL_METHOD_SECTIONS: readonly ManualMethodSection[] = Array.from(
  MANUAL_METHOD_SECTIONS.values(),
);

// マニュアルの作成方針（標準を使う／独自を作る）。
export type ManualChoice = "standard" | "custom";

// 飛行マニュアル骨子ドラフトの構造化結果。
//   - choice="standard": 標準マニュアルを使用する旨と参照先のみ。本文・骨子は出さない。
//   - choice="custom":   独自マニュアルの骨子（基本章 + 該当飛行方法の追記観点）を出す。
export type FlightManualDraft = {
  readonly choice: ManualChoice;
  /** 標準マニュアル参照（choice に関わらず参照情報として保持） */
  readonly standardReference: StandardManualReference;
  /** 独自マニュアルの基本章（custom のときのみ非空） */
  readonly baseSections: readonly ManualBaseSection[];
  /** 該当する飛行方法ごとの追記観点（custom のときのみ非空） */
  readonly methodSections: readonly ManualMethodSection[];
  /** 標準を選んだ場合の説明文（custom のときは空文字） */
  readonly standardNotice: string;
};

export type BuildManualInput = {
  readonly choice: ManualChoice;
  readonly flags: readonly SpecificFlightFlag[];
};

/**
 * 飛行方法・選択（標準／独自）から飛行マニュアル骨子ドラフトを生成する純関数。
 *
 * 標準を選んだ場合は『標準マニュアルを使用する旨』と参照先のみを返し、本文は出さない
 * （著作権配慮・spec §10-5）。独自を選んだ場合は基本章 + 該当飛行方法の追記観点（骨子）を
 * 構造化データから組み立てて返す。
 */
export const buildFlightManualDraft = (
  input: BuildManualInput,
): FlightManualDraft => {
  if (input.choice === "standard") {
    return {
      choice: "standard",
      standardReference: STANDARD_MANUAL_REFERENCE,
      baseSections: [],
      methodSections: [],
      standardNotice:
        `${STANDARD_MANUAL_REFERENCE.label} を使用します。` +
        "標準マニュアルを使用する場合、独自の飛行マニュアルを作成する必要はありません。" +
        "申請時に『航空局標準マニュアルを使用』を選択してください。" +
        "本ツールは標準マニュアルの本文を転載しません。最新の本文・適用条件は出典でご確認ください。",
    };
  }

  // 独自マニュアル: 該当する飛行方法の追記観点を、SPECIFIC_FLIGHT_FLAG_LABEL の順で安定化。
  const order = Object.keys(SPECIFIC_FLIGHT_FLAG_LABEL) as SpecificFlightFlag[];
  const set = new Set(input.flags);
  const methodSections = order
    .filter((f) => set.has(f))
    .map((f) => MANUAL_METHOD_SECTIONS.get(f))
    .filter((s): s is ManualMethodSection => s !== undefined);

  return {
    choice: "custom",
    standardReference: STANDARD_MANUAL_REFERENCE,
    baseSections: MANUAL_BASE_SECTIONS,
    methodSections,
    standardNotice: "",
  };
};

/**
 * 飛行マニュアル骨子ドラフトをプレーンテキストに整形する（PDF・コピペ・テキスト表示用）。
 * 標準を選んだ場合は通知文 + 参照先のみ。独自の場合は章立てと骨子の箇条書き。
 */
export const formatManualDraftText = (draft: FlightManualDraft): string => {
  const lines: string[] = [];
  lines.push("■ 飛行マニュアル（ドラフト）");
  lines.push("");
  if (draft.choice === "standard") {
    lines.push("【選択】航空局 標準マニュアル（01／02）を使用");
    lines.push(draft.standardNotice);
    lines.push("");
    lines.push(`参照: ${draft.standardReference.label}`);
    lines.push(`出典: ${draft.standardReference.sourceUrl}`);
    return lines.join("\n");
  }

  lines.push("【選択】独自飛行マニュアルを作成（骨子ドラフト）");
  lines.push(
    "※ 本骨子は記載すべき項目の見出しと観点であり、航空局 標準マニュアル01／02 の本文は含みません（著作権配慮）。",
  );
  lines.push("");
  lines.push("── 基本構成 ──");
  for (const s of draft.baseSections) {
    lines.push(s.title);
    lines.push(`　${s.outline}`);
  }
  if (draft.methodSections.length > 0) {
    lines.push("");
    lines.push("── 選択した飛行方法に応じて追記する観点 ──");
    for (const m of draft.methodSections) {
      lines.push(m.title);
      for (const p of m.points) {
        lines.push(`　・${p}`);
      }
      lines.push(`　（根拠: ${m.legalBasis} ／ 出典: ${m.sourceUrl}）`);
    }
  }
  return lines.join("\n");
};
