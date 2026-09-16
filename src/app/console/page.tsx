import type { Metadata } from 'next';
import { InboxView } from '@/components/console/InboxView';
import { listInboxRows } from '@/lib/services/consoleReads';
import { toInboxEntry } from '@/lib/validation/console';

export const metadata: Metadata = { title: 'Inbox — Inbound Brief Desk' };

/**
 * A server component fetching directly through the service layer — no client JavaScript is
 * needed to show what this page shows (.claude/rules/nextjs-and-data-fetching.md rule 10). The
 * client component it renders takes this as `initialData`, so the first paint costs no round trip.
 */
export default async function ConsolePage() {
  const rows = await listInboxRows();
  return <InboxView initialEntries={rows.map(toInboxEntry)} />;
}
