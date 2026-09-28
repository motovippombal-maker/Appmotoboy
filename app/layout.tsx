import type { Metadata, Viewport } from "next";
import { AppSplash } from "@/components/app-splash";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Moto SyXp",
  title: "Moto SyXp | Mobilidade em Ribeira do Pombal",
  description:
    "Peça, acompanhe e gerencie corridas de mototáxi com a Moto SyXp, by GoSyXP.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon-brand.svg",
    shortcut: "/favicon-brand.svg",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Moto SyXp",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#05090f",
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        <AppSplash />
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
