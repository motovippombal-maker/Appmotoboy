import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  applicationName: "Moto VIP",
  title: "Moto VIP | Mototáxi em Ribeira do Pombal",
  description: "Peça, acompanhe e gerencie corridas de mototáxi com a Moto VIP.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon-brand.svg",
    shortcut: "/favicon-brand.svg",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "Moto VIP", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#071c39",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased"><PwaRegister />{children}</body>
    </html>
  );
}
