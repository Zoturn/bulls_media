/**
 * A minimal stub satisfying `ToolExecutionOptions`'s required fields (`toolCallId`, `messages`,
 * `context`) for a test calling a tool's `execute` directly. None of this project's tools read
 * `options`, so one shared stub is enough for every tool test rather than each file inventing
 * its own.
 */
export const STUB_TOOL_EXECUTION_OPTIONS = {
  toolCallId: 'test-tool-call',
  messages: [],
  context: undefined,
} as const;
