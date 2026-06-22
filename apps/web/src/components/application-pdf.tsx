"use client";

import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import {
  getCategoryDefinition,
  REQUIRED_PROCEDURE_KIND_LABEL,
  type DiagnosisCategory,
  type FlightManualDraft,
  type PrefillField,
  type RequiredProcedure,
} from "@soraban/regulations";
import type { DiagnoseResponse } from "@/lib/diagnose";
import { MonoText } from "./pdf-mono-text";

// 束ね PDF（申請支援サマリ）。既存 regulation-pdf.tsx の作法に合わせる:
//   - 日本語グリフは self-host の Noto Sans JP（apps/web/public/fonts/*.ttf）を登録。
//   - 等幅は IBM Plex Mono（evidenceId・座標・系統名）。
//   - デザイントークンと整合する色定義を共有。
//   - 既存の単発判定 PDF（RegulationPdfDocument）は壊さず、本コンポーネントを新規に追加する。
//
// 束ねる内容（spec §1.2 ⑥ / sprint-3 契約）:
//   ① カテゴリー切り分け ② 必要手続きチェックリスト ③ 提出期限カレンダー
//   ④ DIPS／DRS 入力プリフィル表 ⑤ 書類ドラフト（飛行マニュアル骨子）
//   ⑥ DRS と DIPS2.0 の別導線 ⑦ 免責文 ⑧ 各手続きの出典 URL ⑨ evidenceId（メタ/ファイル名）

