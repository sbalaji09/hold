// Thin seam between the call logic and Claude, so tests can run with a scripted fake.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/** Model ids. FAST speaks live turns (latency matters); SMART builds questions and judges. */
export const MODELS = {
  fast: "claude-haiku-5-5",
  smart: "claude-sonnet-5-5",
} as const;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Hard ceiling for the whole request. */
  timeoutMs?: number;
}

export interface LLM {
  /** Plain text, streamed as it is generated. Throws (from the iterator) on failure. */
  streamText(req: LLMRequest): AsyncIterable<string>;
  /** Structured output validated against `schema`. Throws on failure or refusal. */
  json<T>(req: LLMRequest & { schema: z.ZodType<T> }): Promise<T>;
}

const DEFAULT_STREAM_TIMEOUT_MS = 8_000;
const DEFAULT_JSON_TIMEOUT_MS = 30_000;

/** The real thing. Credentials come from the environment (ANTHROPIC_API_KEY or an `ant auth login` profile). */
export class AnthropicLLM implements LLM {
  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async *streamText(req: LLMRequest): AsyncIterable<string> {
    const stream = this.client.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens ?? 300,
        system: req.system,
        messages: req.messages,
        // Live phone turns: short answers, no thinking, lowest latency.
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
      },
      { signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS), maxRetries: 0 },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
    }
  }

  async json<T>(req: LLMRequest & { schema: z.ZodType<T> }): Promise<T> {
    const response = await this.client.messages.parse(
      {
        model: req.model,
        max_tokens: req.maxTokens ?? 16_000,
        system: req.system,
        messages: req.messages,
        output_config: { effort: "medium", format: zodOutputFormat(req.schema) },
      },
      { signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_JSON_TIMEOUT_MS), maxRetries: 1 },
    );
    if (response.stop_reason === "refusal") throw new Error("Claude declined the request");
    if (response.parsed_output == null) throw new Error(`No structured output (stop_reason ${response.stop_reason})`);
    return response.parsed_output;
  }
}
