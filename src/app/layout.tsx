import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Fraunces, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const noto = Noto_Sans_Devanagari({
  subsets: ["devanagari", "latin"],
  variable: "--font-noto",
  display: "swap",
});

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
      <body className={`${fraunces.variable} ${noto.variable} bg-cream font-sans text-ink antialiased`}>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
