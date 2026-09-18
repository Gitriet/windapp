import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

// Space Grotesk voor alle cijfers/labels/tabs, Inter voor lopende tekst (tokens
// --font-num / --font-text in globals.css lezen deze variabelen).
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-space-grotesk", display: "swap" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Tidan",
  description: "Windvoorspelling, getijstroom en polaire-ETA voor de kust en Wadden.",
};

// viewport-fit=cover: nodig zodat env(safe-area-inset-*) op notch/Dynamic-Island-
// toestellen echte waarden krijgt (op desktop blijven de insets 0).
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
