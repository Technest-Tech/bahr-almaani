import type { Metadata } from "next";
import { Almarai } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const almarai = Almarai({
  variable: "--font-almarai",
  subsets: ["arabic"],
  weight: ["300", "400", "700", "800"],
});

export const metadata: Metadata = {
  title: "بحر المعاني — نظام إدارة خدمات الترجمة",
  description: "منصة إدارة عمليات الترجمة المعتمدة",
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
