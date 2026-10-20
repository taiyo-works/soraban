"use client";

// 判定（4 段＋判定不能）の PDF 表示（Sprint 11d D1・D2）。画面の verdict-summary.tsx と同じ言葉・同じ記号・同じ並び。
// 地点判定の PDF（regulation-pdf.tsx）は結論と段取りの全体、申請支援の PDF（application-pdf.tsx）は結論を使う。
// 見せ方：結論は表示板（左端の帯＋記号＋段階の言葉＋目盛り）、段取りは運航票（行ごとの左端の帯、等幅の番号と日付、
// 残り日数、法的な重さの目盛り）。印刷・グレースケールでも、言葉と記号の形と目盛りの位置で段階が読める。
import type { ReactNode } from "react";
import { Circle, Line, Path, Polygon, Polyline, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import {
  MODEL_AIRCRAFT_REFERENCE_LINE,
  MODEL_AIRCRAFT_REFERENCES,
  MODEL_AIRCRAFT_RULES_CHECKED_AT,
  MODEL_AIRCRAFT_UNVERIFIED,
  PERMIT_SCOPE_NOT_VERIFIED_NOTE,
  VERDICT_HELP,
  type FlightVerdict,
  type ItemVerdict,
  type LegalTier,
} from "@soraban/regulations";
import {
  BASE_STATUS_LABEL,
  CONDITIONAL_NOTE,
  deadlineCountdown,
  isConfirmProcedure,
  baseStatusDisplay,
  legalTierLabel,
  legalTierWeight,
  PROCEDURE_COLUMNS,
  unknownCountLabel,
  VERDICT_GEOMETRY as G,
  VERDICT_LABEL,
  VERDICT_PDF_COLOR,
  VERDICT_SCALE,
  VERDICT_SECTION_TITLE,
  VERDICT_SHAPE,
} from "@/lib/verdict-display";
import { keepSpaces } from "./pdf-hyphenation";
import { MonoText } from "./pdf-mono-text";

const INK = "#0E1421";
const INK_SOFT = "#2A2F3A";
const INK_MUTE = "#5B6170";
const RULE = "#C9C2AD";
const PAPER = "#F5F2EA";
const SCALE_OFF = "#B9B4A6";

const s = StyleSheet.create({
  conclusionWrap: { marginTop: 18 },
  eyebrow: { fontSize: 7, color: INK_MUTE, letterSpacing: 1.4, marginBottom: 4 },
  plate: {
    flexDirection: "column",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 0.75,
    borderColor: INK_SOFT,
    borderLeftWidth: 5,
  },
  plateHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  level: { fontSize: 19, fontWeight: 700 },
  scale: { flexDirection: "row", gap: 3, marginLeft: "auto", alignItems: "flex-end" },
  scaleCell: { width: 18, height: 18, alignItems: "center", justifyContent: "center", borderBottomWidth: 1.5 },
  plateNotes: { flexDirection: "column", gap: 2, paddingTop: 5, borderTopWidth: 0.5, borderTopColor: RULE },
  line: { fontSize: 8.5, lineHeight: 1.5, color: INK_SOFT },
  strong: { fontSize: 9, fontWeight: 700, color: INK },
  conditional: {
    fontSize: 9,
    fontWeight: 700,
    color: INK,
    paddingLeft: 6,
    borderLeftWidth: 1.5,
    borderLeftColor: VERDICT_PDF_COLOR.procedure_done,
    borderLeftStyle: "dashed",
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 14,
    marginBottom: 4,
    paddingBottom: 2,
    borderBottomWidth: 0.75,
    borderBottomColor: INK_SOFT,
  },
  sectionTitle: { fontSize: 9.5, fontWeight: 700, color: INK },
  sectionCount: { marginLeft: "auto", fontFamily: "IBM Plex Mono", fontSize: 7.5, color: INK_MUTE },
  tableHead: { flexDirection: "row", paddingBottom: 2, paddingLeft: 8 },
  th: { fontSize: 6.5, color: INK_MUTE, letterSpacing: 0.6 },
  strip: {
    flexDirection: "row",
    marginTop: 2.5,
    paddingVertical: 4,
    paddingLeft: 6,
    borderWidth: 0.5,
    borderColor: RULE,
    borderLeftWidth: 3,
    borderLeftColor: VERDICT_PDF_COLOR.needs_procedure,
  },
  cellNo: { width: 20, fontFamily: "IBM Plex Mono", fontSize: 9, fontWeight: 500, color: INK },
  cellTitle: { flex: 3, paddingRight: 6 },
  title: { fontSize: 8.5, fontWeight: 700, color: INK },
  cellTo: { flex: 2, fontSize: 7.5, color: INK_SOFT, paddingRight: 6, lineHeight: 1.4 },
  cellDeadline: { flex: 3, paddingRight: 6 },
  deadlineHead: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 1.5 },
  deadlineDate: { fontFamily: "IBM Plex Mono", fontSize: 9, fontWeight: 500, color: INK },
  countdown: {
    fontFamily: "IBM Plex Mono",
    fontSize: 6.5,
    color: INK,
    borderWidth: 0.5,
    borderColor: INK_SOFT,
    paddingHorizontal: 2,
    paddingVertical: 0.5,
  },
  deadlineLabel: { fontSize: 7.5, color: INK, lineHeight: 1.4 },
  deadlineLabelSub: { fontSize: 6.5, color: INK_MUTE, lineHeight: 1.4 },
  cellTier: { width: 64, flexDirection: "row", alignItems: "flex-end", alignSelf: "flex-start", gap: 3 },
  tierText: { fontSize: 7.5, color: INK_SOFT },
  reason: { fontSize: 6.5, color: INK_MUTE, lineHeight: 1.4, marginTop: 1 },
  doneBox: {
    marginTop: 2.5,
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 4,
    borderWidth: 0.5,
    borderColor: RULE,
    borderLeftWidth: 3,
    borderLeftColor: VERDICT_PDF_COLOR.procedure_done,
    flexDirection: "column",
    gap: 1.5,
  },
  doneConditions: {
    marginLeft: 13,
    paddingLeft: 5,
    borderLeftWidth: 1,
    borderLeftColor: VERDICT_PDF_COLOR.procedure_done,
    borderLeftStyle: "dashed",
  },
  dutyRow: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 2.5,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
  },
  dutyTag: { width: 40, fontSize: 6.5, paddingVertical: 0.5, paddingHorizontal: 2, borderWidth: 0.5, textAlign: "center" },
  itemHead: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE, paddingBottom: 2, paddingLeft: 6 },
  itemRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
    paddingVertical: 2.5,
    paddingLeft: 5,
    borderLeftWidth: 1.5,
  },
  itemCell: { flex: 3, fontSize: 7.5, paddingRight: 4, color: INK },
  itemCellSm: { flex: 2, fontSize: 7.5, color: INK_SOFT, paddingRight: 4 },
  unverified: {
    fontSize: 6.5,
    fontWeight: 700,
    color: VERDICT_PDF_COLOR.needs_procedure,
    borderWidth: 0.5,
    borderColor: VERDICT_PDF_COLOR.needs_procedure,
    borderStyle: "dashed",
    paddingHorizontal: 3,
    paddingVertical: 0.5,
  },
  refRow: { flexDirection: "row", gap: 4, paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: RULE },
  refNo: { width: 16, fontFamily: "IBM Plex Mono", fontSize: 7, color: INK_MUTE },
  refUrl: { fontFamily: "IBM Plex Mono", fontSize: 6.5, color: INK_MUTE },
  verdictCell: { flex: 2, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 3 },
});

