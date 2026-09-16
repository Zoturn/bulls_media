import { AlertCircle, Inbox as InboxIcon, Loader2 } from 'lucide-react';

/**
 * The three states every view that reads data needs besides "loaded"
 * (.claude/rules/ui-and-ux-states.md rule 2) — shared so the inbox and the case view render them
 * identically rather than three ad hoc spinners.
 */

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-12 justify-center text-zinc-500">
      <Loader2 aria-hidden className="size-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <AlertCircle aria-hidden className="size-8 text-red-600" />
      <p className="text-zinc-700 dark:text-zinc-300">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Try again
      </button>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-zinc-500">
      <InboxIcon aria-hidden className="size-8" />
      <p className="font-medium text-zinc-700 dark:text-zinc-300">{title}</p>
      {hint !== undefined && <p className="text-sm">{hint}</p>}
    </div>
  );
}
