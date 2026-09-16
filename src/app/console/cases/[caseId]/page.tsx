import { notFound } from 'next/navigation';
import { CaseDetailView } from '@/components/console/CaseDetailView';
import { getCaseDetailRow } from '@/lib/services/consoleReads';
import { toCaseDetail } from '@/lib/validation/console';

export default async function CaseDetailPage(props: PageProps<'/console/cases/[caseId]'>) {
  const { caseId } = await props.params;

  const row = await getCaseDetailRow(caseId);
  if (row === null) notFound();

  return <CaseDetailView caseId={caseId} initialDetail={toCaseDetail(row)} />;
}
