import type { Metadata } from "next";
import { Almarai } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const almarai = Almarai({
  variable: "--font-almarai",
  subsets: ["arabic"],
  weight: ["300", "400", "700", "800"],
});

// The site and the API always share an origin (compose builds NEXT_PUBLIC_API_URL
// as "$APP_URL/api/v1"), so the share card's absolute URLs are derived here
// rather than configured a second time.
const siteUrl =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/v1\/?$/, "") ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "بحر المعاني — نظام إدارة خدمات الترجمة",
  description: "منصة إدارة عمليات الترجمة المعتمدة",
  // opengraph-image.png next to this file is picked up automatically.
  openGraph: {
    title: "بحر المعاني — للترجمة القانونية المعتمدة",
    description: "منصة إدارة عمليات الترجمة المعتمدة",
    siteName: "بحر المعاني",
    locale: "ar",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      suppressHydrationWarning
      className={`${almarai.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
