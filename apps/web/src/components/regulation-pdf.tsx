"use client";

import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { LatLng } from "@soraban/geo";
import {
  CONFIDENCE_LABEL,
  STATUS_LABEL,
  formatMachineCondition,
  shouldWarnConfidence,
  type FlightContext,
  type RegulationCheckResult,
} from "@soraban/regulations";

// 日本語グリフを含むフォントを登録。@react-pdf/renderer のデフォルトは
// Helvetica で日本語が出ないため、Noto Sans JP の woff2 を 2 ウェイトだけ取得。
// CDN は Google Fonts の static URL (Cloudflare 経由)。
Font.register({
  family: "Noto Sans JP",
  fonts: [
    {
      src: "https://fonts.gstatic.com/s/notosansjp/v53/-F62fjtqLzI2JPCgQBnw7HFow2oe0e7G_PFr5zbqfMog.ttf",
      fontWeight: 400,
    },
    {
      src: "https://fonts.gstatic.com/s/notosansjp/v53/-F62fjtqLzI2JPCgQBnw7HFow2oe0e7G_PNH5zbqfMog.ttf",
      fontWeight: 700,
    },
  ],
});

// 等幅: IBM Plex Mono (evidenceId / 座標 / engine 名版数)
Font.register({
  family: "IBM Plex Mono",
  fonts: [
    {
      src: "https://fonts.gstatic.com/s/ibmplexmono/v19/-F63fjptAgt5VM-kVkqdyU8n5io.ttf",
      fontWeight: 400,
    },
    {
      src: "https://fonts.gstatic.com/s/ibmplexmono/v19/-F6qfjptAgt5VM-kVkqdyU8n3kw_5VVF.ttf",
      fontWeight: 500,
    },
  ],
});

// ── デザイントークンと整合する PDF 用カラー定義 ──
const COLOR = {
  paper: "#F5F2EA",
  ink: "#0E1421",
  inkSoft: "#2A2F3A",
  inkMute: "#5B6170",
  rule: "#C9C2AD",
  brand: "#1D3557",
  signalRed: "#B53A3A",
  signalAmber: "#B97E1E",
  signalGreen: "#3A7A4F",
  signalMute: "#9DA4B1",
};

