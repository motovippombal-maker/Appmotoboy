import { MarketOrderPage } from "@/components/marketplace/customer-orders";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <MarketOrderPage orderId={(await params).id} />;
}
