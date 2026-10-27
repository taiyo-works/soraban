import type { Metadata } from "next";
import { Noto_Sans_JP, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// 書体は 2 つだけ（デザインシステム v2）。どちらも next/font でビルド時に取得して自前配信する（外部への通信なし）。
// - 和文：Noto Sans JP。太さは 400・500・700。日本語の分割ファイルは先読みしない（preload: false）。使う文字を含む分割だけが
//   unicode-range で読まれる。先読みすると全分割の転送量が増え、LCP が遅れるため。fallback は端末の和文ゴシック。
//   display は swap：読み込めたら入れ替える（optional だと初回は Noto Sans JP にならず、デザインの字体を出せない）。
//   swap で字体が入れ替わるとき、文字の矩形が変わるとレイアウトのずれ（0.0002〜0.0005）になる。原因は、フォールバックの縦の寸法
//   （ascent・descent）と Noto Sans JP の hhea（1.16・0.288）のずれ。そこで fallback の先頭に、寸法を揃えた代用の字体
//   （soraban-ui.css の @font-face。size-adjust・ascent-override・descent-override）を置き、入れ替えで矩形が動かないようにした。
//   これで sprint11b.spec の「見出し内の CLS は 0」と全体の CLS 0 を、しきい値を変えずに満たす。
// - 数字・英字：Plus Jakarta Sans（座標・証跡 ID・件数。tabular-nums を併用）。latin だけを先読みする。太さは 500・700。
const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-jp",
  weight: ["400", "500", "700"],
  display: "swap",
  preload: false,
  // 読み込み前の字体は、端末の和文ゴシックを Noto Sans JP の縦の寸法（ascent・descent）に合わせた代用の字体（soraban-ui.css の @font-face）。
  // 字体が入れ替わっても、文字の縦の位置・行の高さが動かない（見出し内の CLS を 0 に保つ）。
  fallback: ["Soraban Latin Fallback", "Soraban JP Fallback", "sans-serif"],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["500", "700"],
  display: "swap",
});

const SITE_TITLE = "そらばん — ドローン飛行の可否判定と運航管理";
const SITE_DESCRIPTION =
  "ドローン飛行の可否判定と運航管理。運営：フューチャーテック株式会社。現在は社内での試験運用中です。";

// アイコンは app/icon.svg・app/favicon.ico（算盤の珠と梁の単純な図形）。共有時の表示（OG）は文字情報のみ。
// 題名のテンプレートは、子の区間（/ops 以下）の title に「 — そらばん」を付ける。`/` は default のまま（SITE_TITLE）。
// 運航管理のレイアウト（app/ops/layout.tsx）と同じ区間のページ（/ops）にも効かせるため、テンプレートはここに置く。
export const metadata: Metadata = {
  title: { template: "%s — そらばん", default: SITE_TITLE },
  description: SITE_DESCRIPTION,
  applicationName: "そらばん",
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: "そらばん",
    locale: "ja_JP",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${notoSansJp.variable} ${plusJakartaSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
