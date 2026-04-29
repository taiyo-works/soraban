import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans_JP } from "next/font/google";
import "./globals.css";

// Display: Fraunces — 光学サイズ・SOFT・WONK 軸を持つ可変セリフ。
// 「測量野帳」的な節度ある華やかさを担保するための主役。
// next/font では weight を省略 (= variable) にしないと axes が使えない。
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["SOFT", "WONK", "opsz"],
  display: "swap",
});

// Body: IBM Plex Sans JP — 官公庁・テクニカル文脈と相性が良く日本語混植可。
const plexSansJp = IBM_Plex_Sans_JP({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

// Mono: IBM Plex Mono — 座標・evidenceId・engine 名版数のための数値書体。
const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "そらばん（Soraban）— ドローン規制チェック",
  description:
    "山陰の業務ドローン運用者向けコンプライアンス統合 SaaS。緯度経度から関連条例と信号機判定を表示します。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${fraunces.variable} ${plexSansJp.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
