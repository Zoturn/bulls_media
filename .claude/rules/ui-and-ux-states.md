---
paths:
  - "src/app/**"
  - "src/components/**"
  - "src/app/globals.css"
---

# UI and UX states

**Scope:** Styling, and the states every view must handle. The console is an internal operator tool: it is judged on whether someone can tell what the agent did and decide safely, not on decoration.

## Rules

1. Style with Tailwind utilities and keep shared appearance in a component rather than in a custom CSS file, because a second styling system means two places to look and two ways to be inconsistent.
2. Handle four states in every view that reads data — loading, empty, error, loaded — since three of them are what an operator actually hits on a bad day and an unhandled empty state reads as a broken page.
3. Make an in-progress run visibly in progress, with steps appearing as they complete, because a multi-step run takes long enough that a spinner alone is indistinguishable from a hang.
4. Show the refusal reason and the rule that caused it on a refused case, not just the word "refused", as an operator who cannot see why will override it.
5. Present the structured result and the human summary together, with the summary first: the assignment asks for both, and the summary is what a salesperson reads while the JSON is what an engineer checks.
6. Make the approval control unmistakable about what it approves — which advertiser, which total, which draft — because this is the one irreversible-looking action in the product and a mis-click is a commercial commitment.
7. Disable a submit control while its mutation is pending and re-enable it on failure, so a slow request cannot become a double approval.
8. Never present a failed action as succeeded, and keep the operator's input when something fails, since re-entering work after an error is how people stop trusting a tool.
9. Give every interactive element an accessible name, keep the tab order sensible, and do not encode a decision in colour alone — a refused case must read as refused in text, not only in red.
10. Check the inbox and case views at a phone width; an operator triaging from a phone is an ordinary case, and a table that overflows is unusable rather than merely ugly.

## Examples

```tsx
// no: one state handled, so an empty inbox looks like a hung page
if (!cases) return <Spinner />;
return <CaseTable cases={cases} />;

// yes: all four, with the empty case saying what to do next
if (isPending) return <CaseTableSkeleton />;
if (error) return <ErrorState message="Could not load the inbox." onRetry={refetch} />;
if (cases.length === 0) return <EmptyState title="No enquiries waiting." />;
return <CaseTable cases={cases} />;
```

```tsx
// no: the decision is carried by colour alone
<span className="text-red-600">●</span>

// yes: readable without colour, and named for a screen reader
<span className="inline-flex items-center gap-1 text-red-700">
  <XCircle aria-hidden className="size-4" />
  Refused — restricted vertical
</span>
```

## Anti-patterns

- A spinner that covers the whole page for the length of an agent run, hiding the trace that is the most useful thing on screen.
- An approval button reading only "Approve", with the total it commits to somewhere further up the page.
- A status shown only as a coloured dot, which conveys nothing to a screen reader and little in a screenshot.
- Clearing the operator's note when a save fails, making the error cost them their work as well as their time.
- A one-off `.css` file for a single view, starting a second styling system nobody will remember to maintain.