/** 段階の記号（画面の verdict-mark.tsx と同じ形・同じ幾何）。 */
export const PdfVerdictMark = ({
  level,
  size = 12,
  color,
}: {
  level: ItemVerdict;
  size?: number;
  color?: string;
}) => {
  const c = color ?? VERDICT_PDF_COLOR[level];
  const shape = VERDICT_SHAPE[level];
  // 線の太さ（viewBox 24 の単位）。小さい記号ほど太くし、紙の上の線幅を 0.6〜0.9pt に揃える。
  const sw = size >= 24 ? 1.5 : size >= 14 ? 2 : 2.4;
  const line = { stroke: c, strokeWidth: sw, fill: "none" } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {shape === "slashed-circle" ? (
        <>
          <Circle {...G.ring} {...line} />
          <Line {...G.slash} {...line} />
        </>
      ) : null}
      {shape === "triangle" ? (
        <>
          <Polygon points={G.triangle} {...line} />
          <Line {...G.triangleBar} {...line} />
        </>
      ) : null}
      {shape === "checked-ring" ? (
        <>
          <Circle {...G.ring} {...line} />
          <Polyline points={G.check} {...line} />
        </>
      ) : null}
      {shape === "filled-circle" ? (
        <>
          <Circle {...G.ring} {...line} />
          <Circle {...G.disc} fill={c} />
        </>
      ) : null}
      {shape === "dashed-square" ? (
        <>
          <Rect x={G.square.x} y={G.square.y} width={G.square.size} height={G.square.size} {...line} strokeDasharray={G.square.dash} />
          <Path d={G.question} {...line} />
          <Circle {...G.questionDot} fill={c} />
        </>
      ) : null}
    </Svg>
  );
};

