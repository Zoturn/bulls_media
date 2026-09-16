'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * One `QueryClient` per browser session, created inside a `useState` initialiser rather than as a
 * module constant — a module-level client would be shared across every server render, and with
 * it, one visitor's cache (.claude/rules/nextjs-and-data-fetching.md rule 4).
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
