import type { Metadata } from "next";
import { BrasaDemoStore } from "@/components/marketplace/brasa-demo-store";

export const metadata: Metadata = {
  title: "Brasa da Vila · Demonstração | MotoPombal",
  description: "Conheça o modelo de loja de Compras e simule um pedido sem envio ou cobrança.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <BrasaDemoStore />;
}