/** 法的な重さの目盛り（画面の TierGauge と同じ：3 本の棒）。 */
const PdfTierGauge = ({ tier }: { tier: LegalTier }) => {
  const w = legalTierWeight(tier);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 1.2 }}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={{ width: 1.8, height: 2.5 + i * 2, backgroundColor: i <= w ? INK : RULE }} />
      ))}
    </View>
  );
};

/** 結論の目盛り（重い順に 4 段。現在の段階の位置に色と下線）。 */
const PdfVerdictScale = ({ level }: { level: ItemVerdict }) => (
  <View style={s.scale}>
    {VERDICT_SCALE.map((l) => {
      const active = l === level;
      return (
        <View
          key={l}
          style={[s.scaleCell, { borderBottomColor: active ? VERDICT_PDF_COLOR[l] : RULE }]}
        >
          <PdfVerdictMark level={l} size={11} color={active ? VERDICT_PDF_COLOR[l] : SCALE_OFF} />
        </View>
      );
    })}
  </View>
);

const hasRefs = (reason: string): boolean => reason.includes(MODEL_AIRCRAFT_REFERENCE_LINE);
const refNo = (i: number): string => `[${i + 1}]`;

/** 理由（模型航空機の参照先の一行は外し、番号で参照先の一覧を指す。画面の pointer と同じ考え方）。 */
const PdfReason = ({ reason }: { reason: string }) =>
  hasRefs(reason) ? (
    <Text style={s.reason}>
      {keepSpaces(reason.replace(MODEL_AIRCRAFT_REFERENCE_LINE, "").trim())}
      {"\n"}
      {keepSpaces(`参照先：${refNo(0)}〜${refNo(MODEL_AIRCRAFT_REFERENCES.length - 1)}（参照先の一覧）`)}
    </Text>
  ) : (
    <Text style={s.reason}>{keepSpaces(reason)}</Text>
  );

const SectionHead = ({ title, count }: { title: string; count?: number }) => (
  <View style={s.sectionHead} minPresenceAhead={40}>
    <Text style={s.sectionTitle}>{title}</Text>
    {count !== undefined ? <Text style={s.sectionCount}>{String(count).padStart(2, "0")}</Text> : null}
  </View>
);

