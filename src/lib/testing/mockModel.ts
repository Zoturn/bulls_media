import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';

/**
 * A language model that does exactly what a test tells it to, step by step.
 *
 * Two details here are load-bearing, and both were established by running them rather than
 * recalled — a mock written from memory fails silently rather than loudly, which is the worst
 * possible failure mode for test infrastructure:
 *
 * 1. At the provider level `finishReason` is an OBJECT, `{ unified, raw }`, not the bare string
 *    the SDK surfaces on `StepResult`. Passing the string is accepted without complaint, and the
 *    loop then ends after one step *without executing the tool it just called*: the tool call is
 *    recorded, `toolResults` comes back empty, and nothing reports an error.
 * 2. A tool call's `input` is a JSON STRING at this level. The SDK parses and validates it before
 *    the tool's `execute` ever sees it, so passing an object produces a tool call whose arguments
 *    never arrive.
 *
 * Usage is nested here too (`inputTokens: { total }`), unlike the flattened `usage.inputTokens`
 * on a `StepResult`.
 */

/** One scripted model turn. */
export type ScriptedStep =
  /** Call a tool. `input` is written as a normal object; this module stringifies it. */
  | { call: string; input: unknown; toolCallId?: string }
  /** Finish with this object as the structured answer. */
  | { answer: unknown }
  /** Finish with this literal text — for asserting what happens when it is not valid JSON. */
  | { text: string };

export interface ScriptedModelOptions {
  steps: ScriptedStep[];
  /**
   * Keep replaying the last step once the script runs out, for a model that never stops calling
   * tools. Without it, a script that runs out throws, which is what a test wanting a fixed number
   * of steps should want.
   */
  repeatLast?: boolean;
  modelId?: string;
  /** Tokens reported per step, so a test can assert on per-step and total accounting. */
  tokensPerStep?: { input: number; output: number };
}

const TOOL_CALLS: LanguageModelV4FinishReason = { unified: 'tool-calls', raw: 'tool_use' };
const STOP: LanguageModelV4FinishReason = { unified: 'stop', raw: 'end_turn' };

function usageOf(input: number, output: number): LanguageModelV4Usage {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
}

function contentFor(step: ScriptedStep, index: number): LanguageModelV4Content[] {
  if ('call' in step) {
    return [
      {
        type: 'tool-call',
        toolCallId: step.toolCallId ?? `call-${index}`,
        toolName: step.call,
        input: JSON.stringify(step.input),
      },
    ];
  }
  if ('answer' in step) return [{ type: 'text', text: JSON.stringify(step.answer) }];
  return [{ type: 'text', text: step.text }];
}

/**
 * The model, plus `doGenerateCalls` — which a test reads to assert what the model was actually
 * offered at each step, rather than inferring it from what it happened to call.
 */
export function scriptedModel(options: ScriptedModelOptions): MockLanguageModelV4 {
  const { steps, repeatLast = false } = options;
  const { input: inputTokens, output: outputTokens } = options.tokensPerStep ?? {
    input: 100,
    output: 20,
  };
  let index = 0;

  return new MockLanguageModelV4({
    modelId: options.modelId ?? 'mock-model',
    doGenerate: async (): Promise<LanguageModelV4GenerateResult> => {
      const step = index < steps.length ? steps[index] : repeatLast ? steps.at(-1) : undefined;
      if (step === undefined) {
        throw new Error(
          `scriptedModel: the model was called ${index + 1} times but the script has ` +
            `${steps.length} steps. Add a step, or pass repeatLast to keep replaying the last one.`,
        );
      }
      return {
        content: contentFor(step, index++),
        finishReason: 'call' in step ? TOOL_CALLS : STOP,
        usage: usageOf(inputTokens, outputTokens),
        warnings: [],
      };
    },
  });
}

/**
 * The tool names the model was offered on a given step — the allowlist as the provider saw it,
 * which is the thing the phase gate is actually claiming to control.
 */
export function toolsOfferedAt(model: MockLanguageModelV4, stepNumber: number): string[] {
  const call: LanguageModelV4CallOptions | undefined = model.doGenerateCalls[stepNumber];
  if (call === undefined) {
    throw new Error(
      `toolsOfferedAt: the model was called ${model.doGenerateCalls.length} times; no step ${stepNumber}.`,
    );
  }
  return (call.tools ?? []).map((tool) => tool.name).sort();
}
