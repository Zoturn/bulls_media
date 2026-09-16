import { ArrowRight, Bot, Flag, Wrench } from 'lucide-react';
import type { RunStepDto } from '@/lib/validation/console';
import { formatDateTime } from './format';

/**
 * The run's steps, in order, as they are polled in. Rule 3
 * (.claude/rules/ui-and-ux-states.md): a multi-step run takes long enough that a spinner alone is
 * indistinguishable from a hang, so every step already recorded is shown, not just a "working…"
 * placeholder.
 */

const STEP_ICON = { MODEL_CALL: Bot, TOOL_CALL: Wrench, TERMINAL: Flag } as const;

function stepLabel(step: RunStepDto): string {
  if (step.type === 'TOOL_CALL') return step.toolName ?? 'tool call';
  if (step.type === 'MODEL_CALL') return 'Model turn';
  return 'Finished';
}

export function TraceList({ steps }: { steps: RunStepDto[] }) {
  if (steps.length === 0) {
    return <p className="py-4 text-sm text-zinc-500">No steps recorded yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step) => {
        const Icon = STEP_ICON[step.type as keyof typeof STEP_ICON] ?? ArrowRight;
        const failed = step.error !== null;
        return (
          <li
            key={step.id}
            className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
              failed
                ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
                : 'border-zinc-200 dark:border-zinc-800'
            }`}
          >
            <Icon
              aria-hidden
              className={`mt-0.5 size-4 shrink-0 ${failed ? 'text-red-600' : 'text-zinc-500'}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {stepLabel(step)}
                </span>
                <span className="text-xs text-zinc-500">
                  step {step.index + 1} · {step.durationMs}ms
                  {step.tokens !== null && <> · {step.tokens} tokens</>} ·{' '}
                  {formatDateTime(step.createdAt)}
                </span>
              </div>
              {/* "Failed", not "Refused": this step's own error covers any tool-call failure the
                  AI SDK surfaces this way — a phase-allowlist rejection, but just as easily a
                  genuine tool exception — and the two must not read the same
                  (.claude/rules/ui-and-ux-states.md rule 4). The run's own disposition, shown
                  above via StatusBadge, is what actually says whether the case was refused. */}
              {failed && (
                <p className="mt-1 text-red-700 dark:text-red-400">Failed: {step.error}</p>
              )}
              {(step.input !== null || step.output !== null) && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                    Details
                  </summary>
                  {step.input !== null && (
                    <pre className="mt-1 overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                      {step.input}
                    </pre>
                  )}
                  {step.output !== null && (
                    <pre className="mt-1 overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                      {step.output}
                    </pre>
                  )}
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