/** 結論（表示板：段階の言葉・記号・目盛り・判定不能の件数・条件付きの念押し）。 */
export const PdfVerdictConclusion = ({
  verdict,
  locLine,
}: {
  verdict: FlightVerdict;
  locLine?: ReactNode;
}) => (
  <View style={s.conclusionWrap} wrap={false}>
    <Text style={s.eyebrow}>{VERDICT_SECTION_TITLE.conclusion}</Text>
    <View style={[s.plate, { borderLeftColor: VERDICT_PDF_COLOR[verdict.level], backgroundColor: PAPER }]}>
      <View style={s.plateHead}>
        <PdfVerdictMark level={verdict.level} size={26} />
        <Text style={[s.level, { color: VERDICT_PDF_COLOR[verdict.level] }]}>{VERDICT_LABEL[verdict.level]}</Text>
        <PdfVerdictScale level={verdict.level} />
      </View>
      {verdict.unknownCount > 0 || verdict.level === "procedure_done" ? (
        <View style={s.plateNotes}>
          {verdict.unknownCount > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <PdfVerdictMark level="unknown" size={10} />
              <Text style={s.strong}>{unknownCountLabel(verdict.unknownCount)}</Text>
            </View>
          ) : null}
          {verdict.level === "procedure_done" ? (
            <Text style={s.conditional}>{keepSpaces(`${CONDITIONAL_NOTE}${PERMIT_SCOPE_NOT_VERIFIED_NOTE}`)}</Text>
          ) : null}
        </View>
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
        <SectionHead title={VERDICT_SECTION_TITLE.noFly} count={verdict.noFly.length} />
        {verdict.noFly.map((n) => (
          <View
            key={n.itemId}
            style={[s.strip, { borderLeftColor: VERDICT_PDF_COLOR.no_fly, gap: 5, paddingRight: 6 }]}
          >
            <PdfVerdictMark level="no_fly" size={10} />
            <View style={{ flex: 1 }}>
              <Text style={s.strong}>{n.title}</Text>
              <Text style={s.reason}>{keepSpaces(n.reason)}</Text>
            </View>
          </View>
        ))}
      </View>
    ) : null}

    <SectionHead title={`${VERDICT_SECTION_TITLE.procedures}（${verdict.procedures.length} 件）`} />
    {verdict.procedures.length === 0 ? (
      <Text style={s.line}>要手続きの手続きはありません。</Text>
    ) : (
      <View>
        <View style={s.tableHead}>
          <Text style={[s.th, { width: 20 }]}>#</Text>
          <Text style={[s.th, { flex: 3 }]}>{PROCEDURE_COLUMNS[0]}</Text>
          <Text style={[s.th, { flex: 2 }]}>{PROCEDURE_COLUMNS[1]}</Text>
          <Text style={[s.th, { flex: 3 }]}>{PROCEDURE_COLUMNS[2]}</Text>
          <Text style={[s.th, { width: 64 }]}>{PROCEDURE_COLUMNS[3]}</Text>
        </View>
        {verdict.procedures.map((p, i) => {
          const countdown = deadlineCountdown(p.deadline.date);
          return (
            <View
              key={p.id}
              style={[
                s.strip,
                isConfirmProcedure(p.id) ? { borderLeftColor: VERDICT_PDF_COLOR.unknown } : {},
              ]}
              wrap={false}
            >
              <View style={{ width: 20 }}>
                <Text style={[s.cellNo, { width: undefined }]}>{String(i + 1).padStart(2, "0")}</Text>
                {isConfirmProcedure(p.id) ? (
                  <View style={{ marginTop: 2 }}>
                    <PdfVerdictMark level="unknown" size={9} />
                  </View>
                ) : null}
              </View>
              <View style={s.cellTitle}>
                <Text style={s.title}>{keepSpaces(p.title)}</Text>
                <PdfReason reason={p.reason} />
              </View>
              <Text style={s.cellTo}>{keepSpaces(p.submitTo)}</Text>
              <View style={s.cellDeadline}>
                {p.deadline.date ? (
                  <View style={s.deadlineHead}>
                    <Text style={s.deadlineDate}>{p.deadline.date}</Text>
                    {countdown ? <MonoText style={s.countdown}>{keepSpaces(countdown)}</MonoText> : null}
                  </View>
                ) : null}
                <Text style={p.deadline.date ? s.deadlineLabelSub : s.deadlineLabel}>
                  {keepSpaces(p.deadline.label)}
                </Text>
              </View>
              <View style={s.cellTier}>
                <PdfTierGauge tier={p.legalTier} />
                <Text style={s.tierText}>{legalTierLabel(p.legalTier)}</Text>
              </View>
            </View>
          );
        })}
      </View>
    )}

    {verdict.done.length > 0 ? (
      <View>
        <SectionHead title={VERDICT_SECTION_TITLE.done} count={verdict.done.length} />
        {verdict.done.map((d) => (
          <View key={d.itemId} style={s.doneBox} wrap={false}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <PdfVerdictMark level="procedure_done" size={10} />
              <Text style={[s.strong, { flex: 1 }]}>{d.title}</Text>
              <PdfTierGauge tier={d.legalTier} />
              <Text style={s.tierText}>{legalTierLabel(d.legalTier)}</Text>
            </View>
            <View style={{ marginLeft: 14 }}>
              <Text style={s.line}>元の判定：{BASE_STATUS_LABEL[d.baseStatus]}</Text>
              <Text style={s.line}>適用した許可：{d.appliedPermits.map((p) => p.label).join(" / ")}</Text>
            </View>
            <View style={s.doneConditions}>
              {d.conditions.map((c) => (
                <Text key={c} style={s.line}>
                  ・{keepSpaces(c)}
                </Text>
              ))}
            </View>
          </View>
        ))}
      </View>
    ) : null}

    <View wrap={false}>
      <SectionHead title={VERDICT_SECTION_TITLE.duties} count={verdict.perFlightDuties.length} />
      {verdict.perFlightDuties.map((d) => (
        <View key={d.id} style={s.dutyRow}>
          <Text
            style={[
              s.dutyTag,
              d.kind === "premise" ? { borderColor: RULE, color: INK_MUTE } : { borderColor: INK_SOFT, color: INK },
            ]}
          >
            {d.kind === "premise" ? "前提" : "飛行ごと"}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.line, { fontWeight: 700, color: INK }]}>{d.title}</Text>
            <Text style={s.reason}>{keepSpaces(d.detail)}</Text>
          </View>
        </View>
      ))}
    </View>

    <SectionHead title={VERDICT_SECTION_TITLE.items} count={verdict.items.length} />
    <View style={s.itemHead}>
      <Text style={[s.th, { flex: 3 }]}>規制・飛行の条件</Text>
      <Text style={[s.th, { flex: 2 }]}>元の判定</Text>
      <Text style={[s.th, { flex: 2 }]}>適用した許可</Text>
      <Text style={[s.th, { flex: 2 }]}>判定</Text>
    </View>
    {verdict.items.map((it) => (
      <View key={it.id} style={[s.itemRow, { borderLeftColor: VERDICT_PDF_COLOR[it.verdict] }]} wrap={false}>
        <View style={s.itemCell}>
          <Text>{keepSpaces(it.title)}</Text>
          {hasRefs(it.reason) ? <PdfReason reason={it.reason} /> : null}
        </View>
        <Text style={s.itemCellSm}>{baseStatusDisplay(it)}</Text>
        <Text style={s.itemCellSm}>
          {it.appliedPermits.length > 0 ? it.appliedPermits.map((p) => p.label).join(" / ") : "—"}
        </Text>
        <View style={s.verdictCell}>
          <PdfVerdictMark level={it.verdict} size={9} />
          <Text style={{ fontSize: 7.5, fontWeight: 700, color: VERDICT_PDF_COLOR[it.verdict] }}>
            {VERDICT_LABEL[it.verdict]}
          </Text>
        </View>
      </View>
    ))}
    {verdict.items.some((it) => hasRefs(it.reason)) || verdict.procedures.some((p) => hasRefs(p.reason)) ? (
      <View wrap={false}>
        <SectionHead title="参照先（100g 未満の機体・模型航空機）" count={MODEL_AIRCRAFT_REFERENCES.length} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <MonoText style={{ fontFamily: "IBM Plex Mono", fontSize: 7, color: INK_SOFT }}>
            {keepSpaces(`確認日 ${MODEL_AIRCRAFT_RULES_CHECKED_AT}`)}
          </MonoText>
          <Text style={s.unverified}>{MODEL_AIRCRAFT_UNVERIFIED}</Text>
        </View>
        {MODEL_AIRCRAFT_REFERENCES.map((r, i) => (
          <View key={r.id} style={s.refRow}>
            <Text style={s.refNo}>{refNo(i)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 7.5, color: INK }}>{keepSpaces(r.title)}</Text>
              <Text style={s.refUrl}>{r.url}</Text>
            </View>
          </View>
        ))}
      </View>
    ) : null}
  </View>
);
