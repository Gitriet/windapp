import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Windvoorspelling — gekalibreerde locaties",
  description: "Bias-gecorrigeerde windvoorspelling op gekalibreerde vaarpunten",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
