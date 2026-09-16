'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessageFor, fetchInbox, openCase } from '@/lib/query/api';
import { queryKeys } from '@/lib/query/keys';
import type { InboxEntry } from '@/lib/validation/console';
import { formatDateTime } from './format';
import { EmptyState, ErrorState, LoadingState } from './QueryStates';
import { StatusBadge, type ConsoleStatus } from './StatusBadge';

/** No case yet → nothing has started. A case with no run yet → open, waiting to be triaged. */
function statusFor(entry: InboxEntry): ConsoleStatus {
  if (entry.case === null) return 'NOT_STARTED';
  return entry.case.latestRunStatus ?? 'OPEN';
}

/**
 * The list of every inbound enquiry. Reads through TanStack Query, seeded with the server
 * component's own fetch so the first paint needs no round trip
 * (.claude/rules/nextjs-and-data-fetching.md rule 3).
 */
export function InboxView({ initialEntries }: { initialEntries: InboxEntry[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.inbox(),
    queryFn: fetchInbox,
    initialData: initialEntries,
  });

  const open = useMutation({
    mutationFn: openCase,
    onSuccess: ({ caseId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox() });
      router.push(`/console/cases/${caseId}`);
    },
  });

  if (isPending) return <LoadingState label="Loading the inbox…" />;
  // Only page-breaking when there is no data at all to fall back on — `initialData` means a later
  // *background* refetch can fail while `data` still holds the last good list, and that must not
  // blank a perfectly good inbox out from under an operator mid-triage.
  if (error && data === undefined) {
    return <ErrorState message="Could not load the inbox." onRetry={() => void refetch()} />;
  }
  if (data.length === 0) {
    return <EmptyState title="No enquiries waiting." hint="New messages will appear here." />;
  }

  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {data.map((entry) => {
        // Two independent facts about "this row", checked separately rather than through one
        // `pendingThisRow` flag: TS's aliased-condition narrowing treats a boolean that implies
        // `isPending` as contradictory with a later `isError` check (they cannot both be true at
        // once), which silently narrowed `open` to `never` when the two were combined here.
        const isThisRow = open.variables === entry.messageId;
        const pendingThisRow = open.isPending && isThisRow;
        const openError =
          open.isError && isThisRow
            ? errorMessageFor(open.error, 'Could not open this enquiry.')
            : null;
        return (
          <li key={entry.messageId} className="py-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                  {entry.subject}
                </p>
                <p className="truncate text-sm text-zinc-500">
                  {entry.fromName} &lt;{entry.fromAddress}&gt; · {formatDateTime(entry.receivedAt)}
                </p>
              </div>
              <div className="flex items-center gap-3 sm:shrink-0">
                <StatusBadge status={statusFor(entry)} />
                {entry.case === null ? (
                  <button
                    type="button"
                    disabled={pendingThisRow}
                    onClick={() => open.mutate(entry.messageId)}
                    className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    {pendingThisRow ? 'Opening…' : 'Open'}
                  </button>
                ) : (
                  <Link
                    href={`/console/cases/${entry.case.id}`}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    View
                  </Link>
                )}
              </div>
            </div>
            {openError !== null && (
              <p className="mt-1 text-sm text-red-700 dark:text-red-400">{openError}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
