import { MarketStorePage } from "@/components/marketplace/customer-store";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <MarketStorePage slug={(await params).slug} />;
}
