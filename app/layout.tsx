import "./globals.css";
import "leaflet/dist/leaflet.css";
import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import { RouteProvider } from "@/components/route/RouteProvider";

const sans = DM_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Windapp — vertrekvensters",
  description: "Route-planner met wind, getij en stroom langs de vaarroute",
};

export const viewport: Viewport = {
  themeColor: "#030810",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div className="wrap">
          <div className="app">
            <RouteProvider>{children}</RouteProvider>
          </div>
        </div>
      </body>
    </html>
  );
}
