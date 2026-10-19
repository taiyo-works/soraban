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
  ALL_AMENDMENTS,
  formatMachineCondition,
  shouldWarnConfidence,
  type AmendmentRef,
  type DatasetRef,
  type FlightContext,
  type RegulationCheckResult,
} from "@soraban/regulations";
import { MonoText } from "./pdf-mono-text";
import { keepSpaces, registerJapaneseLineBreaking } from "./pdf-hyphenation";

// 日本語グリフを含むフォントを登録。@react-pdf/renderer のデフォルトは
// Helvetica で日本語が出ないため、Noto Sans JP / IBM Plex Mono を 2 ウェイトずつ使う。
//
// ⚠️ 以前は fonts.gstatic.com のハッシュ付き URL（NotoSansJP v53 等）を直接参照していたが、
// Google 側でファイル名のハッシュがローテートされると旧 URL が 404 になり、
// 「PDF生成に失敗」が発生していた。恒久対策として、安定取得した静的ウェイトの
// .ttf を apps/web/public/fonts/ に同梱（self-host）し、ローカルパスから登録する。
// （空港データを静的 import 化したのと同じ「外部の揺れに依存しない」思想。）
//
// 配置: apps/web/public/fonts/{NotoSansJP-Regular,NotoSansJP-Bold,IBMPlexMono-Regular,IBMPlexMono-Medium}.ttf
//   - Noto Sans JP: @expo-google-fonts/noto-sans-jp（静的ウェイト 400/700, OFL）由来。
//   - IBM Plex Mono: google/fonts（静的ウェイト 400/500, OFL）由来。
//
// この PDF コンポーネントはクライアント（ブラウザ）でのみ動的 import されて動くため、
// ルート相対パス（/fonts/...）はページのオリジンに対して解決され、ブラウザ fetch で
// 取得できる（Vercel serverless でも public/ 配下として配信される）。
const fontUrl = (file: string): string => {
  // SSR/Edge で誤って評価された場合の保険として origin を前置できるが、
  // 実運用ではクライアントからのみ呼ばれるためルート相対で十分。
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

// 等幅: IBM Plex Mono (evidenceId / 座標 / engine 名版数)
Font.register({
  family: "IBM Plex Mono",
  fonts: [
    { src: fontUrl("IBMPlexMono-Regular.ttf"), fontWeight: 400 },
    { src: fontUrl("IBMPlexMono-Medium.ttf"), fontWeight: 500 },
  ],
});

// 日本語の行末に「-」が入らないよう、改行位置の扱いを差し替える（全 PDF 共通）。
registerJapaneseLineBreaking();

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
  // 規制ブロック内の脚注（使用データ・反映済みの改正）。判定本文と罫線で区切る。
  dataGroup: {
    marginTop: 2,
    paddingTop: 4,
    borderTopWidth: 0.5,
    borderTopColor: COLOR.rule,
    borderTopStyle: "dashed",
    flexDirection: "column",
    gap: 1,
  },
  dataLine: {
    fontSize: 7,
    lineHeight: 1.45,
    color: COLOR.inkMute,
  },
  sourcesBox: {
    marginTop: 12,
    padding: 10,
    borderWidth: 0.5,
    borderColor: COLOR.rule,
    flexDirection: "column",
    gap: 1,
  },
  sourcesLine: {
    fontSize: 7.5,
    lineHeight: 1.5,
    color: COLOR.inkSoft,
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

const uniqueDatasets = (result: RegulationCheckResult): readonly DatasetRef[] => {
  const map = new Map<string, DatasetRef>();
  for (const r of result.regulations) for (const d of r.datasets ?? []) map.set(d.id, d);
  return Array.from(map.values());
};

// 判定結果に出てくる改正を施行日順に（判定結果に無くても全改正を示す）。
const uniqueAmendments = (result: RegulationCheckResult): readonly AmendmentRef[] => {
  const ids = new Set(result.regulations.flatMap((r) => (r.amendments ?? []).map((a) => a.id)));
  const listed = ALL_AMENDMENTS.filter((a) => ids.has(a.id));
  return listed.length > 0 ? listed : ALL_AMENDMENTS;
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
            <MonoText style={styles.metaValue}>
              {CONFIDENCE_LABEL[result.overallConfidence]}
            </MonoText>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Checked at</Text>
            <MonoText style={styles.metaValue}>
              {new Date(result.checkedAt).toLocaleString("ja-JP")}
            </MonoText>
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
            <MonoText style={styles.locLine}>
              {loc.lat.toFixed(6)}°N · {loc.lng.toFixed(6)}°E
              {result.resolvedAddress ? ` — ${result.resolvedAddress}` : ""}
            </MonoText>
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
            <Text style={styles.regSummary}>{keepSpaces(reg.summary)}</Text>
            <Text style={styles.regNote}>{keepSpaces(reg.note)}</Text>
            <View style={styles.dataGroup}>
              <Text style={styles.dataLine}>
                使用データ：
                {reg.datasets
                  .map(
                    (d) =>
                      `${d.name}${d.baseYear !== null ? `（基準年 ${d.baseYear}）` : ""}・確認日 ${d.verifiedAt}`,
                  )
                  .join(" / ")}
              </Text>
              {reg.amendments.length > 0 ? (
                <Text style={styles.dataLine}>
                  反映済みの改正：
                  {reg.amendments.map((a) => `${a.title}（施行・適用 ${a.effectiveDate}）`).join(" / ")}
                </Text>
              ) : null}
            </View>
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

        {/* DATA SOURCES（Sprint 7）: 判定に使ったデータと確認日、反映済みの改正 */}
        <View style={styles.sourcesBox} wrap={false}>
          <Text style={styles.eyebrow}>データ出典と確認日</Text>
          {uniqueDatasets(result).map((d) => (
            <Text key={d.id} style={styles.sourcesLine}>
              ・{d.name}
              {d.baseYear !== null ? `（基準年 ${d.baseYear}）` : ""}・確認日 {d.verifiedAt}
            </Text>
          ))}
          <Text style={[styles.eyebrow, { marginTop: 6 }]}>反映済みの法令改正</Text>
          {uniqueAmendments(result).map((a) => (
            <Text key={a.id} style={styles.sourcesLine}>
              ・{a.title}（施行・適用 {a.effectiveDate}）
            </Text>
          ))}
        </View>

        {/* DISCLAIMER */}
        <Text style={styles.disclaimer}>
          <Text style={{ fontWeight: 700 }}>免責 — </Text>
          {keepSpaces(result.disclaimer)}
        </Text>

        {/* FOOTER */}
        <View style={styles.footer} fixed>
          <MonoText>© 2026 Soraban · 奥田憲章</MonoText>
          <MonoText>
            出典: 国交省 国土数値情報 / 国土地理院 / 警察庁・防衛省 / 各自治体例規集
          </MonoText>
        </View>
      </Page>
    </Document>
  );
};