const fontUrl = (file: string): string => {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/fonts/${file}`;
  }
  return `/fonts/${file}`;
};

Font.register({
  family: "Noto Sans JP",
  fonts: [
    { src: fontUrl("NotoSansJP-Regular.ttf"), fontWeight: 400 },
    { src: fontUrl("NotoSansJP-Bold.ttf"), fontWeight: 700 },
  ],
});
Font.register({
  family: "IBM Plex Mono",
  fonts: [
    { src: fontUrl("IBMPlexMono-Regular.ttf"), fontWeight: 400 },
    { src: fontUrl("IBMPlexMono-Medium.ttf"), fontWeight: 500 },
  ],
});

const COLOR = {
  paper: "#F5F2EA",
  ink: "#0E1421",
  inkSoft: "#2A2F3A",
  inkMute: "#5B6170",
  rule: "#C9C2AD",
  brand: "#1D3557",
  brandSoft: "#E4E9F1",
  signalRed: "#B53A3A",
  signalAmber: "#B97E1E",
  signalGreen: "#3A7A4F",
};

// カテゴリー → 強調色。III（レベル4）は赤で最も強く。
const CATEGORY_ACCENT: Record<DiagnosisCategory, string> = {
  I: COLOR.signalGreen,
  II_A: COLOR.brand,
  II_B_eligible: COLOR.brand,
  III_level4: COLOR.signalRed,
};
const CATEGORY_HEADLINE: Record<DiagnosisCategory, string> = {
  I: "カテゴリー I（特定飛行に非該当）",
  II_A: "カテゴリー II（IIA 相当・申請が必要）",
  II_B_eligible: "カテゴリー II（IIB 相当・申請を不要化できる可能性）",
  III_level4: "カテゴリー III（レベル4・第三者上空）",
};

// プリフィルの系統バッジ枠色（DRS=墨 / DIPS2.0=藍）。
const SYSTEM_BORDER: Record<PrefillField["system"], string> = {
  DRS: COLOR.ink,
  "DIPS2.0": COLOR.brand,
};

const styles = StyleSheet.create({
  page: {
    padding: 36,
    paddingBottom: 48,
    fontFamily: "Noto Sans JP",
    fontSize: 9,
    color: COLOR.ink,
    backgroundColor: COLOR.paper,
  },
  eyebrow: {
    fontSize: 7,
    color: COLOR.inkMute,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  h1: { fontSize: 21, fontWeight: 700, marginBottom: 2 },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: COLOR.rule,
    fontFamily: "IBM Plex Mono",
    fontSize: 8,
    color: COLOR.inkMute,
  },
  metaCol: { flexDirection: "column", minWidth: 110 },
  metaLabel: {
    fontSize: 6,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: COLOR.inkMute,
    marginBottom: 1,
  },
  metaValue: { color: COLOR.ink, fontFamily: "IBM Plex Mono" },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginTop: 18,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR.rule,
  },
  // カテゴリーバナー
  categoryBanner: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderLeftWidth: 2,
    flexDirection: "column",
    gap: 3,
  },
  categoryHeadline: { fontSize: 13, fontWeight: 700 },
  categoryNote: { fontSize: 8.5, lineHeight: 1.5, color: COLOR.inkSoft },
  categorySource: {
    fontSize: 7,
    fontFamily: "IBM Plex Mono",
    color: COLOR.inkMute,
    marginTop: 2,
  },
  // 手続き
  procBlock: {
    marginTop: 6,
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderWidth: 0.5,
    borderColor: COLOR.rule,
    flexDirection: "column",
    gap: 3,
  },
  procHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  systemBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 6.5,
    fontWeight: 700,
    letterSpacing: 0.6,
    borderWidth: 0.5,
    fontFamily: "IBM Plex Mono",
  },
  procKind: { fontSize: 7.5, color: COLOR.inkMute },
  waivableBadge: {
    marginLeft: "auto",
    fontSize: 6.5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 0.5,
    borderColor: COLOR.rule,
    color: COLOR.inkMute,
  },
  procTitle: { fontSize: 10, fontWeight: 700 },
  procMeta: { fontSize: 7.5, color: COLOR.inkMute, lineHeight: 1.45 },
  procLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 2,
    fontFamily: "IBM Plex Mono",
    fontSize: 7,
    color: COLOR.brand,
  },
  // 期限カレンダー行
  deadlineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderLeftWidth: 1.5,
    marginTop: 3,
  },
  deadlineName: { fontSize: 9, fontWeight: 500, flex: 1 },
  deadlineDate: {
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "IBM Plex Mono",
  },
  hint: { fontSize: 7.5, color: COLOR.inkMute, marginTop: 4, lineHeight: 1.45 },
  // プリフィル表
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 0.8,
    borderBottomColor: COLOR.ink,
    paddingBottom: 3,
    marginTop: 6,
  },
  th: {
    fontSize: 6.5,
    fontFamily: "IBM Plex Mono",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: COLOR.inkMute,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.4,
    borderBottomColor: COLOR.rule,
  },
  colSys: { width: 42 },
  colLabel: { width: 130, paddingRight: 4 },
  colValue: { flex: 1, paddingRight: 4 },
  colSource: { width: 96 },
  cellLabel: { fontSize: 8, color: COLOR.inkSoft },
  cellValue: { fontSize: 8.5, fontWeight: 700, color: COLOR.ink },
  cellSource: { fontSize: 7, color: COLOR.inkMute },
  // マニュアルドラフト
  manualNotice: {
    fontSize: 8,
    lineHeight: 1.5,
    color: COLOR.inkSoft,
    borderLeftWidth: 1.5,
    borderLeftColor: COLOR.brand,
    paddingLeft: 8,
    paddingVertical: 4,
    marginTop: 6,
  },
  manualSectionTitle: { fontSize: 9, fontWeight: 700, marginTop: 6 },
  manualOutline: { fontSize: 7.5, color: COLOR.inkSoft, lineHeight: 1.45, marginTop: 1 },
  manualPoint: { fontSize: 7.5, color: COLOR.inkSoft, lineHeight: 1.45, marginLeft: 8 },
  manualSource: {
    fontSize: 6.5,
    fontFamily: "IBM Plex Mono",
    color: COLOR.inkMute,
    marginTop: 1,
    marginLeft: 8,
  },
  // 別導線
  portalRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  portalBox: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: COLOR.rule,
    padding: 8,
    flexDirection: "column",
    gap: 2,
  },
  portalLabel: { fontSize: 7, fontFamily: "IBM Plex Mono", color: COLOR.inkMute },
  portalUrl: { fontSize: 7.5, fontFamily: "IBM Plex Mono", color: COLOR.brand },
  disclaimer: {
    marginTop: 16,
    paddingLeft: 8,
    paddingVertical: 6,
    paddingRight: 8,
    borderLeftWidth: 1.5,
    borderLeftColor: COLOR.brand,
    fontSize: 8,
    lineHeight: 1.5,
    color: COLOR.inkSoft,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: COLOR.rule,
    flexDirection: "row",
    justifyContent: "space-between",
    fontFamily: "IBM Plex Mono",
    fontSize: 7,
    color: COLOR.inkMute,
  },
});

// 提出期限の逼迫度色（PDF 簡易版）。submitBy が無ければ none。
const deadlineColor = (
  submitBy: string | undefined,
  todayIso: string,
): string => {
  if (!submitBy) return COLOR.rule;
  // 暦日差で簡易判定（厳密な urgency 判定はUI側、PDFは色のみ）。
  const a = Date.parse(`${todayIso}T00:00:00Z`);
  const b = Date.parse(`${submitBy}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return COLOR.rule;
  const remainingDays = Math.round((b - a) / 86_400_000);
  if (remainingDays < 0) return COLOR.signalRed;
  if (remainingDays <= 7) return COLOR.signalAmber;
  return COLOR.signalGreen;
};

