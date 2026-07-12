import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MICHIKUSA — ちょっと寄り道の案内",
    short_name: "MICHIKUSA",
    description: "行きたい場所がない日に、現在地から寄り道のルートを提案します。",
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
