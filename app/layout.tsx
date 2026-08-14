import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tidan — Tocht planner",
  description: "Windvoorspelling, getijstroom en polaire-ETA voor de kust en Wadden.",
};

// viewport-fit=cover: nodig zodat env(safe-area-inset-*) op notch/Dynamic-Island-
// toestellen echte waarden krijgt (op desktop blijven de insets 0).
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
