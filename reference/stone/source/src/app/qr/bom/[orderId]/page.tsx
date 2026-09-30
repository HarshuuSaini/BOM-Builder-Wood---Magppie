import { QrBomPage } from "@/components/QrBomPage";

export default async function BomQrRoute({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <QrBomPage orderId={orderId} />;
}
