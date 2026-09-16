import { STUB_TOOL_EXECUTION_OPTIONS } from './toolExecutionOptions';

/**
 * Calls a tool's `execute` directly in a test and narrows its result to `OUTPUT`.
 *
 * The `tool` parameter is typed `any` deliberately, not out of laziness: `Tool<INPUT, OUTPUT>` is
 * contravariant in `execute`'s `INPUT` position (also true of `needsApproval`), so a concretely
 * typed tool — `Tool<{ query: string }, ...>`, say — can never be assigned to any generic
 * `Tool<unknown, ...>` or `{ execute: (input: unknown, ...) => ... }` parameter type; that is
 * correct variance, not a gap in this helper's typing. Runtime safety is unaffected: every tool
 * validates its own input against its Zod `inputSchema` regardless of what a test passes it, so
 * this helper cannot smuggle a malformed input past that check.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function callTool<OUTPUT>(tool: any, input: unknown): Promise<OUTPUT> {
  // No guard for a missing `execute`: every tool this project builds is created via `tool({ ...
  // execute })`, so `execute` is always present, and a genuinely missing one already throws a
  // clear "not a function" error on its own — a bespoke message here would guard a case that
  // cannot occur today and that nothing exercises.
  return (await tool.execute(input, STUB_TOOL_EXECUTION_OPTIONS)) as OUTPUT;
}
