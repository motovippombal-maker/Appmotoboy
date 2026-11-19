import { MerchantManagementPanel } from "@/components/marketplace/management-panel";
import { managementId } from "@/lib/marketplace/management";
import "@/components/marketplace/management.css";

export default async function MerchantPage({ searchParams }: { searchParams: Promise<{ loja?: string | string[] }> }) {
  const requested = managementId.safeParse((await searchParams).loja);
  return <MerchantManagementPanel initialStoreId={requested.success ? requested.data : ""} />;
}
