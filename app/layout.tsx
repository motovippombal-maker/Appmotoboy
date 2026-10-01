import type { Metadata, Viewport } from "next";
import { AppSplash } from "@/components/app-splash";
import { PwaRegister } from "@/components/pwa-register";
import { parsePublicSiteUrl } from "@/lib/config/public-site-url.mjs";
import "./globals.css";
import "./brand-overrides.css";
import "./driver-workspace.css";
import "./passenger-center.css";
import "./passenger-tracking.css";

const publicSiteUrl = parsePublicSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

export const metadata: Metadata = {
  ...(publicSiteUrl ? { metadataBase: new URL(publicSiteUrl), alternates: { canonical: "/" } } : {}),
  applicationName: "MotoPombal",
  title: "MotoPombal | Mobilidade em Ribeira do Pombal",
  description:
    "Peça, acompanhe e gerencie corridas de mototáxi com a MotoPombal.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/moto-pombal-192.png",
    shortcut: "/icons/moto-pombal-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "MotoPombal",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#071b42",
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
