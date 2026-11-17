import { CaseWorkspace } from '../../../components/case/CaseWorkspace.tsx';

export default async function CasePage({ params }: { params: Promise<{ brandId: string; marketplace: string }> }) {
  const { brandId, marketplace } = await params;
  return <CaseWorkspace brandId={decodeURIComponent(brandId)} marketplace={decodeURIComponent(marketplace)} />;
}
