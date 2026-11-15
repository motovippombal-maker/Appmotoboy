import type { Metadata } from "next";
import { MarketCustomerShell } from "@/components/marketplace/customer-shell";

export const metadata: Metadata = { title: "Compras | MotoPombal" };
export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return <MarketCustomerShell>{children}</MarketCustomerShell>;
}
