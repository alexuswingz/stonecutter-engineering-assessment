import { ClientReportView } from '../../../../components/ClientReportView.tsx';

export default async function ReportPage({ params }: { params: Promise<{ brandId: string; marketplace: string }> }) {
  const { brandId, marketplace } = await params;
  return <ClientReportView brandId={decodeURIComponent(brandId)} marketplace={decodeURIComponent(marketplace)} />;
}
