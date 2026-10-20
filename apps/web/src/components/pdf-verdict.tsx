"use client";

// 判定（4 段＋判定不能）の PDF 表示（Sprint 11d D1）。画面の verdict-summary.tsx と同じ言葉・同じ記号・同じ並び。
// 地点判定の PDF（regulation-pdf.tsx）は結論と段取りの全体、申請支援の PDF（application-pdf.tsx）は結論を使う。
// 見せ方（寸法・線・配色）は designer が磨く。言葉と並びは lib/verdict-display.ts の定義に従う。
import type { ReactNode } from "react";
import { Circle, Line, Polygon, Polyline, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import {
  PERMIT_SCOPE_NOT_VERIFIED_NOTE,
  VERDICT_HELP,
  type FlightVerdict,
  type ItemVerdict,
} from "@soraban/regulations";
import {
  BASE_STATUS_LABEL,
  CONDITIONAL_NOTE,
  legalTierLabel,
  PROCEDURE_COLUMNS,
  unknownCountLabel,
  VERDICT_LABEL,
  VERDICT_PDF_COLOR,
  VERDICT_SECTION_TITLE,
  VERDICT_SHAPE,
} from "@/lib/verdict-display";
import { keepSpaces } from "./pdf-hyphenation";

const INK = "#0E1421";
const INK_SOFT = "#2A2F3A";
const INK_MUTE = "#5B6170";
const RULE = "#C9C2AD";

const s = StyleSheet.create({
  conclusion: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 0.5,
    borderColor: RULE,
  },
  conclusionText: { flexDirection: "column", gap: 3, flex: 1 },
  eyebrow: { fontSize: 7, color: INK_MUTE, letterSpacing: 1.4, marginBottom: 2 },
  level: { fontSize: 20, fontWeight: 700 },
  line: { fontSize: 8.5, lineHeight: 1.5, color: INK_SOFT },
  strong: { fontSize: 9, fontWeight: 700, color: INK },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    marginTop: 14,
    marginBottom: 4,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
  },
  tableHead: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE, paddingBottom: 2 },
  th: { fontSize: 7, color: INK_MUTE },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 3 },
  cellNo: { width: 18, fontSize: 8, color: INK_MUTE },
  cellTitle: { flex: 3, fontSize: 8.5, paddingRight: 4 },
  cellTo: { flex: 2, fontSize: 8, color: INK_SOFT, paddingRight: 4 },
  cellDeadline: { flex: 3, fontSize: 8, color: INK, paddingRight: 4 },
  cellTier: { width: 52, fontSize: 8, color: INK_SOFT },
  reason: { fontSize: 7, color: INK_MUTE, lineHeight: 1.4 },
  doneBox: {
    marginTop: 4,
    paddingLeft: 6,
    paddingVertical: 3,
    borderLeftWidth: 1.5,
    borderLeftColor: VERDICT_PDF_COLOR.procedure_done,
    flexDirection: "column",
    gap: 1,
  },
  itemRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 2.5 },
  itemCell: { flex: 3, fontSize: 8, paddingRight: 4 },
  itemCellSm: { flex: 2, fontSize: 8, color: INK_SOFT, paddingRight: 4 },
  verdictCell: { flex: 2, flexDirection: "row", alignItems: "center", gap: 3 },
});

/** 段階の記号（画面の verdict-mark.tsx と同じ形）。 */
export const PdfVerdictMark = ({ level, size = 12 }: { level: ItemVerdict; size?: number }) => {
  const color = VERDICT_PDF_COLOR[level];
  const shape = VERDICT_SHAPE[level];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {shape === "slashed-circle" ? (
        <>
          <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={2} fill="none" />
          <Line x1="5.6" y1="18.4" x2="18.4" y2="5.6" stroke={color} strokeWidth={2} />
        </>
      ) : null}
      {shape === "triangle" ? (
        <Polygon points="12,3 21.5,20 2.5,20" stroke={color} strokeWidth={2} fill="none" />
      ) : null}
      {shape === "checked-ring" ? (
        <>
          <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={2} fill="none" />
          <Polyline points="7.5,12.5 10.5,15.5 16.5,8.5" stroke={color} strokeWidth={2} fill="none" />
        </>
      ) : null}
      {shape === "filled-circle" ? <Circle cx="12" cy="12" r="8" fill={color} /> : null}
      {shape === "dashed-square" ? (
        <>
          <Rect x="3" y="3" width="18" height="18" stroke={color} strokeWidth={2} strokeDasharray="3 2.5" fill="none" />
          <Line x1="12" y1="15.5" x2="12" y2="17" stroke={color} strokeWidth={2} />
          <Polyline points="9,9.5 10,7.5 14,7.5 15,9.5 12,12 12,13.5" stroke={color} strokeWidth={1.6} fill="none" />
        </>
      ) : null}
    </Svg>
  );
};

/** 結論（段階の言葉・記号・判定不能の件数・条件付きの念押し）。 */
export const PdfVerdictConclusion = ({
  verdict,
  locLine,
}: {
  verdict: FlightVerdict;
  locLine?: ReactNode;
}) => (
  <View style={s.conclusion} wrap={false}>
    <PdfVerdictMark level={verdict.level} size={30} />
    <View style={s.conclusionText}>
      <Text style={s.eyebrow}>{VERDICT_SECTION_TITLE.conclusion}</Text>
      <Text style={[s.level, { color: VERDICT_PDF_COLOR[verdict.level] }]}>{VERDICT_LABEL[verdict.level]}</Text>
      {verdict.unknownCount > 0 ? (
        <Text style={s.strong}>{unknownCountLabel(verdict.unknownCount)}</Text>
      ) : null}
      {verdict.level === "procedure_done" ? (
        <Text style={s.strong}>{keepSpaces(`${CONDITIONAL_NOTE}${PERMIT_SCOPE_NOT_VERIFIED_NOTE}`)}</Text>
      ) : null}
      <Text style={s.line}>{keepSpaces(VERDICT_HELP[verdict.level])}</Text>
      {locLine}
    </View>
  </View>
);

