/**
 * A fixed locale and time zone, not the runtime's own — the initial HTML for a client component
 * is still rendered on the server, and a locale-dependent format would render differently there
 * than after hydration in the browser, which React reports as a mismatch.
 */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}
