import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "MICHIKUSA — AI外出エージェント",
  description:
    "行きたい場所がない日に、現在地と空き時間からAIが道草ルートと過ごし方を決めるスマホ対応Webアプリ。",
  applicationName: "MICHIKUSA",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.svg"
  },
  openGraph: {
    title: "MICHIKUSA",
    description: "行き先は考えなくていい。行くかどうかだけ、決めて。",
    type: "website"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#fcfbfa"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
