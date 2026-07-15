import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Barlow, Barlow_Semi_Condensed, IBM_Plex_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
// Instrument theme fonts (scoped via .instrument in globals.css): Barlow +
// Barlow Semi Condensed for labels/headings, IBM Plex Mono for data.
const barlow = Barlow({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-barlow", display: "swap" });
const barlowCond = Barlow_Semi_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-cond", display: "swap" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex", display: "swap" });

export const metadata: Metadata = {
  title: "Windvoorspelling — gekalibreerde locaties",
  description: "Bias-gecorrigeerde windvoorspelling op gekalibreerde vaarpunten",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${inter.variable} ${mono.variable} ${barlow.variable} ${barlowCond.variable} ${plex.variable}`}>
      <body>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
