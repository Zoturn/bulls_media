'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessageFor, submitApproval } from '@/lib/query/api';
import { queryKeys } from '@/lib/query/keys';
import type { ApprovalDecision } from '@/lib/domain/enums';
import type { ApprovalRecord, AssessmentRecord } from '@/lib/validation/console';
import { formatCents, formatDateTime } from './format';

/**
 * The one irreversible-looking action in the product. The control names what it approves —
 * advertiser, total, draft — because a mis-click here is a commercial commitment
 * (.claude/rules/ui-and-ux-states.md rule 6), and it never shows a decision as recorded before
 * the server confirms it (.claude/rules/nextjs-and-data-fetching.md rule 8).
 */
export function ApprovalPanel({
  caseId,
  runId,
  assessment,
  approval,
}: {
  caseId: string;
  runId: string;
  assessment: AssessmentRecord;
  approval: ApprovalRecord | null;
}) {
  const queryClient = useQueryClient();
  const [decidedBy, setDecidedBy] = useState('');
  const [note, setNote] = useState('');

  const decide = useMutation({
    mutationFn: (decision: ApprovalDecision) =>
      submitApproval(runId, { decision, decidedBy, note: note.trim() || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.case(caseId) });
    },
  });

  if (approval?.decision != null) {
    const Icon = approval.decision === 'APPROVED' ? CheckCircle2 : XCircle;
    return (
      <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100">
          <Icon aria-hidden className="size-5" />
          {approval.decision === 'APPROVED' ? 'Approved' : 'Rejected'} by {approval.decidedBy}
          {approval.decidedAt !== null && <> on {formatDateTime(approval.decidedAt)}</>}
        </p>
        {approval.note !== null && approval.note !== '' && (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{approval.note}</p>
        )}
      </div>
    );
  }

  const hasDraft = assessment.draftReply !== null;
  const canSubmit = decidedBy.trim().length > 0 && !decide.isPending;

  return (
    <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="font-medium text-zinc-900 dark:text-zinc-100">
        {hasDraft
          ? `Approve sending this reply${
              assessment.quoteCents !== null ? ` (total ${formatCents(assessment.quoteCents)})` : ''
            }?`
          : 'This case needs a human decision before it can close.'}
      </p>
      {hasDraft && assessment.draftReply !== null && (
        <p className="mt-2 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          {assessment.draftReply}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">Your name</span>
          <input
            type="text"
            value={decidedBy}
            onChange={(e) => setDecidedBy(e.target.value)}
            placeholder="Who is deciding?"
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <label className="flex-1 text-sm">
          <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
            Note (optional)
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => decide.mutate('APPROVED')}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          <CheckCircle2 aria-hidden className="size-4" />
          {decide.isPending && decide.variables === 'APPROVED' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => decide.mutate('REJECTED')}
          className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        >
          <XCircle aria-hidden className="size-4" />
          {decide.isPending && decide.variables === 'REJECTED' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>

      {/* The mutation failed: the operator's name and note stay exactly as typed (rule 8) and the
          buttons are re-enabled above via `canSubmit`, not left disabled by a stuck pending state. */}
      {decide.isError && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">
          {errorMessageFor(decide.error, 'Could not record that decision. Please try again.')}
        </p>
      )}
    </div>
  );
}
