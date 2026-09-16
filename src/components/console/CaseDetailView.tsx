'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Play, RotateCcw } from 'lucide-react';
import { errorMessageFor, fetchCaseDetail, startRun } from '@/lib/query/api';
import { queryKeys } from '@/lib/query/keys';
import type { CaseDetail } from '@/lib/validation/console';
import { ApprovalPanel } from './ApprovalPanel';
import { formatDateTime } from './format';
import { ErrorState, LoadingState } from './QueryStates';
import { StatusBadge } from './StatusBadge';
import { TraceList } from './TraceList';

/** Dispositions with something for a human to decide — see design.md on why one action covers both. */
const DECIDABLE_DISPOSITIONS = new Set(['QUOTED', 'NEEDS_INFO', 'NEEDS_REVIEW']);

export function CaseDetailView({
  caseId,
  initialDetail,
}: {
  caseId: string;
  initialDetail: CaseDetail;
}) {
  const queryClient = useQueryClient();

  const { data, error, refetch } = useQuery({
    queryKey: queryKeys.case(caseId),
    queryFn: () => fetchCaseDetail(caseId),
    initialData: initialDetail,
    // Stops the instant the run is no longer RUNNING — a console left polling a finished run is a
    // permanent background load for no information (.claude/rules/nextjs-and-data-fetching.md
    // rule 6).
    refetchInterval: (query) => (query.state.data?.latestRun?.status === 'RUNNING' ? 1500 : false),
  });

  const trigger = useMutation({
    mutationFn: () => startRun(caseId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.case(caseId) });
    },
  });

  // `initialData` means `data` is defined from the very first render, so a later *background*
  // refetch failing (a query error with `data` still holding the last good response) must not
  // blank the whole view — the operator has a perfectly good case in front of them, mid-approval
  // in this component's own case, and losing it to a transient refetch hiccup would be losing
  // their unsent decision along with a screen that never actually broke.
  if (error && data === undefined) {
    return <ErrorState message="Could not load this case." onRetry={() => void refetch()} />;
  }
  // initialData guarantees data is always defined, but useQuery's type does not know that.
  if (data === undefined) return <LoadingState label="Loading…" />;

  const { message, latestRun } = data;
  const canStart = latestRun == null || latestRun.status === 'FAILED';
  const isRetry = latestRun?.status === 'FAILED';
  const showApproval =
    latestRun != null &&
    latestRun.assessment != null &&
    DECIDABLE_DISPOSITIONS.has(latestRun.assessment.disposition) &&
    (latestRun.status === 'COMPLETED' || latestRun.status === 'NEEDS_HUMAN');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {message.subject}
          </h1>
          <StatusBadge status={latestRun?.status ?? 'OPEN'} />
        </div>
        <p className="text-sm text-zinc-500">
          {message.fromName} &lt;{message.fromAddress}&gt; · {formatDateTime(message.receivedAt)}
        </p>
        <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
          {message.body}
        </p>
      </header>

      {canStart && (
        <div>
          <button
            type="button"
            disabled={trigger.isPending}
            onClick={() => trigger.mutate()}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {isRetry ? (
              <RotateCcw aria-hidden className="size-4" />
            ) : (
              <Play aria-hidden className="size-4" />
            )}
            {trigger.isPending ? 'Starting…' : isRetry ? 'Retry Triage' : 'Start Triage'}
          </button>
          {trigger.isError && (
            <p className="mt-2 text-sm text-red-700 dark:text-red-400">
              {errorMessageFor(trigger.error, 'Could not start a run.')}
            </p>
          )}
        </div>
      )}

      {latestRun !== null && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Trace
            </h2>
            <TraceList steps={latestRun.steps} />
          </div>

          {latestRun.diagnostics?.refusalSummary !== undefined && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <p>{latestRun.diagnostics.refusalSummary}</p>
            </div>
          )}

          {latestRun.diagnostics?.violations !== undefined &&
            latestRun.diagnostics.violations.length > 0 && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
                <p className="font-medium text-red-800 dark:text-red-300">
                  The recorded answer did not match what the tools returned:
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {latestRun.diagnostics.violations.map((violation, index) => (
                    <li key={index} className="text-red-700 dark:text-red-400">
                      Claimed {violation.claimed}, but {violation.recorded}.
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {latestRun.assessment !== null && (
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Assessment
              </h2>
              {/* Summary first, structured result after — the summary is what a salesperson
                  reads, the JSON is what an engineer checks (rule 5). */}
              <p className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                {latestRun.assessment.summary}
              </p>
              {latestRun.assessment.refusalReason !== null && (
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <span className="font-medium">Why: </span>
                  {latestRun.assessment.refusalReason}
                </p>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                  Structured result
                </summary>
                <pre className="mt-1 overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                  {latestRun.assessment.structured}
                </pre>
              </details>
            </div>
          )}

          {showApproval && latestRun.assessment !== null && (
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Decision
              </h2>
              <ApprovalPanel
                caseId={caseId}
                runId={latestRun.id}
                assessment={latestRun.assessment}
                approval={latestRun.approval}
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
