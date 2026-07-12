import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "MICHIKUSA — ちょっと寄り道の案内",
  description:
    "行きたい場所がない日に、現在地と空き時間から寄り道のルートと過ごし方を提案するアプリ。",
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
