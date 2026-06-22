import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Windvoorspelling — gekalibreerde locaties",
  description: "Bias-gecorrigeerde windvoorspelling op gekalibreerde vaarpunten",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