const SIGNAL_COLOR: Record<string, string> = {
  red: COLOR.signalRed,
  yellow: COLOR.signalAmber,
  green: COLOR.signalGreen,
  unknown: COLOR.signalMute,
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
  // ── header ──
  eyebrow: {
    fontSize: 7,
    color: COLOR.inkMute,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  h1: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 2,
  },
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
  metaCol: {
    flexDirection: "column",
    minWidth: 110,
  },
  metaLabel: {
    fontSize: 6,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: COLOR.inkMute,
    marginBottom: 1,
  },
  metaValue: {
    color: COLOR.ink,
    fontFamily: "IBM Plex Mono",
  },
  // ── overall ──
  overallBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 0.5,
    borderColor: COLOR.rule,
    backgroundColor: "#FFFFFF22",
  },
  signalBox: {
    flexDirection: "column",
    gap: 4,
    padding: 6,
    backgroundColor: COLOR.ink,
    borderRadius: 2,
  },
  signalDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 0.8,
  },
  overallTextBox: {
    flexDirection: "column",
    gap: 4,
    flex: 1,
  },
  overallStatus: {
    fontSize: 20,
    fontWeight: 700,
  },
  overallNote: {
    fontSize: 9,
    lineHeight: 1.5,
    color: COLOR.inkSoft,
  },
  locLine: {
    fontSize: 8,
    fontFamily: "IBM Plex Mono",
    color: COLOR.inkMute,
    marginTop: 2,
  },
  // ── ctx box ──
  ctxBox: {
    marginTop: 12,
    padding: 10,
    borderWidth: 0.5,
    borderColor: COLOR.rule,
    flexDirection: "column",
    gap: 4,
  },
  ctxRow: {
    flexDirection: "row",
    fontSize: 9,
    gap: 8,
  },
  ctxLabel: {
    width: 100,
    color: COLOR.inkMute,
  },
  // ── regulations ──
  regSectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginTop: 18,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR.rule,
  },
  regBlock: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 0.5,
    borderColor: COLOR.rule,
    flexDirection: "column",
    gap: 4,
  },
  regHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sourceBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 7,
    fontWeight: 500,
    letterSpacing: 0.8,
    borderWidth: 0.5,
    borderColor: COLOR.ink,
  },
  authority: {
    fontSize: 8,
    color: COLOR.inkMute,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    fontSize: 7,
    fontWeight: 700,
    borderWidth: 0.5,
  },
  regTitle: {
    fontSize: 10,
    fontWeight: 700,
  },
  regSummary: {
    fontSize: 8.5,
    lineHeight: 1.5,
    color: COLOR.inkSoft,
  },
  regNote: {
    fontSize: 8,
    lineHeight: 1.5,
    color: COLOR.inkMute,
    paddingLeft: 6,
    borderLeftWidth: 0.5,
    borderLeftColor: COLOR.rule,
  },
  appliedBox: {
    marginTop: 4,
    padding: 6,
    borderLeftWidth: 1.5,
    borderLeftColor: COLOR.signalGreen,
    backgroundColor: "#D6E6DA",
  },
  appliedTitle: {
    fontSize: 7,
    fontWeight: 700,
    color: COLOR.signalGreen,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  appliedItem: {
    fontSize: 8,
    color: COLOR.signalGreen,
    lineHeight: 1.4,
  },
  appliedMachine: {
    fontSize: 7,
    fontFamily: "IBM Plex Mono",
    color: COLOR.signalGreen,
    opacity: 0.7,
    marginLeft: 8,
    marginTop: 1,
    letterSpacing: 0.6,
  },
  warningBox: {
    marginTop: 10,
    paddingLeft: 8,
    paddingVertical: 6,
    paddingRight: 8,
    borderLeftWidth: 1.5,
    borderLeftColor: COLOR.signalAmber,
    fontSize: 8,
    lineHeight: 1.5,
    color: COLOR.inkSoft,
  },
  // ── footer ──
  disclaimer: {
    marginTop: 18,
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

const sourceBorderColor: Record<string, string> = {
  国: COLOR.ink,
  都道府県: COLOR.brand,
  市町村: COLOR.rule,
};

const STATUS_LABEL_PDF: Record<string, string> = {
  red: "飛行不可",
  yellow: "要確認",
  green: "適用外",
  unknown: "未整備",
};

type Props = {
  readonly result: RegulationCheckResult;
  readonly loc: LatLng;
  readonly ctx?: FlightContext;
};

const PURPOSE_LABEL: Record<string, string> = {
  general: "通常運航",
  emergency: "緊急（災害復旧・人命救助）",
  public_duty: "公務（警察・消防・自治体）",
  city_event: "市が主催・後援する行事",
};

const PERMIT_LABEL: Record<string, string> = {
  mlit: "国交省 DIPS",
  park_manager: "公園管理者",
  facility_manager: "施設管理者",
  facility_manager_and_pref_pubsafety: "施設管理者+県公安委員会",
  bunkacho_or_kyoiku: "文化庁・教育委員会",
};

export const RegulationPdfDocument = ({ result, loc, ctx }: Props) => {
  const overallColor = SIGNAL_COLOR[result.overall] ?? COLOR.signalMute;
  return (
    <Document title={`Soraban — ${result.evidenceId}`}>
      <Page size="A4" style={styles.page}>
        {/* HEADER */}
        <View>
          <Text style={styles.eyebrow}>
            Soraban — Aerial Compliance Atlas Report
          </Text>
          <Text style={styles.h1}>そらばん 飛行可否レポート</Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Evidence ID</Text>
            <Text style={styles.metaValue}>{result.evidenceId}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Engine</Text>
            <Text style={styles.metaValue}>{result.engineVersion}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Confidence</Text>
            <Text style={styles.metaValue}>
              {CONFIDENCE_LABEL[result.overallConfidence]}
            </Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Checked at</Text>
            <Text style={styles.metaValue}>
              {new Date(result.checkedAt).toLocaleString("ja-JP")}
            </Text>
          </View>
        </View>

        {/* OVERALL */}
        <View style={styles.overallBlock}>
          <View style={styles.signalBox}>
            {(["red", "yellow", "green"] as const).map((light) => (
              <View
                key={light}
                style={[
                  styles.signalDot,
                  {
                    backgroundColor:
                      light === result.overall ? SIGNAL_COLOR[light] : "#1F263A",
                    borderColor:
                      light === result.overall ? SIGNAL_COLOR[light] : COLOR.rule,
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.overallTextBox}>
            <Text style={styles.eyebrow}>総合判定</Text>
            <Text style={[styles.overallStatus, { color: overallColor }]}>
              {STATUS_LABEL[result.overall]}
            </Text>
            <Text style={styles.locLine}>
              {loc.lat.toFixed(6)}°N · {loc.lng.toFixed(6)}°E
              {result.resolvedAddress ? ` — ${result.resolvedAddress}` : ""}
            </Text>
          </View>
        </View>

        {/* CONFIDENCE WARNING — 特許①従属項8 の実施例。閾値未満のときだけ出る */}
        {shouldWarnConfidence(result.overallConfidence) ? (
          <Text style={styles.warningBox}>
            <Text style={{ fontWeight: 700, color: COLOR.signalAmber }}>
              確信度 {CONFIDENCE_LABEL[result.overallConfidence]} — 現地での再確認を推奨
            </Text>
            {"  "}
            本判定はジオメトリ精度または条文抽出精度が低いレコードを含みます。引受・許可申請の前に、該当条文の原本と現地状況をご確認ください。
          </Text>
        ) : null}

        {/* FLIGHT CONTEXT */}
        {ctx ? (
          <View style={styles.ctxBox}>
            <Text style={styles.eyebrow}>機体・運航条件</Text>
            <View style={styles.ctxRow}>
              <Text style={styles.ctxLabel}>機体重量</Text>
              <Text>
                {ctx.droneWeightG !== undefined ? `${ctx.droneWeightG} g` : "未指定"}
              </Text>
            </View>
            <View style={styles.ctxRow}>
              <Text style={styles.ctxLabel}>運航目的</Text>
              <Text>{PURPOSE_LABEL[ctx.purpose ?? "general"] ?? ctx.purpose}</Text>
            </View>
            <View style={styles.ctxRow}>
              <Text style={styles.ctxLabel}>取得済み許可</Text>
              <Text>
                {ctx.pilotPermits && ctx.pilotPermits.length > 0
                  ? Array.from(
                      new Set(
                        ctx.pilotPermits.map((p) => PERMIT_LABEL[p] ?? p),
                      ),
                    ).join(" / ")
                  : "なし"}
              </Text>
            </View>
          </View>
        ) : null}

        {/* REGULATIONS */}
        <Text style={styles.regSectionTitle}>
          関連条例 ({result.regulations.length} 件)
        </Text>
        {result.regulations.map((reg) => (
          <View key={reg.id} style={styles.regBlock} wrap={false}>
            <View style={styles.regHeader}>
              <Text
                style={[
                  styles.sourceBadge,
                  { borderColor: sourceBorderColor[reg.source] ?? COLOR.rule },
                ]}
              >
                {reg.source}
              </Text>
              <Text style={styles.authority}>{reg.authority}</Text>
              <Text
                style={[
                  styles.statusBadge,
                  {
                    color: SIGNAL_COLOR[reg.status] ?? COLOR.inkMute,
                    borderColor: SIGNAL_COLOR[reg.status] ?? COLOR.rule,
                  },
                ]}
              >
                {STATUS_LABEL_PDF[reg.status] ?? reg.status}
              </Text>
            </View>
            <Text style={styles.regTitle}>{reg.title}</Text>
            <Text style={styles.regSummary}>{reg.summary}</Text>
            <Text style={styles.regNote}>{reg.note}</Text>
            {reg.appliedExceptions && reg.appliedExceptions.length > 0 ? (
              <View style={styles.appliedBox}>
                <Text style={styles.appliedTitle}>✓ 適用された例外節</Text>
                {reg.appliedExceptions.map((ex) => (
                  <View key={ex.id}>
                    <Text style={styles.appliedItem}>・{ex.condition}</Text>
                    {ex.machine ? (
                      <Text style={styles.appliedMachine}>
                        {formatMachineCondition(ex.machine)}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        {/* DISCLAIMER */}
        <Text style={styles.disclaimer}>
          <Text style={{ fontWeight: 700 }}>免責 — </Text>
          {result.disclaimer}
        </Text>

        {/* FOOTER */}
        <View style={styles.footer} fixed>
          <Text>© 2026 Soraban · 奥田憲章</Text>
          <Text>
            出典: 国交省 国土数値情報 / 国土地理院 / 警察庁・防衛省 / 各自治体例規集
          </Text>
        </View>
      </Page>
    </Document>
  );
};
