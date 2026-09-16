import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  Circle,
  Loader2,
  OctagonX,
  XCircle,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { CaseStatus, RunStatus } from '@/lib/domain/enums';

/**
 * A status shown as text plus an icon, never colour alone — a refused case must read as refused,
 * not merely appear red (.claude/rules/ui-and-ux-states.md rule 9).
 */

// `RunStatus | CaseStatus`, derived rather than hand-listed, plus the one value that is the
// console's own invention: a case with no run yet has no status in the domain at all.
export type ConsoleStatus = RunStatus | CaseStatus | 'NOT_STARTED';

const STATUS_INFO: Record<
  ConsoleStatus,
  { label: string; icon: ComponentType<{ className?: string }>; className: string }
> = {
  NOT_STARTED: { label: 'Not started', icon: Circle, className: 'text-zinc-500' },
  RUNNING: { label: 'Running', icon: Loader2, className: 'text-blue-700 dark:text-blue-400' },
  COMPLETED: {
    label: 'Completed',
    icon: CheckCircle2,
    className: 'text-emerald-700 dark:text-emerald-400',
  },
  REFUSED: { label: 'Refused', icon: XCircle, className: 'text-red-700 dark:text-red-400' },
  NEEDS_HUMAN: {
    label: 'Needs review',
    icon: AlertTriangle,
    className: 'text-amber-700 dark:text-amber-400',
  },
  FAILED: { label: 'Failed', icon: OctagonX, className: 'text-red-700 dark:text-red-400' },
  OPEN: { label: 'Open', icon: Circle, className: 'text-zinc-500' },
  RESOLVED: {
    label: 'Resolved',
    icon: CheckCheck,
    className: 'text-emerald-700 dark:text-emerald-400',
  },
};

export function StatusBadge({ status }: { status: ConsoleStatus }) {
  const { label, icon: Icon, className } = STATUS_INFO[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${className}`}>
      <Icon aria-hidden className={`size-4 ${status === 'RUNNING' ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
}
