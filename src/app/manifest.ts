import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MICHIKUSA — AI外出エージェント",
    short_name: "MICHIKUSA",
    description: "行きたい場所がない日に、AIが現在地から道草ルートを作ります。",
    start_url: "/",
    display: "standalone",
    background_color: "#fcfbfa",
    theme_color: "#fcfbfa",
    orientation: "portrait",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      { src: "/apple-touch-icon.svg", sizes: "180x180", type: "image/svg+xml" }
    ]
  };
}
