"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export function AppSplash() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!standalone || sessionStorage.getItem("syxp-splash-seen")) return;
    sessionStorage.setItem("syxp-splash-seen", "1");
    const showTimer = window.setTimeout(() => setVisible(true), 0);
    const timer = window.setTimeout(() => setVisible(false), 1150);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(timer);
    };
  }, []);
  if (!visible) return null;
  return (
    <div className="app-splash" role="status" aria-label="Abrindo MotoPombal">
      <Image
        src="/brand/motopombal-wordmark.png"
        alt="MotoPombal"
        width={300}
        height={150}
        priority
      />
      <span>Mobilidade rápida e segura</span>
      <i />
    </div>
  );
}
