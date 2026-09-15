import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
/* Self-hosted fonts (Fontsource woff2, shipped inside node_modules).
   They are imported as CSS instead of fetched from Google Fonts at build
   time, so `next build` never depends on an external network call and the
   fonts keep working offline (PWA) / in restricted CI networks. */
import "@fontsource-variable/fraunces/index.css";
import "@fontsource-variable/noto-sans-devanagari/index.css";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  title: "Smart Tijori — स्मार्ट तिजोरी | Bilingual Document Vault",
  description:
    "A senior-friendly, bilingual (English/हिंदी) smart document vault with voice search, automatic organisation, QR sharing and offline support.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Smart Tijori", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#175732",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="hi">
      <body className="bg-cream font-sans text-ink antialiased">
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