/** 結論の下の段取り：飛行できない理由 → 要手続きの手続き（期限順）→ 手続き済み → 飛行の前後に必ず行うこと → 規制ごとの判定。 */
export const PdfVerdictDetails = ({ verdict }: { verdict: FlightVerdict }) => (
  <View>
    {verdict.noFly.length > 0 ? (
      <View wrap={false}>
        <Text style={s.sectionTitle}>{VERDICT_SECTION_TITLE.noFly}</Text>
        {verdict.noFly.map((n) => (
          <View key={n.itemId} style={{ flexDirection: "row", gap: 4, marginTop: 2 }}>
            <PdfVerdictMark level="no_fly" size={9} />
            <View style={{ flex: 1 }}>
              <Text style={s.strong}>{n.title}</Text>
              <Text style={s.reason}>{keepSpaces(n.reason)}</Text>
            </View>
          </View>
        ))}
      </View>
    ) : null}

    <Text style={s.sectionTitle}>
      {VERDICT_SECTION_TITLE.procedures}（{verdict.procedures.length} 件）
    </Text>
    {verdict.procedures.length === 0 ? (
      <Text style={s.line}>要手続きの手続きはありません。</Text>
    ) : (
      <View>
        <View style={s.tableHead}>
          <Text style={[s.th, { width: 18 }]}>#</Text>
          <Text style={[s.th, { flex: 3 }]}>{PROCEDURE_COLUMNS[0]}</Text>
          <Text style={[s.th, { flex: 2 }]}>{PROCEDURE_COLUMNS[1]}</Text>
          <Text style={[s.th, { flex: 3 }]}>{PROCEDURE_COLUMNS[2]}</Text>
          <Text style={[s.th, { width: 52 }]}>{PROCEDURE_COLUMNS[3]}</Text>
        </View>
        {verdict.procedures.map((p, i) => (
          <View key={p.id} style={s.row} wrap={false}>
            <Text style={s.cellNo}>{String(i + 1).padStart(2, "0")}</Text>
            <View style={s.cellTitle}>
              <Text>{p.title}</Text>
              <Text style={s.reason}>{keepSpaces(p.reason)}</Text>
            </View>
            <Text style={s.cellTo}>{keepSpaces(p.submitTo)}</Text>
            <Text style={s.cellDeadline}>{keepSpaces(p.deadline.label)}</Text>
            <Text style={s.cellTier}>{legalTierLabel(p.legalTier)}</Text>
          </View>
        ))}
      </View>
    )}

    {verdict.done.length > 0 ? (
      <View>
        <Text style={s.sectionTitle}>{VERDICT_SECTION_TITLE.done}</Text>
        {verdict.done.map((d) => (
          <View key={d.itemId} style={s.doneBox} wrap={false}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <PdfVerdictMark level="procedure_done" size={9} />
              <Text style={s.strong}>{d.title}</Text>
            </View>
            <Text style={s.line}>元の判定：{BASE_STATUS_LABEL[d.baseStatus]}</Text>
            <Text style={s.line}>適用した許可：{d.appliedPermits.map((p) => p.label).join(" / ")}</Text>
            {d.conditions.map((c) => (
              <Text key={c} style={s.line}>
                ・{keepSpaces(c)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    ) : null}

    <View wrap={false}>
      <Text style={s.sectionTitle}>{VERDICT_SECTION_TITLE.duties}</Text>
      {verdict.perFlightDuties.map((d) => (
        <Text key={d.id} style={s.line}>
          ・［{d.kind === "premise" ? "前提" : "飛行ごと"}］{d.title}：{keepSpaces(d.detail)}
        </Text>
      ))}
    </View>

    <Text style={s.sectionTitle}>{VERDICT_SECTION_TITLE.items}</Text>
    <View style={s.tableHead}>
      <Text style={[s.th, { flex: 3 }]}>規制・飛行の条件</Text>
      <Text style={[s.th, { flex: 2 }]}>元の判定</Text>
      <Text style={[s.th, { flex: 2 }]}>適用した許可</Text>
      <Text style={[s.th, { flex: 2 }]}>判定</Text>
    </View>
    {verdict.items.map((it) => (
      <View key={it.id} style={s.itemRow} wrap={false}>
        <Text style={s.itemCell}>{keepSpaces(it.title)}</Text>
        <Text style={s.itemCellSm}>{BASE_STATUS_LABEL[it.baseStatus]}</Text>
        <Text style={s.itemCellSm}>
          {it.appliedPermits.length > 0 ? it.appliedPermits.map((p) => p.label).join(" / ") : "—"}
        </Text>
        <View style={s.verdictCell}>
          <PdfVerdictMark level={it.verdict} size={9} />
          <Text style={{ fontSize: 8, color: VERDICT_PDF_COLOR[it.verdict] }}>{VERDICT_LABEL[it.verdict]}</Text>
        </View>
      </View>
    ))}
  </View>
);
