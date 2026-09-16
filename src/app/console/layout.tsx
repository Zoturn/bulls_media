import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The console's shell. A server component with no client JavaScript of its own — the interactive
 * pieces live in the pages and components it wraps
 * (.claude/rules/nextjs-and-data-fetching.md rule 1).
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-white dark:bg-black">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-6">
        <Link href="/console" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Inbound Brief Desk — Operator Console
        </Link>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