type Props = {
  readonly diagnosis: DiagnoseResponse;
  readonly manualDraft: FlightManualDraft;
  /** 飛行予定日（ISO）。空なら期限は未確定として案内。 */
  readonly plannedDate: string;
  /** 今日の ISO 日付（残り日数色の基準）。 */
  readonly todayIso: string;
};

export const ApplicationPdfDocument = ({
  diagnosis,
  manualDraft,
  plannedDate,
  todayIso,
}: Props) => {
  const accent = CATEGORY_ACCENT[diagnosis.category];
  const def = getCategoryDefinition(diagnosis.category);
  const deadlineMap = new Map(diagnosis.deadlines.map((d) => [d.procedureId, d]));
  const kindLabel = (p: RequiredProcedure): string =>
    REQUIRED_PROCEDURE_KIND_LABEL[p.kind];
  const deadlineItems = diagnosis.procedures.filter((p) => deadlineMap.has(p.id));

  return (
    <Document title={`Soraban 申請支援サマリ — ${diagnosis.evidenceId}`}>
      <Page size="A4" style={styles.page} wrap>
        {/* HEADER */}
        <View>
          <Text style={styles.eyebrow}>Soraban — DIPS Application Support Summary</Text>
          <Text style={styles.h1}>そらばん 申請支援サマリ（束ねレポート）</Text>
        </View>
        <View style={styles.metaRow}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Evidence ID</Text>
            <Text style={styles.metaValue}>{diagnosis.evidenceId}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Engine</Text>
            <Text style={styles.metaValue}>{diagnosis.engineVersion}</Text>
          </View>
          <View style={styles.metaCol}>
            <MonoText style={styles.metaLabel}>地点</MonoText>
            <Text style={styles.metaValue}>
              {diagnosis.lat.toFixed(6)}, {diagnosis.lng.toFixed(6)}
            </Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Checked at</Text>
            <MonoText style={styles.metaValue}>
              {new Date(diagnosis.checkedAt).toLocaleString("ja-JP")}
            </MonoText>
          </View>
        </View>

        {/* ① カテゴリー切り分け */}
        <View style={[styles.categoryBanner, { borderLeftColor: accent }]} wrap={false}>
          <Text style={styles.eyebrow}>カテゴリー切り分け</Text>
          <Text style={[styles.categoryHeadline, { color: accent }]}>
            {CATEGORY_HEADLINE[diagnosis.category]}
          </Text>
          <Text style={styles.categoryNote}>{diagnosis.categoryNote}</Text>
          {diagnosis.category === "III_level4" ? (
            <Text style={[styles.categoryNote, { color: COLOR.signalRed, fontWeight: 700 }]}>
              ※ 単純な飛行許可・承認の申請では実施できません。一等無人航空機操縦士 ＋ 第一種機体認証が必須です。
            </Text>
          ) : null}
          {diagnosis.category === "II_A" || diagnosis.category === "II_B_eligible" ? (
            <Text style={styles.categoryNote}>
              ※「IIA／IIB」の呼称が正式名称か運用通称かは要確認のため「相当」表記としています。
            </Text>
          ) : null}
          <MonoText style={styles.categorySource}>出典: {def.sourceUrl}</MonoText>
        </View>

        {/* ② 必要手続きチェックリスト */}
        <Text style={styles.sectionTitle}>
          必要手続きチェックリスト（{diagnosis.procedures.length} 件）
        </Text>
        {diagnosis.procedures.length === 0 ? (
          <Text style={styles.procMeta}>
            現在の入力では、航空法に基づく飛行許可・承認・登録の手続きは導出されませんでした。
          </Text>
        ) : (
          diagnosis.procedures.map((p) => (
            <View key={p.id} style={styles.procBlock} wrap={false}>
              <View style={styles.procHeader}>
                <Text
                  style={[
                    styles.systemBadge,
                    {
                      borderColor: p.system === "DRS" ? COLOR.ink : COLOR.brand,
                      color: p.system === "DRS" ? COLOR.ink : COLOR.brand,
                    },
                  ]}
                >
                  {p.system}
                </Text>
                <Text style={styles.procKind}>{kindLabel(p)}</Text>
                <Text style={styles.waivableBadge}>
                  {p.waivableByIIB ? "IIB 相当で不要化可" : "IIA 相当・不要化不可"}
                </Text>
              </View>
              <Text style={styles.procTitle}>{p.title}</Text>
              {p.note ? <Text style={styles.procMeta}>{p.note}</Text> : null}
              <Text style={styles.procMeta}>法的根拠: {p.legalBasis}</Text>
              <View style={styles.procLinks}>
                <MonoText>手続き（{p.system}）: {p.systemUrl}</MonoText>
                <MonoText>出典: {p.sourceUrl}</MonoText>
              </View>
            </View>
          ))
        )}

        {/* ③ 提出期限カレンダー */}
        <Text style={styles.sectionTitle}>提出期限カレンダー</Text>
        {plannedDate.trim().length === 0 ? (
          <Text style={styles.procMeta}>
            飛行予定日が未入力です。飛行日が決まると、各手続きの提出期限（飛行日 − 10 開庁日・土日祝を除く）を算出します。
          </Text>
        ) : deadlineItems.length === 0 ? (
          <Text style={styles.procMeta}>提出期限の逆算対象となる申請手続きはありません。</Text>
        ) : (
          <>
            <Text style={styles.procMeta}>起算日（飛行予定日）: {plannedDate}</Text>
            {deadlineItems.map((p) => {
              const d = deadlineMap.get(p.id);
              const color = deadlineColor(d?.submitBy, todayIso);
              return (
                <View
                  key={p.id}
                  style={[styles.deadlineRow, { borderLeftColor: color }]}
                  wrap={false}
                >
                  <Text style={styles.deadlineName}>
                    {p.title}（{p.leadTimeBusinessDays} 開庁日前まで）
                  </Text>
                  <Text style={[styles.deadlineDate, { color }]}>
                    {d?.submitBy ?? "—"}
                  </Text>
                </View>
              );
            })}
            <Text style={styles.hint}>
              ※ 「10 開庁日前」は手引き記載に基づく逆算の目安です（標準処理期間は目安）。祝日は内閣府公開データに基づきます。
            </Text>
          </>
        )}

        {/* ④ DIPS／DRS 入力プリフィル表 */}
        <Text style={styles.sectionTitle}>
          DIPS／DRS 入力プリフィル（{diagnosis.prefill.length} 行）
        </Text>
        <View style={styles.tableHead}>
          <MonoText style={[styles.th, styles.colSys]}>系統</MonoText>
          <MonoText style={[styles.th, styles.colLabel]}>入力欄</MonoText>
          <MonoText style={[styles.th, styles.colValue]}>値</MonoText>
          <MonoText style={[styles.th, styles.colSource]}>出所</MonoText>
        </View>
        {diagnosis.prefill.map((f, i) => (
          <View key={`${f.dipsFieldLabel}-${i}`} style={styles.tableRow} wrap={false}>
            <View style={styles.colSys}>
              <Text
                style={[
                  styles.systemBadge,
                  { borderColor: SYSTEM_BORDER[f.system], color: SYSTEM_BORDER[f.system], alignSelf: "flex-start" },
                ]}
              >
                {f.system}
              </Text>
            </View>
            <Text style={[styles.cellLabel, styles.colLabel]}>{f.dipsFieldLabel}</Text>
            <Text style={[styles.cellValue, styles.colValue]}>{f.value}</Text>
            <Text style={[styles.cellSource, styles.colSource]}>{f.source}</Text>
          </View>
        ))}

        {/* ⑤ 書類ドラフト（飛行マニュアル骨子） */}
        <Text style={styles.sectionTitle}>書類ドラフト — 飛行マニュアル</Text>
        {manualDraft.choice === "standard" ? (
          <View>
            <Text style={styles.manualNotice}>
              【選択】{manualDraft.standardReference.label} を使用。{manualDraft.standardNotice}
            </Text>
            <MonoText style={styles.manualSource}>参照: {manualDraft.standardReference.sourceUrl}</MonoText>
          </View>
        ) : (
          <View>
            <Text style={styles.manualNotice}>
              【選択】独自飛行マニュアルを作成（骨子）。※ 記載すべき項目の見出しと観点であり、航空局 標準マニュアル01／02 の本文は含みません（著作権配慮）。
            </Text>
            {manualDraft.baseSections.map((s) => (
              <View key={s.id} wrap={false}>
                <Text style={styles.manualSectionTitle}>{s.title}</Text>
                <Text style={styles.manualOutline}>{s.outline}</Text>
              </View>
            ))}
            {manualDraft.methodSections.map((m) => (
              <View key={m.flag} wrap={false}>
                <Text style={styles.manualSectionTitle}>{m.title}</Text>
                {m.points.map((p, i) => (
                  <Text key={i} style={styles.manualPoint}>
                    ・{p}
                  </Text>
                ))}
                <MonoText style={styles.manualSource}>
                  根拠: {m.legalBasis} ／ 出典: {m.sourceUrl}
                </MonoText>
              </View>
            ))}
          </View>
        )}

        {/* ⑥ DRS と DIPS2.0 の別導線 */}
        <Text style={styles.sectionTitle}>2 系統の手続き窓口（別導線・混同しないこと）</Text>
        <View style={styles.portalRow}>
          <View style={styles.portalBox}>
            <MonoText style={styles.portalLabel}>DRS（機体登録・別系統）</MonoText>
            <Text style={styles.portalUrl}>https://www.dips-reg.mlit.go.jp/drs/</Text>
            <Text style={styles.procMeta}>100g 以上の機体登録・リモートID。</Text>
          </View>
          <View style={styles.portalBox}>
            <MonoText style={styles.portalLabel}>DIPS 2.0（飛行許可・承認）</MonoText>
            <Text style={styles.portalUrl}>https://www.ossportal.dips.mlit.go.jp/</Text>
            <Text style={styles.procMeta}>許可・承認／飛行計画通報／飛行日誌。</Text>
          </View>
        </View>

        {/* ⑦ 免責 */}
        <Text style={styles.disclaimer}>
          <Text style={{ fontWeight: 700 }}>免責 — </Text>
          {diagnosis.disclaimer}
        </Text>

        {/* FOOTER（evidenceId を全ページに固定） */}
        <View style={styles.footer} fixed>
          <MonoText>© 2026 Soraban · 申請支援サマリ</MonoText>
          <Text>Evidence {diagnosis.evidenceId}</Text>
        </View>
      </Page>
    </Document>
  );
};
