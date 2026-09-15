---
paths:
  - "src/app/**"
  - "src/components/**"
  - "src/lib/query/**"
---

# Next.js and data fetching

**Scope:** Which side of the server/client boundary code belongs on, and how the console reads and mutates server state with TanStack Query. It does not cover endpoint shapes; `api-and-validation.md` does.

## Rules

1. Default to a server component and add `'use client'` only for a component that needs state, an effect or an event handler, because every client component ships its dependencies to the browser and the console's static shell needs none of them.
2. Never import a service, the Prisma client or anything reading `process.env` into a client component, since that either fails the build or ships server internals to the browser — and with an API key in scope, the second is the dangerous one.
3. Fetch server state with TanStack Query, never with `useEffect` and `fetch`, because the trace view needs caching, polling, retry and invalidation, and hand-rolling those is how a console ends up with four inconsistent loading states.
4. Create the `QueryClient` inside a `useState` initialiser in a client provider, not as a module constant, so that server rendering cannot share one client — and one user's cache — across requests.
5. Define query keys in one module as typed factories rather than inline string arrays, because an invalidation that misses by one key element fails silently and looks like a caching bug forever.
6. Poll an in-progress run with `refetchInterval` driven by the run's own status and stop polling once it reaches a terminal disposition, since a console left polling a finished run is a permanent background load for no information.
7. Mutate through `useMutation` and invalidate the affected queries in `onSuccess`, rather than writing to the cache by hand, so the server stays the source of truth for what happened.
8. Never optimistically show an approval as applied before the server confirms it, because the operator's approval is the audit record and showing it early is showing something that may not have happened.
9. Keep server state in TanStack Query and UI state in local `useState`; do not introduce a global client store, as there is no state here that is neither of those and a store would only duplicate the cache.
10. Render `generateMetadata` and any SEO-visible content on the server — the console is internal, so the practical form of this rule is that no page should need client JavaScript to show what it is.

## Examples

```ts
// no: hand-rolled fetching, no cache, a new loading state to maintain
useEffect(() => {
  fetch(`/api/runs/${id}`)
    .then((r) => r.json())
    .then(setRun);
}, [id]);

// yes: cached, typed, and polls only while the run is live
const { data: run } = useQuery({
  queryKey: queryKeys.run(id),
  queryFn: () => fetchRun(id),
  refetchInterval: (query) => (isTerminal(query.state.data?.status) ? false : 1000),
});
```

```tsx
// no: a module-level client is shared across server requests
const queryClient = new QueryClient();

// yes: one client per browser session
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

## Anti-patterns

- `'use client'` at the top of a page so that one button can have an `onClick`, pulling the whole subtree into the bundle.
- Inline query keys such as `['run', id]` written slightly differently in two files, so one invalidation silently misses.
- Polling every second forever because the stop condition was never wired to the run's terminal status.
- An optimistic approval that briefly shows a case as approved when the write failed, which is a lie in an audit trail.
- Importing `@/lib/services/cases` into a client component "just for the type", dragging Prisma into the browser bundle.
